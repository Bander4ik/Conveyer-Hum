# Conveyer Hum

**A local toolkit for faceless YouTube videos — Grok video + MiniMax voiceover, all on your own computer.**

Conveyer Hum has **three modes**, picked from the sidebar:

- **Video Conveyer** — paste a script; it splits into scenes, generates a MiniMax voiceover and a Grok video clip for each scene, and stitches everything into one MP4 ready for YouTube.
- **Voiceover** — a standalone text-to-speech tool: paste any text, pick a MiniMax voice, generate and download the MP3. No script splitting, no video.
- **Re-assembly** — build a video mostly from clips you already have: the AI matches each script scene to a clip in your Google Drive library, you swap any pick by hand, and only the missing scenes are generated fresh.

Everything runs locally through a simple web interface — no editing config files, no hosted backend. Finished runs can auto-upload to Google Drive, and the AI can reuse clips from past runs when scenes look similar, so the more videos you make, the cheaper and faster each new one becomes.

Channel profiles are supported — save a per-channel bundle (scene-split prompt, MiniMax voice, motion style) and switch between them in one click on each run.

---

## Documentation

| Doc | What's in it |
|---|---|
| **[INSTALL.md](./docs/INSTALL.md)** | Step-by-step install for Windows + macOS — for users with zero programming experience |
| **[USAGE.md](./docs/USAGE.md)** | How to use the three modes — making videos, voiceovers, re-assembly, library reuse |
| **[PROMPT-GUIDE.md](./docs/PROMPT-GUIDE.md)** | How to write a scene-split prompt for your YouTube niche, with a full worked example |

---

## Quick start (if you already have Node 20+ and FFmpeg)

From the **Conveyer Hum** project folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Keys & Settings** → paste your `GOOGLE_API_KEY` and `LABS69_API_KEY` → Save.

That single 69labs key powers **both** Grok video generation and MiniMax voiceover — no separate TTS account needed.

Then **Video Conveyer** → paste a script → run. First video done in 5–10 minutes.

For full onboarding (installing prerequisites, getting API keys, Drive setup), see [INSTALL.md](./docs/INSTALL.md).

---

## What's the stack

- **Next.js 16** (Turbopack) + **React 19** + **TypeScript** + **Tailwind 4**
- **Gemini Flash** — script → scene split (cheap, free tier OK for tests)
- **MiniMax via 69labs** — voiceover per scene (uses the same `LABS69_API_KEY` as video)
- **xAI Grok via 69labs** — text-to-video, ~6-second clips per scene
- **FFmpeg** — per-scene render + crossfade assembly
- **better-sqlite3** — local DB at `~/.conveyer-hum/hum.db`
- **Google Drive** — optional auto-upload + AI-search reuse across past runs

---

## How it works — Video Conveyer mode

```
script
  │
  ▼
[1] Scene split (Gemini) → JSON array of {text, visual_prompt, duration_hint_sec}
  │
  ▼
[2] Per scene IN PARALLEL:
       ├─ MiniMax TTS (via 69labs) → narration MP3
       └─ Grok via 69labs         → 6-second silent video clip
                                     (or download an existing clip from Drive if reusing)
  │
  ▼
[3] Per-scene render (FFmpeg) → MP4 with audio + video synced
  │
  ▼
[4] Final assembly (FFmpeg) → crossfade all clips into final.mp4
  │
  ▼
[5] (Optional) Drive sync → upload final.mp4 + raw clips + metadata
```

**Re-assembly mode** runs the same pipeline but with a manual reuse map — the scenes you matched to library clips skip Grok generation and download from Drive instead.

Concurrency: up to 3 TTS + 3 video jobs in flight per 69labs key. With 3 keys configured, 9 video jobs run in parallel.

---

## Where files live

- **Code** — the **Conveyer Hum** project folder
- **Data** (persistent, never wiped by code updates):
  - macOS / Linux: `~/.conveyer-hum/`
  - Windows: `C:\Users\YOU\.conveyer-hum\`

The data folder contains `hum.db` (SQLite — your settings, prompts, run history), `runs/<folder>/` (per-run audio + video + final.mp4), and `voiceovers/` (MP3s from the standalone Voiceover tool).

---

## License

MIT — see [LICENSE](./LICENSE).
