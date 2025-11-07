import type { PrismaClient, Song, SongProvider } from "@prisma/client";

export abstract class SearchProvider {
  db: PrismaClient;

  constructor(db: PrismaClient) {
    // Re-use the same connection to Prisma
    this.db = db;
  }

  abstract findSong(name: string): Song & { providers: SongProvider[] };
}
