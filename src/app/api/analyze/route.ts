import { NextResponse, type NextRequest } from "next/server";

import { requestFacts } from "@/app/local-session";
import { discoverRepository, type DiscoveryProgress, type DiscoveryResult } from "@/lib/discovery";
import { presentRepositoryError } from "@/lib/errors/presentation";
import { isAuthorizedRequest, readLocalSession } from "@/lib/local/session";

export const dynamic = "force-dynamic";

export type AnalysisEvent = { type: "progress"; progress: DiscoveryProgress } | { type: "result"; result: DiscoveryResult };

// Analyzes the repository this process was started on and streams
// newline-delimited JSON: progress events, then one result. The request
// carries no path: the root is fixed when Codefield starts, so no request can
// point the analysis anywhere else. Only the graph and counts are sent; source
// text stays in this process.
export async function POST(request: NextRequest) {
  const session = readLocalSession();
  if (session === null) return new NextResponse(null, { status: 404 });
  if (!isAuthorizedRequest(session, requestFacts(session, request.headers, request.cookies))) {
    return new NextResponse(null, { status: 403 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      let result: DiscoveryResult;
      try {
        result = await discoverRepository(session.root, {
          signal: request.signal,
          onProgress: (progress) => send({ type: "progress", progress }),
        });
      } catch (error) {
        if (request.signal.aborted) {
          closed = true;
          return;
        }
        // Only the error's name: messages can contain file paths or contents.
        console.error("Repository analysis failed.", error instanceof Error ? error.name : "unknown error");
        result = { status: "error", error: presentRepositoryError("failed") };
      }
      send({ type: "result", result });
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
    // The browser went away; request.signal also stops the analysis.
    cancel() {
      closed = true;
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
