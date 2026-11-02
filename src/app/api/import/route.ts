import { cancelImport, checkLibrary, ImportError, latestImport, startImport } from "@/server/import/apple";
import { withUser } from "@/server/session";

// Bringing in a library from elsewhere. GET: how the latest one is going.
export const GET = withUser(async (_request, user) => Response.json(await latestImport(user.id)));

// POST: a library, as read in the browser (see src/lib/apple-library.ts).
export const POST = withUser(async (request, user) => {
  try {
    const library = checkLibrary(await request.json().catch(() => undefined));
    return Response.json(await startImport(user.id, library), { status: 202 });
  } catch (err) {
    if (err instanceof ImportError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
});

// DELETE: stop looking. Nothing is added to their library.
export const DELETE = withUser(async (_request, user) => {
  await cancelImport(user.id);
  return Response.json(await latestImport(user.id));
});
