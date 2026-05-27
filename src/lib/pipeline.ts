import path from "node:path";
import fs from "node:fs";
import db from "./db";
import { log } from "./logger";
import { getSetting } from "./settings";
import { getRunDir } from "./run-paths";
import { pLimit } from "./plimit";
import { splitScript, type Scene } from "./services/scene-split";
import { synthesizeScene, type TtsResult } from "./services/tts";
import { animateScene } from "./services/img2vid";
import { assembleVideo, probeDurationSafe, type AssembleInput } from "./services/video-assemble";
import { getKeyCount } from "./services/labs69";
import { syncRunToDrive, channelFolderName } from "./services/run-upload";
import { downloadReusedClip } from "./services/reuse";
import { findSimilarClips } from "./services/library";
import { checkCancelled, clearCancelled, CancelledError } from "./cancellation";

const getReuseMapStmt = db.prepare("SELECT reuse_map_json FROM runs WHERE id = ?");
const getPresetSnapshotStmt = db.prepare(
  "SELECT preset_content, preset_animation_motion, preset_voice_id, preset_name FROM runs WHERE id = ?"
);
const getRunRowStmt = db.prepare("SELECT id, script FROM runs WHERE id = ?");
const getRunConfigStmt = db.prepare("SELECT config_json FROM runs WHERE id = ?");

const updateRun = db.prepare(
  "UPDATE runs SET status = ?, output_path = ?, updated_at = datetime('now') WHERE id = ?"
);

/** A scene's generated assets, ready for assembly. */
type SceneResult = AssembleInput | null;

/** scene index → padded asset file paths. */
function audioPathFor(audioDir: string, index: number): string {
  return path.join(audioDir, `scene_${String(index).padStart(3, "0")}.mp3`);
}
function videoPathFor(animDir: string, index: number): string {
  return path.join(animDir, `scene_${String(index).padStart(3, "0")}.mp4`);
}
/** True only if the file exists AND is non-empty (guards against broken/0-byte files). */
function fileReady(p: string): boolean {
  try {
    return fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

/** Read the per-channel overrides snapshotted onto the run row. */
function readPresetSnapshot(runId: string): {
  scenePrompt: string | undefined;
  motionOverride: string | null;
  voiceOverride: string | null;
  presetName: string | null;
} {
  const row = getPresetSnapshotStmt.get(runId) as
    | {
        preset_content: string | null;
        preset_animation_motion: string | null;
        preset_voice_id: string | null;
        preset_name: string | null;
      }
    | undefined;
  return {
    scenePrompt: row?.preset_content ?? undefined,
    motionOverride: row?.preset_animation_motion ?? null,
    voiceOverride: row?.preset_voice_id ?? null,
    presetName: row?.preset_name ?? null,
  };
}

/** Read the reuse map (scene index → Drive file id) the user picked on New Run. */
function readReuseMap(runId: string): Record<string, string> {
  const row = getReuseMapStmt.get(runId) as { reuse_map_json: string | null } | undefined;
  return row?.reuse_map_json ? (JSON.parse(row.reuse_map_json) as Record<string, string>) : {};
}

/**
 * Whether this run should auto-search the library for reusable clips.
 * Per-run choice from the New Run page (config_json.autoReuse); falls back to
 * the global AUTO_REUSE_ENABLED setting for runs created without it.
 */
function isAutoReuseRun(runId: string): boolean {
  const row = getRunConfigStmt.get(runId) as { config_json: string | null } | undefined;
  if (row?.config_json) {
    try {
      const cfg = JSON.parse(row.config_json) as { autoReuse?: unknown };
      if (typeof cfg.autoReuse === "boolean") return cfg.autoReuse;
    } catch {}
  }
  return getSetting("AUTO_REUSE_ENABLED") === "1";
}

/**
 * When AUTO_REUSE_ENABLED is on, the pipeline searches the Drive library
 * itself and folds high-confidence matches into the reuse map — no Preview
 * step, no manual approval clicking. Mutates `reuseMap` in place.
 * Best-effort: a search failure just logs and the run proceeds with full
 * generation. Scenes the user already picked manually are left untouched.
 */
async function applyAutoReuse(
  runId: string,
  scenes: Scene[],
  reuseMap: Record<string, string>,
  channel: string
): Promise<void> {
  const threshold = Math.max(
    0,
    Math.min(100, Number(getSetting("AUTO_REUSE_THRESHOLD") || "80"))
  );
  try {
    log(
      runId,
      "info",
      `Auto-reuse on — searching the "${channel}" library for clips matching at >=${threshold}%`,
      { stage: "reuse" }
    );
    // Auto-reuse stays within the run's own channel so a channel never pulls
    // off-brand clips from a different channel.
    const matches = await findSimilarClips(scenes, { minScore: threshold, channel });
    const bestByScene = new Map<number, { id: string; score: number }>();
    for (const m of matches) {
      const cur = bestByScene.get(m.new_scene_index);
      if (!cur || m.score > cur.score) {
        bestByScene.set(m.new_scene_index, { id: m.drive_file_id, score: m.score });
      }
    }
    let picked = 0;
    for (const [sceneIdx, best] of bestByScene) {
      if (best.score >= threshold && !reuseMap[String(sceneIdx)]) {
        reuseMap[String(sceneIdx)] = best.id;
        picked++;
      }
    }
    log(
      runId,
      "success",
      `Auto-reuse: ${picked}/${scenes.length} scene${picked === 1 ? "" : "s"} matched the library — Grok generation skipped for them (~${picked} video credit${picked === 1 ? "" : "s"} saved)`,
      { stage: "reuse" }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(runId, "warn", `Auto-reuse search failed — continuing with full generation: ${msg.slice(0, 150)}`, {
      stage: "reuse",
    });
  }
}

/** Per-key × key-count concurrency limiters for TTS and video. */
function makeLimiters() {
  const keyCount = Math.max(1, getKeyCount());
  const ttsPerKey = Math.max(1, Number(getSetting("TTS_CONCURRENCY") || "3"));
  const animPerKey = Math.max(1, Number(getSetting("ANIMATION_CONCURRENCY") || "3"));
  return {
    keyCount,
    ttsPerKey,
    animPerKey,
    limitTts: pLimit(ttsPerKey * keyCount),
    limitAnim: pLimit(animPerKey * keyCount),
  };
}

/**
 * Logs the failure tally and throws if the failure rate is over the
 * user-configured threshold. Shared by runPipeline and resumeRun.
 */
function enforceFailureThreshold(runId: string, totalScenes: number, succeeded: number): void {
  const failedCount = totalScenes - succeeded;
  if (failedCount <= 0) return;
  const failedPct = (failedCount / totalScenes) * 100;
  const threshold = Math.max(
    0,
    Math.min(100, Number(getSetting("FAILURE_THRESHOLD_PERCENT") || "25"))
  );
  const over = failedPct > threshold;
  log(
    runId,
    over ? "error" : "warn",
    `${failedCount}/${totalScenes} scenes failed (${failedPct.toFixed(0)}%) · abort threshold ${threshold}%`,
    { stage: "pipeline" }
  );
  if (over) {
    throw new Error(
      `Too many scenes failed: ${failedCount}/${totalScenes} (${failedPct.toFixed(0)}% over the ${threshold}% threshold). The partial assets are kept — use Resume on the run page to regenerate only the missing scenes.`
    );
  }
}

/** Final assembly + Drive sync + mark the run done. Shared by both flows. */
async function finishRun(
  runId: string,
  sceneAssets: AssembleInput[],
  runDir: string
): Promise<void> {
  checkCancelled(runId);
  const finalPath = await assembleVideo(runId, sceneAssets, runDir);

  // Drive sync is best-effort — a failed upload must not roll back a
  // successful generation.
  try {
    await syncRunToDrive(runId, sceneAssets, runDir, finalPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(runId, "warn", `Drive sync failed (local files preserved): ${msg}`, { stage: "gdrive" });
  }

  updateRun.run("done", finalPath, runId);
  log(runId, "success", "Pipeline complete", { stage: "pipeline", data: { finalPath } });
}

/** Translate a thrown error into the right run status + log. Shared catch. */
function handlePipelineError(runId: string, e: unknown): void {
  if (e instanceof CancelledError) {
    log(runId, "warn", "Pipeline cancelled by user", { stage: "pipeline" });
    // status 'cancelled' was already set by the cancel endpoint
  } else {
    const msg = e instanceof Error ? e.message : String(e);
    log(runId, "error", `Pipeline crashed: ${msg}`, { stage: "pipeline" });
    updateRun.run("error", null, runId);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Full run
// ───────────────────────────────────────────────────────────────────────────

export async function runPipeline(runId: string, script: string) {
  const runDir = getRunDir(runId);
  const audioDir = path.join(runDir, "audio");
  const animDir = path.join(runDir, "animations");
  // No imgDir — Conveyer Hum is video-only, scenes go straight to Grok img2vid.
  for (const d of [runDir, audioDir, animDir]) fs.mkdirSync(d, { recursive: true });

  try {
    clearCancelled(runId);
    updateRun.run("running", null, runId);
    log(runId, "info", `Pipeline started · folder: ${path.basename(runDir)}`, { stage: "pipeline" });

    // 1. Split script into scenes — channel profile snapshot drives the prompt,
    //    voice and motion overrides.
    const { scenePrompt, motionOverride, voiceOverride, presetName } = readPresetSnapshot(runId);
    const scenes = await splitScript(runId, script, scenePrompt);
    checkCancelled(runId);
    fs.writeFileSync(path.join(runDir, "scenes.json"), JSON.stringify(scenes, null, 2), "utf-8");

    const reuseMap = readReuseMap(runId);

    // Auto-reuse — when the run is in Auto mode, the pipeline searches the
    // library itself and folds matches into the reuse map (no Preview step).
    if (isAutoReuseRun(runId)) {
      await applyAutoReuse(runId, scenes, reuseMap, channelFolderName(presetName));
      checkCancelled(runId);
    }

    const reuseCount = Object.keys(reuseMap).length;
    if (reuseCount > 0) {
      log(
        runId,
        "info",
        `${reuseCount} scene${reuseCount === 1 ? "" : "s"} will reuse an existing clip — those skip Grok generation`,
        { stage: "reuse", data: { reuseMap } }
      );
    }

    // 2. Guard: Conveyer Hum is video-only, the animation provider must be set.
    const animProvider = (getSetting("ANIMATION_PROVIDER") || "69labs").toLowerCase();
    if (animProvider === "off") {
      throw new Error(
        "Conveyer Hum is video-only: ANIMATION_PROVIDER cannot be 'off'. Set it to '69labs' in /settings."
      );
    }

    // 3. Per scene: TTS + Grok text-to-video, interleaved, concurrency-limited.
    const { keyCount, ttsPerKey, animPerKey, limitTts, limitAnim } = makeLimiters();
    // Worker pool bounds peak RAM by capping how many scene closures + plimit
    // queue entries live at once. The plimit limiters still control real API
    // concurrency; this only stops the heap from holding 1 500 pending
    // closures on long runs.
    const WORKER_COUNT = Math.max(20, keyCount * 5);
    log(
      runId,
      "info",
      `Generating ${scenes.length} scenes (video-only). Keys: ${keyCount} · Concurrency per key×keys: TTS=${ttsPerKey}×${keyCount}, video=${animPerKey}×${keyCount}. Provider: ${animProvider} · workers=${WORKER_COUNT}`,
      { stage: "pipeline" }
    );

    const processScene = async (scene: Scene): Promise<SceneResult> => {
      try {
        checkCancelled(runId);
        const reuseFileId = reuseMap[String(scene.index)];
        const [audio, videoPath] = await Promise.all([
          limitTts(() => synthesizeScene(runId, scene, audioDir, { voiceOverride })),
          reuseFileId
            ? downloadReusedClip(runId, scene, reuseFileId, animDir)
            : limitAnim(() => animateScene(runId, scene, null, animDir, { motionOverride })),
        ]);
        if (!videoPath) throw new Error(`Scene #${scene.index} produced no video clip`);
        return { scene, imagePath: videoPath, videoPath, audio };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(runId, "error", `Scene #${scene.index} failed: ${msg.slice(0, 1500)}`, { stage: "pipeline" });
        return null;
      }
    };

    const settled: SceneResult[] = new Array(scenes.length).fill(null);
    let nextSceneIdx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const idx = nextSceneIdx++;
        if (idx >= scenes.length) return;
        settled[idx] = await processScene(scenes[idx]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(WORKER_COUNT, scenes.length) }, () => worker())
    );

    const sceneAssets = settled.filter((x): x is AssembleInput => x !== null);
    enforceFailureThreshold(runId, scenes.length, sceneAssets.length);
    if (sceneAssets.length === 0) throw new Error("No scenes succeeded");

    await finishRun(runId, sceneAssets, runDir);
  } catch (e) {
    handlePipelineError(runId, e);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Resume — regenerate only the missing scenes of a failed/partial run
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resumes a run that failed or was cancelled partway through. Reads the saved
 * scenes.json, keeps every scene whose audio + video are already on disk, and
 * regenerates ONLY the missing ones — then re-assembles and re-uploads.
 *
 * This is what makes runs failure-proof: a provider glitch / rate-cap night
 * no longer throws away clips already paid for.
 */
export async function resumeRun(runId: string) {
  const runDir = getRunDir(runId);
  const audioDir = path.join(runDir, "audio");
  const animDir = path.join(runDir, "animations");
  for (const d of [runDir, audioDir, animDir]) fs.mkdirSync(d, { recursive: true });

  try {
    clearCancelled(runId);
    updateRun.run("running", null, runId);
    log(runId, "info", "Resume started — keeping finished scenes, regenerating the rest", {
      stage: "pipeline",
    });

    // The saved scene plan is required — without it there's nothing to resume.
    const scenesPath = path.join(runDir, "scenes.json");
    if (!fileReady(scenesPath)) {
      throw new Error(
        "scenes.json not found for this run — there's no saved scene plan to resume from. Start a fresh run instead."
      );
    }
    const scenes = JSON.parse(fs.readFileSync(scenesPath, "utf-8")) as Scene[];
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error("scenes.json is empty or invalid — start a fresh run instead.");
    }
    checkCancelled(runId);

    const { motionOverride, voiceOverride } = readPresetSnapshot(runId);
    const reuseMap = readReuseMap(runId);

    const animProvider = (getSetting("ANIMATION_PROVIDER") || "69labs").toLowerCase();
    if (animProvider === "off") {
      throw new Error(
        "Conveyer Hum is video-only: ANIMATION_PROVIDER cannot be 'off'. Set it to '69labs' in /settings."
      );
    }

    const alreadyComplete = scenes.filter(
      (s) => fileReady(audioPathFor(audioDir, s.index)) && fileReady(videoPathFor(animDir, s.index))
    ).length;
    log(
      runId,
      "info",
      `${alreadyComplete}/${scenes.length} scenes already complete on disk — regenerating the remaining ${scenes.length - alreadyComplete}`,
      { stage: "pipeline" }
    );

    const { keyCount, limitTts, limitAnim } = makeLimiters();
    const WORKER_COUNT = Math.max(20, keyCount * 5);

    const processScene = async (scene: Scene): Promise<SceneResult> => {
      try {
        checkCancelled(runId);
        const aPath = audioPathFor(audioDir, scene.index);
        const vPath = videoPathFor(animDir, scene.index);

        // Audio: reuse the file on disk, else regenerate via MiniMax.
        let audio: TtsResult;
        if (fileReady(aPath)) {
          audio = { filePath: aPath, durationSec: await probeDurationSafe(aPath) };
        } else {
          audio = await limitTts(() => synthesizeScene(runId, scene, audioDir, { voiceOverride }));
        }

        // Video: reuse the clip on disk, else regenerate via Grok (or reuse
        // map → download from Drive).
        let videoPath: string;
        if (fileReady(vPath)) {
          videoPath = vPath;
        } else {
          const reuseFileId = reuseMap[String(scene.index)];
          const generated = reuseFileId
            ? await downloadReusedClip(runId, scene, reuseFileId, animDir)
            : await limitAnim(() => animateScene(runId, scene, null, animDir, { motionOverride }));
          if (!generated) throw new Error(`Scene #${scene.index} produced no video clip`);
          videoPath = generated;
        }

        return { scene, imagePath: videoPath, videoPath, audio };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(runId, "error", `Scene #${scene.index} failed: ${msg.slice(0, 1500)}`, { stage: "pipeline" });
        return null;
      }
    };

    // Worker pool — same bounded-RAM pattern as runPipeline.
    const settled: SceneResult[] = new Array(scenes.length).fill(null);
    let nextSceneIdx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const idx = nextSceneIdx++;
        if (idx >= scenes.length) return;
        settled[idx] = await processScene(scenes[idx]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(WORKER_COUNT, scenes.length) }, () => worker())
    );

    const sceneAssets = settled.filter((x): x is AssembleInput => x !== null);
    enforceFailureThreshold(runId, scenes.length, sceneAssets.length);
    if (sceneAssets.length === 0) throw new Error("No scenes succeeded");

    await finishRun(runId, sceneAssets, runDir);
  } catch (e) {
    handlePipelineError(runId, e);
  }
}

/** Whether a run can be resumed — needs a row + a saved scenes.json on disk. */
export function canResumeRun(runId: string): boolean {
  const row = getRunRowStmt.get(runId) as { id: string } | undefined;
  if (!row) return false;
  return fileReady(path.join(getRunDir(runId), "scenes.json"));
}
