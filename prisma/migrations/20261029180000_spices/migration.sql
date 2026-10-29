-- CreateTable
CREATE TABLE "Spice" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "queryKey" TEXT,
    "sources" TEXT[],
    "poolIds" TEXT[],
    "poolRefreshAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Spice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpiceSeed" (
    "spiceId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpiceSeed_pkey" PRIMARY KEY ("spiceId","songId")
);

-- CreateTable
CREATE TABLE "SpiceMix" (
    "spiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "songIds" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpiceMix_pkey" PRIMARY KEY ("spiceId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Spice_queryKey_key" ON "Spice"("queryKey");

-- CreateIndex
CREATE INDEX "Spice_ownerId_idx" ON "Spice"("ownerId");

-- AddForeignKey
ALTER TABLE "Spice" ADD CONSTRAINT "Spice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiceSeed" ADD CONSTRAINT "SpiceSeed_spiceId_fkey" FOREIGN KEY ("spiceId") REFERENCES "Spice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiceSeed" ADD CONSTRAINT "SpiceSeed_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiceMix" ADD CONSTRAINT "SpiceMix_spiceId_fkey" FOREIGN KEY ("spiceId") REFERENCES "Spice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiceMix" ADD CONSTRAINT "SpiceMix_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
