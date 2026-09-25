import { NextResponse, type NextRequest } from "next/server";

import { noStore, routeCookieJar } from "@/app/github";
import { readGitHubAppConfig } from "@/lib/github/app";
import { startAuthorization } from "@/lib/github/connection";

export async function GET(request: NextRequest) {
  const config = readGitHubAppConfig();
  if (config === null) return noStore(NextResponse.redirect(new URL("/", request.url), 303));

  const { jar, apply } = routeCookieJar(request);
  const location = startAuthorization(jar, config, request.nextUrl.searchParams.get("repository"));
  return noStore(apply(NextResponse.redirect(location, 303)));
}
