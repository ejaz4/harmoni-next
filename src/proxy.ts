import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: sends signed-out visitors to /login. API routes
// verify the session themselves, so a forged cookie gets nothing.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the API, Next's assets, static files and the auth pages.
  matcher: ["/((?!api|_next|login|signup|favicon\\.ico|.*\\.[a-z0-9]+$).*)"],
};
