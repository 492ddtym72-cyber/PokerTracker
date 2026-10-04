import type { NightSnapshot } from "./night";

export type AuditEventType =
  | "night.created"
  | "night.updated"
  | "night.deleted"
  | "night.baseline";

export type AuditChange =
  | {
      type: "field";
      field: "title" | "date";
      before: string;
      after: string;
    }
  | {
      type: "player_added";
      player: string;
      stakeCents: number;
      cashOutCents: number;
    }
  | {
      type: "player_removed";
      player: string;
      stakeCents: number;
      cashOutCents: number;
    }
  | {
      type: "player_amount";
      player: string;
      field: "stake" | "cash_out";
      beforeCents: number;
      afterCents: number;
    };

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

export function parseSnapshot(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value) as NightSnapshot;
  } catch {
    return null;
  }
}

export function buildAuditChanges(
  before: NightSnapshot | null,
  after: NightSnapshot | null,
): AuditChange[] {
  if (!before || !after) return [];

  const changes: AuditChange[] = [];

  if (before.title !== after.title) {
    changes.push({
      type: "field",
      field: "title",
      before: before.title,
      after: after.title,
    });
  }

  if (before.playedAt !== after.playedAt) {
    changes.push({
      type: "field",
      field: "date",
      before: before.playedAt,
      after: after.playedAt,
    });
  }

  const beforePlayers = new Map(
    before.players.map((player) => [normalizeName(player.name), player]),
  );
  const afterPlayers = new Map(
    after.players.map((player) => [normalizeName(player.name), player]),
  );

  for (const [key, player] of afterPlayers) {
    const previous = beforePlayers.get(key);

    if (!previous) {
      changes.push({
        type: "player_added",
        player: player.name,
        stakeCents: player.stakeCents,
        cashOutCents: player.cashOutCents,
      });
      continue;
    }

    if (previous.stakeCents !== player.stakeCents) {
      changes.push({
        type: "player_amount",
        player: player.name,
        field: "stake",
        beforeCents: previous.stakeCents,
        afterCents: player.stakeCents,
      });
    }

    if (previous.cashOutCents !== player.cashOutCents) {
      changes.push({
        type: "player_amount",
        player: player.name,
        field: "cash_out",
        beforeCents: previous.cashOutCents,
        afterCents: player.cashOutCents,
      });
    }
  }

  for (const [key, player] of beforePlayers) {
    if (!afterPlayers.has(key)) {
      changes.push({
        type: "player_removed",
        player: player.name,
        stakeCents: player.stakeCents,
        cashOutCents: player.cashOutCents,
      });
    }
  }

  return changes;
}

export function auditSummary(snapshot: NightSnapshot | null) {
  if (!snapshot) {
    return {
      title: "Pokerabend",
      playedAt: null,
      playerCount: 0,
      totalStakeCents: 0,
    };
  }

  return {
    title: snapshot.title,
    playedAt: snapshot.playedAt,
    playerCount: snapshot.players.length,
    totalStakeCents: snapshot.players.reduce(
      (sum, player) => sum + player.stakeCents,
      0,
    ),
  };
}
