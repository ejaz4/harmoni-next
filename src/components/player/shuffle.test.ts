import { describe, expect, test } from "bun:test";
import { limitQueue, shuffleQueue, unshuffleQueue, type Shuffleable } from "./shuffle";

const list = (n: number): Shuffleable[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
const ids = (songs: Shuffleable[]) => songs.map((s) => s.id);

describe("shuffle and unshuffle", () => {
  test("shuffling keeps what's played and playing, and every song", () => {
    const { queue } = shuffleQueue(list(10), 3);
    expect(ids(queue.slice(0, 4))).toEqual(["s0", "s1", "s2", "s3"]);
    expect(ids(queue).sort()).toEqual(ids(list(10)).sort());
  });

  test("playing a list shuffled starts with the song picked", () => {
    const { queue } = shuffleQueue(list(10), 0, 6);
    expect(queue[0].id).toBe("s6");
    expect(queue).toHaveLength(10);
  });

  test("turning shuffle off carries on in the list's order from the current song", () => {
    const { queue, unshuffled } = shuffleQueue(list(10), 0, 0);
    const index = queue.findIndex((s) => s.id === "s4");
    const back = unshuffleQueue(queue, index, unshuffled);
    expect(back[index].id).toBe("s4");
    expect(ids(back.slice(index + 1))).toEqual(["s5", "s6", "s7", "s8", "s9"]);
    expect(back.every((s) => s.pos === undefined)).toBe(true);
  });

  test("songs queued while shuffled stay next, autoplay stays last, removed songs stay gone", () => {
    const { queue, unshuffled } = shuffleQueue(list(6), 0, 0);
    const playing = queue.findIndex((s) => s.id === "s2");
    const withExtras = [...queue.slice(0, playing + 1), { id: "mine" }, ...queue.slice(playing + 1), { id: "auto", autoplay: true as const }].filter((s) => s.id !== "s4");
    const at = withExtras.findIndex((s) => s.id === "s2");
    expect(ids(unshuffleQueue(withExtras, at, unshuffled).slice(at + 1))).toEqual(["mine", "s3", "s5", "auto"]);
  });

  test("autoplay's songs aren't shuffled in: they stay last, in their order, and come back the same", () => {
    const queue: Shuffleable[] = [...list(6), ...["a1", "a2", "a3"].map((id) => ({ id, autoplay: true as const }))];
    const { queue: mixed, unshuffled } = shuffleQueue(queue, 1);
    expect(ids(mixed.slice(-3))).toEqual(["a1", "a2", "a3"]);
    expect(mixed.slice(-3).every((s) => s.pos === undefined)).toBe(true);
    expect(ids(unshuffleQueue(mixed, 1, unshuffled))).toEqual(ids(queue));
  });

  test("a queue that was never shuffled is left as it is", () => {
    expect(ids(unshuffleQueue(list(4), 1, undefined))).toEqual(["s0", "s1", "s2", "s3"]);
  });

  test("a song queued by hand playing now: the list carries on from the last of its songs", () => {
    const { queue, unshuffled } = shuffleQueue(list(4), 0);
    const now = [...queue.slice(0, 1), { id: "mine" }, ...queue.slice(1)];
    expect(ids(unshuffleQueue(now, 1, unshuffled))).toEqual(["s0", "mine", "s1", "s2", "s3"]);
  });
});

describe("limitQueue", () => {
  const list = Array.from({ length: 2000 }, (_, i) => i);

  test("a short list is left alone", () => {
    expect(limitQueue([1, 2, 3], 1, 500, false)).toEqual({ songs: [1, 2, 3], start: 1 });
  });

  test("a long one keeps the songs around where they started", () => {
    const { songs, start } = limitQueue(list, 1200, 500, false);
    expect(songs.length).toBe(500);
    expect(songs[start]).toBe(1200);
    expect(songs[0]).toBe(1180);
    expect(limitQueue(list, 5, 500, false)).toEqual({ songs: list.slice(0, 500), start: 5 });
    const end = limitQueue(list, 1999, 500, false);
    expect(end.songs[end.start]).toBe(1999);
    expect(end.songs.length).toBe(500);
  });

  test("shuffled, a pick from all of it, in order, with where they started", () => {
    const { songs, start } = limitQueue(list, 1500, 500, true);
    expect(songs.length).toBe(500);
    expect(songs[start]).toBe(1500);
    expect([...songs].sort((a, b) => a - b)).toEqual(songs);
    expect(songs[songs.length - 1] - songs[0]).toBeGreaterThan(1000);
  });
});
