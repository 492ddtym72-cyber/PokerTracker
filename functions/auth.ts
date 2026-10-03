export interface Env {
  DB: D1Database;
}

interface AuthConfig {
  password_salt: string;
  password_hash: string;
  iterations: number;
}

const COOKIE_NAME = "pokertracker_session";
const SESSION_PAYLOAD = "pokertracker-authenticated-v2";
const PASSWORD_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex value.");

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

async function authConfig(env: Env) {
  return env.DB.prepare(
    "SELECT password_salt, password_hash, iterations FROM app_auth WHERE id = 1 LIMIT 1",
  ).first<AuthConfig>();
}

async function derivePasswordHash(password: string, saltHex: string, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations,
    },
    keyMaterial,
    256,
  );

  return bytesToHex(new Uint8Array(bits));
}

async function sessionToken(passwordHash: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(passwordHash),
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

export async function verifyPassword(password: string, env: Env) {
  const config = await authConfig(env);
  if (!config) return false;

  const candidate = await derivePasswordHash(
    password,
    config.password_salt,
    Number(config.iterations),
  );

  return constantTimeEqual(candidate, config.password_hash);
}

export async function changePassword(newPassword: string, env: Env) {
  if (newPassword.length < 12 || newPassword.length > 128) {
    throw new Error("Das neue Passwort muss zwischen 12 und 128 Zeichen lang sein.");
  }

  const salt = randomHex(16);
  const hash = await derivePasswordHash(newPassword, salt, PASSWORD_ITERATIONS);

  await env.DB.prepare(
    `UPDATE app_auth
     SET password_salt = ?, password_hash = ?, iterations = ?, updated_at = ?
     WHERE id = 1`,
  ).bind(salt, hash, PASSWORD_ITERATIONS, new Date().toISOString()).run();
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
  const actual = readCookie(request, COOKIE_NAME);
  if (!actual) return false;

  const config = await authConfig(env);
  if (!config) return false;

  const expected = await sessionToken(config.password_hash);
  return constantTimeEqual(actual, expected);
}

export async function createSessionCookie(env: Env) {
  const config = await authConfig(env);
  if (!config) throw new Error("Authentication is not configured.");

  const token = await sessionToken(config.password_hash);

  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
