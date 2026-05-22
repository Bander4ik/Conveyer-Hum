# Installation guide — Conveyer Hum

Step-by-step setup for Windows 10/11 and macOS. Aimed at users with **zero programming experience** — every command can be copy-pasted exactly as shown.

**Total time:** ~30 minutes the first time, ~5 minutes for any update later.

---

## What you need before starting

- A computer running **Windows 10/11 or macOS** (Linux works too but isn't covered here)
- **~5 GB free disk space**
- Stable internet (first install downloads ~600 MB)
- A **Google account** (free — for the Gemini API key and optional Google Drive sync)
- A **69labs.vip account** (paid subscription — covers BOTH Grok video and MiniMax voiceover)

> **Heads-up about the command line.** Steps below ask you to use the terminal. On Windows it's called **Command Prompt** or **PowerShell**. On macOS it's called **Terminal**. You only paste commands and press Enter — no need to understand them.

---

## Part 1 — Install the three required programs (one time, ever)

You install **Git**, **Node.js**, and **FFmpeg** once on your computer. Then you never touch them again.

### 1.1 Install Git

Git is what downloads the project and pulls updates.

**Windows:**
1. Open https://git-scm.com/download/win — download starts automatically
2. Run the downloaded `.exe`. Click **Next** on every screen (defaults are fine), then **Install**
3. Open **Command Prompt** (Win key → type `cmd` → Enter), paste:
   ```
   git --version
   ```
   You should see `git version 2.x.x.windows.x`. If yes, Git is installed.

**macOS:**
1. Open **Terminal** (⌘ + Space → type `terminal` → Enter)
2. Paste:
   ```
   xcode-select --install
   ```
3. A popup asks to install Command Line Developer Tools. Click **Install**. Wait a few minutes.
4. Verify:
   ```
   git --version
   ```

---

### 1.2 Install Node.js

Node.js runs the Conveyer Hum code.

1. Open https://nodejs.org/
2. Click the green **LTS** button on the left. The `.msi` (Windows) or `.pkg` (macOS) download starts.
3. Run the installer. Click Next/Continue on every screen, accept the license, Install. Enter your computer password if asked.
4. **CLOSE all open terminal windows and open a fresh one.** Node isn't visible to windows opened before installation.
5. Verify:
   ```
   node --version
   ```
   Should print `v20.x.x` or higher.

---

### 1.3 Install FFmpeg

FFmpeg stitches your clips into the final video.

**Windows:**
1. Open **Command Prompt as administrator** (Win key → type `cmd` → right-click → Run as administrator)
2. Paste:
   ```
   winget install Gyan.FFmpeg
   ```
3. Wait for download (1–2 minutes)
4. **Close that admin window and open a new normal one.** Verify:
   ```
   ffmpeg -version
   ```

**macOS:**
1. If you don't have Homebrew, install it first. Open https://brew.sh and copy the install command (starts with `/bin/bash -c "$(curl ...`). Paste in Terminal, press Enter. Takes 5–10 min.
2. Then in Terminal:
   ```
   brew install ffmpeg
   ```
3. Verify:
   ```
   ffmpeg -version
   ```

---

## Part 2 — Download and install Conveyer Hum

### Step 1 — Pick a folder

Go to your Documents folder.

- **Windows:**
  ```
  cd %USERPROFILE%\Documents
  ```
- **macOS:**
  ```
  cd ~/Documents
  ```

### Step 2 — Download the project

```
git clone <CONVEYER-HUM-REPO-URL>
```

Replace `<CONVEYER-HUM-REPO-URL>` with the repository URL you were given.
10–30 seconds — you'll see progress lines ending with `Receiving objects: 100% ...`.

(If you received the project as a folder or ZIP instead of a repo URL, just put
that folder in your Documents folder and skip to Step 4.)

### Step 3 — Enter the project folder

```
cd Conveyer-Hum
```

### Step 4 — (Windows only) Add the folder to antivirus exclusions FIRST

> **Why this matters:** Windows Defender sometimes truncates native binaries during `npm install`, which breaks the project. Adding the folder to exclusions prevents this.

1. Open **Windows Security** (Start → "Windows Security")
2. **Virus & threat protection** → **Manage settings** under "Virus & threat protection settings"
3. Scroll down to **Exclusions** → **Add or remove exclusions**
4. **Add an exclusion** → **Folder** → pick your `Conveyer-Hum` folder

If you skip this and `npm install` fails, the `postinstall` script will try to fix it automatically by copying working binaries from a sibling project (if you have one). But adding exclusions is the proper fix.

### Step 5 — Install dependencies

```
npm install
```

3–8 minutes depending on internet. You'll see lots of scrolling text — that's normal. When done, you'll see `added NNN packages`.

---

## Part 3 — Get your API keys (2 keys total)

### Key 1 — Google Gemini (for splitting scripts into scenes)

1. Open https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click blue **Create API key**
4. Key starts with `AIza...`. Copy and save it temporarily.

Free tier is more than enough. No payment info required.

### Key 2 — 69labs (Grok video + MiniMax voiceover)

1. Open https://69labs.vip
2. Sign up / sign in, pick a plan
3. Dashboard → **API Keys** → copy your key (starts with `vk_`)

This single key covers **both** Grok video generation and the MiniMax voiceover — there is no separate TTS account to create. The MiniMax voice itself is chosen later, inside the app.

Tip: you can paste multiple `vk_` keys later (each on its own line) to run multiple 69labs accounts in parallel.

---

## Part 4 — First launch and configuration

### Step 1 — Start the app

In your terminal (still inside the `Conveyer-Hum` folder):

```
npm run dev
```

You should see:
```
▲ Next.js 16.x.x (Turbopack)
- Local:    http://localhost:3000
✓ Ready in 1300ms
```

**Don't close this window** — it's the running server. Keep it open while using the app. To stop the app, press **Ctrl+C** in this window.

#### One-click launch for next time

After installation, you can use:

- **Windows:** double-click `start.bat` in the project folder
- **macOS:** double-click `start.command`. The first time, macOS may block it — right-click → Open → confirm.

These do the same thing as `npm run dev` and open the browser automatically.

### Step 2 — Open in browser

Open Chrome / Edge / Safari / Firefox. Type:

```
http://localhost:3000
```

You'll see the **Conveyer Hum** interface with a left sidebar.

### Step 3 — Paste API keys

1. Click **Keys & Settings** in the sidebar
2. Under **Required API Keys**, fill in:
   - `GOOGLE_API_KEY` — Gemini key from Part 3 Key 1
   - `LABS69_API_KEY` — 69labs key from Part 3 Key 2
3. Click **Save all changes**. Green checkmark = saved.

That's all that's required. The MiniMax voice has a working default — change it any time in **Advanced → Voice Over (TTS)**.

You're ready to make videos. See [USAGE.md](./USAGE.md) for what to do next.

---

## Part 5 — (Optional) Connect Google Drive

Drive sync is **optional** but strongly recommended. Every finished run auto-uploads to your Drive, and the AI can later reuse clips from past runs for new videos — saving Grok credits.

### Step 1 — Create a Google Cloud project

1. Open https://console.cloud.google.com/
2. Sign in with your Google account
3. Project selector (top, next to the logo) → **New project** → name it "Conveyer Hum" → **Create**
4. Pick the new project from the selector

### Step 2 — Enable Google Drive API

1. Search bar at top → type `Google Drive API` → Enter
2. Click the result → **Enable**

### Step 3 — Set up OAuth consent screen

1. Hamburger menu → **APIs & Services** → **OAuth consent screen**
2. **External** → **Create**
3. **App name** — "Conveyer Hum", **User support email** — your email
4. Scroll down. **Developer contact** — your email again
5. **Save and Continue** through Scopes (no changes needed)
6. **Test users** → **Add users** → add your email → Save and Continue
7. **Back to Dashboard**

### Step 4 — Create OAuth credentials

1. Left sidebar → **Credentials**
2. **+ Create Credentials** → **OAuth client ID**
3. **Application type:** Web application
4. **Name:** "Conveyer Hum Local"
5. **Authorized redirect URIs** → **+ Add URI** → paste:
   ```
   http://localhost:3000/api/gdrive/oauth/callback
   ```
6. **Create** — a popup shows **Client ID** + **Client Secret**. Copy both.

### Step 5 — Paste into Conveyer Hum

1. Back at http://localhost:3000 → **Keys & Settings**
2. Scroll to **Google Drive Sync** section
3. Paste **Client ID** into `GDRIVE_CLIENT_ID`
4. Paste **Client Secret** into `GDRIVE_CLIENT_SECRET`
5. Leave folder ID fields **empty** — app auto-creates folders on first sync
6. Tick **Auto-upload finished runs to Drive**
7. Scroll up → **Save all changes**

### Step 6 — Authorize

1. The status banner shows "⚠ Not connected"
2. Click **Connect Google Drive**
3. Sign in with your Google account (the test user)
4. Click **Advanced** → **Go to [App Name] (unsafe)** — this is normal because the app is yours, not publicly verified
5. Approve permissions
6. Redirected back → "Google Drive connected ✓"

Drive sync is now active. Finished runs upload automatically.

---

## Updating to the latest version

When a new version is released:

1. Stop the app (Ctrl+C in the terminal where `npm run dev` is running)
2. Go into the project folder:
   - Windows: `cd %USERPROFILE%\Documents\Conveyer-Hum`
   - macOS: `cd ~/Documents/Conveyer-Hum`
3. Pull latest code:
   ```
   git pull
   ```
4. Update dependencies (usually <1 min):
   ```
   npm install
   ```
5. Start again:
   ```
   npm run dev
   ```

**Your API keys, prompts, presets, and run history are NOT affected** — they live in `~/.conveyer-hum/` outside the project tree, so updates can never delete them.

---

## Common installation problems

### `is not a valid Win32 application` or `next-swc.win32-x64-msvc.node` errors (Windows)

Windows Defender truncated a downloaded binary. Add the project folder to Defender exclusions (Part 2, Step 4), delete `node_modules`, re-install:

```
rmdir /s /q node_modules
npm install
```

The `postinstall` script also tries to auto-fix this by copying working binaries from sibling projects.

### `npm install` fails with permissions errors (macOS)

```
sudo npm install
```

If sudo also fails, your Node install is corrupted — reinstall Node from https://nodejs.org/.

### Port 3000 already in use

Another app is using port 3000. Either close that app, or run on a different port:

```
PORT=3001 npm run dev
```

Then open http://localhost:3001. Note: Google Drive OAuth callback is hardcoded to port 3000, so if you change ports, edit the redirect URI in your Google Cloud OAuth credentials too.

### "Save failed: Internal Server Error" on Settings page

The native SQLite module didn't install correctly. Try:

```
npm rebuild better-sqlite3
```

If that doesn't fix it, see the antivirus warning (Windows) and re-install.

### "Token expired or revoked" in Drive section

Misleading message — usually means Google Drive API isn't enabled for your project yet. Expand the raw error in the banner, click the link to Google Cloud, click Enable, wait 1 minute, refresh.

### macOS: `start.command` says "cannot be opened because it's from an unidentified developer"

Right-click the file → **Open** → confirm in the dialog. macOS remembers this and won't ask again.

---

## Where your files are stored

Two separate locations — code and data kept apart so updates never destroy your work.

**Code** (replaced on every `git pull`):
- The folder you cloned into (e.g. `~/Documents/Conveyer-Hum`)

**Data** (persistent — settings, presets, run history):
- macOS / Linux: `~/.conveyer-hum/`
- Windows: `C:\Users\YOU\.conveyer-hum\`

Inside that folder:
- `hum.db` — SQLite database (settings, API keys, prompts, presets, run history)
- `runs/<run-folder>/` — per-run output (audio MP3s, scene MP4s, final.mp4)

When Drive sync is on, raw clips are uploaded then deleted locally to save space. The final video stays on disk.

> **macOS users:** the folder starts with a dot so Finder hides it. To see it: press **⌘ + Shift + .** (period) in Finder, or **⌘ + Shift + G** and paste `~/.conveyer-hum/`.

---

## Next steps

- **Make your first video** → see [USAGE.md](./USAGE.md)
- **Tune visuals for your channel** → see [PROMPT-GUIDE.md](./PROMPT-GUIDE.md)
