import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createNight,
  deleteNight,
  loadHistory,
  loadNights,
  updateNight,
  updateNightAdjustments,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import {
  getLanguage,
  getLocale,
  setLanguagePreference,
  t,
  type Language,
} from "./i18n";
import { GOLD_WREATH, SILVER_WREATH } from "./leaderboardFrames";
import type {
  AuditChange,
  AuditEvent,
  HistoryResponse,
  NightInput,
  PokerNight,
} from "./types";

type Screen = "home" | "history" | "players" | "more";
type ReconcileMode = "all" | "selected" | "custom";

type DraftPlayer = {
  key: string;
  playerId: string;
  isNew: boolean;
  name: string;
  stake: string;
  cashOut: string;
};

type PlayerStats = {
  id: string;
  name: string;
  nights: number;
  stakeCents: number;
  cashOutCents: number;
  profitCents: number;
  wins: number;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function moneyInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function emptyPlayer(): DraftPlayer {
  return {
    key: crypto.randomUUID(),
    playerId: "",
    isNew: false,
    name: "",
    stake: "",
    cashOut: "",
  };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function leaderboardFrame(rank: number) {
  if (rank === 1) return GOLD_WREATH;
  if (rank === 2) return SILVER_WREATH;
  if (rank === 3) return "/assets/leaderboard-frame-bronze.webp";
  return "/assets/leaderboard-frame-neutral.webp";
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString(getLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(getLocale(), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function playerResultCents(player: PokerNight["players"][number]) {
  return player.cashOutCents - player.stakeCents + (player.adjustmentCents ?? 0);
}

function distributeCents(totalCents: number, playerIds: string[]) {
  if (playerIds.length === 0 || totalCents === 0) return [];

  const sign = totalCents < 0 ? -1 : 1;
  const absolute = Math.abs(totalCents);
  const base = Math.floor(absolute / playerIds.length);
  const remainder = absolute % playerIds.length;

  return playerIds
    .map((playerId, index) => ({
      playerId,
      amountCents: sign * (base + (index < remainder ? 1 : 0)),
    }))
    .filter((adjustment) => adjustment.amountCents !== 0);
}

function nightTotals(night: PokerNight) {
  const stakeCents = night.players.reduce((sum, player) => sum + player.stakeCents, 0);
  const cashOutCents = night.players.reduce((sum, player) => sum + player.cashOutCents, 0);
  const adjustmentCents = night.players.reduce(
    (sum, player) => sum + (player.adjustmentCents ?? 0),
    0,
  );
  const differenceCents = cashOutCents - stakeCents;

  return {
    stakeCents,
    cashOutCents,
    adjustmentCents,
    differenceCents,
    remainingDifferenceCents: differenceCents + adjustmentCents,
  };
}

function eventLabel(event: AuditEvent) {
  switch (event.eventType) {
    case "night.created":
      return t("Pokerabend erstellt");
    case "night.updated":
      return t("Pokerabend geändert");
    case "night.deleted":
      return t("Pokerabend gelöscht");
    case "night.baseline":
      return t("Ausgangsstand erfasst");
  }
}

function eventIcon(event: AuditEvent) {
  switch (event.eventType) {
    case "night.created":
      return "+";
    case "night.updated":
      return "✎";
    case "night.deleted":
      return "×";
    case "night.baseline":
      return "•";
  }
}

function changeText(change: AuditChange) {
  if (change.type === "field") {
    const label = change.field === "title" ? t("Name") : t("Datum");
    const before = change.field === "date" ? formatDate(change.before) : change.before;
    const after = change.field === "date" ? formatDate(change.after) : change.after;
    return `${label}: ${before} → ${after}`;
  }

  if (change.type === "player_added") {
    return `${change.player} ${t("hinzugefügt")}`;
  }

  if (change.type === "player_removed") {
    return `${change.player} ${t("entfernt")}`;
  }

  const field = change.field === "stake" ? t("Einsatz") : t("Endbetrag");
  return `${change.player} · ${field} ${formatMoney(change.beforeCents)} → ${formatMoney(change.afterCents)}`;
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => getLanguage());
  const [screen, setScreen] = useState<Screen>("home");
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailNightId, setDetailNightId] = useState<string | null>(null);
  const [nights, setNights] = useState<PokerNight[]>([]);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [historyMeta, setHistoryMeta] = useState<HistoryResponse["pagination"]>({
    offset: 0,
    limit: 40,
    total: 0,
    hasMore: false,
  });
  const [title, setTitle] = useState(() => t("Pokerabend"));
  const [playedAt, setPlayedAt] = useState(today);
  const [players, setPlayers] = useState<DraftPlayer[]>([emptyPlayer(), emptyPlayer()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileMode, setReconcileMode] = useState<ReconcileMode>("all");
  const [reconcileSelected, setReconcileSelected] = useState<string[]>([]);
  const [reconcileCustom, setReconcileCustom] = useState<Record<string, string>>({});
  const [reconcileSaving, setReconcileSaving] = useState(false);
  const [error, setError] = useState("");

  async function refreshNights() {
    const data = await loadNights();
    setNights(data);
    return data;
  }

  async function refreshHistory(reset = true) {
    setHistoryLoading(true);

    try {
      const offset = reset ? 0 : history.length;
      const data = await loadHistory(offset, 40);
      setHistory((current) => reset ? data.events : [...current, ...data.events]);
      setHistoryMeta(data.pagination);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function refreshAfterMutation() {
    await refreshNights();

    try {
      await refreshHistory(true);
    } catch (historyError) {
      console.error("History refresh failed", historyError);
    }
  }

  useEffect(() => {
    setLanguagePreference(language);
  }, [language]);

  useEffect(() => {
    Promise.all([
      refreshNights(),
      refreshHistory(true),
    ])
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t("Daten konnten nicht geladen werden."));
      })
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const byPlayer = new Map<string, PlayerStats>();

    for (const night of nights) {
      for (const player of night.players) {
        const existing = byPlayer.get(player.id) ?? {
          id: player.id,
          name: player.name,
          nights: 0,
          stakeCents: 0,
          cashOutCents: 0,
          profitCents: 0,
          wins: 0,
        };

        const profit = playerResultCents(player);
        existing.name = player.name;
        existing.nights += 1;
        existing.stakeCents += player.stakeCents;
        existing.cashOutCents += player.cashOutCents;
        existing.profitCents += profit;
        if (profit > 0) existing.wins += 1;
        byPlayer.set(player.id, existing);
      }
    }

    return Array.from(byPlayer.values()).sort(
      (a, b) =>
        b.profitCents - a.profitCents ||
        b.nights - a.nights ||
        a.name.localeCompare(b.name),
    );
  }, [nights]);

  const maxAbsProfit = useMemo(
    () => Math.max(1, ...stats.map((player) => Math.abs(player.profitCents))),
    [stats],
  );

  const knownPlayers = useMemo(
    () => [...stats].sort((a, b) => a.name.localeCompare(b.name)),
    [stats],
  );

  const totalStakeAllTime = useMemo(
    () => nights.reduce(
      (nightTotal, night) =>
        nightTotal + night.players.reduce((sum, player) => sum + player.stakeCents, 0),
      0,
    ),
    [nights],
  );

  const detailNight = useMemo(
    () => nights.find((night) => night.id === detailNightId) ?? null,
    [nights, detailNightId],
  );

  const draftTotals = useMemo(() => {
    let stakeCents = 0;
    let cashOutCents = 0;

    for (const player of players) {
      stakeCents += parseMoney(player.stake) ?? 0;
      cashOutCents += parseMoney(player.cashOut) ?? 0;
    }

    return {
      stakeCents,
      cashOutCents,
      differenceCents: cashOutCents - stakeCents,
    };
  }, [players]);

  function changeLanguage(next: Language) {
    setLanguagePreference(next);
    setLanguage(next);
    setError("");
  }

  function navigate(next: Screen) {
    setScreen(next);
    setEditorOpen(false);
    setDetailNightId(null);
    setReconcileOpen(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEditor() {
    setTitle(t("Pokerabend"));
    setPlayedAt(today());
    setPlayers([emptyPlayer(), emptyPlayer()]);
    setEditingId(null);
    setError("");
  }

  function startNew() {
    resetEditor();
    setDetailNightId(null);
    setReconcileOpen(false);
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openNight(night: PokerNight) {
    setDetailNightId(night.id);
    setEditorOpen(false);
    setReconcileOpen(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editNight(night: PokerNight) {
    setReconcileOpen(false);
    setEditingId(night.id);
    setTitle(night.title);
    setPlayedAt(night.playedAt);
    setPlayers(night.players.map((player) => ({
      key: crypto.randomUUID(),
      playerId: player.id,
      isNew: false,
      name: player.name,
      stake: moneyInput(player.stakeCents),
      cashOut: moneyInput(player.cashOutCents),
    })));
    setDetailNightId(null);
    setEditorOpen(true);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openReconciliation(night: PokerNight) {
    const hasExisting = night.players.some((player) => (player.adjustmentCents ?? 0) !== 0);

    setReconcileMode(hasExisting ? "custom" : "all");
    setReconcileSelected(night.players.map((player) => player.id));
    setReconcileCustom(Object.fromEntries(
      night.players.map((player) => [
        player.id,
        player.adjustmentCents ? moneyInput(Math.abs(player.adjustmentCents)) : "",
      ]),
    ));
    setReconcileOpen(true);
    setError("");
  }

  function plannedAdjustments(night: PokerNight) {
    const totals = nightTotals(night);
    const targetCents = -totals.differenceCents;
    const playersByOriginalProfit = [...night.players].sort(
      (a, b) =>
        (b.cashOutCents - b.stakeCents) - (a.cashOutCents - a.stakeCents) ||
        a.name.localeCompare(b.name, getLanguage()),
    );

    if (reconcileMode === "all") {
      return distributeCents(
        targetCents,
        playersByOriginalProfit.map((player) => player.id),
      );
    }

    if (reconcileMode === "selected") {
      const selectedIds = new Set(reconcileSelected);
      return distributeCents(
        targetCents,
        playersByOriginalProfit
          .filter((player) => selectedIds.has(player.id))
          .map((player) => player.id),
      );
    }

    const sign = totals.differenceCents > 0 ? -1 : 1;
    return night.players.flatMap((player) => {
      const value = reconcileCustom[player.id]?.trim() ?? "";
      if (!value) return [];

      const cents = parseMoney(value);
      if (cents === null || cents === 0) return [];

      return [{ playerId: player.id, amountCents: sign * cents }];
    });
  }

  async function saveReconciliation(night: PokerNight) {
    setError("");

    const totals = nightTotals(night);
    if (totals.differenceCents === 0) {
      setReconcileOpen(false);
      return;
    }

    if (reconcileMode === "selected" && reconcileSelected.length === 0) {
      setError(t("Bitte mindestens eine Person für den Ausgleich auswählen."));
      return;
    }

    if (reconcileMode === "custom") {
      for (const value of Object.values(reconcileCustom)) {
        if (value.trim() && parseMoney(value) === null) {
          setError(t("Bitte gültige Beträge für den Ausgleich eintragen."));
          return;
        }
      }
    }

    const adjustments = plannedAdjustments(night);
    const totalAdjustment = adjustments.reduce((sum, item) => sum + item.amountCents, 0);
    const remaining = totals.differenceCents + totalAdjustment;

    if (
      (totals.differenceCents > 0 && remaining < 0) ||
      (totals.differenceCents < 0 && remaining > 0)
    ) {
      setError(t("Der Ausgleich ist größer als die ursprüngliche Differenz."));
      return;
    }

    setReconcileSaving(true);

    try {
      await updateNightAdjustments(night.id, adjustments);
      await refreshNights();
      setReconcileOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Differenzausgleich konnte nicht gespeichert werden."));
    } finally {
      setReconcileSaving(false);
    }
  }

  async function resetReconciliation(night: PokerNight) {
    if (!window.confirm(t("Gespeicherten Differenzausgleich wirklich zurücksetzen?"))) return;

    setReconcileSaving(true);
    setError("");

    try {
      await updateNightAdjustments(night.id, []);
      await refreshNights();
      setReconcileOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Differenzausgleich konnte nicht zurückgesetzt werden."));
    } finally {
      setReconcileSaving(false);
    }
  }

  function updatePlayer(key: string, patch: Partial<DraftPlayer>) {
    setPlayers((current) =>
      current.map((player) => (player.key === key ? { ...player, ...patch } : player)),
    );
  }

  function buildInput(): NightInput | null {
    const cleanPlayers: NightInput["players"] = [];
    const selectedPlayerIds = new Set<string>();

    for (const player of players) {
      if (!player.playerId && !player.isNew) continue;

      const name = player.name.trim();
      if (!name) {
        setError(player.isNew
          ? t("Bitte den Namen des neuen Spielers eintragen.")
          : t("Bitte einen Spieler auswählen."));
        return null;
      }

      if (player.playerId) {
        if (selectedPlayerIds.has(player.playerId)) {
          setError(t("Ein Spieler kann pro Abend nur einmal vorkommen."));
          return null;
        }
        selectedPlayerIds.add(player.playerId);
      }

      const stakeCents = parseMoney(player.stake);
      const cashOutCents = parseMoney(player.cashOut);

      if (stakeCents === null || cashOutCents === null) {
        setError(t("Bitte für jeden Spieler gültige Beträge eintragen."));
        return null;
      }

      cleanPlayers.push({
        ...(player.playerId ? { playerId: player.playerId } : {}),
        name,
        stakeCents,
        cashOutCents,
      });
    }

    if (cleanPlayers.length < 2) {
      setError(t("Ein Pokerabend braucht mindestens zwei Spieler."));
      return null;
    }

    return {
      title: title.trim() || t("Pokerabend"),
      playedAt,
      players: cleanPlayers,
    };
  }

  async function saveNight(event: FormEvent) {
    event.preventDefault();
    setError("");

    const input = buildInput();
    if (!input) return;

    setSaving(true);

    try {
      if (editingId) {
        await updateNight(editingId, input);
      } else {
        await createNight(input);
      }

      await refreshAfterMutation();
      resetEditor();
      setEditorOpen(false);
      setScreen("home");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Pokerabend konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }

  async function removeNight(night: PokerNight) {
    if (!window.confirm(t("„{title}“ wirklich löschen?").replace("{title}", night.title))) return;

    try {
      await deleteNight(night.id);
      await refreshAfterMutation();
      setDetailNightId(null);
      setScreen("home");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Pokerabend konnte nicht gelöscht werden."));
    }
  }

  function Header() {
    return (
      <header className="app-header">
        <button className="brand-button" type="button" onClick={() => navigate("home")}>
          <span className="brand-suit">♠</span>
          <strong>PokerTracker</strong>
        </button>
      </header>
    );
  }

  function BottomNav() {
    return (
      <nav className="bottom-nav" aria-label={t("Navigation")}>
        <button className={screen === "home" ? "active" : ""} onClick={() => navigate("home")}>
          <span>⌂</span><small>{t("Start")}</small>
        </button>
        <button className={screen === "history" ? "active" : ""} onClick={() => navigate("history")}>
          <span>↺</span><small>{t("Verlauf")}</small>
        </button>
        <button className="nav-create" type="button" onClick={startNew} aria-label={t("Neuer Pokerabend")}>
          <span>+</span>
        </button>
        <button className={screen === "players" ? "active" : ""} onClick={() => navigate("players")}>
          <span>♣</span><small>{t("Spieler")}</small>
        </button>
        <button className={screen === "more" ? "active" : ""} onClick={() => navigate("more")}>
          <span>•••</span><small>{t("Mehr")}</small>
        </button>
      </nav>
    );
  }

  if (editorOpen) {
    return (
      <main className="app-shell">
        <div className="app-frame">
          <header className="page-header">
            <button className="back-button" type="button" onClick={() => setEditorOpen(false)}>←</button>
            <h1>{editingId ? t("Pokerabend bearbeiten") : t("Pokerabend anlegen")}</h1>
          </header>

          <form className="editor-form" onSubmit={saveNight}>
            <section className="form-card">
              <div className="form-card-title"><span>♠</span><h2>{t("Abend")}</h2></div>
              <label>
                {t("Name")}
                <input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                {t("Datum")}
                <div className="date-input-shell">
                  <span aria-hidden="true">
                    {playedAt
                      ? new Date(playedAt + "T12:00:00").toLocaleDateString(getLocale(), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : t("Datum wählen")}
                  </span>
                  <input
                    className="date-input-native"
                    type="date"
                    aria-label={t("Datum")}
                    value={playedAt}
                    onChange={(event) => setPlayedAt(event.target.value)}
                    required
                  />
                </div>
              </label>
            </section>

            <section className="form-card">
              <div className="form-card-title split-title">
                <div><span>♣</span><h2>{t("Spieler")}</h2></div>
                <button className="small-gold-button" type="button" onClick={() => setPlayers((current) => [...current, emptyPlayer()])}>
                  {t("+ Spieler")}
                </button>
              </div>

              <div className="editor-player-list">
                {players.map((player) => {
                  const stake = parseMoney(player.stake);
                  const cashOut = parseMoney(player.cashOut);
                  const result = stake !== null && cashOut !== null ? cashOut - stake : null;

                  return (
                    <div className="editor-player" key={player.key}>
                      <div className="player-identity">
                        <span className="avatar">{initials(player.name || "?")}</span>
                        <select
                          aria-label={t("Spieler auswählen")}
                          value={player.isNew ? "__new__" : player.playerId}
                          onChange={(event) => {
                            const value = event.target.value;

                            if (value === "__new__") {
                              updatePlayer(player.key, {
                                playerId: "",
                                isNew: true,
                                name: "",
                              });
                              return;
                            }

                            const selected = knownPlayers.find((known) => known.id === value);
                            updatePlayer(player.key, {
                              playerId: value,
                              isNew: false,
                              name: selected?.name ?? "",
                            });
                          }}
                        >
                          <option value="">{t("Spieler wählen")}</option>
                          {knownPlayers.map((known) => (
                            <option
                              value={known.id}
                              key={known.id}
                              disabled={players.some(
                                (other) => other.key !== player.key && other.playerId === known.id,
                              )}
                            >
                              {known.name}
                            </option>
                          ))}
                          <option value="__new__">{t("+ Neuer Spieler")}</option>
                        </select>
                        <button
                          className="remove-button"
                          type="button"
                          disabled={players.length <= 2}
                          onClick={() => setPlayers((current) => current.filter((item) => item.key !== player.key))}
                          aria-label={t("Spieler entfernen")}
                        >
                          ×
                        </button>
                      </div>

                      {player.isNew && (
                        <input
                          className="new-player-name"
                          maxLength={50}
                          placeholder={t("Name des neuen Spielers")}
                          value={player.name}
                          onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                          autoFocus
                        />
                      )}

                      <div className="money-row">
                        <label>
                          {t("Einsatz")}
                          <div className="money-input">
                            <input inputMode="decimal" placeholder={language === "en" ? "0.00" : "0,00"} value={player.stake} onChange={(event) => updatePlayer(player.key, { stake: event.target.value })} />
                            <span>€</span>
                          </div>
                        </label>
                        <label>
                          {t("Endbetrag")}
                          <div className="money-input">
                            <input inputMode="decimal" placeholder={language === "en" ? "0.00" : "0,00"} value={player.cashOut} onChange={(event) => updatePlayer(player.key, { cashOut: event.target.value })} />
                            <span>€</span>
                          </div>
                        </label>
                      </div>

                      <div className="inline-result">
                        <span>{t("Ergebnis")}</span>
                        <strong className={result === null ? "" : result >= 0 ? "positive" : "negative"}>
                          {result === null ? "—" : (result > 0 ? "+" : "") + formatMoney(result)}
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={"reconcile-card " + (draftTotals.differenceCents === 0 ? "balanced-card" : "warning-card")}>
              <div><span>{t("Einsatz")}</span><strong>{formatMoney(draftTotals.stakeCents)}</strong></div>
              <div><span>{t("Endbeträge")}</span><strong>{formatMoney(draftTotals.cashOutCents)}</strong></div>
              <b>
                {draftTotals.differenceCents === 0
                  ? t("✓ Bilanz stimmt")
                  : t("Differenz") + " " + formatMoney(draftTotals.differenceCents)}
              </b>
            </section>

            {error && <p className="error-banner">{error}</p>}

            <button className="gold-cta" type="submit" disabled={saving}>
              {saving ? t("Speichert …") : editingId ? t("Änderungen speichern") : t("Pokerabend speichern")}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (detailNight) {
    const totals = nightTotals(detailNight);
    const ranking = [...detailNight.players].sort(
      (a, b) => playerResultCents(b) - playerResultCents(a),
    );
    const planned = reconcileOpen ? plannedAdjustments(detailNight) : [];
    const plannedTotal = planned.reduce((sum, item) => sum + item.amountCents, 0);
    const plannedRemaining = totals.differenceCents + plannedTotal;
    const adjustmentByPlayer = new Map(
      planned.map((adjustment) => [adjustment.playerId, adjustment.amountCents]),
    );

    return (
      <main className="app-shell">
        <div className="app-frame">
          <header className="page-header">
            <button className="back-button" type="button" onClick={() => setDetailNightId(null)}>←</button>
            <div>
              <h1>{detailNight.title}</h1>
              <p>{formatDate(detailNight.playedAt)}</p>
            </div>
          </header>

          <section className="detail-summary">
            <div>
              <span>{t("Spieler")}</span>
              <strong>{detailNight.players.length}</strong>
            </div>
            <div>
              <span>{t("Einsatz")}</span>
              <strong>{formatMoney(totals.stakeCents)}</strong>
            </div>
            <div>
              <span>{t("Endbeträge")}</span>
              <strong>{formatMoney(totals.cashOutCents)}</strong>
            </div>
          </section>

          <section className={
            "detail-balance-card " +
            (totals.remainingDifferenceCents === 0 ? "good" : "bad")
          }>
            <div className="detail-balance-copy">
              <strong>
                {totals.differenceCents === 0
                  ? t("✓ Bilanz stimmt")
                  : totals.remainingDifferenceCents === 0
                    ? t("✓ Differenz ausgeglichen")
                    : t("Offene Differenz") + " " + formatMoney(totals.remainingDifferenceCents)}
              </strong>
              {totals.differenceCents !== 0 && (
                <span>
                  {t("Ursprünglich")} {formatMoney(totals.differenceCents)}
                  {totals.adjustmentCents !== 0
                    ? " · " + t("Ausgleich") + " " + formatMoney(totals.adjustmentCents)
                    : ""}
                </span>
              )}
            </div>

            {totals.differenceCents !== 0 && (
              <button
                className="balance-action"
                type="button"
                onClick={() => reconcileOpen ? setReconcileOpen(false) : openReconciliation(detailNight)}
              >
                {reconcileOpen
                  ? t("Schließen")
                  : totals.adjustmentCents !== 0
                    ? t("Ausgleich bearbeiten")
                    : t("Differenz klären")}
              </button>
            )}
          </section>

          {reconcileOpen && totals.differenceCents !== 0 && (
            <section className="reconcile-editor">
              <div className="reconcile-editor-heading">
                <div>
                  <span>{t("Differenzausgleich")}</span>
                  <strong>
                    {totals.differenceCents > 0
                      ? formatMoney(Math.abs(totals.differenceCents)) + " " + t("müssen abgezogen werden")
                      : formatMoney(Math.abs(totals.differenceCents)) + " " + t("müssen gutgeschrieben werden")}
                  </strong>
                </div>
              </div>

              <div className="reconcile-mode-tabs" role="group" aria-label={t("Art des Ausgleichs")}>
                <button
                  type="button"
                  className={reconcileMode === "all" ? "active" : ""}
                  onClick={() => setReconcileMode("all")}
                >
                  {t("Alle")}
                </button>
                <button
                  type="button"
                  className={reconcileMode === "selected" ? "active" : ""}
                  onClick={() => setReconcileMode("selected")}
                >
                  {t("Auswahl")}
                </button>
                <button
                  type="button"
                  className={reconcileMode === "custom" ? "active" : ""}
                  onClick={() => setReconcileMode("custom")}
                >
                  {t("Individuell")}
                </button>
              </div>

              {reconcileMode === "selected" && (
                <div className="reconcile-player-select">
                  {detailNight.players.map((player) => {
                    const checked = reconcileSelected.includes(player.id);
                    return (
                      <label key={player.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setReconcileSelected((current) =>
                            checked
                              ? current.filter((id) => id !== player.id)
                              : [...current, player.id]
                          )}
                        />
                        <span className="avatar">{initials(player.name)}</span>
                        <strong>{player.name}</strong>
                      </label>
                    );
                  })}
                  <small>{t("Eine Person auswählen = diese Person übernimmt die ganze Differenz.")}</small>
                </div>
              )}

              {reconcileMode === "custom" && (
                <div className="reconcile-custom-list">
                  {detailNight.players.map((player) => (
                    <label key={player.id}>
                      <span>{player.name}</span>
                      <div className="money-input">
                        <input
                          inputMode="decimal"
                          placeholder={language === "en" ? "0.00" : "0,00"}
                          value={reconcileCustom[player.id] ?? ""}
                          onChange={(event) => setReconcileCustom((current) => ({
                            ...current,
                            [player.id]: event.target.value,
                          }))}
                        />
                        <span>€</span>
                      </div>
                    </label>
                  ))}
                  <small>
                    {t("Hier sind auch Teilbeträge möglich. Nicht verteilte Cents bleiben als offene Differenz bestehen.")}
                  </small>
                </div>
              )}

              <div className="reconcile-preview">
                <div className="reconcile-preview-title">
                  <span>{t("Vorschau")}</span>
                  <strong className={plannedRemaining === 0 ? "positive" : ""}>
                    {plannedRemaining === 0
                      ? t("geht exakt auf")
                      : t("noch offen") + " " + formatMoney(plannedRemaining)}
                  </strong>
                </div>

                {planned.length === 0 ? (
                  <p>{t("Noch keine Verteilung ausgewählt.")}</p>
                ) : (
                  <div className="reconcile-preview-list">
                    {detailNight.players
                      .filter((player) => adjustmentByPlayer.has(player.id))
                      .map((player) => {
                        const amount = adjustmentByPlayer.get(player.id) ?? 0;
                        return (
                          <div key={player.id}>
                            <span>{player.name}</span>
                            <strong className={amount >= 0 ? "positive" : "negative"}>
                              {amount > 0 ? "+" : ""}{formatMoney(amount)}
                            </strong>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="reconcile-editor-actions">
                {totals.adjustmentCents !== 0 && (
                  <button
                    className="danger-outline"
                    type="button"
                    disabled={reconcileSaving}
                    onClick={() => resetReconciliation(detailNight)}
                  >
                    {t("Ausgleich zurücksetzen")}
                  </button>
                )}
                <button
                  className="gold-cta"
                  type="button"
                  disabled={reconcileSaving || (reconcileMode === "selected" && reconcileSelected.length === 0)}
                  onClick={() => saveReconciliation(detailNight)}
                >
                  {reconcileSaving ? t("Speichert …") : t("Ausgleich speichern")}
                </button>
              </div>
            </section>
          )}

          <section className="results-card">
            {ranking.map((player, index) => {
              const rawResult = player.cashOutCents - player.stakeCents;
              const result = playerResultCents(player);

              return (
                <div className="result-row" key={player.id}>
                  <span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span>
                  <span className="avatar">{initials(player.name)}</span>
                  <div className="result-name">
                    <strong>{player.name}</strong>
                    <span>{formatMoney(player.stakeCents)} → {formatMoney(player.cashOutCents)}</span>
                    {(player.adjustmentCents ?? 0) !== 0 && (
                      <span className="result-adjustment">
                        {t("Vorher")} {rawResult > 0 ? "+" : ""}{formatMoney(rawResult)}
                        {" · "}{t("Ausgleich")} {player.adjustmentCents > 0 ? "+" : ""}{formatMoney(player.adjustmentCents)}
                      </span>
                    )}
                  </div>
                  <b className={result >= 0 ? "positive" : "negative"}>
                    {result > 0 ? "+" : ""}{formatMoney(result)}
                  </b>
                </div>
              );
            })}
          </section>

          <div className="detail-actions">
            <button className="secondary-button" type="button" onClick={() => editNight(detailNight)}>
              {t("Bearbeiten")}
            </button>
            <button className="danger-outline" type="button" onClick={() => removeNight(detailNight)}>
              {t("Löschen")}
            </button>
          </div>

          {error && <p className="error-banner">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <Header />

        {screen === "home" && (
          <>
            <section className="hero-ledger">
              <span>{t("Einsätze gesamt")}</span>
              <strong>{formatMoney(totalStakeAllTime)}</strong>
              <small>{nights.length} {t("Pokerabende")}</small>
            </section>

            <section className="quick-stats">
              <div><strong>{nights.length}</strong><span>{t("Abende")}</span></div>
              <div><strong>{stats.length}</strong><span>{t("Spieler")}</span></div>
              <div><strong>{stats[0]?.name ?? "—"}</strong><span>{t("Führung")}</span></div>
            </section>

            <button className="gold-cta" type="button" onClick={startNew}>
              <span className="cta-plus" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              {t("Neuer Pokerabend")}
            </button>

            <section className="screen-section">
              <div className="section-title-row">
                <h2>{t("Letzte Abende")}</h2>
                <span>{nights.length} {t("gesamt")}</span>
              </div>

              {loading ? (
                <div className="empty-card">{t("Lädt …")}</div>
              ) : nights.length === 0 ? (
                <div className="empty-card">
                  <strong>{t("Noch kein Pokerabend")}</strong>
                  <p>{t("Nach dem ersten Abend erscheint hier die Übersicht.")}</p>
                </div>
              ) : (
                <div className="compact-night-list">
                  {nights.map((night) => {
                    const totals = nightTotals(night);
                    const leader = [...night.players].sort(
                      (a, b) => playerResultCents(b) - playerResultCents(a),
                    )[0];
                    const leaderResult = leader ? playerResultCents(leader) : 0;

                    return (
                      <button className="compact-night-card" type="button" key={night.id} onClick={() => openNight(night)}>
                        <div className="date-tile">
                          <span>{new Date(night.playedAt + "T12:00:00").toLocaleDateString(getLocale(), { month: "short" })}</span>
                          <strong>{new Date(night.playedAt + "T12:00:00").getDate()}</strong>
                        </div>
                        <div className="compact-night-copy">
                          <strong>{night.title}</strong>
                          <span>{night.players.length} {t("Spieler")} · {formatMoney(totals.stakeCents)}</span>
                        </div>
                        <div className="compact-night-result">
                          {leader && <strong className={leaderResult >= 0 ? "positive" : "negative"}>
                            {leaderResult > 0 ? "+" : ""}{formatMoney(leaderResult)}
                          </strong>}
                          <span>{leader?.name ?? ""}</span>
                        </div>
                        <span className="chevron">›</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {screen === "history" && (
          <>
            <div className="screen-heading">
              <h1>{t("Verlauf")}</h1>
              <p>{t("Änderungen an gespeicherten Pokerabenden.")}</p>
            </div>

            {history.length === 0 && !historyLoading ? (
              <div className="empty-card">
                <strong>{t("Noch keine Änderungen")}</strong>
                <p>{t("Neue und bearbeitete Pokerabende erscheinen hier.")}</p>
              </div>
            ) : (
              <div className="history-list">
                {history.map((event) => (
                  <article className="history-item" key={event.id}>
                    <span className={"history-icon " + event.eventType.replace(".", "-")}>
                      {eventIcon(event)}
                    </span>
                    <div className="history-content">
                      <div className="history-topline">
                        <strong>{eventLabel(event)}</strong>
                        <time>{formatDateTime(event.createdAt)}</time>
                      </div>
                      <h2>{event.title}</h2>
                      <p>{event.playerCount} {t("Spieler")} · {formatMoney(event.totalStakeCents)} {t("Einsatz")}</p>

                      {event.changes.length > 0 && (
                        <div className="history-changes">
                          {event.changes.slice(0, 5).map((change, index) => (
                            <span key={index}>{changeText(change)}</span>
                          ))}
                          {event.changes.length > 5 && (
                            <span>+ {event.changes.length - 5} {t("weitere Änderungen")}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {historyLoading && <div className="loading-line">{t("Lädt …")}</div>}

            {historyMeta.hasMore && !historyLoading && (
              <button className="secondary-button history-more" type="button" onClick={() => refreshHistory(false)}>
                {t("Weitere laden")}
              </button>
            )}
          </>
        )}

        {screen === "players" && (
          <>
            {stats.length === 0 ? (
              <div className="empty-card">{t("Noch keine Spieler gespeichert.")}</div>
            ) : (
              <>
                <section className="leaderboard-podium" aria-label="Top 3">
                  {[
                    { rank: 2, player: stats[1] },
                    { rank: 1, player: stats[0] },
                    { rank: 3, player: stats[2] },
                  ].map(({ rank, player }) => (
                    <div className={"podium-slot podium-rank-" + rank} key={rank}>
                      {player ? (
                        <>
                          <div className={"framed-avatar podium-avatar frame-rank-" + rank}>
                            <span className="framed-avatar-core">{initials(player.name)}</span>
                            <img src={leaderboardFrame(rank)} alt="" aria-hidden="true" />
                          </div>
                          <strong className="podium-player-name">{player.name}</strong>
                          <b className={"podium-profit " + (player.profitCents >= 0 ? "positive" : "negative")}>
                            {player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}
                          </b>
                          <span className="podium-meta">{player.nights} {t(player.nights === 1 ? "Abend" : "Abende")}</span>
                          <div className="podium-base" aria-hidden="true">
                            <span>{rank}</span>
                          </div>
                        </>
                      ) : (
                        <div className="podium-empty" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </section>

                <div className="section-title-row leaderboard-list-title">
                  <h2>{t("Rangliste")}</h2>
                  <span>{t("Gesamtbilanz")}</span>
                </div>

                <section className="leaderboard-list">
                  {stats.map((player, index) => {
                    const rank = index + 1;
                    const width = Math.max(3, Math.round((Math.abs(player.profitCents) / maxAbsProfit) * 100));

                    return (
                      <article className="leaderboard-row" key={player.id}>
                        <span className={"leaderboard-rank leaderboard-place-" + rank}>{rank}</span>
                        <div className={"framed-avatar leaderboard-mini-avatar " + (rank <= 3 ? "frame-rank-" + rank : "frame-neutral")}>
                          <span className="framed-avatar-core">{initials(player.name)}</span>
                          <img src={leaderboardFrame(rank)} alt="" aria-hidden="true" />
                        </div>
                        <div className="leaderboard-copy">
                          <strong>{player.name}</strong>
                          <span>{player.nights} {t(player.nights === 1 ? "Abend" : "Abende")} · {formatMoney(player.stakeCents)} {t("Einsatz")}</span>
                          <span className="leaderboard-bar" aria-hidden="true">
                            <span
                              className={"leaderboard-bar-fill " + (player.profitCents >= 0 ? "is-positive" : "is-negative")}
                              style={{ width: width + "%" }}
                            />
                          </span>
                        </div>
                        <b className={"leaderboard-balance " + (player.profitCents >= 0 ? "positive" : "negative")}>
                          {player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}
                        </b>
                      </article>
                    );
                  })}
                </section>
              </>
            )}
          </>
        )}

        {screen === "more" && (
          <>
            <div className="screen-heading">
              <h1>{t("Mehr")}</h1>
              <p>{t("Einstellungen für eure Runde.")}</p>
            </div>

            <section className="settings-card language-settings-card">
              <div className="form-card-title"><span>🌐</span><h2>{t("Sprache")}</h2></div>
              <p className="settings-description">{t("Anzeigesprache")}</p>
              <div className="language-picker" role="group" aria-label={t("Sprache")}>
                <button
                  type="button"
                  className={language === "de" ? "active" : ""}
                  aria-pressed={language === "de"}
                  onClick={() => changeLanguage("de")}
                >
                  <strong>Deutsch</strong>
                  <small>DE</small>
                </button>
                <button
                  type="button"
                  className={language === "en" ? "active" : ""}
                  aria-pressed={language === "en"}
                  onClick={() => changeLanguage("en")}
                >
                  <strong>English</strong>
                  <small>EN</small>
                </button>
              </div>
              <small className="settings-note">{t("Die Auswahl wird auf diesem Gerät gespeichert.")}</small>
            </section>

            <section className="settings-card">
              <div className="form-card-title"><span>♦</span><h2>{t("Abmelden")}</h2></div>
              <form action="/api/logout" method="post">
                <button className="danger-outline" type="submit">{t("Abmelden")}</button>
              </form>
            </section>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
