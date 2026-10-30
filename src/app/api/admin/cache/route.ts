import { clearCache } from "@/server/playback/cache";
import { withAdmin } from "@/server/session";

// Empties the audio cache: songs stream from their source again next time.
export const DELETE = withAdmin(async () => Response.json({ removed: await clearCache() }));
