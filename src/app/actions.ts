"use server";

import { readGitHubToken } from "@/lib/github/client";
import { loadRepository } from "@/lib/github/repository";
import { parseRepositoryUrl } from "@/lib/repository-url";

export type DiscoveryResult =
  | {
      ok: true;
      repository: {
        fullName: string;
        defaultBranch: string;
        entryCount: number;
      };
    }
  | { ok: false; message: string };

export async function discoverRepository(input: unknown): Promise<DiscoveryResult> {
  if (typeof input !== "string") {
    return { ok: false, message: "Enter a GitHub repository URL." };
  }

  const parsed = parseRepositoryUrl(input);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const result = await loadRepository(parsed.repository, {
    token: readGitHubToken(),
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  const { metadata, tree } = result.data;
  return {
    ok: true,
    repository: {
      fullName: metadata.fullName,
      defaultBranch: metadata.defaultBranch,
      entryCount: tree.entries.length,
    },
  };
}
