import type { Env } from "../auth";

const MAX_PROFILE_PHOTO_LENGTH = 260_000;
const DATA_URL_PATTERN = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export async function ensurePlayerProfilesTable(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS player_profiles (
      player_id TEXT PRIMARY KEY,
      profile_photo TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS player_photo_sources (
      player_id TEXT PRIMARY KEY,
      source_photo TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )`,
  ).run();
}

export function validateProfilePhoto(value: unknown) {
  if (value === null) return null;

  if (typeof value !== "string") {
    throw new Error("Ungültiges Profilfoto.");
  }

  if (value.length > MAX_PROFILE_PHOTO_LENGTH || !DATA_URL_PATTERN.test(value)) {
    throw new Error("Das Profilfoto ist zu groß oder hat ein ungültiges Format.");
  }

  return value;
}

export function validateProfilePhotoSource(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 900_000 ||
    !DATA_URL_PATTERN.test(value)
  ) {
    throw new Error("Die Fotovorlage ist zu groß oder hat ein ungültiges Format.");
  }

  return value;
}

export function validatePlayerId(value: string) {
  if (!/^player_[a-f0-9]{24}$/.test(value)) {
    throw new Error("Ungültige Spieler-ID.");
  }

  return value;
}
