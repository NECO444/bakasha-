import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import { HttpError } from "./http.js";

export const ROOM_TTL_SECONDS = 24 * 60 * 60; // rooms expire after 24h of inactivity

// Local-only fallback so `npm test` and quick experiments work without Redis.
// It is never used on Vercel preview/production, where functions are stateless.
const mem = new Map();
const memory = {
  async get(key) {
    const entry = mem.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      mem.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  },
  async set(key, value, options = {}) {
    if (options.nx && (await this.get(key)) !== null) return null;
    const ttl = options.px ?? (options.ex ?? 60) * 1000;
    mem.set(key, { value: structuredClone(value), expires: Date.now() + ttl });
    return "OK";
  },
  async del(key) {
    mem.delete(key);
  },
};

let cached = null;
function db() {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    cached = new Redis({ url, token });
  } else if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new HttpError(503, "Storage is not set up. Add Upstash Redis to this Vercel project, then redeploy.");
  } else {
    cached = memory;
  }
  return cached;
}

const roomKey = (code) => `bakasha:room:${code}`;
const lockKey = (code) => `bakasha:lock:${code}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadRoom(code) {
  return (await db().get(roomKey(code))) || null;
}

export async function saveRoom(code, room) {
  await db().set(roomKey(code), room, { ex: ROOM_TTL_SECONDS });
}

// Returns true if the room was created, false if the code was already taken.
export async function createRoomRecord(code, room) {
  const result = await db().set(roomKey(code), room, { nx: true, ex: ROOM_TTL_SECONDS });
  return result === "OK";
}

// Serialises writes to one room so two simultaneous requests cannot overwrite each other.
export async function withRoomLock(code, fn) {
  const client = db();
  const id = randomUUID();
  let locked = false;
  for (let attempt = 0; attempt < 25 && !locked; attempt += 1) {
    locked = (await client.set(lockKey(code), id, { nx: true, px: 5000 })) === "OK";
    if (!locked) await sleep(80);
  }
  if (!locked) throw new HttpError(503, "The room is busy. Try again in a moment.");
  try {
    return await fn();
  } finally {
    await client.del(lockKey(code));
  }
}
