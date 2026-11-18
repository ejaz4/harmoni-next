-- AlterTable
ALTER TABLE "user" ADD COLUMN     "timeZone" TEXT;

-- AlterTable
ALTER TABLE "Spice" ADD COLUMN     "kind" TEXT;

-- AlterTable
ALTER TABLE "SpiceMix" ADD COLUMN     "slot" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Spice_ownerId_kind_key" ON "Spice"("ownerId", "kind");

