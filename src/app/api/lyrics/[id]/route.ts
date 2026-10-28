import type { NextRequest } from "next/server";
import { getSongLyrics } from "@/server/lyrics/service";

const SONG_ID = /^[0-9a-f-]{36}$/;

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/lyrics/[id]">) {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  const lyrics = await getSongLyrics(id);
  if (!lyrics) return Response.json({ error: `No song ${id}` }, { status: 404 });
  return Response.json(lyrics);
}
