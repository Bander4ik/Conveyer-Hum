"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePersistedState } from "../_use-persisted-state";

/**
 * Re-assembly — Tab 3. Hybrid build.
 *
 * Script → AI splits it into scenes → AI matches each scene to a clip in the
 * Google Drive library → the user reviews and swaps any pick (or browses the
 * whole library) → unmatched scenes are generated fresh with Grok → every
 * scene is narrated with MiniMax → assembled into one MP4.
 *
 * This is all the existing pipeline already does: it just POSTs /api/runs with
 * a manual reuseMap (scene index → Drive file id) and autoReuse off.
 */

interface Scene {
  index: number;
  text: string;
  visual_prompt: string;
  duration_hint_sec: number;
}

interface ClipMatch {
  new_scene_index: number;
  drive_file_id: string;
  score: number;
  reason: string;
  source: {
    run_title: string | null;
    folder_name: string;
    drive_file_link: string;
    scene_text: string;
    visual_prompt: string;
    audio_duration_sec: number | null;
  };
}

interface LibraryClip {
  index: number;
  file: string;
  drive_file_id: string;
  drive_file_link: string;
  scene_text: string;
  visual_prompt: string;
  duration_hint_sec: number;
  audio_duration_sec: number | null;
}

interface LibraryRun {
  run_title: string | null;
  folder_name: string;
  channel: string;
  created_at: string;
  clips: LibraryClip[];
}

interface Preset {
  id: number;
  name: string;
}

interface ClipMeta {
  sceneText: string;
  runLabel: string;
  durationSec: number | null;
  link: string;
}

function fmtDur(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  return `${Math.round(sec)}s`;
}

function scoreBadgeClass(score: number): string {
  if (score >= 75) return "badge badge-success";
  if (score >= 60) return "badge badge-accent";
  return "badge badge-neutral";
}

const dangerBox: React.CSSProperties = {
  background: "var(--danger-soft)",
  border: "1px solid rgba(248,113,113,0.3)",
  padding: "9px 12px",
  borderRadius: "var(--r-sm)",
  color: "var(--danger)",
  fontSize: 13,
  lineHeight: 1.5,
};

const noticeBox: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  padding: "10px 13px",
  borderRadius: "var(--r-sm)",
  fontSize: 12.5,
  lineHeight: 1.55,
  color: "var(--fg-muted)",
};

export default function ReassemblyPage() {
  const router = useRouter();

  const [title, setTitle] = usePersistedState("reassembly.title", "");
  const [script, setScript] = usePersistedState("reassembly.script", "");
  const [selectedPresetId, setSelectedPresetId] = usePersistedState<number | null>(
    "reassembly.channel",
    null
  );
  const [crossChannel, setCrossChannel] = usePersistedState("reassembly.crossChannel", false);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);

  // Analyze
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzePhase, setAnalyzePhase] = useState<"" | "split" | "match">("");
  const [error, setError] = useState<string | null>(null);
  const [matchWarning, setMatchWarning] = useState<string | null>(null);

  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [analyzedScript, setAnalyzedScript] = useState("");
  const [matches, setMatches] = useState<ClipMatch[]>([]);
  const [reuseMap, setReuseMap] = useState<Record<number, string>>({});

  // Library browse
  const [library, setLibrary] = useState<LibraryRun[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [browseScene, setBrowseScene] = useState<number | null>(null);
  const [browseQuery, setBrowseQuery] = useState("");

  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prompt-presets")
      .then((r) => r.json())
      .then((rows: Preset[]) => setPresets(Array.isArray(rows) ? rows : []))
      .catch(() => setPresets([]));
    fetch("/api/gdrive/status")
      .then((r) => r.json())
      .then((s: { connected?: boolean }) => setDriveConnected(Boolean(s.connected)))
      .catch(() => setDriveConnected(null));
  }, []);

  const matchesByScene = useMemo(() => {
    const m = new Map<number, ClipMatch[]>();
    for (const x of matches) {
      const list = m.get(x.new_scene_index) ?? [];
      list.push(x);
      m.set(x.new_scene_index, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.score - a.score);
    return m;
  }, [matches]);

  const allLibraryClips = useMemo(() => {
    const out: { clip: LibraryClip; runLabel: string; channel: string }[] = [];
    for (const run of library ?? []) {
      for (const c of run.clips) {
        if (c.drive_file_id) {
          out.push({ clip: c, runLabel: run.run_title || run.folder_name, channel: run.channel });
        }
      }
    }
    return out;
  }, [library]);

  // Metadata for any assigned clip id — pooled from AI matches + the library.
  const clipMetaById = useMemo(() => {
    const m = new Map<string, ClipMeta>();
    for (const x of matches) {
      if (!m.has(x.drive_file_id)) {
        m.set(x.drive_file_id, {
          sceneText: x.source.scene_text,
          runLabel: x.source.run_title || x.source.folder_name,
          durationSec: x.source.audio_duration_sec,
          link: x.source.drive_file_link,
        });
      }
    }
    for (const { clip, runLabel } of allLibraryClips) {
      if (!m.has(clip.drive_file_id)) {
        m.set(clip.drive_file_id, {
          sceneText: clip.scene_text,
          runLabel,
          durationSec: clip.audio_duration_sec,
          link: clip.drive_file_link,
        });
      }
    }
    return m;
  }, [matches, allLibraryClips]);

  const browseResults = useMemo(() => {
    const q = browseQuery.trim().toLowerCase();
    let list = allLibraryClips;
    if (q) {
      list = list.filter(
        (c) =>
          c.clip.scene_text.toLowerCase().includes(q) ||
          c.clip.visual_prompt.toLowerCase().includes(q) ||
          c.runLabel.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allLibraryClips, browseQuery]);

  const reuseCount = Object.keys(reuseMap).length;
  const sceneCount = scenes?.length ?? 0;
  const freshCount = Math.max(0, sceneCount - reuseCount);
  const stale = scenes != null && script.trim() !== analyzedScript;

  async function analyze() {
    if (!script.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setMatchWarning(null);
    setBuildError(null);
    setScenes(null);
    setMatches([]);
    setReuseMap({});
    setBrowseScene(null);
    try {
      setAnalyzePhase("split");
      const pr = await fetch("/api/preview/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, presetId: selectedPresetId }),
      });
      const pj = await pr.json();
      if (!pr.ok) {
        setError(pj.error || `Scene split failed (HTTP ${pr.status})`);
        return;
      }
      const splitScenes = (pj.scenes ?? []) as Scene[];
      if (splitScenes.length === 0) {
        setError("The script produced no scenes — check the text and try again.");
        return;
      }
      setScenes(splitScenes);
      setAnalyzedScript(script.trim());

      setAnalyzePhase("match");
      const channelName =
        selectedPresetId != null
          ? presets.find((p) => p.id === selectedPresetId)?.name ?? "_No Channel"
          : "_No Channel";
      const mr = await fetch("/api/library/find-similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: splitScenes,
          channel: crossChannel ? null : channelName,
        }),
      });
      const mj = await mr.json();
      if (!mr.ok) {
        setMatchWarning(
          (mj.error || `Library match failed (HTTP ${mr.status})`) +
            " — every scene will be generated fresh unless you assign clips by hand."
        );
        return;
      }
      const found = (mj.matches ?? []) as ClipMatch[];
      setMatches(found);

      // Pre-fill: best-scoring match per scene. The user reviews + swaps below.
      const byScene = new Map<number, ClipMatch[]>();
      for (const x of found) {
        const list = byScene.get(x.new_scene_index) ?? [];
        list.push(x);
        byScene.set(x.new_scene_index, list);
      }
      const prefill: Record<number, string> = {};
      for (const [idx, list] of byScene) {
        list.sort((a, b) => b.score - a.score);
        prefill[idx] = list[0].drive_file_id;
      }
      setReuseMap(prefill);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
      setAnalyzePhase("");
    }
  }

  async function loadLibrary() {
    if (library != null || libraryLoading) return;
    setLibraryLoading(true);
    try {
      const r = await fetch("/api/library/runs");
      const j = await r.json();
      setLibrary((j.runs ?? []) as LibraryRun[]);
    } catch {
      setLibrary([]);
    } finally {
      setLibraryLoading(false);
    }
  }

  function assignClip(sceneIndex: number, fileId: string) {
    setReuseMap((prev) => ({ ...prev, [sceneIndex]: fileId }));
  }
  function generateFresh(sceneIndex: number) {
    setReuseMap((prev) => {
      const copy = { ...prev };
      delete copy[sceneIndex];
      return copy;
    });
  }
  function openBrowse(sceneIndex: number) {
    setBrowseQuery("");
    setBrowseScene((cur) => (cur === sceneIndex ? null : sceneIndex));
    loadLibrary();
  }

  async function build() {
    if (!scenes || building) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const body: {
        title?: string;
        script: string;
        autoReuse: boolean;
        reuseMap?: Record<number, string>;
        presetId?: number;
      } = { script, autoReuse: false };
      if (title.trim()) body.title = title.trim();
      if (reuseCount > 0) body.reuseMap = reuseMap;
      if (selectedPresetId != null) body.presetId = selectedPresetId;
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.id) {
        setBuildError(j.error || `Couldn't start the build (HTTP ${r.status})`);
        return;
      }
      router.push(`/runs/${j.id}`);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div>
      <h1>Re-assembly</h1>
      <p className="muted" style={{ marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
        Build a video mostly from clips you already have. AI matches each script scene to a
        clip in your Google Drive library; you swap any pick by hand, and only the missing
        scenes are generated fresh with Grok. Every scene is narrated with MiniMax.
      </p>

      {driveConnected === false && (
        <div style={{ ...noticeBox, marginBottom: 16 }}>
          Google Drive is not connected, so there is no clip library to reuse. Connect it in
          Keys &amp; Settings — until then every scene is generated fresh (same as Video
          Conveyer).
        </div>
      )}

      {/* ── Stage A — input ──────────────────────────────────────── */}
      <div className="card" style={{ display: "grid", gap: 16, marginBottom: 16 }}>
        <div>
          <label className="label">Run title {""}
            <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>(optional)</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Blue Zone — Episode 12"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Channel</label>
          <select
            className="input"
            value={selectedPresetId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedPresetId(v === "" ? null : Number(v));
            }}
          >
            <option value="">Default — no channel profile</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
            Sets the scene-split prompt and the voice. By default the library search stays
            inside this channel.
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={crossChannel}
              onChange={(e) => setCrossChannel(e.target.checked)}
            />
            Search clips from every channel, not just this one
          </label>
        </div>

        <div>
          <label className="label">Script</label>
          <textarea
            className="textarea"
            rows={9}
            placeholder="Paste the full script…"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn" onClick={analyze} disabled={analyzing || !script.trim()}>
            {analyzing
              ? analyzePhase === "split"
                ? "Splitting the script…"
                : "Matching the library…"
              : scenes
                ? "Re-analyze script"
                : "Analyze script & match library"}
          </button>
          {analyzing && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              This calls Gemini — it can take up to a minute on a long script.
            </span>
          )}
        </div>
        {error && <div style={dangerBox}>{error}</div>}
      </div>

      {/* ── Stage B — review ─────────────────────────────────────── */}
      {scenes && scenes.length > 0 && (
        <>
          {stale && (
            <div style={{ ...noticeBox, marginBottom: 12 }}>
              You&apos;ve edited the script since analyzing — the scene list below is from the
              previous version. Re-analyze to refresh it.
            </div>
          )}
          {matchWarning && <div style={{ ...dangerBox, marginBottom: 12 }}>{matchWarning}</div>}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Scenes</h2>
            <span className="badge badge-neutral">{sceneCount}</span>
            <span className="badge badge-success">{reuseCount} reused</span>
            <span className="badge badge-accent">{freshCount} fresh</span>
          </div>

          {scenes.map((scene) => {
            const assignedId = reuseMap[scene.index];
            const assignedMeta = assignedId ? clipMetaById.get(assignedId) : undefined;
            const candidates = matchesByScene.get(scene.index) ?? [];
            const assignedMatch = assignedId
              ? candidates.find((c) => c.drive_file_id === assignedId)
              : undefined;

            return (
              <div key={scene.index} className="card-inset" style={{ padding: 14, marginBottom: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontWeight: 650, fontSize: 13 }}>Scene {scene.index}</span>
                  {assignedId ? (
                    <span className="badge badge-success">Reusing a clip</span>
                  ) : (
                    <span className="badge badge-accent">Generate fresh</span>
                  )}
                  {assignedMatch && (
                    <span className={scoreBadgeClass(assignedMatch.score)}>
                      {assignedMatch.score}% match
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 13, color: "var(--fg)", marginBottom: 8, lineHeight: 1.5 }}>
                  {scene.text}
                </div>

                {/* Current pick */}
                {assignedId ? (
                  <div
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r-sm)",
                      padding: "8px 10px",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ color: "var(--fg-muted)" }}>
                      {assignedMeta
                        ? `Library clip — originally: “${assignedMeta.sceneText.slice(0, 110)}”`
                        : `Library clip ${assignedId.slice(0, 10)}…`}
                    </div>
                    {assignedMeta && (
                      <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                        from {assignedMeta.runLabel} · {fmtDur(assignedMeta.durationSec)}
                        {assignedMeta.link ? (
                          <>
                            {" · "}
                            <a href={assignedMeta.link} target="_blank" rel="noopener noreferrer">
                              view on Drive
                            </a>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="faint" style={{ fontSize: 12 }}>
                    A fresh ~6-second clip will be generated with Grok.
                  </div>
                )}

                {/* AI candidates */}
                {candidates.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="faint" style={{ fontSize: 11, marginBottom: 5 }}>
                      AI-suggested clips — click to use one
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {candidates.map((c) => {
                        const selected = assignedId === c.drive_file_id;
                        return (
                          <button
                            key={c.drive_file_id}
                            onClick={() => assignClip(scene.index, c.drive_file_id)}
                            style={{
                              textAlign: "left",
                              cursor: "pointer",
                              background: selected ? "var(--surface-2)" : "transparent",
                              border: `1px solid ${
                                selected ? "var(--accent)" : "var(--border)"
                              }`,
                              borderRadius: "var(--r-sm)",
                              padding: "8px 10px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                marginBottom: 3,
                              }}
                            >
                              <span className={scoreBadgeClass(c.score)}>{c.score}%</span>
                              <span className="faint" style={{ fontSize: 11 }}>
                                from {c.source.run_title || c.source.folder_name}
                                {" · "}
                                {fmtDur(c.source.audio_duration_sec)}
                              </span>
                              {selected && (
                                <span
                                  style={{
                                    marginLeft: "auto",
                                    color: "var(--accent)",
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                  }}
                                >
                                  ✓ selected
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.45 }}>
                              {c.source.scene_text.slice(0, 130)}
                            </div>
                            {c.reason && (
                              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                                {c.reason}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => generateFresh(scene.index)}
                    disabled={!assignedId}
                  >
                    Generate fresh
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => openBrowse(scene.index)}>
                    {browseScene === scene.index ? "Close library" : "Browse library…"}
                  </button>
                </div>

                {/* Browse-the-whole-library picker */}
                {browseScene === scene.index && (
                  <div
                    style={{
                      marginTop: 10,
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r-sm)",
                      padding: 10,
                    }}
                  >
                    {libraryLoading ? (
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        Loading the Drive library…
                      </div>
                    ) : allLibraryClips.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        No clips in your Drive library yet. Run some videos with Drive sync on,
                        then their clips become reusable here.
                      </div>
                    ) : (
                      <>
                        <input
                          className="input"
                          placeholder="Search every library clip…"
                          value={browseQuery}
                          onChange={(e) => setBrowseQuery(e.target.value)}
                          style={{ marginBottom: 8 }}
                        />
                        <div style={{ maxHeight: 280, overflowY: "auto" }}>
                          {browseResults.slice(0, 60).map(({ clip, runLabel, channel }) => (
                            <div
                              key={clip.drive_file_id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "7px 4px",
                                borderBottom: "1px solid var(--border)",
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "var(--fg)",
                                    lineHeight: 1.4,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {clip.scene_text || clip.visual_prompt.slice(0, 90)}
                                </div>
                                <div className="faint" style={{ fontSize: 11 }}>
                                  {runLabel} · {channel} · {fmtDur(clip.audio_duration_sec)}
                                </div>
                              </div>
                              <button
                                className="btn-secondary btn-sm"
                                onClick={() => {
                                  assignClip(scene.index, clip.drive_file_id);
                                  setBrowseScene(null);
                                }}
                              >
                                Use
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                          {browseResults.length} clip{browseResults.length === 1 ? "" : "s"}
                          {browseResults.length > 60 ? " — showing first 60, refine the search" : ""}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Build bar ──────────────────────────────────────────── */}
          <div
            className="card"
            style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>
                {reuseCount} reused · {freshCount} generated fresh
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                Reusing {reuseCount} clip{reuseCount === 1 ? "" : "s"} skips that many Grok
                generations. The {freshCount} fresh scene{freshCount === 1 ? "" : "s"} and all
                voiceovers are still generated.
              </div>
            </div>
            <button
              className="btn"
              onClick={build}
              disabled={building || stale}
              style={{ marginLeft: "auto", flexShrink: 0 }}
            >
              {building ? "Starting…" : "Build video"}
            </button>
          </div>
          {buildError && <div style={{ ...dangerBox, marginTop: 10 }}>{buildError}</div>}
        </>
      )}
    </div>
  );
}
