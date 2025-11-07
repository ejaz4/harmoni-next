/*
  Warnings:

  - You are about to drop the `Token` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserSecurity` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Token" DROP CONSTRAINT "Token_securityId_fkey";

-- DropForeignKey
ALTER TABLE "public"."UserSecurity" DROP CONSTRAINT "UserSecurity_userId_fkey";

-- DropTable
DROP TABLE "public"."Token";

-- DropTable
DROP TABLE "public"."User";

-- DropTable
DROP TABLE "public"."UserSecurity";
