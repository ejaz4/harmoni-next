import { forgetListening } from "@/server/discovery/listens";
import { forgetTaste } from "@/server/discovery/taste";
import { withUser } from "@/server/session";

// Forgets everything Super Processing has learned (likes, playlists and
// play history stay).
export const DELETE = withUser(async (_request, user) => {
  await forgetListening(user.id);
  forgetTaste(user.id);
  return new Response(null, { status: 204 });
});
