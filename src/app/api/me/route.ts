import { readJson } from "@/server/library/http";
import { db } from "@/server/db";
import { backfillFromPlays } from "@/server/discovery/listens";
import { rebuildHome } from "@/server/discovery/home";
import { withUser } from "@/server/session";

export const GET = withUser(async (_request, user) => Response.json(user));

// Account preferences: Super Processing and autoplay.
export const PATCH = withUser(async (request, user) => {
  const body = await readJson<{ superProcessing: boolean; autoplay: boolean }>(request);
  const data = {
    ...(typeof body.superProcessing === "boolean" && { superProcessing: body.superProcessing }),
    ...(typeof body.autoplay === "boolean" && { autoplay: body.autoplay }),
  };
  if (!Object.keys(data).length) return Response.json({ error: "Nothing to change." }, { status: 400 });
  await db.user.update({ where: { id: user.id }, data });
  if (data.superProcessing && !user.superProcessing) {
    // Start from their history so far, and have a home screen ready by the time they look.
    await backfillFromPlays(user.id);
    void rebuildHome(user.id).catch((err) => console.warn(`home: first build for ${user.id} failed`, err));
  }
  return Response.json({ ...user, ...data });
});
