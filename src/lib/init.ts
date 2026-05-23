// Server-only module — runs once per dev server start to seed default settings/prompts.
import { seedDefaults, getSetting, setSetting } from "./settings";
import { seedPromptDefaults } from "./prompts";

let inited = false;
export function ensureInit() {
  if (inited) return;
  seedDefaults();
  seedPromptDefaults();

  // One-time migration: the original default `TTS_VOICE_ID` was "English_CalmWoman",
  // but that id does NOT exist in the live 69labs MiniMax catalog (it was an
  // example from the docs, not a real voice). Jobs submitted with it created
  // successfully but failed during processing with "This job failed to complete."
  // Replace it with the confirmed-existing "English_Comedian". Users who picked
  // a different voice explicitly are untouched.
  if (getSetting("TTS_VOICE_ID") === "English_CalmWoman") {
    setSetting("TTS_VOICE_ID", "English_Comedian");
  }

  inited = true;
}
