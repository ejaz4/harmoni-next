import { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { persistQueue } from "../search/persist-queue";
import { classifyListen, heardSlices, SLICES, type ListenReport } from "./score";

// Super Processing's raw material. Each listen is one insert plus one
// upsert of the song's running totals, so reads never scan history.

export interface ListenInput extends ListenReport {
  songId: string;
  heard: number;
  replays: number;
  context?: "autoplay";
}

// Below this they never really heard it (tapping through the queue).
const MIN_PLAYED_MS = 2000;

// Adds the incoming row's totals to an existing one. "heard" adds slice by slice.
export const ADD_ON_CONFLICT = Prisma.sql`
  ON CONFLICT ("userId", "songId") DO UPDATE SET
    "listens" = "SongStat"."listens" + EXCLUDED."listens",
    "completes" = "SongStat"."completes" + EXCLUDED."completes",
    "skips" = "SongStat"."skips" + EXCLUDED."skips",
    "earlySkips" = "SongStat"."earlySkips" + EXCLUDED."earlySkips",
    "replays" = "SongStat"."replays" + EXCLUDED."replays",
    "playedMs" = "SongStat"."playedMs" + EXCLUDED."playedMs",
    "heard" = ARRAY(
      SELECT COALESCE(a, 0) + COALESCE(b, 0)
      FROM unnest("SongStat"."heard", EXCLUDED."heard") WITH ORDINALITY AS t(a, b, i)
      ORDER BY i
    ),
    "firstAt" = LEAST("SongStat"."firstAt", EXCLUDED."firstAt"),
    "lastAt" = GREATEST("SongStat"."lastAt", EXCLUDED."lastAt")`;

export async function recordListen(userId: string, input: ListenInput): Promise<void> {
  if (input.playedMs < MIN_PLAYED_MS) return;
  const songId = await persistQueue.settled(input.songId);
  if (!(await db.song.findUnique({ where: { id: songId }, select: { id: true } }))) return;
  const { complete, skip, earlySkip } = classifyListen(input);
  const heard = heardSlices(input.heard);
  await db.$transaction([
    db.listen.create({
      data: {
        userId,
        songId,
        playedMs: input.playedMs,
        positionMs: input.positionMs,
        durationMs: input.durationMs,
        heard: input.heard,
        replays: input.replays,
        reason: input.reason,
        context: input.context,
      },
    }),
    db.$executeRaw`
      INSERT INTO "SongStat" ("userId", "songId", "listens", "completes", "skips", "earlySkips", "replays", "playedMs", "heard", "firstAt", "lastAt")
      VALUES (${userId}, ${songId}, 1, ${+complete}, ${+skip}, ${+earlySkip}, ${input.replays}, ${input.playedMs}, ${heard}::int[], now(), now())
      ${ADD_ON_CONFLICT}`,
  ]);
}

// When Super Processing is turned on, history from before counts too: each
// recorded play becomes a listen of unknown outcome.
export async function backfillFromPlays(userId: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "SongStat" ("userId", "songId", "listens", "heard", "firstAt", "lastAt")
    SELECT "userId", "songId", count(*)::int, array_fill(0, ARRAY[${SLICES}::int]), min("playedAt"), max("playedAt")
    FROM "Play" WHERE "userId" = ${userId}
    GROUP BY "userId", "songId"
    ON CONFLICT ("userId", "songId") DO NOTHING`;
}

export async function forgetListening(userId: string): Promise<void> {
  await db.$transaction([
    db.listen.deleteMany({ where: { userId } }),
    db.songStat.deleteMany({ where: { userId } }),
    db.homeMix.deleteMany({ where: { userId } }),
  ]);
}

// For mergeSongs: carry everyone's listening across to the song being kept.
export async function mergeListening(tx: Prisma.TransactionClient, keepId: string, dropId: string): Promise<void> {
  await tx.listen.updateMany({ where: { songId: dropId }, data: { songId: keepId } });
  await tx.$executeRaw`
    INSERT INTO "SongStat" ("userId", "songId", "listens", "completes", "skips", "earlySkips", "replays", "playedMs", "heard", "firstAt", "lastAt")
    SELECT "userId", ${keepId}, "listens", "completes", "skips", "earlySkips", "replays", "playedMs", "heard", "firstAt", "lastAt"
    FROM "SongStat" WHERE "songId" = ${dropId}
    ${ADD_ON_CONFLICT}`;
}
