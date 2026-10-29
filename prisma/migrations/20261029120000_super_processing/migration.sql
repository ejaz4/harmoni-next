-- AlterTable
ALTER TABLE "user" ADD COLUMN     "autoplay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "superProcessing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Listen" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedMs" INTEGER NOT NULL,
    "positionMs" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "heard" INTEGER NOT NULL,
    "replays" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "context" TEXT,

    CONSTRAINT "Listen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongStat" (
    "userId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "listens" INTEGER NOT NULL DEFAULT 0,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "skips" INTEGER NOT NULL DEFAULT 0,
    "earlySkips" INTEGER NOT NULL DEFAULT 0,
    "replays" INTEGER NOT NULL DEFAULT 0,
    "playedMs" BIGINT NOT NULL DEFAULT 0,
    "heard" INTEGER[],
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SongStat_pkey" PRIMARY KEY ("userId","songId")
);

-- CreateTable
CREATE TABLE "SongRadio" (
    "songId" TEXT NOT NULL,
    "songIds" TEXT[],
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SongRadio_pkey" PRIMARY KEY ("songId")
);

-- CreateTable
CREATE TABLE "HomeMix" (
    "userId" TEXT NOT NULL,
    "shelves" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeMix_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "Listen_userId_at_idx" ON "Listen"("userId", "at");

-- CreateIndex
CREATE INDEX "SongStat_userId_lastAt_idx" ON "SongStat"("userId", "lastAt");

-- AddForeignKey
ALTER TABLE "Listen" ADD CONSTRAINT "Listen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listen" ADD CONSTRAINT "Listen_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongStat" ADD CONSTRAINT "SongStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongStat" ADD CONSTRAINT "SongStat_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongRadio" ADD CONSTRAINT "SongRadio_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeMix" ADD CONSTRAINT "HomeMix_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
