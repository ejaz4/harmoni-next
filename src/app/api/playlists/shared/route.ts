import { sharedWithMe } from "@/server/social/sharing";
import { withUser } from "@/server/session";

// Other people's playlists shared with you.
export const GET = withUser(async (_request, user) => Response.json(await sharedWithMe(user.id)));
