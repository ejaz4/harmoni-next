import { connection } from "next/server";
import { db } from "@/server/db";

// Public on purpose: the sign-up page asks whether this is the first run
// (no accounts yet, so no invite needed and that person becomes admin).
export async function GET() {
  await connection(); // per request, never prerendered at build time
  return Response.json({ needsAdmin: (await db.user.count()) === 0 });
}
