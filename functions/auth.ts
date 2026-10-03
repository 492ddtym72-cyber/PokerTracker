export interface Env {
  APP_PASSWORD: string;
  SESSION_SECRET: string;
}

const COOKIE_NAME = "pokertracker_session";
const SESSION_PAYLOAD = "pokertracker-authenticated-v1";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionToken(secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(SESSION_PAYLOAD),
  );

  return bytesToHex(new Uint8Array(signature));
}

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const entry = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="));

  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export async function isAuthenticated(request: Request, env: Env) {
  if (!env.SESSION_SECRET) return false;
  const actual = readCookie(request, COOKIE_NAME);
  if (!actual) return false;
  const expected = await sessionToken(env.SESSION_SECRET);
  return actual === expected;
}

export async function createSessionCookie(env: Env) {
  const token = await sessionToken(env.SESSION_SECRET);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
