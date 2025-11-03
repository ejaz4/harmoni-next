/*
  Warnings:

  - Added the required column `password` to the `UserSecurity` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserSecurity" ADD COLUMN     "password" TEXT NOT NULL;
