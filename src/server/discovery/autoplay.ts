import { db } from "../db";
import type { StoredProfile } from "../library/catalogue";
import { songViews, type SongResult } from "../library/song-view";
import { cachedRadios, getRadio } from "./radio";
import { diversify } from "./score";
import { loadTaste } from "./taste";

// What to play when the queue runs out: the current song's radio, nudged
// by the last couple of songs so it follows where the listening is going.
// With Super Processing on it's also personal: songs they skip are left
// out, artists and songs they love (heard or not) are brought forward.

const RADIO_WAIT_MS = 12_000;
const RECENTLY_HEARD_MS = 6 * 60 * 60_000;

export async function autoplaySongs(
  user: { id: string; superProcessing: boolean },
  seedIds: string[],
  exclude: Set<string>,
  limit = 10,
): Promise<SongResult[]> {
  const [first, ...rest] = seedIds;
  const [primary, others, taste] = await Promise.all([
    getRadio(first, { waitMs: RADIO_WAIT_MS }),
    cachedRadios(rest),
    user.superProcessing ? loadTaste(user.id) : undefined,
  ]);
  // Not built yet: start them now so the next batch can use them.
  rest.filter((id) => !others.has(id)).forEach((id) => void getRadio(id));

  const votes = new Map<string, number>();
  const vote = (ids: string[], weight: number) => ids.forEach((id, rank) => votes.set(id, (votes.get(id) ?? 0) + weight / (1 + rank / 6)));
  vote(primary.ids, 1);
  rest.forEach((id, i) => vote(others.get(id) ?? [], 0.5 / (i + 1)));

  // A radio nobody could build: their popular songs, so the music doesn't stop.
  if (votes.size < limit) vote(await artistPopular(first), 0.3);

  const now = Date.now();
  let ids = [...votes.keys()].filter((id) => !exclude.has(id) && !seedIds.includes(id));
  if (taste) {
    ids = ids.filter((id) => !taste.disliked.has(id) && now - (taste.lastHeard.get(id) ?? 0) > RECENTLY_HEARD_MS);
  }
  const score = (id: string) => {
    let s = votes.get(id)!;
    if (!taste) return s;
    const song = taste.songs.get(id) ?? 0;
    s *= 1 + 0.12 * Math.max(-3, Math.min(song, 8));
    const artist = taste.artists.get(taste.songArtists.get(id)?.[0] ?? "") ?? 0;
    return s * (artist < -1 ? 0.5 : 1 + 0.15 * Math.tanh(artist / 6));
  };
  const ranked = ids.sort((a, b) => score(b) - score(a)).slice(0, limit * 6);
  // Songs from a radio built just now may not be saved yet; use them as matched.
  const fresh = primary.fresh;
  // By name: songs not saved yet have no artist ids.
  const credits = await db.songArtist.findMany({ where: { songId: { in: ranked } }, orderBy: { position: "asc" }, select: { songId: true, artist: { select: { name: true } } } });
  const leads = new Map<string, string>();
  for (const c of credits) if (!leads.has(c.songId)) leads.set(c.songId, c.artist.name);
  const leadOf = (id: string) => (leads.get(id) ?? fresh?.get(id)?.artists[0]?.name)?.toLowerCase();
  const picked = diversify(ranked, leadOf, limit);
  const saved = new Map((await songViews(picked)).map((s) => [s.id, s]));
  return picked.flatMap((id) => saved.get(id) ?? fresh?.get(id) ?? []);
}

async function artistPopular(songId: string): Promise<string[]> {
  const credit = await db.songArtist.findFirst({ where: { songId }, orderBy: { position: "asc" }, select: { artist: { select: { profile: true } } } });
  return (credit?.artist.profile as unknown as StoredProfile | null)?.popular ?? [];
}
