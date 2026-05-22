"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePersistedState } from "./_use-persisted-state";

// Rough estimate: TTS narration averages ~150 words per minute
const WORDS_PER_MINUTE = 150;

// Per-job time estimates (in seconds), empirically tuned from production runs
const AVG_IMAGE_SEC = 90;
const AVG_GROK_VIDEO_SEC = 75; // Grok via 69labs averages ~60-90s per clip
const AVG_TTS_SEC = 4;
const AVG_CLIP_RENDER_SEC = 8;
const XFADE_FRAMES_PER_SEC = 1800;

interface StatsResp {
  keyCount: number;
  perKey: { image: number; tts: number; anim: number };
  total: { image: number; tts: number; anim: number };
  assembleConcurrency: number;
  xfadeChunks: number;
  animationEnabled: boolean;
  animationRatio: number;
}

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

interface GdriveStatus {
  connected: boolean;
}

export default function NewRunPage() {
  // Persisted across navigation so a pasted script isn't lost on a tab switch.
  const [title, setTitle] = usePersistedState("newrun.title", "");
  const [script, setScript] = usePersistedState("newrun.script", "");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [drive, setDrive] = useState<GdriveStatus | null>(null);

  // Library preview state
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [matches, setMatches] = useState<ClipMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reuseMap, setReuseMap] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Channel profiles
  const [presets, setPresets] = useState<{ id: number; name: string }[]>([]);
  const [selectedPresetId, setSelectedPresetId] = usePersistedState<number | null>(
    "newrun.channel",
    null
  );
  // Library search scope — by default only the selected channel; opt into all.
  const [crossChannel, setCrossChannel] = useState(false);

  // Library reuse mode. Auto: the pipeline finds + reuses clips itself (no
  // clicking). Manual: preview scenes and pick clips by hand in the section below.
  const [reuseMode, setReuseMode] = usePersistedState<"auto" | "manual">(
    "newrun.reuseMode",
    "auto"
  );

  const AUTO_PICK_THRESHOLD = 80;
  const router = useRouter();

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
    fetch("/api/gdrive/status")
      .then((r) => r.json())
      .then(setDrive)
      .catch(() => setDrive(null));
    fetch("/api/prompt-presets")
      .then((r) => r.json())
      .then((rows: { id: number; name: string }[]) => setPresets(rows))
      .catch(() => setPresets([]));
  }, []);

  const scriptStats = useMemo(() => {
    const text = script.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const seconds = (words / WORDS_PER_MINUTE) * 60;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return {
      words,
      chars,
      duration: words === 0 ? "—" : m > 0 ? `~${m} min ${s} s` : `~${s} s`,
      scenes: Math.max(1, Math.round(seconds / 5)),
      narrationSeconds: seconds,
    };
  }, [script]);

  const timeEstimate = useMemo(() => {
    if (!stats || scriptStats.scenes === 0) return null;
    const N = scriptStats.scenes;
    const imageMin = (Math.ceil(N / stats.total.image) * AVG_IMAGE_SEC) / 60;
    const animScenes = stats.animationEnabled ? Math.ceil(N * (stats.animationRatio / 100)) : 0;
    const animMin =
      animScenes > 0 ? (Math.ceil(animScenes / stats.total.anim) * AVG_GROK_VIDEO_SEC) / 60 : 0;
    const ttsMin = (Math.ceil(N / stats.total.tts) * AVG_TTS_SEC) / 60;
    const phase1 = Math.max(imageMin, animMin, ttsMin);
    const phase2 = (Math.ceil(N / stats.assembleConcurrency) * AVG_CLIP_RENDER_SEC) / 60;
    const totalFrames = scriptStats.narrationSeconds * 30;
    const chunks = stats.xfadeChunks;
    const phase3 = totalFrames / chunks / XFADE_FRAMES_PER_SEC / 60;
    const total = phase1 + phase2 + phase3;
    return { total, phase1, phase2, phase3, imageMin, animMin, ttsMin, animScenes };
  }, [stats, scriptStats]);

  const matchesByScene = useMemo(() => {
    const m = new Map<number, ClipMatch[]>();
    for (const x of matches ?? []) {
      const list = m.get(x.new_scene_index) ?? [];
      list.push(x);
      m.set(x.new_scene_index, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.score - a.score);
    return m;
  }, [matches]);

  useEffect(() => {
    if (!matches || matches.length === 0) return;
    const auto: Record<number, string> = {};
    for (const [sceneIdx, list] of matchesByScene.entries()) {
      const best = list[0];
      if (best && best.score >= AUTO_PICK_THRESHOLD) {
        auto[sceneIdx] = best.drive_file_id;
      }
    }
    setReuseMap(auto);
    setExpanded({});
  }, [matches, matchesByScene]);

  const reuseCount = Object.keys(reuseMap).length;

  async function previewScenes() {
    if (!script.trim()) return;
    setPreviewing(true);
    setMatches(null);
    setReuseMap({});
    try {
      const r = await fetch("/api/preview/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, presetId: selectedPresetId }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(`Couldn't split scenes:\n\n${j.error || r.statusText}`);
        return;
      }
      setScenes(j.scenes as Scene[]);
    } finally {
      setPreviewing(false);
    }
  }

  async function findClips() {
    if (!scenes) return;
    setSearching(true);
    try {
      // Scope the search: the selected channel by default, or every channel
      // when the cross-channel toggle is on.
      const channelName =
        selectedPresetId != null
          ? (presets.find((p) => p.id === selectedPresetId)?.name ?? "_No Channel")
          : "_No Channel";
      const r = await fetch("/api/library/find-similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes, channel: crossChannel ? null : channelName }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(`Couldn't search library:\n\n${j.error || r.statusText}`);
        return;
      }
      setMatches(j.matches as ClipMatch[]);
    } finally {
      setSearching(false);
    }
  }

  function toggleReuse(sceneIndex: number, fileId: string) {
    setReuseMap((prev) => {
      const copy = { ...prev };
      if (copy[sceneIndex] === fileId) delete copy[sceneIndex];
      else copy[sceneIndex] = fileId;
      return copy;
    });
  }

  async function start() {
    setBusy(true);
    try {
      const body: {
        title?: string;
        script: string;
        reuseMap?: Record<number, string>;
        presetId?: number | null;
        autoReuse: boolean;
      } = { title, script, autoReuse: reuseMode === "auto" };
      if (reuseCount > 0) body.reuseMap = reuseMap;
      if (selectedPresetId != null) body.presetId = selectedPresetId;
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        alert(`Error: ${await r.text()}`);
        return;
      }
      const data = (await r.json()) as { id: string };
      router.push(`/runs/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Video Conveyer</h1>
      <p className="muted" style={{ marginBottom: 24, fontSize: 14 }}>
        Paste a script — the system splits it into scenes, generates voiceover and video, then
        assembles the final MP4. Optionally preview scenes first and reuse clips from past runs.
      </p>

      <div className="card" style={{ display: "grid", gap: 16 }}>
        <div>
          <label className="label">Title (optional)</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Okinawa Longevity — Test 1"
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
              setScenes(null);
              setMatches(null);
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
            Picks the scene-split prompt, voice and motion for this channel. Manage in Channels &amp; Prompts.
          </div>
        </div>

        <div>
          <label className="label">Library reuse</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={reuseMode === "auto" ? "btn btn-sm" : "btn-secondary btn-sm"}
              onClick={() => {
                setReuseMode("auto");
                setMatches(null);
                setReuseMap({});
              }}
            >
              Auto
            </button>
            <button
              type="button"
              className={reuseMode === "manual" ? "btn btn-sm" : "btn-secondary btn-sm"}
              onClick={() => setReuseMode("manual")}
            >
              Manual
            </button>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
            {reuseMode === "auto"
              ? "The app searches your Drive library and reuses matching clips automatically — scenes with no match are generated. Just press Run pipeline."
              : "Preview the scenes, search the library, and pick which clips to reuse yourself."}
          </div>
        </div>

        <div>
          <label className="label">Script</label>
          <textarea
            className="textarea"
            rows={14}
            value={script}
            onChange={(e) => {
              setScript(e.target.value);
              setScenes(null);
              setMatches(null);
              setReuseMap({});
            }}
            placeholder="Paste the full narrator script here..."
          />
          <div
            style={{
              display: "flex",
              gap: 18,
              marginTop: 10,
              fontSize: 13,
              color: "var(--fg-muted)",
              flexWrap: "wrap",
            }}
          >
            <span>
              <strong style={{ color: "var(--fg)" }}>{scriptStats.words}</strong> words
            </span>
            <span>
              <strong style={{ color: "var(--fg)" }}>{scriptStats.chars}</strong> chars
            </span>
            <span>
              ≈ <strong style={{ color: "var(--accent-hover)" }}>{scriptStats.duration}</strong> final video
            </span>
            <span>
              ≈ <strong style={{ color: "var(--fg)" }}>{scriptStats.scenes}</strong> scenes
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={start} disabled={busy || !script.trim()}>
            {busy
              ? "Starting…"
              : reuseCount > 0
                ? `Run pipeline · reusing ${reuseCount} clip${reuseCount === 1 ? "" : "s"}`
                : "Run pipeline"}
          </button>
          <button
            className="btn-secondary"
            onClick={previewScenes}
            disabled={previewing || !script.trim()}
            title="See the scenes before running. Lets you pick reusable clips from past runs."
          >
            {previewing ? "Splitting…" : scenes ? "Re-split scenes" : "Preview scenes first"}
          </button>
        </div>
      </div>

      {/* ─── Scene preview + library suggestions ─────────────────────────── */}
      {scenes && scenes.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ marginBottom: 2 }}>Scene preview · {scenes.length}</h2>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {reuseMode === "auto"
                  ? "Auto reuse is on — the app handles library clips for you. This is just a preview of the split."
                  : "Reuse clips from past runs to skip generation — saves time and credits."}
              </div>
            </div>
            {reuseMode === "manual" && (drive?.connected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <button className="btn-secondary btn-sm" onClick={findClips} disabled={searching}>
                  {searching
                    ? "Searching library…"
                    : matches
                      ? "Search again"
                      : "Find existing clips"}
                </button>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    color: "var(--fg-muted)",
                    cursor: "pointer",
                  }}
                  title="By default the search is scoped to the selected channel. Tick this to search across every channel."
                >
                  <input
                    type="checkbox"
                    checked={crossChannel}
                    onChange={(e) => setCrossChannel(e.target.checked)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Search all channels
                </label>
              </div>
            ) : (
              <a className="btn-secondary btn-sm" href="/settings" title="Connect Google Drive to enable library search">
                Connect Drive to search
              </a>
            ))}
          </div>

          {matches !== null && matches.length === 0 && (
            <div
              className="card-inset"
              style={{ marginBottom: 12, padding: "10px 12px", color: "var(--fg-muted)", fontSize: 12.5 }}
            >
              No similar clips found in your library — every scene will be generated from scratch.
            </div>
          )}

          {matches !== null && matches.length > 0 && (
            <div
              style={{
                marginBottom: 14,
                padding: "11px 13px",
                background: reuseCount > 0 ? "var(--success-soft)" : "var(--surface-2)",
                border: `1px solid ${reuseCount > 0 ? "rgba(74,222,128,0.3)" : "var(--border)"}`,
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                color: reuseCount > 0 ? "var(--success)" : "var(--fg-muted)",
                lineHeight: 1.55,
              }}
            >
              {reuseCount > 0 ? (
                <>
                  Auto-picked {reuseCount} clip{reuseCount === 1 ? "" : "s"} at ≥{AUTO_PICK_THRESHOLD}% confidence.
                  Other scenes generate fresh. Click any scene below to inspect or change the pick.
                </>
              ) : (
                <>
                  Found {matches.length} suggestion{matches.length === 1 ? "" : "s"} across{" "}
                  {matchesByScene.size} scene{matchesByScene.size === 1 ? "" : "s"}, but none passed the{" "}
                  {AUTO_PICK_THRESHOLD}% auto-pick threshold. Click a scene to review and pick manually.
                </>
              )}
              <div style={{ marginTop: 9, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    const all: Record<number, boolean> = {};
                    for (const idx of matchesByScene.keys()) all[idx] = true;
                    setExpanded(all);
                  }}
                >
                  Expand all
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setExpanded({})}>
                  Collapse all
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            {scenes.map((scene) => {
              const sceneMatches = matchesByScene.get(scene.index) ?? [];
              const picked = reuseMap[scene.index];
              const pickedMatch = picked ? sceneMatches.find((m) => m.drive_file_id === picked) : null;
              const bestScore = sceneMatches[0]?.score ?? 0;
              const isExpanded = !!expanded[scene.index];

              let statusBadge: React.ReactNode = null;
              if (pickedMatch) {
                statusBadge = (
                  <span className="badge badge-success">✓ reusing {pickedMatch.score}%</span>
                );
              } else if (sceneMatches.length > 0 && bestScore >= AUTO_PICK_THRESHOLD) {
                statusBadge = (
                  <span className="badge" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
                    will generate new
                  </span>
                );
              } else if (sceneMatches.length > 0) {
                statusBadge = (
                  <span className="badge badge-neutral">
                    {sceneMatches.length} low-confidence
                  </span>
                );
              }

              return (
                <div
                  key={scene.index}
                  className="card-inset"
                  style={{ borderColor: pickedMatch ? "rgba(74,222,128,0.3)" : undefined }}
                >
                  <div
                    style={{
                      padding: "9px 11px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: sceneMatches.length > 0 ? "pointer" : "default",
                    }}
                    onClick={() => {
                      if (sceneMatches.length === 0) return;
                      setExpanded((prev) => ({ ...prev, [scene.index]: !prev[scene.index] }));
                    }}
                  >
                    <span style={{ fontWeight: 650, fontSize: 12.5, minWidth: 62 }}>
                      Scene {scene.index + 1}
                    </span>
                    <span
                      style={{
                        color: "var(--fg-muted)",
                        fontSize: 12.5,
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={scene.text}
                    >
                      {scene.text}
                    </span>
                    {statusBadge}
                    {sceneMatches.length > 0 && (
                      <span style={{ color: "var(--fg-faint)", fontSize: 11, width: 12, textAlign: "center" }}>
                        {isExpanded ? "▾" : "▸"}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div style={{ padding: "0 11px 11px", borderTop: "1px solid var(--border)" }}>
                      <div style={{ color: "var(--fg-muted)", fontSize: 12.5, lineHeight: 1.5, margin: "9px 0 4px" }}>
                        {scene.text}
                      </div>
                      <div
                        className="mono"
                        style={{ color: "var(--accent-hover)", fontSize: 11, lineHeight: 1.45, marginBottom: 10 }}
                      >
                        {scene.visual_prompt}
                      </div>
                      {sceneMatches.length > 0 && (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                            Suggestions (sorted by confidence):
                          </div>
                          {sceneMatches.map((m) => {
                            const isPicked = picked === m.drive_file_id;
                            return (
                              <label
                                key={m.drive_file_id}
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  padding: 9,
                                  background: isPicked ? "var(--success-soft)" : "var(--surface)",
                                  border: `1px solid ${isPicked ? "rgba(74,222,128,0.3)" : "var(--border)"}`,
                                  borderRadius: "var(--r-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isPicked}
                                  onChange={() => toggleReuse(scene.index, m.drive_file_id)}
                                  style={{ marginTop: 3, accentColor: "var(--accent)" }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      alignItems: "baseline",
                                      flexWrap: "wrap",
                                      marginBottom: 4,
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 650,
                                        color: m.score >= AUTO_PICK_THRESHOLD ? "var(--success)" : "var(--warning)",
                                      }}
                                    >
                                      {m.score}% match
                                      {m.score >= AUTO_PICK_THRESHOLD ? " · auto-pick" : ""}
                                    </span>
                                    <span className="faint" style={{ fontSize: 11 }}>
                                      from &quot;{m.source.run_title || m.source.folder_name}&quot;
                                    </span>
                                    <a
                                      href={m.source.drive_file_link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ fontSize: 11, marginLeft: "auto" }}
                                    >
                                      Preview ↗
                                    </a>
                                  </div>
                                  <div style={{ fontSize: 11, color: "var(--fg-muted)", marginBottom: 4 }}>
                                    {m.reason}
                                  </div>
                                  <div
                                    className="mono"
                                    style={{
                                      fontSize: 10,
                                      color: "var(--fg-faint)",
                                      lineHeight: 1.4,
                                      maxHeight: 40,
                                      overflow: "auto",
                                    }}
                                  >
                                    {m.source.visual_prompt}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {reuseCount > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "11px 13px",
                background: "var(--success-soft)",
                border: "1px solid rgba(74,222,128,0.3)",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                color: "var(--success)",
              }}
            >
              {reuseCount} clip{reuseCount === 1 ? "" : "s"} marked for reuse. Click{" "}
              <strong>Run pipeline</strong> above — those scenes skip generation and download from Drive.
            </div>
          )}
        </div>
      )}

      {/* ─── Time estimate ───────────────────────────────────────────────── */}
      {timeEstimate && stats && scriptStats.words > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Estimated time</h2>
            <span
              style={{
                color: "var(--accent-hover)",
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              ~{timeEstimate.total < 1 ? "<1" : Math.round(timeEstimate.total)} min
            </span>
          </div>
          <div style={{ color: "var(--fg-muted)", fontSize: 13, lineHeight: 1.8 }}>
            <div>
              <strong style={{ color: "var(--fg)" }}>Parallel generation</strong>
              {stats.animationEnabled ? ` (TTS + ${timeEstimate.animScenes} video clips)` : " (TTS)"}: ~
              {Math.round(timeEstimate.phase1)} min
              <span className="faint" style={{ marginLeft: 8 }}>
                {stats.keyCount} {stats.keyCount === 1 ? "key" : "keys"} · {stats.total.anim} video / {stats.total.tts} TTS in parallel
              </span>
            </div>
            <div>
              <strong style={{ color: "var(--fg)" }}>FFmpeg clip render</strong>: ~
              {Math.round(timeEstimate.phase2 * 10) / 10} min
              <span className="faint" style={{ marginLeft: 8 }}>
                {stats.assembleConcurrency} clips at once
              </span>
            </div>
            <div>
              <strong style={{ color: "var(--fg)" }}>Final xfade assembly</strong>: ~
              {Math.round(timeEstimate.phase3 * 10) / 10} min
              <span className="faint" style={{ marginLeft: 8 }}>
                {stats.xfadeChunks} parallel chunks
              </span>
            </div>
          </div>
          {stats.keyCount === 1 && scriptStats.scenes > 30 && (
            <div
              style={{
                color: "var(--warning)",
                fontSize: 12,
                marginTop: 11,
                padding: "9px 11px",
                background: "var(--warning-soft)",
                borderRadius: "var(--r-sm)",
                lineHeight: 1.55,
              }}
            >
              You&apos;re on a single 69labs key. A 2nd key roughly halves the generation phase
              (~{Math.round(timeEstimate.total / 2)} min instead of ~{Math.round(timeEstimate.total)} min).
              Add keys in <a href="/settings">Keys &amp; Settings</a>.
            </div>
          )}
          <div className="faint" style={{ fontSize: 11, marginTop: 9 }}>
            Rough numbers — real runs are usually 10–30% faster.
          </div>
        </div>
      )}

      {/* ─── How it works ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 8 }}>What happens next</h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.75, margin: 0, color: "var(--fg-muted)", fontSize: 13.5 }}>
          <li>Gemini splits the script into scenes, each with a visual prompt.</li>
          <li>Per scene, MiniMax TTS narration and a Grok video clip generate in parallel.</li>
          <li>FFmpeg stitches all clips together with crossfade transitions.</li>
          <li>If Drive sync is on, the finished run uploads automatically.</li>
        </ol>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
          Live logs for every stage stream into the run page in real time.
        </p>
      </div>
    </div>
  );
}
