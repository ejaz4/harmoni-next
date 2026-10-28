-- CreateTable
CREATE TABLE "Lyrics" (
    "songId" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "provider" TEXT,
    "sync" TEXT,
    "lines" JSONB,
    "language" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryAfter" TIMESTAMP(3),

    CONSTRAINT "Lyrics_pkey" PRIMARY KEY ("songId")
);

-- AddForeignKey
ALTER TABLE "Lyrics" ADD CONSTRAINT "Lyrics_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
