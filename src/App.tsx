import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  changeSharedPassword,
  createNight,
  deleteNight,
  loadHistory,
  loadNights,
  updateNight,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { SILVER_WREATH } from "./leaderboardFrames";
import type {
  AuditChange,
  AuditEvent,
  HistoryResponse,
  NightInput,
  PokerNight,
} from "./types";

type Screen = "home" | "history" | "players" | "more";

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
  if (rank === 1) return "/assets/leaderboard-frame-gold-v2.webp";
  if (rank === 2) return SILVER_WREATH;
  if (rank === 3) return "/assets/leaderboard-frame-bronze.webp";
  return "/assets/leaderboard-frame-neutral.webp";
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nightTotals(night: PokerNight) {
  const stakeCents = night.players.reduce((sum, player) => sum + player.stakeCents, 0);
  const cashOutCents = night.players.reduce((sum, player) => sum + player.cashOutCents, 0);

  return {
    stakeCents,
    cashOutCents,
    differenceCents: cashOutCents - stakeCents,
  };
}

function eventLabel(event: AuditEvent) {
  switch (event.eventType) {
    case "night.created":
      return "Pokerabend erstellt";
    case "night.updated":
      return "Pokerabend geändert";
    case "night.deleted":
      return "Pokerabend gelöscht";
    case "night.baseline":
      return "Ausgangsstand erfasst";
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
    const label = change.field === "title" ? "Name" : "Datum";
    const before = change.field === "date" ? formatDate(change.before) : change.before;
    const after = change.field === "date" ? formatDate(change.after) : change.after;
    return `${label}: ${before} → ${after}`;
  }

  if (change.type === "player_added") {
    return `${change.player} hinzugefügt`;
  }

  if (change.type === "player_removed") {
    return `${change.player} entfernt`;
  }

  const field = change.field === "stake" ? "Einsatz" : "Endbetrag";
  return `${change.player} · ${field} ${formatMoney(change.beforeCents)} → ${formatMoney(change.afterCents)}`;
}

export default function App() {
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
  const [title, setTitle] = useState("Pokerabend");
  const [playedAt, setPlayedAt] = useState(today);
  const [players, setPlayers] = useState<DraftPlayer[]>([emptyPlayer(), emptyPlayer()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
    Promise.all([
      refreshNights(),
      refreshHistory(true),
    ])
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Daten konnten nicht geladen werden.");
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

        const profit = player.cashOutCents - player.stakeCents;
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

  function navigate(next: Screen) {
    setScreen(next);
    setEditorOpen(false);
    setDetailNightId(null);
    setError("");
    setPasswordMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEditor() {
    setTitle("Pokerabend");
    setPlayedAt(today());
    setPlayers([emptyPlayer(), emptyPlayer()]);
    setEditingId(null);
    setError("");
  }

  function startNew() {
    resetEditor();
    setDetailNightId(null);
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openNight(night: PokerNight) {
    setDetailNightId(night.id);
    setEditorOpen(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editNight(night: PokerNight) {
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
          ? "Bitte den Namen des neuen Spielers eintragen."
          : "Bitte einen Spieler auswählen.");
        return null;
      }

      if (player.playerId) {
        if (selectedPlayerIds.has(player.playerId)) {
          setError("Ein Spieler kann pro Abend nur einmal vorkommen.");
          return null;
        }
        selectedPlayerIds.add(player.playerId);
      }

      const stakeCents = parseMoney(player.stake);
      const cashOutCents = parseMoney(player.cashOut);

      if (stakeCents === null || cashOutCents === null) {
        setError("Bitte für jeden Spieler gültige Beträge eintragen.");
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
      setError("Ein Pokerabend braucht mindestens zwei Spieler.");
      return null;
    }

    return {
      title: title.trim() || "Pokerabend",
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
      setError(err instanceof Error ? err.message : "Pokerabend konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function removeNight(night: PokerNight) {
    if (!window.confirm(`„${night.title}“ wirklich löschen?`)) return;

    try {
      await deleteNight(night.id);
      await refreshAfterMutation();
      setDetailNightId(null);
      setScreen("home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pokerabend konnte nicht gelöscht werden.");
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPasswordMessage("");

    if (newPassword !== confirmPassword) {
      setError("Die neuen Passwörter stimmen nicht überein.");
      return;
    }

    try {
      await changeSharedPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Passwort geändert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passwort konnte nicht geändert werden.");
    }
  }

  function Header() {
    return (
      <header className="app-header">
        <button className="brand-button" type="button" onClick={() => navigate("home")}>
          <span className="brand-suit">♠</span>
          <strong>PokerTracker</strong>
        </button>
        <button className="round-button" type="button" onClick={() => navigate("more")} aria-label="Einstellungen">
          ⚙
        </button>
      </header>
    );
  }

  function BottomNav() {
    return (
      <nav className="bottom-nav" aria-label="Navigation">
        <button className={screen === "home" ? "active" : ""} onClick={() => navigate("home")}>
          <span>⌂</span><small>Start</small>
        </button>
        <button className={screen === "history" ? "active" : ""} onClick={() => navigate("history")}>
          <span>↺</span><small>Verlauf</small>
        </button>
        <button className="nav-create" type="button" onClick={startNew} aria-label="Neuer Pokerabend">
          <span>+</span>
        </button>
        <button className={screen === "players" ? "active" : ""} onClick={() => navigate("players")}>
          <span>♣</span><small>Spieler</small>
        </button>
        <button className={screen === "more" ? "active" : ""} onClick={() => navigate("more")}>
          <span>•••</span><small>Mehr</small>
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
            <h1>{editingId ? "Pokerabend bearbeiten" : "Pokerabend anlegen"}</h1>
          </header>

          <form className="editor-form" onSubmit={saveNight}>
            <section className="form-card">
              <div className="form-card-title"><span>♠</span><h2>Abend</h2></div>
              <label>
                Name
                <input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                Datum
                <input type="date" value={playedAt} onChange={(event) => setPlayedAt(event.target.value)} required />
              </label>
            </section>

            <section className="form-card">
              <div className="form-card-title split-title">
                <div><span>♣</span><h2>Spieler</h2></div>
                <button className="small-gold-button" type="button" onClick={() => setPlayers((current) => [...current, emptyPlayer()])}>
                  + Spieler
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
                          aria-label="Spieler auswählen"
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
                          <option value="">Spieler wählen</option>
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
                          <option value="__new__">+ Neuer Spieler</option>
                        </select>
                        <button
                          className="remove-button"
                          type="button"
                          disabled={players.length <= 2}
                          onClick={() => setPlayers((current) => current.filter((item) => item.key !== player.key))}
                          aria-label="Spieler entfernen"
                        >
                          ×
                        </button>
                      </div>

                      {player.isNew && (
                        <input
                          className="new-player-name"
                          maxLength={50}
                          placeholder="Name des neuen Spielers"
                          value={player.name}
                          onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                          autoFocus
                        />
                      )}

                      <div className="money-row">
                        <label>
                          Einsatz
                          <div className="money-input">
                            <input inputMode="decimal" placeholder="0,00" value={player.stake} onChange={(event) => updatePlayer(player.key, { stake: event.target.value })} />
                            <span>€</span>
                          </div>
                        </label>
                        <label>
                          Endbetrag
                          <div className="money-input">
                            <input inputMode="decimal" placeholder="0,00" value={player.cashOut} onChange={(event) => updatePlayer(player.key, { cashOut: event.target.value })} />
                            <span>€</span>
                          </div>
                        </label>
                      </div>

                      <div className="inline-result">
                        <span>Ergebnis</span>
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
              <div><span>Einsatz</span><strong>{formatMoney(draftTotals.stakeCents)}</strong></div>
              <div><span>Endbeträge</span><strong>{formatMoney(draftTotals.cashOutCents)}</strong></div>
              <b>
                {draftTotals.differenceCents === 0
                  ? "✓ Bilanz stimmt"
                  : "Differenz " + formatMoney(draftTotals.differenceCents)}
              </b>
            </section>

            {error && <p className="error-banner">{error}</p>}

            <button className="gold-cta" type="submit" disabled={saving}>
              {saving ? "Speichert …" : editingId ? "Änderungen speichern" : "Pokerabend speichern"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (detailNight) {
    const totals = nightTotals(detailNight);
    const ranking = [...detailNight.players].sort(
      (a, b) => (b.cashOutCents - b.stakeCents) - (a.cashOutCents - a.stakeCents),
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
              <span>Spieler</span>
              <strong>{detailNight.players.length}</strong>
            </div>
            <div>
              <span>Einsatz</span>
              <strong>{formatMoney(totals.stakeCents)}</strong>
            </div>
            <div>
              <span>Endbeträge</span>
              <strong>{formatMoney(totals.cashOutCents)}</strong>
            </div>
          </section>

          <div className={totals.differenceCents === 0 ? "detail-balance good" : "detail-balance bad"}>
            {totals.differenceCents === 0
              ? "✓ Bilanz stimmt"
              : "Differenz " + formatMoney(totals.differenceCents)}
          </div>

          <section className="results-card">
            {ranking.map((player, index) => {
              const result = player.cashOutCents - player.stakeCents;

              return (
                <div className="result-row" key={player.id}>
                  <span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span>
                  <span className="avatar">{initials(player.name)}</span>
                  <div className="result-name">
                    <strong>{player.name}</strong>
                    <span>{formatMoney(player.stakeCents)} → {formatMoney(player.cashOutCents)}</span>
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
              Bearbeiten
            </button>
            <button className="danger-outline" type="button" onClick={() => removeNight(detailNight)}>
              Löschen
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
              <span>Einsätze gesamt</span>
              <strong>{formatMoney(totalStakeAllTime)}</strong>
              <small>{nights.length} Pokerabende</small>
            </section>

            <section className="quick-stats">
              <div><strong>{nights.length}</strong><span>Abende</span></div>
              <div><strong>{stats.length}</strong><span>Spieler</span></div>
              <div><strong>{stats[0]?.name ?? "—"}</strong><span>Führung</span></div>
            </section>

            <button className="gold-cta" type="button" onClick={startNew}>
              <span className="cta-plus">+</span> Neuer Pokerabend
            </button>

            <section className="screen-section">
              <div className="section-title-row">
                <h2>Letzte Abende</h2>
                <span>{nights.length} gesamt</span>
              </div>

              {loading ? (
                <div className="empty-card">Lädt …</div>
              ) : nights.length === 0 ? (
                <div className="empty-card">
                  <strong>Noch kein Pokerabend</strong>
                  <p>Nach dem ersten Abend erscheint hier die Übersicht.</p>
                </div>
              ) : (
                <div className="compact-night-list">
                  {nights.slice(0, 6).map((night) => {
                    const totals = nightTotals(night);
                    const leader = [...night.players].sort(
                      (a, b) => (b.cashOutCents - b.stakeCents) - (a.cashOutCents - a.stakeCents),
                    )[0];
                    const leaderResult = leader ? leader.cashOutCents - leader.stakeCents : 0;

                    return (
                      <button className="compact-night-card" type="button" key={night.id} onClick={() => openNight(night)}>
                        <div className="date-tile">
                          <span>{new Date(night.playedAt + "T12:00:00").toLocaleDateString("de-DE", { month: "short" })}</span>
                          <strong>{new Date(night.playedAt + "T12:00:00").getDate()}</strong>
                        </div>
                        <div className="compact-night-copy">
                          <strong>{night.title}</strong>
                          <span>{night.players.length} Spieler · {formatMoney(totals.stakeCents)}</span>
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
              <h1>Verlauf</h1>
              <p>Änderungen an gespeicherten Pokerabenden.</p>
            </div>

            {history.length === 0 && !historyLoading ? (
              <div className="empty-card">
                <strong>Noch keine Änderungen</strong>
                <p>Neue und bearbeitete Pokerabende erscheinen hier.</p>
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
                      <p>{event.playerCount} Spieler · {formatMoney(event.totalStakeCents)} Einsatz</p>

                      {event.changes.length > 0 && (
                        <div className="history-changes">
                          {event.changes.slice(0, 5).map((change, index) => (
                            <span key={index}>{changeText(change)}</span>
                          ))}
                          {event.changes.length > 5 && (
                            <span>+ {event.changes.length - 5} weitere Änderungen</span>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {historyLoading && <div className="loading-line">Lädt …</div>}

            {historyMeta.hasMore && !historyLoading && (
              <button className="secondary-button history-more" type="button" onClick={() => refreshHistory(false)}>
                Weitere laden
              </button>
            )}
          </>
        )}

        {screen === "players" && (
          <>
            {stats.length === 0 ? (
              <div className="empty-card">Noch keine Spieler gespeichert.</div>
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
                          <span className="podium-meta">{player.nights} {player.nights === 1 ? "Abend" : "Abende"}</span>
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
                  <h2>Rangliste</h2>
                  <span>Gesamtbilanz</span>
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
                          <span>{player.nights} {player.nights === 1 ? "Abend" : "Abende"} · {formatMoney(player.stakeCents)} Einsatz</span>
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
              <h1>Mehr</h1>
              <p>Einstellungen für eure Runde.</p>
            </div>

            <section className="settings-card">
              <div className="form-card-title"><span>♠</span><h2>Passwort ändern</h2></div>
              <p>Mindestens 12 Zeichen.</p>
              <form onSubmit={submitPassword}>
                <label>
                  Aktuelles Passwort
                  <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
                </label>
                <label>
                  Neues Passwort
                  <input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
                </label>
                <label>
                  Wiederholen
                  <input type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                </label>
                {error && <p className="error-banner">{error}</p>}
                {passwordMessage && <p className="success-banner">{passwordMessage}</p>}
                <button className="secondary-button" type="submit">Passwort ändern</button>
              </form>
            </section>

            <section className="settings-card">
              <div className="form-card-title"><span>♦</span><h2>Abmelden</h2></div>
              <form action="/api/logout" method="post">
                <button className="danger-outline" type="submit">Abmelden</button>
              </form>
            </section>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
