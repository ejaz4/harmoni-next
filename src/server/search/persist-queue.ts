// Serial in-process queue for search writes, so results can be returned
// before they're saved. Serial on purpose: jobs find-or-create artists and
// albums, and running them in parallel would race to create duplicates.
//
// Two lanes: "now" for what someone is looking at (search results, pages),
// "later" for background work (recommendation radios), which only runs
// when nothing else is waiting. Asking to settle a background song moves
// its jobs to the front, so playing or liking one never waits behind a
// backlog.

type Job = () => Promise<unknown>;
export type Lane = "now" | "later";

interface Entry {
  songId: string;
  job: Job;
  lane: Lane;
  done: Promise<void>;
  finish: () => void;
}

class PersistQueue {
  private readonly lanes: Record<Lane, Entry[]> = { now: [], later: [] };
  private draining = false;
  // Every queued job per song, in order; settled() waits for the last.
  private readonly pending = new Map<string, Entry[]>();
  // A job can discover its song already exists under another id
  // (another search saved it first); later lookups follow the alias.
  private readonly aliases = new Map<string, string>();

  enqueue(songId: string, job: Job, lane: Lane = "now") {
    let finish!: () => void;
    const entry: Entry = { songId, job, lane, done: new Promise((r) => (finish = r)), finish };
    const forSong = this.pending.get(songId) ?? [];
    // A song's jobs run in order: a foreground job pulls its earlier background ones forward.
    if (lane === "now") this.promote(songId);
    else if (forSong.some((e) => e.lane === "now")) entry.lane = "now";
    forSong.push(entry);
    this.pending.set(songId, forSong);
    this.lanes[entry.lane].push(entry);
    void this.drain();
  }

  alias(from: string, to: string) {
    this.aliases.set(from, to);
  }

  resolve(songId: string): string {
    return this.aliases.get(songId) ?? songId;
  }

  // Waits for any queued writes for this song, then returns its real id.
  // `background` callers wait without jumping the queue.
  async settled(songId: string, { background = false } = {}): Promise<string> {
    const forSong = this.pending.get(songId);
    if (forSong?.length) {
      if (!background) this.promote(songId);
      await forSong[forSong.length - 1].done;
    }
    return this.resolve(songId);
  }

  // Moves a song's background jobs to the end of the foreground lane, in order.
  private promote(songId: string) {
    const moving = this.lanes.later.filter((e) => e.songId === songId);
    if (!moving.length) return;
    this.lanes.later = this.lanes.later.filter((e) => e.songId !== songId);
    for (const e of moving) e.lane = "now";
    this.lanes.now.push(...moving);
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let entry = this.next(); entry; entry = this.next()) {
        try {
          await entry.job();
        } catch (err) {
          console.error(`persist: job for song ${entry.songId} failed`, err);
        }
        entry.finish();
        const rest = this.pending.get(entry.songId)?.filter((e) => e !== entry);
        if (rest?.length) this.pending.set(entry.songId, rest);
        else this.pending.delete(entry.songId);
      }
    } finally {
      this.draining = false;
    }
  }

  private next(): Entry | undefined {
    return this.lanes.now.shift() ?? this.lanes.later.shift();
  }
}

const globalForQueue = globalThis as unknown as { persistQueue?: PersistQueue };
export const persistQueue = (globalForQueue.persistQueue ??= new PersistQueue());
