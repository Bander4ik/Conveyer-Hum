/**
 * Single source of truth for the settings form schema.
 *
 * Shared between /settings (only `MAIN_GROUPS`) and /advanced (only
 * `ADVANCED_GROUPS`). Editing a field's description here updates it on whatever
 * page renders that group.
 *
 * NOTE: only the settings relevant to Conveyer Hum's actual pipeline are
 * surfaced here. Legacy keys (image generation, ElevenLabs voice fine-tuning,
 * animation ratio/distribution) still exist in SETTING_KEYS / DEFAULTS so old
 * DB rows and code paths don't break — they're just hidden from the UI because
 * Conveyer Hum is video-only with MiniMax TTS and animates every scene.
 */

export interface Field {
  key: string;
  label?: string;
  desc: string;
  examples?: string;
  required?: boolean;
  multiline?: boolean;
}

export interface Group {
  title: string;
  subtitle?: string;
  required?: boolean;
  fields: Field[];
}

export const ALL_GROUPS: Group[] = [
  {
    title: "Required API Keys",
    subtitle: "The bare minimum needed to run the pipeline. Without these keys, nothing works.",
    required: true,
    fields: [
      {
        key: "GOOGLE_API_KEY",
        desc: "Powers scene splitting — Gemini reads your script and breaks it into individual scenes with visual prompts.",
        examples: "Get it free at https://aistudio.google.com/app/apikey (Create API key)",
        required: true,
      },
      {
        key: "LABS69_API_KEY",
        desc: "One key for BOTH Grok video generation and MiniMax voiceover through 69labs.vip — no separate TTS account needed.\n\nPRO TIP: You can paste multiple keys from different 69labs accounts (one per line, or comma-separated). Each account adds another 5 parallel video jobs to the pool. With 3 keys, generation is roughly 3× faster. The platform automatically balances jobs across all keys.",
        examples: "Single key: vk_abc... · Multiple keys: paste each on its own line. Each starts with vk_",
        required: true,
        multiline: true,
      },
    ],
  },
  {
    title: "Storage Location",
    subtitle: "Where the generated audio and final videos are saved on disk.",
    fields: [
      {
        key: "RUNS_OUTPUT_DIR",
        desc: "Absolute folder path for run outputs. Leave empty to use the default location inside your user profile (~/.conveyer-hum/runs). The settings database itself stays in the default location regardless.",
        examples: "Mac: /Users/you/Documents/Conveyer-Runs  ·  Windows: D:\\YouTube\\Conveyer-Runs",
      },
      {
        key: "FFMPEG_PATH",
        desc: "Absolute path to the FFmpeg binary. Only needed if FFmpeg is not in your system PATH. The platform requires FFmpeg for video assembly.",
        examples: "Mac: /opt/homebrew/bin/ffmpeg  ·  Windows: C:\\ffmpeg\\bin\\ffmpeg.exe  ·  Leave empty if `ffmpeg` works in your terminal",
      },
    ],
  },
  {
    title: "Script Breakdown (LLM)",
    subtitle: "How your script gets divided into scenes, and which language model does the splitting.",
    fields: [
      {
        key: "SCENE_SPLIT_PROVIDER",
        desc: "Which LLM service splits your script into scenes. Gemini is cheap and fast (recommended). Claude is more thorough but costs more.",
        examples: "google  or  anthropic",
      },
      {
        key: "SCENE_SPLIT_MODEL",
        desc: "Specific model id. For Google, the `-latest` alias auto-tracks the current stable Flash. For Anthropic use the full model id.",
        examples: "gemini-flash-latest, gemini-2.5-flash, gemini-2.5-pro",
      },
    ],
  },
  {
    title: "Voice Over (TTS)",
    subtitle: "Conveyer Hum narrates with MiniMax through the 69labs gateway — the same LABS69_API_KEY that powers video also covers the voiceover. Pick a MiniMax voice and tune its delivery here.",
    fields: [
      {
        key: "TTS_VOICE_ID",
        label: "MiniMax voice",
        desc: "The MiniMax voice used for narration. Use a catalog voice id (e.g. English_Comedian) or a cloned-voice id — browse them in your 69labs dashboard → MiniMax. A channel profile in Channels & Prompts can override this per channel.",
        examples: "Catalog voice e.g. English_Comedian  ·  or a cloned-voice id from 69labs",
      },
      {
        key: "TTS_MODEL",
        label: "MiniMax model",
        desc: "Which MiniMax speech model to use. `speech-02-hd` is the highest-quality option and the recommended default. Leave it as-is unless 69labs lists a newer model.",
        examples: "speech-02-hd (default — highest quality)",
      },
      {
        key: "TTS_SPEED",
        desc: "Speech rate. 1.0 = neutral pace. Lower = slower and more deliberate. 0.93 sounds slightly cinematic for documentary narration.",
        examples: "Range 0.5–2.0  ·  default 0.93",
      },
      {
        key: "TTS_LANGUAGE_BOOST",
        label: "Language boost",
        desc: "Tells MiniMax which language to optimise pronunciation for. Set it to your script's language for the clearest delivery. `auto` lets MiniMax detect the language itself.",
        examples: "English (default)  ·  Spanish  ·  French  ·  auto",
      },
      {
        key: "TTS_PROVIDER",
        desc: "Which engine generates the voiceover. `minimax` (default) routes to MiniMax via 69labs. `69labs` uses Edge TTS / ElevenLabs / a cloned voice through 69labs. `elevenlabs` and `openai` call those APIs directly and need their own keys.",
        examples: "minimax (default)  ·  69labs  ·  elevenlabs  ·  openai",
      },
    ],
  },
  {
    title: "Video Generation (Grok)",
    subtitle: "How each scene's video clip is generated. Conveyer Hum animates EVERY scene through Grok via 69labs.",
    fields: [
      {
        key: "ANIMATION_PROVIDER",
        desc: "Service for video generation. `69labs` (default) routes to xAI Grok. `replicate` / `fal` open the door to Kling, Luma, etc. Do not set to `off` — Conveyer Hum is video-only and needs a provider.",
        examples: "69labs  (default)  ·  replicate  ·  fal",
      },
      {
        key: "ANIMATION_MODEL",
        desc: "Specific model id. `grok-imagine-video` (xAI Grok) is the Conveyer Hum default — that's what this fork is built around. `veo-video` (Google Veo) is an alternate 69labs option. For Replicate use `kwaivgi/kling-v1.6-pro`.",
        examples: "grok-imagine-video  (default)  ·  veo-video  ·  kwaivgi/kling-v1.6-standard",
      },
      {
        key: "IMAGE_RATIO",
        label: "Aspect ratio",
        desc: "Aspect ratio of the generated video clips. 16:9 for landscape YouTube videos, 9:16 for vertical Shorts/Reels.",
        examples: "16:9 (default)  ·  9:16  ·  1:1",
      },
      {
        key: "ANIMATION_DURATION",
        desc: "Clip length in seconds. IGNORED for Grok (69labs hard-blocks the duration parameter — Grok always returns a fixed ~6s clip) and Veo. Only used for other providers (Kling via Replicate/fal).",
        examples: "empty = provider default  ·  4–10 = explicit (Kling/Replicate only)",
      },
      {
        key: "ANIMATION_KEEP_VEO_AUDIO",
        label: "Keep model ambient audio",
        desc: "Whether to keep the ambient audio the video model bakes into each clip. Default empty — we mute it so only the MiniMax voiceover is heard. Set `1` to layer the model's atmospheric sound behind the narrator. (Key name is legacy — applies to any model.)",
        examples: "empty = mute (default)  ·  1 = keep ambient audio",
      },
    ],
  },
  {
    title: "Video Assembly (FFmpeg)",
    subtitle: "Final stitching step. Controls output resolution, framerate, and how scenes transition into each other.",
    fields: [
      {
        key: "VIDEO_RESOLUTION",
        desc: "Final video resolution. 1920x1080 (1080p) is the YouTube standard. Grok source clips are scaled to fit.",
        examples: "1920x1080, 1280x720, 3840x2160",
      },
      {
        key: "VIDEO_FPS",
        desc: "Frames per second. 24 is cinematic. 30 is YouTube standard. 60 doubles render time and file size.",
        examples: "24, 30, 60",
      },
      {
        key: "TRANSITION_DURATION",
        desc: "Crossfade length between scenes in seconds. 0.5 is a gentle blend. 1.0 is more cinematic and smooths over short clips. 0 disables transitions (instant cuts — faster to render but abrupt).",
        examples: "0.5 = smooth  ·  1.0 = cinematic  ·  0 = no transitions",
      },
      {
        key: "SCENE_TAIL_SILENCE",
        desc: "Silence appended to the END of every scene's audio before assembly. This is how you get breathing room BETWEEN scenes. Raise to 0.6–0.8 if narration feels rushed at sentence endings.",
        examples: "0 = back-to-back  ·  0.4 = natural breath (default)  ·  0.8 = reflective pacing",
      },
      {
        key: "SCENE_DURATION_SECONDS",
        desc: "Fallback clip duration when TTS audio length is somehow unknown. In normal operation this is never used — we measure actual audio length with ffprobe.",
        examples: "default 5",
      },
    ],
  },
  {
    title: "Performance (Concurrency)",
    subtitle: "How many parallel jobs and FFmpeg renders to run at once. Higher = faster but risks rate limits. Defaults are tuned for 69labs's limits.",
    fields: [
      {
        key: "TTS_CONCURRENCY",
        desc: "Simultaneous TTS jobs PER 69labs key. With multiple keys, total = this × number of keys.",
        examples: "default 3  ·  bump to 5–7 on higher-tier plans",
      },
      {
        key: "ANIMATION_CONCURRENCY",
        desc: "Simultaneous video jobs PER 69labs key. 69labs's hard limit is 5 per account. Default 3 leaves retry headroom. Total = this × number of keys. Lower this to 2 if you see lots of 429 'Too many requests' errors.",
        examples: "default 3  ·  max 5 per 69labs account",
      },
      {
        key: "ASSEMBLE_CONCURRENCY",
        desc: "How many FFmpeg clip renders happen in parallel. CPU-bound — set roughly to half your CPU core count.",
        examples: "default 4  ·  raise on 8+ core CPUs",
      },
      {
        key: "ASSEMBLE_XFADE_CHUNKS",
        desc: "Splits the final crossfade pass into N parallel chunks, then crossfades the chunks together. Massively speeds up assembly for long videos (100+ scenes). Set to 1 to disable. Auto-skipped for short videos (fewer than 3×chunks scenes).",
        examples: "1 = no chunking  ·  4 = default  ·  6-8 for 16+ core CPUs",
      },
    ],
  },
  {
    title: "Reliability & Scaling",
    subtitle: "How tolerant a run is of failures, and the confidence bar for Auto library reuse. Matters most at high volume on unreliable nights.",
    fields: [
      {
        key: "FAILURE_THRESHOLD_PERCENT",
        desc: "If more than this percentage of scenes fail, the whole run aborts. Default 25. On unreliable nights (provider glitches) raise it to 60-70 so a partial run survives — you can then Resume it from the run page to regenerate only the missing scenes instead of losing everything.",
        examples: "25 = default (strict)  ·  60-70 = tolerant (keep partial runs)  ·  100 = never abort",
      },
      {
        key: "AUTO_REUSE_THRESHOLD",
        desc: "Confidence percentage for Auto reuse. When a run is in Auto reuse mode (chosen per run on the New Run page), a scene is reused only if its best library match scores at or above this. Higher = stricter (fewer but safer reuses).",
        examples: "80 = default  ·  90 = very strict  ·  70 = aggressive reuse",
      },
    ],
  },
  {
    title: "Optional / Alternative Providers",
    subtitle: "Only needed if you switch away from the default Grok + MiniMax stack. Leave empty otherwise.",
    fields: [
      {
        key: "ELEVENLABS_API_KEY",
        desc: "Direct ElevenLabs API key. Only used when TTS_PROVIDER is set to `elevenlabs`.",
        examples: "Sign up at https://elevenlabs.io → Profile → API Keys",
      },
      {
        key: "REPLICATE_API_TOKEN",
        desc: "Replicate token — for using Kling or other video models directly instead of Grok via 69labs.",
        examples: "Sign up at https://replicate.com → Account → API Tokens",
      },
      {
        key: "FAL_API_KEY",
        desc: "fal.ai key — alternative to Replicate for video models.",
        examples: "Sign up at https://fal.ai → API keys",
      },
      {
        key: "ANTHROPIC_API_KEY",
        desc: "Anthropic Claude key. Only used when SCENE_SPLIT_PROVIDER is `anthropic`.",
        examples: "Sign up at https://console.anthropic.com",
      },
      {
        key: "OPENAI_API_KEY",
        desc: "OpenAI key — for backup TTS (gpt-4o-mini-tts) when TTS_PROVIDER is `openai`.",
        examples: "Sign up at https://platform.openai.com",
      },
    ],
  },
];

/** Groups that stay on /settings (Keys & Settings). */
export const MAIN_GROUPS: Group[] = ALL_GROUPS.filter(
  (g) => g.title === "Required API Keys"
);

/** Groups that move to /advanced. */
export const ADVANCED_GROUPS: Group[] = ALL_GROUPS.filter(
  (g) => g.title !== "Required API Keys"
);
