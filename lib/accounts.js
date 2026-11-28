import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";
import {
  ACCOUNT_SESSION_TTL_SECONDS,
  clearLoginFailures,
  completePlayerTutorial,
  createAccountRecord,
  deleteAccountSession,
  loadAccountRecord,
  loadAccountSession,
  loadLoginFailures,
  loadPlayerProgress,
  saveAccountSession,
  saveLoginFailures,
  withLoginLock,
} from "./store.js";

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = "bakasha_session";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_LOGIN_FAILURES = 8;
const DUMMY_SALT = Buffer.from("5e7cc45a915bff8b88098a7cb66c", "hex");
const DUMMY_HASH = Buffer.alloc(PASSWORD_KEY_LENGTH);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cleanUsername(value) {
  if (typeof value !== "string") throw new HttpError(400, "Choose a username between 3 and 16 letters, numbers, or underscores.");
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(username)) {
    throw new HttpError(400, "Choose a username between 3 and 16 letters, numbers, or underscores.");
  }
  return username;
}

function cleanPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(400, "Choose a password between 8 and 128 characters.");
  }
  return value;
}

async function derivePassword(password, salt) {
  return scryptAsync(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);
}

function getSessionToken(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

function sessionCookie(token, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function responseWithCookie(data, cookie) {
  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": cookie,
    },
  });
}

async function createSession(account, request) {
  const token = randomBytes(32).toString("hex");
  await saveAccountSession(hashToken(token), { id: account.id, username: account.username });
  return responseWithCookie(
    { user: { username: account.username } },
    sessionCookie(token, request, ACCOUNT_SESSION_TTL_SECONDS),
  );
}

export async function getAuthenticatedAccount(request) {
  if (!request) return null;
  const hostname = new URL(request.url).hostname.toLowerCase();
  const localRequest = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  if (localRequest && request.headers.get("x-bakasha-local-testing") === "1") {
    return { id: "local-testing-player", username: "local_player" };
  }
  const token = getSessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await loadAccountSession(hashToken(token));
  return session && typeof session.id === "string" && typeof session.username === "string"
    ? { id: session.id, username: session.username }
    : null;
}

async function measured(name, fn) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const result = await fn();
    outcome = "success";
    return result;
  } catch (error) {
    outcome = error instanceof HttpError ? "rejected" : "error";
    throw error;
  } finally {
    metric(`${name}.requests`, 1, { outcome });
    metric(`${name}.duration_ms`, performance.now() - startedAt);
  }
}

async function checkLoginLimit(username) {
  return withLoginLock(username, async () => {
    const failures = await loadLoginFailures(username);
    return Boolean(failures && failures.count >= MAX_LOGIN_FAILURES);
  });
}

async function recordLoginFailure(username) {
  return withLoginLock(username, async () => {
    const previous = await loadLoginFailures(username);
    const failures = previous || { count: 0 };
    failures.count += 1;
    await saveLoginFailures(username, failures);
    return failures.count >= MAX_LOGIN_FAILURES;
  });
}

export async function handleCurrentAccount({ request }) {
  return measured("bakasha.account.session", async () => {
    const account = await getAuthenticatedAccount(request);
    if (!account) return { user: null };
    const progress = await loadPlayerProgress(account.id, account.username);
    return { user: { username: account.username, progress } };
  });
}

export async function handleCompleteTutorial({ request }) {
  return measured("bakasha.account.tutorial", async () => {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new HttpError(401, "Sign in to save your tutorial progress.");
    const progress = await completePlayerTutorial(account.id, account.username);
    return { progress };
  });
}

export async function handleRegister({ request, body }) {
  return measured("bakasha.account.register", async () => {
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    const salt = randomBytes(16);
    const account = {
      id: randomUUID(),
      username,
      salt: salt.toString("hex"),
      passwordHash: (await derivePassword(password, salt)).toString("hex"),
      createdAt: Date.now(),
    };
    if (!(await createAccountRecord(username, account))) {
      throw new HttpError(409, "That username is already taken.");
    }
    return createSession(account, request);
  });
}

export async function handleLogin({ request, body }) {
  return measured("bakasha.account.login", async () => {
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    if (await checkLoginLimit(username)) {
      throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
    }

    const account = await loadAccountRecord(username);
    const salt = account ? Buffer.from(account.salt, "hex") : DUMMY_SALT;
    const expected = account ? Buffer.from(account.passwordHash, "hex") : DUMMY_HASH;
    const actual = await derivePassword(password, salt);
    const valid = account
      && expected.length === actual.length
      && timingSafeEqual(expected, actual);
    if (!valid) {
      if (await recordLoginFailure(username)) {
        throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
      }
      throw new HttpError(401, "Incorrect username or password.");
    }

    await clearLoginFailures(username);
    return createSession(account, request);
  });
}

export async function handleLogout({ request }) {
  return measured("bakasha.account.logout", async () => {
    const token = getSessionToken(request);
    if (token && /^[a-f0-9]{64}$/.test(token)) await deleteAccountSession(hashToken(token));
    return responseWithCookie(
      { ok: true },
      sessionCookie("", request, 0),
    );
  });
}
