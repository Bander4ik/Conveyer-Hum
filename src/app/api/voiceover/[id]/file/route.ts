import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getVoiceoverDir } from "@/lib/run-paths";

/**
 * GET /api/voiceover/{id}/file — serves a generated voiceover MP3.
 *   ?download=1        — adds Content-Disposition: attachment
 *   ?name=My+Script    — base filename for the download (sanitized)
 *
 * Supports HTTP Range requests (206) so the <audio> player can seek.
 * `id` must be a UUID — anything else is rejected to block path traversal.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const target = path.join(getVoiceoverDir(), `${id}.mp3`);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return NextResponse.json({ error: "Voiceover not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const size = fs.statSync(target).size;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0",
  };
  if (url.searchParams.get("download")) {
    const raw = url.searchParams.get("name") || "voiceover";
    const safe = raw.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 80) || "voiceover";
    baseHeaders["Content-Disposition"] = `attachment; filename="${safe}.mp3"`;
  }

  // Range request — lets the audio player seek without loading the whole file.
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const chunkSize = end - start + 1;
      const buffer = Buffer.alloc(chunkSize);
      const fd = fs.openSync(target, "r");
      try {
        fs.readSync(fd, buffer, 0, chunkSize, start);
      } finally {
        fs.closeSync(fd);
      }
      return new Response(new Uint8Array(buffer), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
      });
    }
  }

  const buffer = fs.readFileSync(target);
  return new Response(new Uint8Array(buffer), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
