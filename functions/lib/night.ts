import type { Env } from "../auth";

export interface NightPlayerInput {
  name: string;
  stakeCents: number;
  cashOutCents: number;
}

export interface NightInput {
  title: string;
  playedAt: string;
  players: NightPlayerInput[];
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

async function playerIdFor(normalizedName: string) {
  const bytes = new TextEncoder().encode(normalizedName);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return "player_" + hex.slice(0, 24);
}

export function validateNightInput(value: unknown): NightInput {
  if (!value || typeof value !== "object") {
    throw new Error("Ungültige Session.");
  }

  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const playedAt = typeof raw.playedAt === "string" ? raw.playedAt : "";
  const players = Array.isArray(raw.players) ? raw.players : [];

  if (!title || title.length > 80) {
    throw new Error("Bitte einen gültigen Namen für den Pokerabend angeben.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedAt)) {
    throw new Error("Bitte ein gültiges Datum angeben.");
  }

  if (players.length < 2 || players.length > 20) {
    throw new Error("Ein Pokerabend braucht zwischen 2 und 20 Spieler.");
  }

  const cleanPlayers: NightPlayerInput[] = [];
  const names = new Set<string>();

  for (const rawPlayer of players) {
    if (!rawPlayer || typeof rawPlayer !== "object") {
      throw new Error("Ungültiger Spieler.");
    }

    const player = rawPlayer as Record<string, unknown>;
    const name = typeof player.name === "string"
      ? player.name.trim().replace(/\s+/g, " ")
      : "";
    const stakeCents = Number(player.stakeCents);
    const cashOutCents = Number(player.cashOutCents);
    const normalizedName = normalizeName(name);

    if (!name || name.length > 50) {
      throw new Error("Jeder Spieler braucht einen gültigen Namen.");
    }

    if (names.has(normalizedName)) {
      throw new Error("Ein Spieler kann pro Abend nur einmal vorkommen.");
    }
    names.add(normalizedName);

    if (
      !Number.isSafeInteger(stakeCents) ||
      !Number.isSafeInteger(cashOutCents) ||
      stakeCents < 0 ||
      cashOutCents < 0 ||
      stakeCents > 100_000_000 ||
      cashOutCents > 100_000_000
    ) {
      throw new Error("Bitte gültige Geldbeträge angeben.");
    }

    cleanPlayers.push({ name, stakeCents, cashOutCents });
  }

  return { title, playedAt, players: cleanPlayers };
}

export async function writeNight(
  env: Env,
  input: NightInput,
  nightId: string,
  mode: "create" | "update",
) {
  const now = new Date().toISOString();
  const playerRows = await Promise.all(
    input.players.map(async (player) => {
      const normalizedName = normalizeName(player.name);
      return {
        ...player,
        normalizedName,
        playerId: await playerIdFor(normalizedName),
      };
    }),
  );

  const statements: D1PreparedStatement[] = [];

  if (mode === "create") {
    statements.push(
      env.DB.prepare(
        "INSERT INTO poker_nights (id, title, played_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(nightId, input.title, input.playedAt, now, now),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE poker_nights SET title = ?, played_at = ?, updated_at = ? WHERE id = ?",
      ).bind(input.title, input.playedAt, now, nightId),
    );
    statements.push(
      env.DB.prepare("DELETE FROM night_results WHERE night_id = ?").bind(nightId),
    );
  }

  for (const player of playerRows) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO players (id, name, normalized_name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name`,
      ).bind(player.playerId, player.name, player.normalizedName, now),
    );

    statements.push(
      env.DB.prepare(
        `INSERT INTO night_results
         (id, night_id, player_id, stake_cents, cash_out_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        nightId,
        player.playerId,
        player.stakeCents,
        player.cashOutCents,
        now,
      ),
    );
  }

  await env.DB.batch(statements);
}

export async function nightExists(env: Env, nightId: string) {
  const row = await env.DB.prepare(
    "SELECT id FROM poker_nights WHERE id = ? LIMIT 1",
  ).bind(nightId).first<{ id: string }>();

  return Boolean(row?.id);
}
