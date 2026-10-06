import type { Env } from "../auth";

export interface NightPlayerInput {
  playerId?: string;
  name: string;
  stakeCents: number;
  cashOutCents: number;
}

export interface NightInput {
  title: string;
  playedAt: string;
  players: NightPlayerInput[];
}

export interface NightAdjustmentInput {
  playerId: string;
  amountCents: number;
}

export interface NightSnapshot {
  id: string;
  title: string;
  playedAt: string;
  players: NightPlayerInput[];
}

interface SnapshotRow {
  night_id: string;
  title: string;
  played_at: string;
  player_name: string | null;
  stake_cents: number | null;
  cash_out_cents: number | null;
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

function snapshotFromInput(id: string, input: NightInput): NightSnapshot {
  return {
    id,
    title: input.title,
    playedAt: input.playedAt,
    players: input.players.map((player) => ({ ...player })),
  };
}

function sameNightResults(before: NightSnapshot, after: NightSnapshot) {
  if (before.players.length !== after.players.length) return false;

  const key = (player: NightPlayerInput) =>
    normalizeName(player.name) + ":" + player.stakeCents + ":" + player.cashOutCents;

  const beforeKeys = before.players.map(key).sort();
  const afterKeys = after.players.map(key).sort();

  return beforeKeys.every((value, index) => value === afterKeys[index]);
}

function auditStatement(
  env: Env,
  eventType: "night.created" | "night.updated" | "night.deleted" | "night.baseline",
  entityId: string,
  createdAt: string,
  before: NightSnapshot | null,
  after: NightSnapshot | null,
) {
  return env.DB.prepare(
    `INSERT INTO audit_events
     (id, event_type, entity_type, entity_id, created_at, before_json, after_json)
     VALUES (?, ?, 'poker_night', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    eventType,
    entityId,
    createdAt,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
  );
}

export function validateNightInput(value: unknown): NightInput {
  if (!value || typeof value !== "object") {
    throw new Error("Ungültiger Pokerabend.");
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
  const identities = new Set<string>();

  for (const rawPlayer of players) {
    if (!rawPlayer || typeof rawPlayer !== "object") {
      throw new Error("Ungültiger Spieler.");
    }

    const player = rawPlayer as Record<string, unknown>;
    const playerId = typeof player.playerId === "string" && player.playerId.trim()
      ? player.playerId.trim()
      : undefined;
    const name = typeof player.name === "string"
      ? player.name.trim().replace(/\s+/g, " ")
      : "";
    const stakeCents = Number(player.stakeCents);
    const cashOutCents = Number(player.cashOutCents);
    const normalizedName = normalizeName(name);

    if (playerId && !/^player_[a-f0-9]{24}$/.test(playerId)) {
      throw new Error("Ungültige Spieler-ID.");
    }

    if (!name || name.length > 50) {
      throw new Error("Jeder Spieler braucht einen gültigen Namen.");
    }

    const identity = playerId ? `id:${playerId}` : `name:${normalizedName}`;
    if (identities.has(identity)) {
      throw new Error("Ein Spieler kann pro Abend nur einmal vorkommen.");
    }
    identities.add(identity);

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

    cleanPlayers.push({ playerId, name, stakeCents, cashOutCents });
  }

  return { title, playedAt, players: cleanPlayers };
}

export function validateNightAdjustments(value: unknown): NightAdjustmentInput[] {
  if (!value || typeof value !== "object") {
    throw new Error("Ungültiger Differenzausgleich.");
  }

  const raw = value as Record<string, unknown>;
  const adjustments = Array.isArray(raw.adjustments) ? raw.adjustments : [];

  if (adjustments.length > 20) {
    throw new Error("Zu viele Ausgleichsbuchungen.");
  }

  const clean: NightAdjustmentInput[] = [];
  const seen = new Set<string>();

  for (const rawAdjustment of adjustments) {
    if (!rawAdjustment || typeof rawAdjustment !== "object") {
      throw new Error("Ungültige Ausgleichsbuchung.");
    }

    const adjustment = rawAdjustment as Record<string, unknown>;
    const playerId = typeof adjustment.playerId === "string"
      ? adjustment.playerId.trim()
      : "";
    const amountCents = Number(adjustment.amountCents);

    if (!/^player_[a-f0-9]{24}$/.test(playerId)) {
      throw new Error("Ungültige Spieler-ID im Differenzausgleich.");
    }

    if (
      !Number.isSafeInteger(amountCents) ||
      Math.abs(amountCents) > 100_000_000
    ) {
      throw new Error("Ungültiger Betrag im Differenzausgleich.");
    }

    if (seen.has(playerId)) {
      throw new Error("Ein Spieler kann nur einmal im Differenzausgleich vorkommen.");
    }
    seen.add(playerId);

    if (amountCents !== 0) {
      clean.push({ playerId, amountCents });
    }
  }

  return clean;
}

export async function writeNightAdjustments(
  env: Env,
  nightId: string,
  adjustments: NightAdjustmentInput[],
) {
  const rows = await env.DB.prepare(
    `SELECT player_id, stake_cents, cash_out_cents
     FROM night_results
     WHERE night_id = ?`,
  ).bind(nightId).all<{
    player_id: string;
    stake_cents: number;
    cash_out_cents: number;
  }>();

  if (rows.results.length === 0) {
    throw new Error("Pokerabend nicht gefunden.");
  }

  const participatingIds = new Set(rows.results.map((row) => row.player_id));
  const rawDifferenceCents = rows.results.reduce(
    (sum, row) => sum + row.cash_out_cents - row.stake_cents,
    0,
  );

  for (const adjustment of adjustments) {
    if (!participatingIds.has(adjustment.playerId)) {
      throw new Error("Der ausgewählte Spieler gehört nicht zu diesem Pokerabend.");
    }
  }

  const adjustmentTotalCents = adjustments.reduce(
    (sum, adjustment) => sum + adjustment.amountCents,
    0,
  );

  if (rawDifferenceCents === 0 && adjustmentTotalCents !== 0) {
    throw new Error("Dieser Pokerabend hat keine Differenz zum Ausgleichen.");
  }

  if (rawDifferenceCents > 0) {
    if (adjustments.some((adjustment) => adjustment.amountCents > 0)) {
      throw new Error("Bei einem Überschuss können nur Beträge abgezogen werden.");
    }
    if (adjustmentTotalCents < -rawDifferenceCents) {
      throw new Error("Der Ausgleich ist größer als die offene Differenz.");
    }
  }

  if (rawDifferenceCents < 0) {
    if (adjustments.some((adjustment) => adjustment.amountCents < 0)) {
      throw new Error("Bei einem Fehlbetrag können nur Beträge gutgeschrieben werden.");
    }
    if (adjustmentTotalCents > -rawDifferenceCents) {
      throw new Error("Der Ausgleich ist größer als die offene Differenz.");
    }
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM night_adjustments WHERE night_id = ?").bind(nightId),
  ];

  for (const adjustment of adjustments) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO night_adjustments
         (id, night_id, player_id, amount_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        nightId,
        adjustment.playerId,
        adjustment.amountCents,
        now,
        now,
      ),
    );
  }

  statements.push(
    env.DB.prepare("UPDATE poker_nights SET updated_at = ? WHERE id = ?")
      .bind(now, nightId),
  );

  await env.DB.batch(statements);

  return {
    rawDifferenceCents,
    adjustmentTotalCents,
    remainingDifferenceCents: rawDifferenceCents + adjustmentTotalCents,
  };
}

export async function loadNightSnapshot(env: Env, nightId: string) {
  const query = await env.DB.prepare(
    `SELECT
       n.id AS night_id,
       n.title,
       n.played_at,
       p.name AS player_name,
       r.stake_cents,
       r.cash_out_cents
     FROM poker_nights n
     LEFT JOIN night_results r ON r.night_id = n.id
     LEFT JOIN players p ON p.id = r.player_id
     WHERE n.id = ?
     ORDER BY p.name COLLATE NOCASE ASC`,
  ).bind(nightId).all<SnapshotRow>();

  if (query.results.length === 0) return null;

  const first = query.results[0];
  const snapshot: NightSnapshot = {
    id: first.night_id,
    title: first.title,
    playedAt: first.played_at,
    players: [],
  };

  for (const row of query.results) {
    if (row.player_name === null) continue;

    snapshot.players.push({
      name: row.player_name,
      stakeCents: row.stake_cents ?? 0,
      cashOutCents: row.cash_out_cents ?? 0,
    });
  }

  return snapshot;
}

export async function writeNight(
  env: Env,
  input: NightInput,
  nightId: string,
  mode: "create" | "update",
) {
  const now = new Date().toISOString();
  const before = mode === "update" ? await loadNightSnapshot(env, nightId) : null;

  if (mode === "update" && !before) {
    throw new Error("Pokerabend nicht gefunden.");
  }

  const playerRows = await Promise.all(
    input.players.map(async (player) => {
      if (player.playerId) {
        const existing = await env.DB.prepare(
          "SELECT id, name, normalized_name FROM players WHERE id = ? LIMIT 1",
        ).bind(player.playerId).first<{
          id: string;
          name: string;
          normalized_name: string;
        }>();

        if (!existing) {
          throw new Error("Der ausgewählte Spieler existiert nicht mehr.");
        }

        return {
          ...player,
          name: existing.name,
          normalizedName: existing.normalized_name,
          playerId: existing.id,
          isExisting: true,
        };
      }

      const normalizedName = normalizeName(player.name);
      return {
        ...player,
        normalizedName,
        playerId: await playerIdFor(normalizedName),
        isExisting: false,
      };
    }),
  );

  const seenPlayerIds = new Set<string>();
  for (const player of playerRows) {
    if (seenPlayerIds.has(player.playerId)) {
      throw new Error("Ein Spieler kann pro Abend nur einmal vorkommen.");
    }
    seenPlayerIds.add(player.playerId);
  }

  const after = snapshotFromInput(nightId, {
    ...input,
    players: playerRows.map(({ playerId, name, stakeCents, cashOutCents }) => ({
      playerId,
      name,
      stakeCents,
      cashOutCents,
    })),
  });

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

    if (before && !sameNightResults(before, after)) {
      statements.push(
        env.DB.prepare("DELETE FROM night_adjustments WHERE night_id = ?").bind(nightId),
      );
    }

    statements.push(
      env.DB.prepare("DELETE FROM night_results WHERE night_id = ?").bind(nightId),
    );
  }

  for (const player of playerRows) {
    if (!player.isExisting) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO players (id, name, normalized_name, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name`,
        ).bind(player.playerId, player.name, player.normalizedName, now),
      );
    }

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

  statements.push(
    auditStatement(
      env,
      mode === "create" ? "night.created" : "night.updated",
      nightId,
      now,
      before,
      after,
    ),
  );

  await env.DB.batch(statements);
}

export async function deleteNightWithAudit(env: Env, nightId: string) {
  const before = await loadNightSnapshot(env, nightId);
  if (!before) return false;

  const now = new Date().toISOString();

  await env.DB.batch([
    auditStatement(env, "night.deleted", nightId, now, before, null),
    env.DB.prepare("DELETE FROM poker_nights WHERE id = ?").bind(nightId),
  ]);

  return true;
}

export async function nightExists(env: Env, nightId: string) {
  const row = await env.DB.prepare(
    "SELECT id FROM poker_nights WHERE id = ? LIMIT 1",
  ).bind(nightId).first<{ id: string }>();

  return Boolean(row?.id);
}
