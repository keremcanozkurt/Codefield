import { NextResponse, type NextRequest } from "next/server";

import { noStore } from "@/app/github";

// GitHub's Setup URL, visited after the app is installed or its repository
// access changes. The installation_id GitHub appends is deliberately not
// read: it comes through the browser and proves nothing, and access is always
// checked with the user's own token instead.
export function GET(request: NextRequest) {
  return noStore(NextResponse.redirect(new URL("/?github=installed", request.url), 303));
}
