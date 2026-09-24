"use server";

import { discoverRepository as runDiscovery } from "@/lib/discovery";
import type { DiscoveryResult } from "@/lib/discovery";

export type { DiscoveryResult, RepositoryIdentity, SuccessResult } from "@/lib/discovery";

// A thin "use server" boundary: the actual orchestration lives in
// lib/discovery.ts, which uses relative imports so it can run under the
// plain test runner instead of Next.js's module resolution.
export async function discoverRepository(input: unknown): Promise<DiscoveryResult> {
  return runDiscovery(input);
}
