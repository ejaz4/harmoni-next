import { db } from "@/server/db";

// Public on purpose: the sign-up page asks whether this is the first run
// (no accounts yet, so no invite needed and that person becomes admin).
export async function GET() {
  return Response.json({ needsAdmin: (await db.user.count()) === 0 });
}
