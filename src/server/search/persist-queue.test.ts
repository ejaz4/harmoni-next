import { expect, test } from "bun:test";
import { persistQueue } from "./persist-queue";

const tick = () => new Promise((r) => setTimeout(r, 0));

// Jobs that wait until released, so the test controls when each finishes.
function recorder() {
  const ran: string[] = [];
  const job = (name: string) => () => {
    ran.push(name);
    return tick();
  };
  return { ran, job };
}

test("foreground jobs run before queued background ones", async () => {
  const { ran, job } = recorder();
  persistQueue.enqueue("t1-a", job("bg1"), "later");
  persistQueue.enqueue("t1-b", job("bg2"), "later");
  persistQueue.enqueue("t1-c", job("fg"));
  await persistQueue.settled("t1-b", { background: true });
  // bg1 had already started when fg arrived; fg still beats bg2.
  expect(ran).toEqual(["bg1", "fg", "bg2"]);
});

test("waiting on a background song moves it to the front", async () => {
  const { ran, job } = recorder();
  persistQueue.enqueue("t2-a", job("a"), "later");
  persistQueue.enqueue("t2-b", job("b"), "later");
  persistQueue.enqueue("t2-c", job("c"), "later");
  await persistQueue.settled("t2-c");
  expect(ran.indexOf("c")).toBeLessThan(ran.indexOf("b"));
  await persistQueue.settled("t2-b", { background: true });
  expect(ran).toHaveLength(3);
});

test("a song's own jobs keep their order across lanes", async () => {
  const { ran, job } = recorder();
  persistQueue.enqueue("t3-x", job("other"), "later");
  persistQueue.enqueue("t3-s", job("create"), "later");
  persistQueue.enqueue("t3-y", job("filler"), "later");
  persistQueue.enqueue("t3-s", job("add source"));
  await persistQueue.settled("t3-y", { background: true });
  expect(ran.indexOf("create")).toBeLessThan(ran.indexOf("add source"));
  expect(ran.indexOf("add source")).toBeLessThan(ran.indexOf("filler"));
});

test("a failed job doesn't stall the queue", async () => {
  persistQueue.enqueue("t4-a", () => Promise.reject(new Error("boom")));
  let ok = false;
  persistQueue.enqueue("t4-b", async () => {
    ok = true;
  });
  await persistQueue.settled("t4-b");
  expect(ok).toBe(true);
});
