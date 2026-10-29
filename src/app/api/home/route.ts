import { personalHome } from "@/server/discovery/home";
import { handle } from "@/server/library/http";
import { home } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user) =>
  handle(async () => {
    const [base, shelves] = await Promise.all([home(user.id), user.superProcessing ? personalHome(user.id) : undefined]);
    return Response.json({ ...base, shelves });
  }),
);
