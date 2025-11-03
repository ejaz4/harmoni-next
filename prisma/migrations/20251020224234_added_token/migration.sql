-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "securityId" TEXT;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "UserSecurity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
