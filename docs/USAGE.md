# Usage guide — how to make videos with Conveyer Hum

This guide assumes you've already finished installation. If not, see [INSTALL.md](./INSTALL.md).

After install, you open `http://localhost:3000` in your browser and see the Conveyer Hum interface with a left sidebar. Everything happens through that interface — no editing config files, no rebuilding.

---

## Sidebar at a glance

| Page | What it does |
|---|---|
| **Video Conveyer** | Paste a script → a full video: scenes, voiceover, clips, final MP4 |
| **Voiceover** | Standalone text-to-speech — paste text, pick a MiniMax voice, download an MP3 |
| **Re-assembly** | Build a video mostly from clips you already have in your Drive library |
| **Run history** | All your past runs — status, final video, logs |
| **Library** | Browse clips from past runs on Google Drive (if Drive sync is on) |
| **Channels & Prompts** | Channel profiles (one per channel) + default prompts |
| **Keys & Settings** | API keys, Drive credentials |
| **Advanced** | Voice (MiniMax) settings, video model, FFmpeg options, concurrency |

The first three are the **modes**; the rest are shared across all of them.

---

## Making your first video (3 minutes setup, 10–30 minutes generation)

### Step 1 — Paste API keys (one-time)

Go to **Keys & Settings** and fill in:

- `GOOGLE_API_KEY` — your Gemini key from [aistudio.google.com](https://aistudio.google.com/app/apikey) (free)
- `LABS69_API_KEY` — your 69labs key (starts with `vk_`). This one key powers **both** Grok video and MiniMax voiceover.

Only two keys to start. The MiniMax voice itself is chosen in **Advanced → Voice Over (TTS)**, and it already has a sensible default.

Click **Reveal secret values** if you need to edit existing keys (they're masked by default).

Click **Save all changes**. You should see green confirmation.

### Step 2 — (Optional but recommended) Set up a channel profile

Default prompts work, but you'll get much better, more on-brand results with a channel profile tuned to your niche.

Go to **Channels & Prompts** → **Add new channel** → fill in the channel name, optionally a MiniMax voice (this channel's own voice) and a description, then paste the Scene Split prompt → **Add channel**.

See [PROMPT-GUIDE.md](./PROMPT-GUIDE.md) for what to put in the Scene Split prompt and a full worked example.

### Step 3 — Paste script, run pipeline

Go to **Video Conveyer**.

1. (Optional) Give the run a title — useful for finding it later in Run history
2. **Channel** dropdown → pick the channel profile for this video. Its scene-split prompt, voice and motion all apply automatically. Leave at *"Default — no channel profile"* to use the global defaults
3. **Script** textarea → paste your full narrator script. Anything from 30 seconds to 30 minutes works.

Below the script box you'll see live stats: word count, estimated duration, estimated scenes, estimated total generation time.

Click **Run pipeline** — that's it. The page redirects to live logs and you can watch each scene generate in real time.

---

## What happens during a run

The pipeline runs 5 phases automatically. You don't intervene — just watch the logs.

```
[1] Scene split (Gemini)
    Your script + preset → JSON array of scenes (each with text + visual_prompt + duration)
       ↓
[2] Per scene IN PARALLEL:
       ├─ MiniMax TTS (via 69labs) → narration MP3
       └─ Grok via 69labs → 6-second silent video clip
           (or, if you picked Library reuse: download existing clip from Drive)
       ↓
[3] Per-scene render (FFmpeg)
    Combine narration + video into one MP4 clip per scene, sync durations
       ↓
[4] Final assembly (FFmpeg)
    Crossfade all scene clips into one final.mp4
       ↓
[5] (Optional) Drive sync
    Upload raw clips + clips.json + description.md + final video to your Google Drive
    Delete local raw clips to save disk space
```

Time per video:
- **30-second test script**: 2–5 minutes
- **2–3 minute video**: 5–10 minutes
- **10-minute video**: 15–25 minutes
- **25-minute video**: 40–80 minutes

These are with ONE 69labs key. Each extra key roughly halves total time (parallel jobs).

---

## Library reuse — save credits on similar scenes

If you've connected Google Drive AND made a few runs already, the AI can browse your past clips and reuse ones that match new scenes — skipping Grok generation for those scenes entirely.

On the Video Conveyer page:

1. Paste script as usual
2. Click **Preview scenes first** (instead of Run pipeline)
3. The page shows the scene split + a button **Find existing clips from library**
4. Click it — the AI scores every scene against your Drive library and auto-checks matches at 80% confidence or higher
5. Review the checked picks — uncheck any you don't like, expand a scene to see alternative matches
6. Click **Run pipeline (reusing N clips)** — N scenes skip generation, the rest generate fresh

This pays off quickly. The more videos you make, the more matches the library finds.

For a dedicated, review-every-scene version of this, use the **Re-assembly** mode (below).

---

## Voiceover — standalone text-to-speech

The **Voiceover** tab is a stand-alone narration tool — no script splitting, no
video, just voice. Use it for intros, ad reads, narration you'll edit elsewhere,
or simply to audition voices.

1. Open **Voiceover** in the sidebar
2. Paste your text into the box
3. Pick a **MiniMax voice** — the dropdown loads the 69labs MiniMax catalog; type
   in the search box to filter it. Tick *"Use a custom / cloned voice id"* to
   paste a cloned-voice id instead
4. Optionally adjust **model**, **language boost**, and **speed**
5. Click **Generate voiceover**

The MP3 appears below with a player and a **Download MP3** button. Recent
generations stay listed so you can compare voices. Files are kept in
`~/.conveyer-hum/voiceovers/`.

---

## Re-assembly — build from clips you already have

The **Re-assembly** tab builds a video mostly from clips already in your Google
Drive library — only the genuinely new scenes are generated fresh. It needs
Google Drive connected and a few past runs synced.

1. Open **Re-assembly**, pick a **Channel**, and paste your **Script**
2. Click **Analyze script & match library** — the AI splits the script into
   scenes and matches each one against your Drive library
3. Every scene is listed with its best-matching clip pre-selected. For each scene
   you can:
   - **keep** the AI's pick,
   - click a different **AI-suggested clip**,
   - **Browse library…** to assign *any* clip from your whole library, or
   - **Generate fresh** to have Grok make a new clip for that scene
4. The summary shows how many scenes are reused vs generated fresh
5. Click **Build video** — the run starts; reused scenes download from Drive, the
   rest generate with Grok, and every scene gets a MiniMax voiceover

This is the cheapest way to make a new video once you have a clip library — every
reused scene is one Grok generation you don't pay for.

---

## Channel profiles — one profile per channel

If you run multiple YouTube channels with different styles, save a profile for each on the **Channels & Prompts** page. Each profile bundles:

- **Scene Split prompt** — the visual rules for this channel (required)
- **MiniMax voice** — this channel's own voice (optional — empty uses the global voice)
- **Animation Motion override** — this channel's motion style (optional — empty uses the global default)
- **Description** — a note for your own reference (optional)

Examples:

- *"Blue Zone Way"* — Mediterranean visuals, calm voice, dignified slow motion
- *"Tech Explainer"* — futuristic visuals, energetic voice, kinetic motion

On the Video Conveyer page, pick the channel from the **Channel** dropdown — the prompt, voice and motion all apply in one click. The run snapshots which profile it used, so deleting a profile later doesn't break old runs.

See [PROMPT-GUIDE.md](./PROMPT-GUIDE.md) for how to write the Scene Split prompt.

---

## After a run finishes

On the run's detail page (under Run history) you can:

- **Play the final video** right in the browser
- **Download MP4** — to upload to YouTube or edit further
- **See Drive sync status** — link to the run's folder in your Drive
- **Open run folder** — opens the local folder with all assets (audio MP3s, individual scene MP4s, final.mp4)
- **Read full logs** — every step of the pipeline, useful for debugging

If something went wrong mid-run (a scene failed, the LLM produced bad output), the page shows which scene + what error.

---

## Where your files live

Two separate locations — code and data are kept apart so updates can never destroy your work.

**Code** (replaced when you update to a new version):
- The **Conveyer Hum** project folder (e.g. `~/Documents/Conveyer Hum`)

**Data** (persistent — settings, run records, all your work):
- macOS / Linux: `~/.conveyer-hum/`
- Windows: `C:\Users\YOU\.conveyer-hum\`

Inside that folder:
- `hum.db` — your settings, API keys, prompts, presets, run history
- `runs/<run-folder>/` — per-run output (audio, animations, final.mp4)

You can change `runs/` location in **Advanced settings → RUNS_OUTPUT_DIR** if you want runs on a different disk.

> **macOS users** — the folder starts with a dot so Finder hides it. Press **⌘ + Shift + .** in Finder to show hidden folders, or **⌘ + Shift + G** and paste `~/.conveyer-hum/`.

---

## Multi-key 69labs — running faster

Each 69labs account has hard limits: 7 parallel images + 5 parallel videos. With multiple accounts you multiply parallelism — 3 keys = 21 image / 15 video slots simultaneously.

To use multiple keys:

1. Go to **Keys & Settings → LABS69_API_KEY**
2. Paste each `vk_...` key on its own line (or separate them with commas)
3. **Save all changes**

The pipeline automatically load-balances jobs across all configured keys. Each key has its own concurrency counter; the next job goes to the least-loaded account.

The header on the New Run page shows current key count and effective parallel capacity. With N keys, expect roughly N× faster generation (limited by total Grok throughput across accounts).

---

## Common questions

### How long can my video be?

No hard limit. The pipeline handles scripts from 30 seconds to 30+ minutes. Longer scripts = more scenes = more generation time + more 69labs credits used.

### How long can each clip be?

Fixed at ~6 seconds per scene (Grok via 69labs limitation — we cannot ask for longer). The scene split prompt enforces this by keeping each scene's narration ≤ 6 seconds, so the visual doesn't freeze on the last frame.

### Can I edit the final video?

Yes — download the MP4 and open in any editor. All raw scene clips are also saved on disk (and Drive if sync is on) so you can swap individual scenes manually.

### What if a scene fails?

The pipeline retries each scene up to 3 times with exponential backoff. If a scene still fails after retries, the run continues — you'll see the failed scene in the logs and final video skips that scene (or fails the whole run if too many scenes fail). For now, the easiest fix is to re-run the pipeline; **Library reuse** will pick up the scenes that succeeded last time, so only the failed ones regenerate.

### Can I use different video models (Veo / Kling) instead of Grok?

Yes — **Advanced settings → ANIMATION_MODEL**. Conveyer Hum defaults to `grok-imagine-video` because that's what this fork was built for, but you can switch to `veo-video` (Google Veo via 69labs) or other providers. Note: this is mainly for experimentation — the default prompts are tuned for Grok's 6s clip length.

### Where are my videos uploaded?

If Drive sync is on:
- Final MP4 → `Conveyer Hum/Final Videos/<run-folder>.mp4` in your Drive
- Raw clips → `Conveyer Hum/Clips Library/<run-folder>/` (scene clips + `clips.json` metadata + `description.md` human-readable summary)

The "Conveyer Hum" root folder is separate from any other forks (Hum Conveyer, Conveyer Isabell, etc.) so you can run multiple variants without collisions.
