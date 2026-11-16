import { listGrants } from "@/server/oauth";
import { withWebSession } from "@/server/session";

// Apps signed in as you, for Settings. Only on the web: an app can't see
// or disconnect the others.
export const GET = withWebSession(async (_request, user) => Response.json(await listGrants(user.id)));
