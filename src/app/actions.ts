"use server";

import { loadSourceFiles } from "@/lib/github/archive";
import { readGitHubToken } from "@/lib/github/client";
import { loadRepository } from "@/lib/github/repository";
import { parseRepositoryUrl } from "@/lib/repository-url";
import { selectSourceFiles } from "@/lib/source-files";

export type DiscoveryResult =
  | {
      ok: true;
      repository: {
        fullName: string;
        defaultBranch: string;
        entryCount: number;
        sourceFileCount: number;
        skippedCount: number;
        limited: boolean;
      };
    }
  | { ok: false; message: string };

export async function discoverRepository(input: unknown): Promise<DiscoveryResult> {
  if (typeof input !== "string") {
    return { ok: false, message: "Enter a GitHub repository URL." };
  }

  const parsed = parseRepositoryUrl(input);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const token = readGitHubToken();
  const loaded = await loadRepository(parsed.repository, { token });
  if (!loaded.ok) return { ok: false, message: loaded.error.message };

  const { metadata, tree } = loaded.data;
  const selection = selectSourceFiles(tree.entries);
  const sources = await loadSourceFiles(metadata, selection.candidates, { token });
  if (!sources.ok) return { ok: false, message: sources.error.message };

  return {
    ok: true,
    repository: {
      fullName: metadata.fullName,
      defaultBranch: metadata.defaultBranch,
      entryCount: tree.entries.length,
      sourceFileCount: sources.data.files.length,
      skippedCount: selection.skipped.length + sources.data.skipped.length,
      limited: selection.limited,
    },
  };
}
