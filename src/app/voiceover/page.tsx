"use client";
import { useEffect, useState } from "react";
import { usePersistedState } from "../_use-persisted-state";

/**
 * Voiceover — Tab 2. Standalone MiniMax text-to-speech tool.
 * Paste text → pick a MiniMax voice → generate → play / download the MP3.
 */

interface CatalogVoice {
  voiceId: string;
  name: string;
  description: string | null;
  language: string | null;
  gender: string | null;
  isClone: boolean;
  sampleAudio: string | null;
  tags: string[];
}

interface VoiceoverResult {
  id: string;
  durationSec: number;
  voiceLabel: string;
  textPreview: string;
  createdAt: number;
}

const LANGUAGE_OPTIONS = [
  "auto", "English", "Spanish", "French", "German", "Italian", "Portuguese",
  "Russian", "Ukrainian", "Polish", "Dutch", "Turkish", "Arabic", "Chinese",
  "Japanese", "Korean", "Hindi", "Indonesian",
];

const MAX_CHARS = 100_000;

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function downloadName(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
  const cleaned = words.replace(/[^a-zA-Z0-9 _-]/g, "").trim();
  return cleaned || "voiceover";
}

const dangerBox: React.CSSProperties = {
  background: "var(--danger-soft)",
  border: "1px solid rgba(248,113,113,0.3)",
  padding: "9px 12px",
  borderRadius: "var(--r-sm)",
  color: "var(--danger)",
  fontSize: 12.5,
  lineHeight: 1.5,
};

export default function VoiceoverPage() {
  const [text, setText] = usePersistedState("voiceover.text", "");

  // ── Voice catalog ────────────────────────────────────────────────
  const [catalog, setCatalog] = useState<CatalogVoice[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [search, setSearch] = useState("");

  // ── Voice selection ──────────────────────────────────────────────
  const [selectedVoiceId, setSelectedVoiceId] = usePersistedState("voiceover.voiceId", "");
  const [useCustomVoice, setUseCustomVoice] = usePersistedState("voiceover.useCustom", false);
  const [customVoiceId, setCustomVoiceId] = usePersistedState("voiceover.customVoiceId", "");

  // ── Delivery settings ────────────────────────────────────────────
  const [model, setModel] = usePersistedState("voiceover.model", "speech-02-hd");
  const [speed, setSpeed] = usePersistedState<number>("voiceover.speed", 1);
  const [languageBoost, setLanguageBoost] = usePersistedState("voiceover.lang", "English");

  // ── Generation ───────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [results, setResults] = usePersistedState<VoiceoverResult[]>("voiceover.results", []);

  // Load the catalog on mount and whenever the search changes (debounced).
  useEffect(() => {
    let cancelled = false;
    const delay = search ? 400 : 0;
    const timer = setTimeout(async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const qs = search ? `?search=${encodeURIComponent(search)}` : "";
        const r = await fetch(`/api/voiceover/voices${qs}`);
        const j = (await r.json()) as {
          error?: string;
          voices?: CatalogVoice[];
          hasMore?: boolean;
        };
        if (cancelled) return;
        if (j.error) {
          setCatalogError(j.error);
          setCatalog([]);
          setCatalogHasMore(false);
        } else {
          setCatalog(j.voices ?? []);
          setCatalogHasMore(Boolean(j.hasMore));
        }
      } catch (e) {
        if (!cancelled) {
          setCatalogError(e instanceof Error ? e.message : String(e));
          setCatalog([]);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  // Default the dropdown to the first catalog voice once it loads.
  useEffect(() => {
    if (catalog.length > 0 && !selectedVoiceId) {
      setSelectedVoiceId(catalog[0].voiceId);
    }
  }, [catalog, selectedVoiceId, setSelectedVoiceId]);

  const catalogUnavailable = !catalogLoading && catalogError !== null;
  const customMode = useCustomVoice || catalogUnavailable;
  const effectiveVoiceId = (customMode ? customVoiceId : selectedVoiceId).trim();
  const selectedVoice = catalog.find((v) => v.voiceId === selectedVoiceId) ?? null;

  const charCount = text.length;
  const overLimit = charCount > MAX_CHARS;
  const canGenerate =
    !generating && text.trim().length > 0 && effectiveVoiceId.length > 0 && !overLimit;

  async function generate() {
    if (!canGenerate) return;
    setGenerating(true);
    setGenError(null);
    try {
      const r = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: effectiveVoiceId,
          modelId: model.trim() || "speech-02-hd",
          speed,
          languageBoost: languageBoost === "auto" ? "" : languageBoost,
        }),
      });
      const j = (await r.json()) as { id?: string; durationSec?: number; error?: string };
      if (!r.ok || !j.id) {
        setGenError(j.error || `HTTP ${r.status}`);
        return;
      }
      const catalogName = catalog.find((v) => v.voiceId === effectiveVoiceId)?.name;
      const result: VoiceoverResult = {
        id: j.id,
        durationSec: j.durationSec ?? 0,
        voiceLabel: catalogName || effectiveVoiceId,
        textPreview: text.trim().slice(0, 90),
        createdAt: Date.now(),
      };
      setResults((prev) => [result, ...prev].slice(0, 20));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <h1>Voiceover</h1>
      <p className="muted" style={{ marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
        Standalone narration tool — paste any text, pick a MiniMax voice, and generate a
        downloadable MP3. Runs on the same 69labs key as the rest of Conveyer Hum.
      </p>

      {/* ── Text ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <label className="label">Text to narrate</label>
        <textarea
          className="textarea"
          rows={8}
          placeholder="Paste the text you want spoken aloud…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div
          className="faint"
          style={{ fontSize: 12, marginTop: 6, color: overLimit ? "var(--danger)" : undefined }}
        >
          {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
          {overLimit ? " — too long, trim it before generating" : ""}
        </div>
      </div>

      {/* ── Voice & delivery ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Voice</h2>

        {catalogUnavailable ? (
          <>
            <div style={{ ...dangerBox, marginBottom: 12 }}>
              Couldn&apos;t load the MiniMax voice catalog: {catalogError}. Add your 69labs
              key in Keys &amp; Settings, or paste a voice id manually below.
            </div>
            <label className="label">MiniMax voice id</label>
            <input
              className="input"
              placeholder="e.g. English_Comedian"
              value={customVoiceId}
              onChange={(e) => setCustomVoiceId(e.target.value)}
            />
          </>
        ) : (
          <>
            <input
              className="input"
              placeholder="Search voices by name, language, style…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            {catalogLoading ? (
              <div className="muted" style={{ fontSize: 13, padding: "6px 0" }}>
                Loading MiniMax voices…
              </div>
            ) : (
              <>
                <select
                  className="select"
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  disabled={useCustomVoice}
                >
                  {catalog.length === 0 && <option value="">No voices found</option>}
                  {catalog.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                      {v.gender ? ` · ${v.gender}` : ""}
                      {v.language ? ` · ${v.language}` : ""}
                      {v.isClone ? " · cloned" : ""}
                    </option>
                  ))}
                </select>
                {catalogHasMore && (
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>
                    Showing the first 100 voices — use search to narrow it down.
                  </div>
                )}
                {selectedVoice?.sampleAudio && !useCustomVoice && (
                  <div style={{ marginTop: 8 }}>
                    <div className="faint" style={{ fontSize: 11.5, marginBottom: 3 }}>
                      Voice sample
                    </div>
                    <audio
                      controls
                      src={selectedVoice.sampleAudio}
                      style={{ width: "100%", height: 34 }}
                    />
                  </div>
                )}

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 12,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useCustomVoice}
                    onChange={(e) => setUseCustomVoice(e.target.checked)}
                  />
                  Use a custom / cloned voice id instead
                </label>
                {useCustomVoice && (
                  <input
                    className="input"
                    placeholder="e.g. a cloned-voice id from your 69labs dashboard"
                    value={customVoiceId}
                    onChange={(e) => setCustomVoiceId(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* Delivery settings */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginTop: 16,
          }}
        >
          <div>
            <label className="label">MiniMax model</label>
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="speech-02-hd"
            />
            <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              Leave as speech-02-hd unless 69labs lists a newer model.
            </div>
          </div>
          <div>
            <label className="label">Language boost</label>
            <select
              className="select"
              value={languageBoost}
              onChange={(e) => setLanguageBoost(e.target.value)}
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l === "auto" ? "Auto-detect" : l}
                </option>
              ))}
            </select>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              Sharpens pronunciation for the text&apos;s language.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="label">
            Speed — <strong style={{ color: "var(--fg)" }}>{speed.toFixed(2)}×</strong>
          </label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
            1.00× is the neutral pace. Lower is slower and more deliberate.
          </div>
        </div>
      </div>

      {/* ── Generate ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button className="btn" onClick={generate} disabled={!canGenerate}>
          {generating ? "Generating…" : "Generate voiceover"}
        </button>
        {generating && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            Calling MiniMax — this can take up to a minute for long text.
          </span>
        )}
      </div>
      {genError && <div style={{ ...dangerBox, fontSize: 13, margin: "8px 0" }}>{genError}</div>}

      {/* ── Results ──────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Generated</h2>
            <span className="badge badge-neutral">{results.length}</span>
            <button
              className="btn-ghost btn-sm"
              style={{ marginLeft: "auto" }}
              onClick={() => setResults([])}
            >
              Clear list
            </button>
          </div>
          {results.map((r) => (
            <div key={r.id} className="card-inset" style={{ padding: 14, marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <span className="badge badge-success">{fmtDuration(r.durationSec)}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.voiceLabel}</span>
                <span className="faint" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                  {new Date(r.createdAt).toLocaleTimeString()}
                </span>
              </div>
              {r.textPreview && (
                <div className="faint" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
                  &ldquo;{r.textPreview}
                  {r.textPreview.length >= 90 ? "…" : ""}&rdquo;
                </div>
              )}
              <audio
                controls
                src={`/api/voiceover/${r.id}/file`}
                style={{ width: "100%", height: 38 }}
              />
              <div style={{ marginTop: 8 }}>
                <a
                  className="btn-secondary btn-sm"
                  href={`/api/voiceover/${r.id}/file?download=1&name=${encodeURIComponent(
                    downloadName(r.textPreview)
                  )}`}
                  style={{ textDecoration: "none" }}
                >
                  ↓ Download MP3
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
