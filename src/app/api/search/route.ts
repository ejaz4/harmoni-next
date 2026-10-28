import type { NextRequest } from "next/server";
import { searchSongs } from "@/server/search/service";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ error: "Missing ?q= parameter" }, { status: 400 });
  }
  return Response.json(await searchSongs(query));
}
