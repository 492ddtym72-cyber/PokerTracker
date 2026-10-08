import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import {
  ensurePlayerProfilesTable,
  validatePlayerId,
  validateProfilePhoto,
  validateProfilePhotoSource,
} from "../../lib/playerProfile";

// Load the editable source only when the user opens the crop dialog.
// Keeping this out of /api/players avoids downloading large originals for every player.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  try {
    const playerId = validatePlayerId(String(params.id ?? ""));
    await ensurePlayerProfilesTable(env);

    const player = await env.DB.prepare(
      `SELECT p.id, ps.source_photo
       FROM players p
       LEFT JOIN player_photo_sources ps ON ps.player_id = p.id
       WHERE p.id = ? LIMIT 1`,
    ).bind(playerId).first<{ id: string; source_photo: string | null }>();

    if (!player) return apiError("Der ausgewählte Spieler existiert nicht.", 404);
    return json({ playerId, sourcePhoto: player.source_photo });
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Fotovorlage konnte nicht geladen werden.",
      500,
    );
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const playerId = validatePlayerId(String(params.id ?? ""));
    const body = await request.json() as { profilePhoto?: unknown; sourcePhoto?: unknown };
    const profilePhoto = validateProfilePhoto(body.profilePhoto);
    const sourcePhoto = body.sourcePhoto == null
      ? null
      : validateProfilePhotoSource(body.sourcePhoto);

    await ensurePlayerProfilesTable(env);

    const player = await env.DB.prepare(
      "SELECT id FROM players WHERE id = ? LIMIT 1",
    ).bind(playerId).first<{ id: string }>();

    if (!player) return apiError("Der ausgewählte Spieler existiert nicht.", 404);

    // Update the cropped avatar and its editable source as one D1 batch.
    // Older clients sending no source remove a potentially stale source.
    if (profilePhoto === null) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM player_photo_sources WHERE player_id = ?").bind(playerId),
        env.DB.prepare("DELETE FROM player_profiles WHERE player_id = ?").bind(playerId),
      ]);
    } else {
      const now = new Date().toISOString();
      const statements = [
        env.DB.prepare(
          `INSERT INTO player_profiles (player_id, profile_photo, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET
             profile_photo = excluded.profile_photo,
             updated_at = excluded.updated_at`,
        ).bind(playerId, profilePhoto, now),
      ];

      if (sourcePhoto !== null) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO player_photo_sources (player_id, source_photo, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(player_id) DO UPDATE SET
               source_photo = excluded.source_photo,
               updated_at = excluded.updated_at`,
          ).bind(playerId, sourcePhoto, now),
        );
      } else {
        statements.push(
          env.DB.prepare("DELETE FROM player_photo_sources WHERE player_id = ?").bind(playerId),
        );
      }
      await env.DB.batch(statements);
    }

    return json({ playerId, profilePhoto });
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Profilfoto konnte nicht gespeichert werden.",
    );
  }
};
