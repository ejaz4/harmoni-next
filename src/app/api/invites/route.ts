import { randomInt } from "node:crypto";
import { db } from "@/server/db";
import { withUser } from "@/server/session";

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
// No 0/O or 1/I/L, so codes survive being read out loud or typed from a screenshot.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function newCode(): string {
  const chunk = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chunk()}-${chunk()}`;
}

// Admin only: list invites, newest first.
export const GET = withUser(async (_request, user) => {
  if (user.role !== "admin") return Response.json({ error: "Only the admin can manage invites." }, { status: 403 });
  const invites = await db.invite.findMany({
    where: { createdById: user.id },
    orderBy: { createdAt: "desc" },
    include: { usedBy: { select: { username: true, displayUsername: true } } },
  });
  return Response.json(
    invites.map((i) => ({
      code: i.code,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      usedBy: i.usedBy ? (i.usedBy.displayUsername ?? i.usedBy.username) : null,
    })),
  );
});

// Admin only: create a one-time invite valid for a week.
export const POST = withUser(async (_request, user) => {
  if (user.role !== "admin") return Response.json({ error: "Only the admin can create invites." }, { status: 403 });
  const invite = await db.invite.create({
    data: { code: newCode(), createdById: user.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  return Response.json({ code: invite.code, expiresAt: invite.expiresAt }, { status: 201 });
});
