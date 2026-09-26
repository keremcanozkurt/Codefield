import type { AnalysisEvent } from "@/app/api/analyze/route";
import type { DiscoveryProgress, DiscoveryResult } from "@/lib/discovery";
import { CONNECTION_LOST } from "@/lib/errors/presentation";

// Never rejects: a failed request becomes an error result like any other.
export async function requestAnalysis(
  onProgress: (progress: DiscoveryProgress) => void,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  let response: Response;
  try {
    response = await fetch("/api/analyze", { method: "POST", signal });
  } catch {
    return { status: "error", error: CONNECTION_LOST };
  }
  if (response.status === 403) {
    return {
      status: "error",
      error: {
        title: "Session expired",
        message: "Open the link printed in the terminal where Codefield is running.",
        retryable: false,
      },
    };
  }
  if (!response.ok || response.body === null) return { status: "error", error: CONNECTION_LOST };

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += value;
      let newline: number;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line === "") continue;
        const event = JSON.parse(line) as AnalysisEvent;
        if (event.type === "progress") onProgress(event.progress);
        else return event.result;
      }
    }
  } catch {
    // Falls through to the error below.
  }
  return { status: "error", error: CONNECTION_LOST };
}
