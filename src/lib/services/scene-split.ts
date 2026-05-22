import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { getPrompt } from "../prompts";
import { log } from "../logger";
import { getRunDir } from "../run-paths";

export interface Scene {
  index: number;
  text: string;
  visual_prompt: string;
  duration_hint_sec: number;
}

/**
 * Splits the script into scenes. Supports Google Gemini (default, cheap) and Anthropic Claude.
 * If `overrideSystemPrompt` is passed (e.g. from a Prompt Preset chosen on the New Run page),
 * it replaces the default scene_split prompt for this call only.
 */
export async function splitScript(
  runId: string,
  script: string,
  overrideSystemPrompt?: string
): Promise<Scene[]> {
  const provider = (getSetting("SCENE_SPLIT_PROVIDER") || "google").toLowerCase();
  const systemPrompt = overrideSystemPrompt?.trim() ? overrideSystemPrompt : getPrompt("scene_split");

  log(runId, "info", `Splitting script (${provider})`, {
    stage: "scene_split",
    data: { scriptChars: script.length },
  });

  let raw: string;
  if (provider === "google") {
    raw = await splitWithGemini(systemPrompt, script);
  } else if (provider === "anthropic") {
    raw = await splitWithClaude(systemPrompt, script);
  } else {
    throw new Error(`Unknown SCENE_SPLIT_PROVIDER: ${provider}`);
  }

  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (e) {
    // Save raw output so we can see what went wrong
    try {
      const runDir = getRunDir(runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "scene_split_raw.txt"), raw, "utf-8");
      log(runId, "error", `Raw output saved to ${runDir}/scene_split_raw.txt (${raw.length} chars)`, {
        stage: "scene_split",
      });
    } catch {}
    throw e;
  }
  if (!Array.isArray(json)) {
    log(runId, "error", "LLM did not return an array", { stage: "scene_split", data: { raw: raw.slice(0, 500) } });
    throw new Error("scene_split: model did not return a JSON array");
  }

  const scenes: Scene[] = enforceMaxSceneLength(
    json.map((s, i) => ({
      index: i,
      text: String(s.text ?? ""),
      visual_prompt: String(s.visual_prompt ?? ""),
      duration_hint_sec: Number(s.duration_hint_sec ?? 6),
    }))
  );

  // Coverage check: words in scene.text vs original script.
  // If coverage < 70%, the model probably summarized — warn the user.
  const scriptWords = script.trim().split(/\s+/).filter(Boolean).length;
  const sceneWords = scenes.reduce(
    (sum, s) => sum + s.text.trim().split(/\s+/).filter(Boolean).length,
    0
  );
  const coverage = scriptWords > 0 ? (sceneWords / scriptWords) * 100 : 0;

  log(runId, "success", `Done: ${scenes.length} scenes · script coverage ${coverage.toFixed(0)}% (${sceneWords}/${scriptWords} words)`, {
    stage: "scene_split",
    data: { scenes: scenes.map((s) => ({ i: s.index, text: s.text.slice(0, 60) })) },
  });

  if (coverage < 70) {
    log(
      runId,
      "warn",
      `⚠️ Low coverage (${coverage.toFixed(0)}%) — the model likely summarized the script. Review the scene_split prompt on /prompts.`,
      { stage: "scene_split" }
    );
  }

  return scenes;
}

/**
 * Same logic as splitScript but with no DB logging and no artifact files.
 * Used by /api/preview/scenes — the user wants to *see* the scenes before
 * deciding to start a run, so we shouldn't create run_logs rows or temp dirs.
 */
export async function splitScriptPreview(
  script: string,
  overrideSystemPrompt?: string
): Promise<Scene[]> {
  const provider = (getSetting("SCENE_SPLIT_PROVIDER") || "google").toLowerCase();
  const systemPrompt = overrideSystemPrompt?.trim() ? overrideSystemPrompt : getPrompt("scene_split");
  let raw: string;
  if (provider === "google") raw = await splitWithGemini(systemPrompt, script);
  else if (provider === "anthropic") raw = await splitWithClaude(systemPrompt, script);
  else throw new Error(`Unknown SCENE_SPLIT_PROVIDER: ${provider}`);
  const json = extractJson(raw);
  if (!Array.isArray(json)) throw new Error("Model did not return a JSON array");
  return enforceMaxSceneLength(
    json.map((s, i) => ({
      index: i,
      text: String(s.text ?? ""),
      visual_prompt: String(s.visual_prompt ?? ""),
      duration_hint_sec: Number(s.duration_hint_sec ?? 6),
    }))
  );
}

/**
 * HARD GUARD against over-long scenes.
 *
 * Grok via 69labs returns a fixed ~6-second clip. If a scene's narration is
 * longer than the clip, the video freezes on the last frame for the overflow.
 * The scene_split prompt tells the LLM to keep scenes short, but the LLM does
 * not always obey — so we enforce it in code here, no matter what the LLM did.
 *
 * Any scene whose text exceeds MAX_SCENE_WORDS is split into the fewest equal
 * word-boundary chunks that all fit. Splitting only on word boundaries keeps
 * the joined text identical, so script coverage stays 100%. The split halves
 * share the original scene's visual_prompt (same visual world).
 *
 * MAX_SCENE_WORDS is deliberately conservative (~5.5s even on a slow ~108wpm
 * MiniMax voice) so the clip always covers the audio with motion to spare.
 */
const MAX_SCENE_WORDS = 11;

function enforceMaxSceneLength(scenes: Scene[]): Scene[] {
  const out: Scene[] = [];
  for (const s of scenes) {
    const words = s.text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= MAX_SCENE_WORDS) {
      out.push(s);
      continue;
    }
    const chunkCount = Math.ceil(words.length / MAX_SCENE_WORDS);
    const perChunk = Math.ceil(words.length / chunkCount);
    for (let i = 0; i < words.length; i += perChunk) {
      const chunkWords = words.slice(i, i + perChunk);
      out.push({
        index: 0, // reindexed below
        text: chunkWords.join(" "),
        visual_prompt: s.visual_prompt,
        duration_hint_sec: Math.min(6, Math.max(2, Math.round((chunkWords.length / 150) * 60))),
      });
    }
  }
  return out.map((s, i) => ({ ...s, index: i }));
}

async function splitWithGemini(systemPrompt: string, script: string): Promise<string> {
  const apiKey = getSetting("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set (Settings)");
  const model = getSetting("SCENE_SPLIT_MODEL") || "gemini-flash-latest";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Script:\n\n${script}` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
      // 60K — enough for ~150 scenes in JSON
      maxOutputTokens: 60000,
      // Disable thinking — for structured output it just wastes the token budget
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // Retry with exponential backoff for transient errors
  // (503 UNAVAILABLE / 429 RATE_LIMIT / 500 — common Google API blips)
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const MAX_RETRIES = 4;
  let attempt = 0;
  let lastErr = "";

  while (attempt <= MAX_RETRIES) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (resp.ok) {
      const json = (await resp.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };
      const cand = json.candidates?.[0];
      const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const reason = cand?.finishReason;
      if (reason && reason !== "STOP") {
        throw new Error(
          `Gemini finish=${reason} (output cut off, tokens=${json.usageMetadata?.candidatesTokenCount}). Increase maxOutputTokens.`
        );
      }
      if (!text) throw new Error(`Gemini: empty output (${JSON.stringify(json).slice(0, 300)})`);
      return text;
    }
    const errText = (await resp.text()).slice(0, 400);
    lastErr = `Gemini ${resp.status}: ${errText}`;
    if (!RETRYABLE.has(resp.status) || attempt === MAX_RETRIES) {
      throw new Error(lastErr);
    }
    // 1s, 2s, 4s, 8s
    const waitMs = 1000 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
  throw new Error(lastErr);
}

async function splitWithClaude(systemPrompt: string, script: string): Promise<string> {
  const apiKey = getSetting("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (Settings)");
  const model = getSetting("SCENE_SPLIT_MODEL") || "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: `Script:\n\n${script}` }],
  });
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

/** Extracts the first JSON array from a text response, even if the model added markdown. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    throw new Error("Could not parse JSON from model response");
  }
}
