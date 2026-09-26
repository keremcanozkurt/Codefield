import { NextResponse, type NextRequest } from "next/server";

import { isLoopbackHost, readLocalSession, sessionCookieName, tokenMatches } from "@/lib/local/session";

// The launcher opens /open?token=… in the browser. A matching token is
// exchanged for an HttpOnly session cookie and the browser is sent on to /,
// which removes the token from the address bar. Nothing else sets the cookie.
export function GET(request: NextRequest) {
  const session = readLocalSession();
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  if (session === null || !isLoopbackHost(session, request.headers.get("host"))) return response;
  if (!tokenMatches(session, request.nextUrl.searchParams.get("token"))) return response;

  response.cookies.set(sessionCookieName(session), session.token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    // Plain HTTP on the loopback address; a Secure cookie would not be sent.
    secure: false,
  });
  return response;
}
