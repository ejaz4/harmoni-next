import Redis from "ioredis";

// Valkey (Redis-compatible) holds state that has to be shared by every web
// instance: Harmoni Link's devices and playback, and the messages between
// devices. Two connections per instance: one for commands, and one that
// does nothing but listen, as subscribing takes a connection over.

const globalForRedis = globalThis as unknown as { redis?: Redis; redisSubscriber?: Redis };

function connect(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL isn't set: Harmoni Link needs Valkey or Redis");
  const client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  client.on("error", (err) => console.warn("redis:", err.message));
  return client;
}

export function redis(): Redis {
  return (globalForRedis.redis ??= connect());
}

export function redisSubscriber(): Redis {
  return (globalForRedis.redisSubscriber ??= connect());
}
