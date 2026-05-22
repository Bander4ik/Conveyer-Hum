import { getLogs, subscribe } from "@/lib/logger";
import { ensureInit } from "@/lib/init";

/**
 * SSE stream of logs for a specific run.
 * First flushes historical logs, then subscribes to live events.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureInit();
  const { id } = await ctx.params;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // 1. history
      for (const log of getLogs(id)) send("log", log);
      send("ready", { runId: id });

      // 2. live
      const unsub = subscribe(id, (e) => send("log", e));

      // 3. heartbeat so proxies don't kill the connection
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {}
      }, 15000);

      const close = () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
