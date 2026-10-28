import { withUser } from "@/server/session";

export const GET = withUser(async (_request, user) => Response.json(user));
