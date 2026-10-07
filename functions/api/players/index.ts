import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { ensurePlayerProfilesTable } from "../../lib/playerProfile";

interface PlayerProfileRow {
  id: string;
  name: string;
  profile_photo: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    await ensurePlayerProfilesTable(env);

    const query = await env.DB.prepare(
      `SELECT
        p.id,
        p.name,
        pp.profile_photo
      FROM players p
      LEFT JOIN player_profiles pp ON pp.player_id = p.id
      ORDER BY p.name COLLATE NOCASE ASC`,
    ).all<PlayerProfileRow>();

    return json({
      players: query.results.map((player) => ({
        id: player.id,
        name: player.name,
        profilePhoto: player.profile_photo,
      })),
    });
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Spielerprofile konnten nicht geladen werden.",
      500,
    );
  }
};
