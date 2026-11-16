import { randomInt } from "node:crypto";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { readJson } from "@/server/library/http";
import { revokeAllFor } from "@/server/oauth";
import { withAdmin } from "@/server/session";

// One person's account, for admins: their role, suspending them, a new
// password, signing them out, or removing them.

const NOT_FOUND = () => Response.json({ error: "No one here by that id." }, { status: 404 });

// There's always someone who can run the place.
async function lastAdmin(id: string) {
  const admins = await db.user.findMany({ where: { role: "admin", suspended: false }, select: { id: true } });
  return admins.length === 1 && admins[0].id === id;
}

export const PATCH = withAdmin(async (request, me, ctx: RouteContext<"/api/admin/users/[id]">) => {
  const { id } = await ctx.params;
  const target = await db.user.findUnique({ where: { id }, select: { role: true, suspended: true } });
  if (!target) return NOT_FOUND();
  const body = await readJson<{ role: string; suspended: boolean }>(request);
  const role = body.role === "admin" || body.role === "user" ? body.role : undefined;
  const suspended = typeof body.suspended === "boolean" ? body.suspended : undefined;
  if (role === undefined && suspended === undefined) return Response.json({ error: "Nothing to change." }, { status: 400 });

  if (suspended && id === me.id) return Response.json({ error: "You can't suspend yourself." }, { status: 400 });
  if ((role === "user" || suspended) && target.role === "admin" && (await lastAdmin(id))) {
    return Response.json({ error: "Make someone else an admin first: there has to be one." }, { status: 400 });
  }
  await db.user.update({ where: { id }, data: { ...(role && { role }), ...(suspended !== undefined && { suspended }) } });
  // Suspending signs them out everywhere, now.
  if (suspended) {
    await db.session.deleteMany({ where: { userId: id } });
    await revokeAllFor(id);
  }
  return Response.json({ ok: true });
});

// No 0/O or 1/I/L, so it can be read out or typed from a screenshot.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const temporaryPassword = () => Array.from({ length: 12 }, (_, i) => (i && i % 4 === 0 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("");

export const POST = withAdmin(async (request, me, ctx: RouteContext<"/api/admin/users/[id]">) => {
  const { id } = await ctx.params;
  if (!(await db.user.count({ where: { id } }))) return NOT_FOUND();
  const { action } = await readJson<{ action: string }>(request);

  if (action === "sign-out") {
    // Not this session, if it's their own: they asked to sign out their others.
    const keep = id === me.id ? (await auth.api.getSession({ headers: request.headers }))?.session.id : undefined;
    const { count } = await db.session.deleteMany({ where: { userId: id, ...(keep && { id: { not: keep } }) } });
    await revokeAllFor(id);
    return Response.json({ signedOut: count });
  }

  if (action === "reset-password") {
    if (id === me.id) return Response.json({ error: "Change your own password in your account settings." }, { status: 400 });
    const password = temporaryPassword();
    const hash = await (await auth.$context).password.hash(password);
    const { count } = await db.account.updateMany({ where: { userId: id, providerId: "credential" }, data: { password: hash } });
    if (!count) return Response.json({ error: "They don't sign in with a password." }, { status: 400 });
    await db.session.deleteMany({ where: { userId: id } });
    await revokeAllFor(id);
    return Response.json({ password });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
});

export const DELETE = withAdmin(async (_request, me, ctx: RouteContext<"/api/admin/users/[id]">) => {
  const { id } = await ctx.params;
  if (id === me.id) return Response.json({ error: "You can't remove your own account from here." }, { status: 400 });
  const target = await db.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return NOT_FOUND();
  if (target.role === "admin" && (await lastAdmin(id))) return Response.json({ error: "There has to be an admin." }, { status: 400 });
  // Their library, plays and sessions go with them (cascades).
  await db.user.delete({ where: { id } });
  return Response.json({ ok: true });
});
