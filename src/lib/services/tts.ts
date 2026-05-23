import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { log } from "../logger";
import type { Scene } from "./scene-split";
import { createTtsJob, pollJob, downloadJob } from "./labs69";
import { probeDurationSafe } from "./video-assemble";

export interface TtsResult {
  /** Path to the mp3 file. */
  filePath: string;
  /** Audio duration in seconds, measured via ffprobe. */
  durationSec: number;
}

/**
 * Synthesizes one scene's narration.
 *
 * Default provider is MiniMax through the 69labs gateway (`minimax`). The same
 * LABS69_API_KEY that powers Grok video also covers MiniMax TTS, so there is no
 * separate voiceover account to manage. Alternatives stay available via the
 * TTS_PROVIDER setting: `69labs` (Edge TTS / ElevenLabs / cloned voice through
 * 69labs), `elevenlabs` (direct), `openai`.
 *
 * Each file is sceneN.mp3 in the scene directory.
 *
 * `options.voiceOverride` — when a channel profile sets its own voice id, the
 * pipeline passes it here so that channel's runs use that voice instead of the
 * global TTS_VOICE_ID setting. Empty/null → use the global setting.
 */
export async function synthesizeScene(
  runId: string,
  scene: Scene,
  outDir: string,
  options: { voiceOverride?: string | null } = {}
): Promise<TtsResult> {
  const provider = (getSetting("TTS_PROVIDER") || "minimax").toLowerCase();
  const fileName = `scene_${String(scene.index).padStart(3, "0")}.mp3`;
  const filePath = path.join(outDir, fileName);

  log(runId, "info", `TTS scene #${scene.index} (${provider})`, {
    stage: "tts",
    data: { provider, text: scene.text.slice(0, 80) },
  });

  if (provider === "minimax") {
    await minimaxTts(runId, scene.text, filePath, options.voiceOverride);
  } else if (provider === "69labs") {
    await labs69Tts(runId, scene.text, filePath, options.voiceOverride);
  } else if (provider === "elevenlabs") {
    await elevenLabs(scene.text, filePath, options.voiceOverride);
  } else if (provider === "openai") {
    await openaiTts(scene.text, filePath, options.voiceOverride);
  } else {
    throw new Error(`Unknown TTS provider: ${provider}`);
  }

  // Real audio duration via ffprobe (falls back to a file-size estimate if
  // ffprobe is unavailable). This value feeds the run log and library manifest,
  // so it must be accurate — a wrong estimate here once read "~12s" for a 5s clip.
  const durationSec = await probeDurationSafe(filePath);

  log(runId, "success", `TTS done: ${fileName} (${durationSec.toFixed(1)}s)`, {
    stage: "tts",
  });
  return { filePath, durationSec };
}

/** A channel profile's voice id wins over the global TTS_VOICE_ID setting. */
function resolveVoiceId(voiceOverride: string | null | undefined, fallback: string): string {
  if (voiceOverride && voiceOverride.trim().length > 0) return voiceOverride.trim();
  return getSetting("TTS_VOICE_ID") || fallback;
}

/**
 * 69labs MiniMax TTS — the primary voiceover engine for Conveyer Hum.
 *
 * The user picks a MiniMax catalog voice (e.g. "English_Comedian") or a cloned
 * voice in the 69labs dashboard → MiniMax, then pastes that voice id into
 * /settings (TTS_VOICE_ID). A channel profile can override it per channel.
 * MiniMax runs over the same 69labs gateway + multi-key pool as Grok video, so
 * the single LABS69_API_KEY covers both audio and video.
 *
 * Settings: TTS_VOICE_ID (voice), TTS_MODEL (default `speech-02-hd`),
 * TTS_SPEED (delivery rate), TTS_LANGUAGE_BOOST (pronunciation hint).
 */
async function minimaxTts(
  runId: string,
  text: string,
  outPath: string,
  voiceOverride?: string | null
) {
  const voiceId = resolveVoiceId(voiceOverride, "");
  if (!voiceId) {
    throw new Error(
      "No MiniMax voice set — paste a voice id into /settings → TTS_VOICE_ID " +
        "(e.g. English_Comedian), or add one to the channel profile in /prompts"
    );
  }
  const modelId = getSetting("TTS_MODEL") || "speech-02-hd";

  // MiniMax delivery tuning. `speed` is clamped to a sane narration band (the
  // raw API allows 0.01–10); `languageBoost` sharpens pronunciation for the
  // script's language.
  const minimaxSettings: { speed?: number; languageBoost?: string } = {};
  const speed = parseFloatOr(getSetting("TTS_SPEED"), NaN);
  if (!Number.isNaN(speed)) minimaxSettings.speed = clamp(speed, 0.5, 2);
  const languageBoost = getSetting("TTS_LANGUAGE_BOOST").trim();
  if (languageBoost) minimaxSettings.languageBoost = languageBoost;

  const jobId = await createTtsJob({
    text,
    voiceId,
    voiceProvider: "minimax",
    modelId,
    minimaxSettings,
    runId,
  });
  log(
    runId,
    "debug",
    `69labs MiniMax TTS job ${jobId.slice(0, 8)}… (${modelId} / ${voiceId}, ` +
      `speed=${minimaxSettings.speed ?? "default"}, lang=${minimaxSettings.languageBoost ?? "auto"})`,
    { stage: "tts" }
  );
  try {
    await pollJob("tts", jobId, runId, "tts");
  } catch (e) {
    // MiniMax accepts the job request even when voice id / model id are invalid,
    // then fails it during processing. Re-throw with a hint so the user knows
    // exactly where to look.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${msg} — most often this means the MiniMax voice id "${voiceId}" or model "${modelId}" is not valid for this account. ` +
        `Open the Voiceover tab in the app to browse the live MiniMax catalog and pick a working voice, then save it as TTS_VOICE_ID.`
    );
  }
  await downloadJob("tts", jobId, outPath);
}

/**
 * 69labs TTS via Edge TTS / ElevenLabs / a cloned voice — the alternate route
 * when TTS_PROVIDER is `69labs`. TTS_VOICE_PROVIDER selects the sub-engine.
 */
async function labs69Tts(
  runId: string,
  text: string,
  outPath: string,
  voiceOverride?: string | null
) {
  const voiceId = resolveVoiceId(voiceOverride, "en-US-GuyNeural");
  const voiceProviderRaw = (getSetting("TTS_VOICE_PROVIDER") || "edgetts").toLowerCase();
  const voiceProvider =
    voiceProviderRaw === "elevenlabs" || voiceProviderRaw === "edgetts" || voiceProviderRaw === "voice-clone"
      ? (voiceProviderRaw as "elevenlabs" | "edgetts" | "voice-clone")
      : "edgetts";
  const modelId = getSetting("TTS_MODEL") || undefined;
  const splitTypeRaw = (getSetting("TTS_SPLIT_TYPE") || "smart").toLowerCase();
  const splitType =
    splitTypeRaw === "paragraphs" || splitTypeRaw === "max_length"
      ? (splitTypeRaw as "smart" | "paragraphs" | "max_length")
      : "smart";

  // ElevenLabs-specific fine-tuning
  const voiceSettings: {
    stability?: number;
    similarityBoost?: number;
    speed?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  } = {};
  if (voiceProvider === "elevenlabs") {
    const stability = parseFloatOr(getSetting("TTS_STABILITY"), NaN);
    const similarity = parseFloatOr(getSetting("TTS_SIMILARITY_BOOST"), NaN);
    const speed = parseFloatOr(getSetting("TTS_SPEED"), NaN);
    const style = parseFloatOr(getSetting("TTS_STYLE"), NaN);
    const speakerBoost = getSetting("TTS_USE_SPEAKER_BOOST");

    if (!Number.isNaN(stability)) voiceSettings.stability = clamp(stability, 0, 1);
    if (!Number.isNaN(similarity)) voiceSettings.similarityBoost = clamp(similarity, 0, 1);
    if (!Number.isNaN(speed)) voiceSettings.speed = clamp(speed, 0.7, 1.2);
    if (!Number.isNaN(style)) voiceSettings.style = clamp(style, 0, 1);
    if (speakerBoost === "1") voiceSettings.useSpeakerBoost = true;
    else if (speakerBoost === "0") voiceSettings.useSpeakerBoost = false;
  }

  // Auto-pause — stops TTS from rushing through sentence ends
  const autoPauseEnabled = getSetting("TTS_AUTO_PAUSE") === "1";
  const autoPauseDuration = parseFloatOr(getSetting("TTS_PAUSE_DURATION"), NaN);
  const autoPauseFrequency = parseFloatOr(getSetting("TTS_PAUSE_FREQUENCY"), NaN);

  const jobId = await createTtsJob({
    text,
    voiceId,
    voiceProvider,
    modelId,
    splitType,
    voiceSettings,
    autoPauseEnabled,
    autoPauseDuration: !Number.isNaN(autoPauseDuration) ? clamp(autoPauseDuration, 0.1, 30) : undefined,
    autoPauseFrequency: !Number.isNaN(autoPauseFrequency) ? clamp(autoPauseFrequency, 1, 100) : undefined,
    runId,
  });
  log(runId, "debug", `69labs TTS job ${jobId.slice(0, 8)}… (${voiceProvider}/${voiceId}, speed=${voiceSettings.speed ?? "default"}, pause=${autoPauseEnabled ? `${autoPauseDuration}s` : "off"})`, { stage: "tts" });
  await pollJob("tts", jobId, runId, "tts");
  await downloadJob("tts", jobId, outPath);
}

function parseFloatOr(s: string, fallback: number): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function elevenLabs(text: string, outPath: string, voiceOverride?: string | null) {
  const apiKey = getSetting("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const voiceId = resolveVoiceId(voiceOverride, "21m00Tcm4TlvDq8ikWAM");
  const model = getSetting("TTS_MODEL") || "eleven_multilingual_v2";

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: model }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ElevenLabs ${resp.status}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function openaiTts(text: string, outPath: string, voiceOverride?: string | null) {
  const apiKey = getSetting("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = getSetting("TTS_MODEL") || "gpt-4o-mini-tts";
  const voice = resolveVoiceId(voiceOverride, "alloy");

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: text, format: "mp3" }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI TTS ${resp.status}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}
