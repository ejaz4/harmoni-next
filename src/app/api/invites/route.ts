import { randomInt } from "node:crypto";
import { db } from "@/server/db";
import { withUser, type CurrentUser } from "@/server/session";
import { getServerSettings } from "@/server/settings";

const DAY_MS = 24 * 60 * 60_000;
// No 0/O or 1/I/L, so codes survive being read out loud or typed from a screenshot.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function newCode(): string {
  const chunk = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chunk()}-${chunk()}`;
}

// Admins invite; everyone else too if Server settings say so.
async function mayInvite(user: CurrentUser) {
  const settings = await getServerSettings();
  return settings.signups !== "closed" && (user.role === "admin" || settings.invitesBy === "everyone");
}

const NOT_ALLOWED = () => Response.json({ error: "Inviting people is up to the admins here." }, { status: 403 });

// Invites, newest first: admins see everyone's, everyone else their own.
export const GET = withUser(async (_request, user) => {
  const admin = user.role === "admin";
  if (!admin && !(await mayInvite(user))) return NOT_ALLOWED();
  const invites = await db.invite.findMany({
    where: admin ? {} : { createdById: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { usedBy: { select: { username: true, displayUsername: true } }, createdBy: { select: { id: true, name: true } } },
  });
  return Response.json(
    invites.map((i) => ({
      code: i.code,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      usedBy: i.usedBy ? (i.usedBy.displayUsername ?? i.usedBy.username) : null,
      createdBy: i.createdBy.id === user.id ? null : i.createdBy.name,
    })),
  );
});

// A one-time invite, lasting as long as Server settings say.
export const POST = withUser(async (_request, user) => {
  if (!(await mayInvite(user))) return NOT_ALLOWED();
  const { inviteDays } = await getServerSettings();
  const invite = await db.invite.create({
    data: { code: newCode(), createdById: user.id, expiresAt: inviteDays ? new Date(Date.now() + inviteDays * DAY_MS) : null },
  });
  return Response.json({ code: invite.code, expiresAt: invite.expiresAt }, { status: 201 });
});

// Takes back an unused invite: your own, or anyone's for admins.
export const DELETE = withUser(async (request, user) => {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const { count } = await db.invite.deleteMany({
    where: { code, usedAt: null, ...(user.role !== "admin" && { createdById: user.id }) },
  });
  return Response.json({ deleted: count > 0 }, { status: count ? 200 : 404 });
});
