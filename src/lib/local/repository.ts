import { basename } from "node:path";

import { readGitMetadata } from "./git-metadata.ts";

// What the status line shows about the repository. The absolute path stays
// on the server; the browser only needs a name.
export type RepositoryIdentity = {
  name: string;
  branch: string | null;
  remote: string | null;
};

export async function describeRepository(root: string): Promise<RepositoryIdentity> {
  const git = await readGitMetadata(root);
  return { name: basename(root) || root, branch: git?.branch ?? null, remote: git?.remote ?? null };
}
