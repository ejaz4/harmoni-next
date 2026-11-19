import { searchUsers } from "@/server/social/profile";
import { withUser } from "@/server/session";

// People on this server, by name or username.
export const GET = withUser(async (request, user) => {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json(await searchUsers(q.slice(0, 100), user.id));
});
