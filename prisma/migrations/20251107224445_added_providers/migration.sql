-- CreateEnum
CREATE TYPE "QualityLabel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'LOSSLESS');

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongProvider" (
    "songId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "quality" "QualityLabel" NOT NULL,
    "locator" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SongProvider_songId_providerId_quality_key" ON "SongProvider"("songId", "providerId", "quality");

-- AddForeignKey
ALTER TABLE "SongProvider" ADD CONSTRAINT "SongProvider_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongProvider" ADD CONSTRAINT "SongProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
