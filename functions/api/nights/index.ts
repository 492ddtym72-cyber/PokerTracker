import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { validateNightInput, writeNight } from "../../lib/night";

interface NightRow {
  night_id: string;
  title: string;
  played_at: string;
  created_at: string;
  updated_at: string;
  record_type: "session" | "baseline";
  result_id: string | null;
  player_id: string | null;
  player_name: string | null;
  stake_cents: number | null;
  cash_out_cents: number | null;
  adjustment_cents: number | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const query = await env.DB.prepare(
    `SELECT
      n.id AS night_id,
      n.title,
      n.played_at,
      n.created_at,
      n.updated_at,
      n.record_type,
      r.id AS result_id,
      p.id AS player_id,
      p.name AS player_name,
      r.stake_cents,
      r.cash_out_cents,
      COALESCE(a.amount_cents, 0) AS adjustment_cents
    FROM poker_nights n
    LEFT JOIN night_results r ON r.night_id = n.id
    LEFT JOIN players p ON p.id = r.player_id
    LEFT JOIN night_adjustments a
      ON a.night_id = n.id AND a.player_id = r.player_id
    ORDER BY n.played_at DESC, n.created_at DESC, p.name COLLATE NOCASE ASC`,
  ).all<NightRow>();

  const nightMap = new Map<string, {
    id: string;
    title: string;
    playedAt: string;
    createdAt: string;
    updatedAt: string;
    recordType: "session" | "baseline";
    players: Array<{
      id: string;
      name: string;
      stakeCents: number;
      cashOutCents: number;
      adjustmentCents: number;
    }>;
  }>();

  for (const row of query.results) {
    let night = nightMap.get(row.night_id);

    if (!night) {
      night = {
        id: row.night_id,
        title: row.title,
        playedAt: row.played_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        recordType: row.record_type,
        players: [],
      };
      nightMap.set(row.night_id, night);
    }

    if (row.result_id && row.player_id && row.player_name !== null) {
      night.players.push({
        id: row.player_id,
        name: row.player_name,
        stakeCents: row.stake_cents ?? 0,
        cashOutCents: row.cash_out_cents ?? 0,
        adjustmentCents: row.adjustment_cents ?? 0,
      });
    }
  }

  return json({ nights: Array.from(nightMap.values()) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const input = validateNightInput(await request.json());
    const id = crypto.randomUUID();

    await writeNight(env, input, id, "create");

    return json({ id }, { status: 201 });
  } catch (error) {
    console.error(error);
    return apiError(error instanceof Error ? error.message : "Pokerabend konnte nicht gespeichert werden.");
  }
};
