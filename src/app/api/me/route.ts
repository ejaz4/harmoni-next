import { readJson } from "@/server/library/http";
import { db } from "@/server/db";
import { backfillFromPlays } from "@/server/discovery/listens";
import { rebuildHome } from "@/server/discovery/home";
import { ownProfileBits } from "@/server/social/profile";
import { withUser, type CurrentUser } from "@/server/session";
import { getServerSettings } from "@/server/settings";
import type { Me } from "@/lib/me";

async function me({ app, ...user }: CurrentUser): Promise<Me> {
  const [settings, profile] = await Promise.all([getServerSettings(), ownProfileBits(user.id)]);
  return {
    ...user,
    ...profile,
    // An app calling: which one it is, as this server knows it.
    ...(app && { app: { id: app.id, name: app.name } }),
    server: {
      name: settings.name,
      features: settings.features,
      canInvite: settings.signups !== "closed" && (user.role === "admin" || settings.invitesBy === "everyone"),
      inviteDays: settings.inviteDays,
    },
  };
}

export const GET = withUser(async (_request, user) => Response.json(await me(user)));

// Their name, and account preferences: Super Processing and autoplay.
export const PATCH = withUser(async (request, user) => {
  const body = await readJson<{ superProcessing: boolean; autoplay: boolean; name: string }>(request);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : undefined;
  if (name === "") return Response.json({ error: "Your name can't be empty." }, { status: 400 });
  const data = {
    ...(typeof body.superProcessing === "boolean" && { superProcessing: body.superProcessing }),
    ...(typeof body.autoplay === "boolean" && { autoplay: body.autoplay }),
    ...(name && { name }),
  };
  if (!Object.keys(data).length) return Response.json({ error: "Nothing to change." }, { status: 400 });
  await db.user.update({ where: { id: user.id }, data });
  const { features } = await getServerSettings();
  if (data.superProcessing && !user.superProcessing && features.superProcessing) {
    // Start from their history so far, and have a home screen ready by the time they look.
    await backfillFromPlays(user.id);
    void rebuildHome(user.id).catch((err) => console.warn(`home: first build for ${user.id} failed`, err));
  }
  return Response.json(
    await me({
      ...user,
      ...(name && { name }),
      ...(data.superProcessing !== undefined && { superProcessing: data.superProcessing && features.superProcessing }),
      ...(data.autoplay !== undefined && { autoplay: data.autoplay && features.autoplay }),
    }),
  );
});
