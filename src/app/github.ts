import "server-only";

import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import type { CookieJar, CookieOptions } from "@/lib/github/connection";

// Cookie access through next/headers. Writes only work in server actions;
// server components only read.
export async function requestCookieJar(): Promise<CookieJar> {
  const store = await cookies();
  return {
    get: (name) => store.get(name)?.value,
    set: (name, value, options) => store.set(name, value, options),
  };
}

// Cookie access for route handlers: reads the request, and records writes to
// apply to the response once it exists.
export function routeCookieJar(request: NextRequest) {
  const writes: { name: string; value: string; options: CookieOptions }[] = [];
  const jar: CookieJar = {
    get: (name) => request.cookies.get(name)?.value,
    set: (name, value, options) => {
      writes.push({ name, value, options });
    },
  };
  function apply(response: NextResponse) {
    for (const { name, value, options } of writes) response.cookies.set(name, value, options);
    return response;
  }
  return { jar, apply };
}

// Every response in the flow is a redirect that must not be cached or pass
// the callback URL, which carries the one-time code, on as a Referer.
export function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
