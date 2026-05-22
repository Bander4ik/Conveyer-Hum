import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * Data dir holds the SQLite database (settings, run records, logs).
 * Lives outside the project source tree so Turbopack file-watcher doesn't try
 * to scan SQLite shm/wal files (which can be locked on Windows).
 *
 * Override via CONVEYER_HUM_DATA_DIR environment variable.
 * Isolated from Hum Conveyer / Conveyer Isabell so they can coexist on the
 * same machine without DB collisions.
 */
const DATA_DIR =
  process.env.CONVEYER_HUM_DATA_DIR ??
  path.join(os.homedir(), ".conveyer-hum");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hum.db"));
// Without WAL: on Windows the .shm file can lock external readers.
db.pragma("journal_mode = DELETE");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prompts (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Channel profiles (table name "prompt_presets" is legacy). Each row is a
  -- full per-channel bundle the user picks on the New Run page in one click:
  --   name             — channel name
  --   description      — optional human note about the channel
  --   content          — scene_split system prompt (legacy column name)
  --   animation_motion — optional motion-style override
  --   image_prompt     — optional image-style override (unused in video-only)
  --   voice_id         — optional per-channel voice; overrides the global
  --                      TTS_VOICE_ID setting for runs on this channel
  -- Optional fields fall back to global defaults / settings when NULL.
  CREATE TABLE IF NOT EXISTS prompt_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    description TEXT,
    animation_motion TEXT,
    image_prompt TEXT,
    voice_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    title TEXT,
    folder_name TEXT,
    status TEXT NOT NULL,
    script TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    output_path TEXT
  );

  CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    -- ISO 8601 with Z so the client renders local time correctly
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    level TEXT NOT NULL,
    stage TEXT,
    message TEXT NOT NULL,
    data_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_run_logs_run ON run_logs(run_id, id);
`);

// Migrations for older DBs. SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT
// EXISTS`, so we attempt and ignore failure when the column already exists.
function tryAddColumn(table: string, columnDecl: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDecl}`);
  } catch {
    // column already exists
  }
}

tryAddColumn("runs", "folder_name TEXT");
// Drive references — set by run-upload.ts after a successful sync.
tryAddColumn("runs", "drive_clips_folder_id TEXT");
tryAddColumn("runs", "drive_final_video_id TEXT");
tryAddColumn("runs", "drive_synced_at TEXT");
// Reuse map — JSON `{ "<scene_index>": "<drive_file_id>" }`. When present,
// the pipeline skips video generation for those scenes and downloads from Drive.
tryAddColumn("runs", "reuse_map_json TEXT");
// Prompt preset used for scene splitting + animation motion + image style.
// Stored as a snapshot of the content (not FKs) so deleting the preset later
// doesn't break old runs / diagnostics. preset_content == scene_split.
tryAddColumn("runs", "preset_id INTEGER");
tryAddColumn("runs", "preset_name TEXT");
tryAddColumn("runs", "preset_content TEXT");
tryAddColumn("runs", "preset_animation_motion TEXT");
tryAddColumn("runs", "preset_image_prompt TEXT");
tryAddColumn("runs", "preset_voice_id TEXT");
// Backfill for older prompt_presets rows (created before these columns existed)
tryAddColumn("prompt_presets", "animation_motion TEXT");
tryAddColumn("prompt_presets", "image_prompt TEXT");
tryAddColumn("prompt_presets", "description TEXT");
tryAddColumn("prompt_presets", "voice_id TEXT");

export default db;
