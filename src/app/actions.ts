"use server";

import { revalidatePath } from "next/cache";

import { requestCookieJar } from "@/app/github";
import { discoverRepository as runDiscovery } from "@/lib/discovery";
import type { DiscoveryResult } from "@/lib/discovery";
import { manageAccessUrl, readGitHubAppConfig } from "@/lib/github/app";
import { openConnection } from "@/lib/github/connection";

export type { DiscoveryResult, RepositoryIdentity, SuccessResult } from "@/lib/discovery";

// A thin "use server" boundary: the actual orchestration lives in
// lib/discovery.ts, which uses relative imports so it can run under the
// plain test runner instead of Next.js's module resolution.
export async function discoverRepository(input: unknown): Promise<DiscoveryResult> {
  const config = readGitHubAppConfig();
  if (config === null) return runDiscovery(input);
  return runDiscovery(input, {
    privateAccess: { connection: openConnection(await requestCookieJar(), config), manageUrl: manageAccessUrl(config) },
  });
}

export async function disconnectGitHub(): Promise<void> {
  const config = readGitHubAppConfig();
  if (config === null) return;
  await openConnection(await requestCookieJar(), config).disconnect();
  revalidatePath("/");
}
