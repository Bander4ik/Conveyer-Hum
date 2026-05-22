import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ensureInit } from "@/lib/init";
import { getSetting } from "@/lib/settings";
import { getVoiceoverDir } from "@/lib/run-paths";
import { createTtsJob, pollJob, downloadJob } from "@/lib/services/labs69";
import { probeDurationSafe } from "@/lib/services/video-assemble";

/** MiniMax accepts very long text, but cap it so a paste-bomb can't hang the box. */
const MAX_CHARS = 100_000;

/**
 * POST /api/voiceover — standalone MiniMax text-to-speech (Tab 2).
 *
 * Body: { text, voiceId?, modelId?, speed?, languageBoost? }
 * Generates one MP3 synchronously via 69labs MiniMax, saves it under
 * `<DATA_DIR>/voiceovers/<uuid>.mp3`, and returns { id, durationSec }.
 * The file is then served by GET /api/voiceover/[id]/file.
 */
export async function POST(req: Request) {
  ensureInit();

  let body: {
    text?: string;
    voiceId?: string;
    modelId?: string;
    speed?: number;
    languageBoost?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Text is empty" }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Text is too long (${text.length} chars, max ${MAX_CHARS})` },
      { status: 400 }
    );
  }

  const voiceId = (body.voiceId ?? "").trim() || getSetting("TTS_VOICE_ID");
  if (!voiceId) {
    return NextResponse.json(
      { error: "No MiniMax voice selected — pick one or paste a voice id" },
      { status: 400 }
    );
  }

  const modelId = (body.modelId ?? "").trim() || getSetting("TTS_MODEL") || "speech-02-hd";

  const minimaxSettings: { speed?: number; languageBoost?: string } = {};
  const speed = Number(body.speed);
  if (Number.isFinite(speed) && speed > 0) {
    minimaxSettings.speed = Math.min(2, Math.max(0.5, speed));
  }
  const languageBoost = (body.languageBoost ?? "").trim();
  if (languageBoost) minimaxSettings.languageBoost = languageBoost;

  const id = randomUUID();
  const outPath = path.join(getVoiceoverDir(), `${id}.mp3`);

  try {
    const jobId = await createTtsJob({
      text,
      voiceId,
      voiceProvider: "minimax",
      modelId,
      minimaxSettings,
    });
    await pollJob("tts", jobId, id, "voiceover");
    await downloadJob("tts", jobId, outPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const durationSec = await probeDurationSafe(outPath);
  return NextResponse.json({ id, durationSec, voiceId, modelId });
}
