import { seedSuggestions } from "@/server/discovery/spice";
import { handle } from "@/server/library/http";
import { withUser } from "@/server/session";

// Songs to start a Spice from, before searching for any.
export const GET = withUser((_request, user) => handle(async () => Response.json(await seedSuggestions(user))));
