import { createSessionCookie, type Env } from "../auth";
import { json } from "../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const checks: Record<string, unknown> = {};

  try {
    const row = await env.DB.prepare(
      "SELECT length(password_salt) AS salt_len, length(password_hash) AS hash_len, iterations FROM app_auth WHERE id = 1",
    ).first<{ salt_len: number; hash_len: number; iterations: number }>();
    checks.d1 = Boolean(row && row.salt_len === 32 && row.hash_len === 64 && row.iterations > 0);
  } catch (error) {
    checks.d1 = false;
    checks.d1Error = error instanceof Error ? error.message : String(error);
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("health-check"),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        iterations: 210000,
      },
      key,
      256,
    );
    checks.pbkdf2 = true;
  } catch (error) {
    checks.pbkdf2 = false;
    checks.pbkdf2Error = error instanceof Error ? error.message : String(error);
  }

  try {
    const cookie = await createSessionCookie(env);
    checks.sessionCookie = cookie.startsWith("pokertracker_session=");
  } catch (error) {
    checks.sessionCookie = false;
    checks.sessionCookieError = error instanceof Error ? error.message : String(error);
  }

  return json(checks);
};
