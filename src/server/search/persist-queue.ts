// Serial in-process queue for search writes, so results can be returned
// before they're saved. Serial on purpose: jobs find-or-create artists and
// albums, and running them in parallel would race to create duplicates.

type Job = () => Promise<unknown>;

class PersistQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<void>>();
  // A job can discover its song already exists under another id
  // (another search saved it first); later lookups follow the alias.
  private readonly aliases = new Map<string, string>();

  enqueue(songId: string, job: Job) {
    const run = this.tail.then(job).then(
      () => undefined,
      (err) => console.error(`persist: job for song ${songId} failed`, err),
    );
    this.tail = run;
    this.pending.set(songId, run);
    void run.finally(() => {
      if (this.pending.get(songId) === run) this.pending.delete(songId);
    });
  }

  alias(from: string, to: string) {
    this.aliases.set(from, to);
  }

  resolve(songId: string): string {
    return this.aliases.get(songId) ?? songId;
  }

  // Waits for any queued writes for this song, then returns its real id.
  async settled(songId: string): Promise<string> {
    await this.pending.get(songId);
    return this.resolve(songId);
  }
}

const globalForQueue = globalThis as unknown as { persistQueue?: PersistQueue };
export const persistQueue = (globalForQueue.persistQueue ??= new PersistQueue());
