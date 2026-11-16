// Where to go after signing in or up (?next=, carried between the two
// pages): only same-site paths, so it can't bounce people to another site.
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

// A link to the other page that keeps ?next=.
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(safeNext(next))}` : path;
}
