import db from "./db";

/**
 * Keys the user can edit through the UI or via .env.
 * UI takes precedence over .env (env is only the fallback when the DB row is empty).
 */
export const SETTING_KEYS = [
  // ── Required API keys ─────────────────────────────────────────────
  "GOOGLE_API_KEY",          // Gemini — scene splitting
  "LABS69_API_KEY",          // 69labs — Grok video + MiniMax voiceover

  // ── Optional / backup providers ───────────────────────────────────
  "ELEVENLABS_API_KEY",      // direct ElevenLabs (without 69labs)
  "REPLICATE_API_TOKEN",     // Replicate (Flux / Kling)
  "ANTHROPIC_API_KEY",       // Claude (alternative to Gemini)
  "OPENAI_API_KEY",          // OpenAI TTS / image backup
  "FAL_API_KEY",             // fal.ai (alternative to Replicate)
  "FFMPEG_PATH",             // absolute path to ffmpeg.exe if not in system PATH

  // ── Storage ───────────────────────────────────────────────────────
  "RUNS_OUTPUT_DIR",         // where run folders are written. Empty = default

  // ── Scene splitting (LLM) ─────────────────────────────────────────
  "SCENE_SPLIT_PROVIDER",    // google | anthropic
  "SCENE_SPLIT_MODEL",       // e.g. gemini-flash-latest, claude-sonnet-4-6

  // ── Text-to-Speech ────────────────────────────────────────────────
  "TTS_PROVIDER",            // minimax (default) | 69labs | elevenlabs | openai
  "TTS_VOICE_PROVIDER",      // For 69labs: edgetts | elevenlabs | voice-clone
  "TTS_VOICE_ID",            // Voice id — MiniMax catalog/clone id, or ElevenLabs/Edge id
  "TTS_MODEL",               // MiniMax: speech-02-hd · ElevenLabs: eleven_multilingual_v2
  "TTS_SPLIT_TYPE",          // smart | paragraphs | max_length
  "TTS_LANGUAGE_BOOST",      // MiniMax pronunciation hint, e.g. English | auto

  // ── ElevenLabs voice fine-tuning ──────────────────────────────────
  "TTS_SPEED",               // 0.7–1.2 (lower = slower)
  "TTS_STABILITY",           // 0–1
  "TTS_SIMILARITY_BOOST",    // 0–1
  "TTS_STYLE",               // 0–1
  "TTS_USE_SPEAKER_BOOST",   // "1" / "0" / ""

  // ── Auto-pause (stops TTS from "swallowing" sentence ends) ────────
  "TTS_AUTO_PAUSE",          // "1" to enable
  "TTS_PAUSE_DURATION",      // seconds (0.1–30)
  "TTS_PAUSE_FREQUENCY",     // 1–100

  // ── Images ────────────────────────────────────────────────────────
  "IMAGE_PROVIDER",          // 69labs | replicate | openai | fal
  "IMAGE_MODEL",             // e.g. nano-banana-pro, imagen-4, seedream-4.5
  "IMAGE_RATIO",             // e.g. 16:9, 9:16, 1:1
  "IMAGE_RESOLUTION",        // 1k | 2k | 4k (for models that support it)

  // ── Animations (img2vid) ──────────────────────────────────────────
  "ANIMATION_PROVIDER",      // off | 69labs | replicate | fal
  "ANIMATION_MODEL",         // e.g. veo-video, grok-imagine-video
  "ANIMATION_RATIO_PERCENT", // 0–100, percentage of scenes to animate
  "ANIMATION_DISTRIBUTION",  // first-half | alternating | random | all
  "ANIMATION_DURATION",      // seconds (provider-dependent)
  "ANIMATION_KEEP_VEO_AUDIO", // "1" to keep Veo's generated ambient audio

  // ── Video assembly (FFmpeg) ───────────────────────────────────────
  "VIDEO_RESOLUTION",        // e.g. 1920x1080
  "VIDEO_FPS",               // 24 / 30 / 60
  "SCENE_DURATION_SECONDS",  // fallback duration when TTS length is unknown
  "TRANSITION_DURATION",     // crossfade between scenes in seconds (0 = none)
  "SCENE_TAIL_SILENCE",      // silence appended to each clip's audio (seconds), creates breathing room between scenes

  // ── Performance / Concurrency ─────────────────────────────────────
  "IMAGE_CONCURRENCY",       // parallel image jobs
  "TTS_CONCURRENCY",         // parallel TTS jobs
  "ANIMATION_CONCURRENCY",   // parallel img2vid jobs
  "ASSEMBLE_CONCURRENCY",    // parallel FFmpeg clip renders
  "ASSEMBLE_XFADE_CHUNKS",   // split final xfade into N parallel chunks (1 = monolithic)

  // ── Reliability / scaling ─────────────────────────────────────────
  "FAILURE_THRESHOLD_PERCENT", // 0–100. If more than this % of scenes fail, the run aborts. Default 25.
  "AUTO_REUSE_ENABLED",      // "1" = pipeline auto-searches the library and reuses matches without a preview step
  "AUTO_REUSE_THRESHOLD",    // 0–100 confidence %. Scenes matching at/above this are auto-reused. Default 80.

  // ── Google Drive sync ─────────────────────────────────────────────
  // OAuth2 credentials from Google Cloud Console (Web Application client).
  // Redirect URI must be set to http://localhost:3000/api/gdrive/oauth/callback
  "GDRIVE_CLIENT_ID",
  "GDRIVE_CLIENT_SECRET",
  // Refresh token, set automatically after the user completes the OAuth flow.
  // Don't edit by hand.
  "GDRIVE_REFRESH_TOKEN",
  // Email of the Google account that authorized — set automatically, shown in UI.
  "GDRIVE_CONNECTED_EMAIL",
  // Folder IDs in Drive. Empty = auto-create `Conveyer Hum/Final Videos` and
  // `Conveyer Hum/Clips Library` in the user's Drive root on first sync.
  "GDRIVE_FINAL_VIDEOS_FOLDER_ID",
  "GDRIVE_CLIPS_LIBRARY_FOLDER_ID",
  // Master switch. Empty/"0" = disabled (don't upload). "1" = upload after every run.
  "GDRIVE_SYNC_ENABLED",
] as const;

/** Keys whose values are secrets and should be masked when sent to the UI. */
function isSecretKey(key: string): boolean {
  return key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET");
}

export type SettingKey = (typeof SETTING_KEYS)[number];

const getStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const upsertStmt = db.prepare(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
);

export function getSetting(key: SettingKey): string {
  const row = getStmt.get(key) as { value: string } | undefined;
  if (row && row.value !== "") return row.value;
  return process.env[key] ?? "";
}

export function setSetting(key: SettingKey, value: string) {
  upsertStmt.run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  return out;
}

/** Safe version — masks secret keys/tokens/secrets. Handles multi-line key lists too. */
export function getMaskedSettings(): Record<string, string> {
  const all = getAllSettings();
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (isSecretKey(k)) {
      if (!v) {
        masked[k] = "";
      } else {
        // Mask each line/entry separately so multi-key fields show all entries
        const parts = v.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
        masked[k] = parts.map((p) => `${p.slice(0, 4)}…${p.slice(-4)}`).join("\n");
      }
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export const DEFAULTS: Record<SettingKey, string> = {
  // Required API keys — empty by default, user must provide
  GOOGLE_API_KEY: "",
  LABS69_API_KEY: "",

  // Optional providers
  ELEVENLABS_API_KEY: "",
  REPLICATE_API_TOKEN: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  FAL_API_KEY: "",
  FFMPEG_PATH: "",

  // Storage — empty = use default (DATA_DIR/runs)
  RUNS_OUTPUT_DIR: "",

  // Scene split
  SCENE_SPLIT_PROVIDER: "google",
  SCENE_SPLIT_MODEL: "gemini-flash-latest",

  // TTS — Conveyer Hum defaults to MiniMax via the 69labs gateway.
  // Switch to 69labs (edge/eleven) / elevenlabs / openai via /settings if needed.
  TTS_PROVIDER: "minimax",
  TTS_VOICE_PROVIDER: "edgetts",
  TTS_VOICE_ID: "English_CalmWoman",
  TTS_MODEL: "speech-02-hd",
  TTS_SPLIT_TYPE: "smart",
  TTS_LANGUAGE_BOOST: "English",

  // Voice fine-tuning (slightly slower + small style for documentary feel)
  TTS_SPEED: "0.93",
  TTS_STABILITY: "0.6",
  TTS_SIMILARITY_BOOST: "0.75",
  TTS_STYLE: "0.15",
  TTS_USE_SPEAKER_BOOST: "1",

  // Auto-pause on sentence boundaries
  TTS_AUTO_PAUSE: "1",
  TTS_PAUSE_DURATION: "0.4",
  TTS_PAUSE_FREQUENCY: "1",

  // Images — Conveyer Hum is video-only. These defaults are kept only so
  // that legacy DB rows don't crash anything; the pipeline never reads them.
  IMAGE_PROVIDER: "off",
  IMAGE_MODEL: "nano-banana-pro",
  IMAGE_RATIO: "16:9",
  IMAGE_RESOLUTION: "1k",

  // Animations — Conveyer Hum animates EVERY scene through Grok via 69labs.
  ANIMATION_PROVIDER: "69labs",
  ANIMATION_MODEL: "grok-imagine-video",  // xAI Grok video via 69labs (text-to-video)
  ANIMATION_RATIO_PERCENT: "100",         // 100 % of scenes animated, no Ken-Burns mix
  ANIMATION_DISTRIBUTION: "all",
  ANIMATION_DURATION: "",                 // ignored by Grok (69labs hard-codes ~6s); applies only to non-Grok/non-Veo models
  ANIMATION_KEEP_VEO_AUDIO: "",           // legacy name — applies to any model with embedded audio

  // Video assembly
  VIDEO_RESOLUTION: "1920x1080",
  VIDEO_FPS: "30",
  SCENE_DURATION_SECONDS: "5",
  TRANSITION_DURATION: "0.5",
  SCENE_TAIL_SILENCE: "0.4",

  // Performance
  IMAGE_CONCURRENCY: "5",
  TTS_CONCURRENCY: "3",
  ANIMATION_CONCURRENCY: "3",
  ASSEMBLE_CONCURRENCY: "4",
  ASSEMBLE_XFADE_CHUNKS: "4",

  // Reliability / scaling
  FAILURE_THRESHOLD_PERCENT: "25",
  AUTO_REUSE_ENABLED: "1",
  AUTO_REUSE_THRESHOLD: "80",

  // Google Drive — all empty by default. User fills client_id/secret;
  // OAuth flow fills refresh_token + email; folders auto-create on first sync.
  GDRIVE_CLIENT_ID: "",
  GDRIVE_CLIENT_SECRET: "",
  GDRIVE_REFRESH_TOKEN: "",
  GDRIVE_CONNECTED_EMAIL: "",
  GDRIVE_FINAL_VIDEOS_FOLDER_ID: "",
  GDRIVE_CLIPS_LIBRARY_FOLDER_ID: "",
  GDRIVE_SYNC_ENABLED: "",
};

/** Write defaults for any keys that aren't already in the DB. */
export function seedDefaults() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const row = getStmt.get(k) as { value: string } | undefined;
    if (!row) upsertStmt.run(k, v);
  }
  forceVideoOnlyMode();
}

/**
 * One-time correction for users coming from the Hum Conveyer template (Veo →
 * Grok migration). Conveyer Hum runs Grok via 69labs for every scene, so we
 * flip any inherited `veo-*` model IDs to `grok-imagine-video` on first boot.
 * Tracked via a flag so we never overwrite a user's later manual choice.
 */
function forceVideoOnlyMode() {
  const flag = getStmt.get("_migration_grok_video_only") as { value: string } | undefined;
  if (flag?.value === "1") return;

  const rules: Array<[string, (current: string) => string | null]> = [
    ["ANIMATION_PROVIDER", (v) => (v === "off" ? "69labs" : null)],
    ["ANIMATION_RATIO_PERCENT", (v) => (v !== "100" ? "100" : null)],
    ["ANIMATION_DISTRIBUTION", (v) => (v !== "all" ? "all" : null)],
    ["IMAGE_PROVIDER", (v) => (v && v !== "off" ? "off" : null)],
    // Migrate inherited Veo model IDs from Hum Conveyer template
    ["ANIMATION_MODEL", (v) => (/^veo/i.test(v) ? "grok-imagine-video" : null)],
  ];
  for (const [key, transform] of rules) {
    const row = getStmt.get(key) as { value: string } | undefined;
    if (!row) continue;
    const next = transform(row.value);
    if (next !== null && next !== row.value) {
      upsertStmt.run(key, next);
    }
  }
  upsertStmt.run("_migration_grok_video_only", "1");
}
