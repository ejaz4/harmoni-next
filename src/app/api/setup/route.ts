import { connection } from "next/server";
import { db } from "@/server/db";
import { getServerSettings } from "@/server/settings";

// Public on purpose: the sign-in and sign-up pages ask what this server is
// called, whether this is the first run (no accounts yet, so no invite
// needed and that person becomes admin), and who can join.
export async function GET() {
  await connection(); // per request, never prerendered at build time
  const [accounts, settings] = await Promise.all([db.user.count(), getServerSettings()]);
  const full = settings.maxAccounts > 0 && accounts >= settings.maxAccounts;
  return Response.json({
    needsAdmin: accounts === 0,
    name: settings.name,
    welcome: settings.welcome,
    signups: accounts === 0 ? "open" : full ? "closed" : settings.signups,
  });
}
