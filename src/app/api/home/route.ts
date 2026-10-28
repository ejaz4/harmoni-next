import { handle } from "@/server/library/http";
import { home } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user) => handle(async () => Response.json(await home(user.id))));
