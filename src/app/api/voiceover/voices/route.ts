import { NextResponse } from "next/server";
import { ensureInit } from "@/lib/init";
import { listMinimaxVoices } from "@/lib/services/labs69";

/**
 * GET /api/voiceover/voices — lists MiniMax catalog voices for the Voiceover
 * tool's picker. Optional ?search= / ?language= / ?gender= filters are passed
 * straight through to 69labs.
 *
 * On failure (no key, network) this still returns HTTP 200 with an `error`
 * field and an empty list, so the client can fall back to a manual voice-id
 * input instead of breaking the page.
 */
export async function GET(req: Request) {
  ensureInit();
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const language = url.searchParams.get("language") ?? undefined;
  const gender = url.searchParams.get("gender") ?? undefined;

  try {
    const result = await listMinimaxVoices({ search, language, gender, pageSize: 100 });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg, voices: [], hasMore: false, totalCount: 0 },
      { status: 200 }
    );
  }
}
