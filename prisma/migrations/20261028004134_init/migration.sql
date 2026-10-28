-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "durationMs" INTEGER,
    "isrc" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "artworkUrl" TEXT,
    "albumId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongSource" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchedBy" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "rawArtists" TEXT[],
    "rawAlbum" TEXT,
    "durationMs" INTEGER,
    "isrc" TEXT,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastOkAt" TIMESTAMP(3),
    "lastFailAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SongSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistSource" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "artworkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumSource" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongArtist" (
    "songId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "SongArtist_pkey" PRIMARY KEY ("songId","artistId")
);

-- CreateTable
CREATE TABLE "_AlbumToArtist" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AlbumToArtist_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Song_isrc_idx" ON "Song"("isrc");

-- CreateIndex
CREATE INDEX "Song_titleKey_idx" ON "Song"("titleKey");

-- CreateIndex
CREATE INDEX "SongSource_songId_idx" ON "SongSource"("songId");

-- CreateIndex
CREATE UNIQUE INDEX "SongSource_provider_externalId_key" ON "SongSource"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Artist_nameKey_idx" ON "Artist"("nameKey");

-- CreateIndex
CREATE INDEX "ArtistSource_artistId_idx" ON "ArtistSource"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistSource_provider_externalId_key" ON "ArtistSource"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Album_titleKey_idx" ON "Album"("titleKey");

-- CreateIndex
CREATE INDEX "AlbumSource_albumId_idx" ON "AlbumSource"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumSource_provider_externalId_key" ON "AlbumSource"("provider", "externalId");

-- CreateIndex
CREATE INDEX "SongArtist_artistId_idx" ON "SongArtist"("artistId");

-- CreateIndex
CREATE INDEX "_AlbumToArtist_B_index" ON "_AlbumToArtist"("B");

-- AddForeignKey
ALTER TABLE "Song" ADD CONSTRAINT "Song_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongSource" ADD CONSTRAINT "SongSource_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistSource" ADD CONSTRAINT "ArtistSource_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumSource" ADD CONSTRAINT "AlbumSource_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongArtist" ADD CONSTRAINT "SongArtist_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongArtist" ADD CONSTRAINT "SongArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AlbumToArtist" ADD CONSTRAINT "_AlbumToArtist_A_fkey" FOREIGN KEY ("A") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AlbumToArtist" ADD CONSTRAINT "_AlbumToArtist_B_fkey" FOREIGN KEY ("B") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
