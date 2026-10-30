-- CreateTable
CREATE TABLE "PlaybackState" (
    "userId" TEXT NOT NULL,
    "queue" JSONB NOT NULL,
    "unshuffled" JSONB,
    "index" INTEGER NOT NULL,
    "positionMs" INTEGER NOT NULL DEFAULT 0,
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "repeat" TEXT NOT NULL DEFAULT 'off',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackState_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "PlaybackState" ADD CONSTRAINT "PlaybackState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
