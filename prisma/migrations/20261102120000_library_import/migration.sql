-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "importKey" TEXT;

-- CreateTable
CREATE TABLE "LibraryImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'apple',
    "status" TEXT NOT NULL,
    "library" JSONB NOT NULL,
    "matches" JSONB NOT NULL DEFAULT '{}',
    "total" INTEGER NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "known" INTEGER NOT NULL DEFAULT 0,
    "bare" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "improved" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "applied" JSONB,
    "error" TEXT,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryImport_userId_createdAt_idx" ON "LibraryImport"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_ownerId_importKey_key" ON "Playlist"("ownerId", "importKey");

-- AddForeignKey
ALTER TABLE "LibraryImport" ADD CONSTRAINT "LibraryImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
