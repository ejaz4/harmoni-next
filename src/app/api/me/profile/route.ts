import { handle, readJson } from "@/server/library/http";
import { getProfile, updateProfile, type ProfileChanges } from "@/server/social/profile";
import { withUser } from "@/server/session";

// Their own profile, as others see it (plus what's hidden from them).
export const GET = withUser((_request, user) => handle(async () => Response.json(await getProfile(user.username, user.id))));

export const PATCH = withUser((request, user) =>
  handle(async () => {
    await updateProfile(user.id, await readJson<ProfileChanges>(request));
    return Response.json(await getProfile(user.username, user.id));
  }),
);
