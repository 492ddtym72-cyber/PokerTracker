import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import {
  ensurePlayerProfilesTable,
  validatePlayerId,
  validateProfilePhoto,
} from "../../lib/playerProfile";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const playerId = validatePlayerId(String(params.id ?? ""));
    const body = await request.json() as { profilePhoto?: unknown };
    const profilePhoto = validateProfilePhoto(body.profilePhoto);

    await ensurePlayerProfilesTable(env);

    const player = await env.DB.prepare(
      "SELECT id FROM players WHERE id = ? LIMIT 1",
    ).bind(playerId).first<{ id: string }>();

    if (!player) {
      return apiError("Der ausgewählte Spieler existiert nicht.", 404);
    }

    if (profilePhoto === null) {
      await env.DB.prepare(
        "DELETE FROM player_profiles WHERE player_id = ?",
      ).bind(playerId).run();
    } else {
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO player_profiles (player_id, profile_photo, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET
           profile_photo = excluded.profile_photo,
           updated_at = excluded.updated_at`,
      ).bind(playerId, profilePhoto, now).run();
    }

    return json({ playerId, profilePhoto });
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Profilfoto konnte nicht gespeichert werden.",
    );
  }
};
