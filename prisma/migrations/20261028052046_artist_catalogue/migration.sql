-- AlterTable
ALTER TABLE "Album" ADD COLUMN     "genres" TEXT[],
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "releaseDate" TIMESTAMP(3),
ADD COLUMN     "trackCount" INTEGER,
ADD COLUMN     "trackIds" JSONB,
ADD COLUMN     "tracksRefreshAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "bannerUrl" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "fans" INTEGER,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "profile" JSONB,
ADD COLUMN     "profileRefreshAfter" TIMESTAMP(3);
