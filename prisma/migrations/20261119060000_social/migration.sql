-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "shareKey" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'private';

-- CreateTable
CREATE TABLE "PlaylistShare" (
    "playlistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistShare_pkey" PRIMARY KEY ("playlistId","userId")
);

-- CreateTable
CREATE TABLE "Profile" (
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "accent" TEXT,
    "font" TEXT,
    "banner" TEXT,
    "bannerImage" TEXT,
    "avatarImage" TEXT,
    "pinnedSongs" TEXT[],
    "showLikes" BOOLEAN NOT NULL DEFAULT true,
    "showPlaylists" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Follow" (
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followeeId")
);

-- CreateIndex
CREATE INDEX "PlaylistShare_userId_idx" ON "PlaylistShare"("userId");

-- CreateIndex
CREATE INDEX "Follow_followeeId_createdAt_idx" ON "Follow"("followeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_shareKey_key" ON "Playlist"("shareKey");

-- CreateIndex
CREATE INDEX "Playlist_visibility_idx" ON "Playlist"("visibility");

-- AddForeignKey
ALTER TABLE "PlaylistShare" ADD CONSTRAINT "PlaylistShare_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistShare" ADD CONSTRAINT "PlaylistShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followeeId_fkey" FOREIGN KEY ("followeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

