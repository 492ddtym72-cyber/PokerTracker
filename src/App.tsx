import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  changeSharedPassword,
  createNight,
  deleteNight,
  loadNights,
  updateNight,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import type { NightInput, PokerNight } from "./types";

type View = "home" | "editor" | "detail" | "stats" | "players" | "more";

type DraftPlayer = {
  key: string;
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

function emptyPlayer(name = ""): DraftPlayer {
  return {
    key: crypto.randomUUID(),
    name,
    stake: "",
    cashOut: "",
  };
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

function playerResult(stakeCents: number, cashOutCents: number) {
  return cashOutCents - stakeCents;
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

export default function App() {
  const [view, setView] = useState<View>("home");
  const [nights, setNights] = useState<PokerNight[]>([]);
  const [selectedNightId, setSelectedNightId] = useState<string | null>(null);
  const [title, setTitle] = useState("Pokerabend");
  const [playedAt, setPlayedAt] = useState(today);
  const [players, setPlayers] = useState<DraftPlayer[]>([emptyPlayer(), emptyPlayer()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function refresh() {
    const data = await loadNights();
    setNights(data);
    return data;
  }

  useEffect(() => {
    refresh()
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

        const profit = playerResult(player.stakeCents, player.cashOutCents);
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

  const knownNames = useMemo(
    () => Array.from(new Set(stats.map((player) => player.name))).sort((a, b) => a.localeCompare(b)),
    [stats],
  );

  const totalStakeAllTime = useMemo(
    () =>
      nights.reduce(
        (nightSum, night) =>
          nightSum + night.players.reduce((sum, player) => sum + player.stakeCents, 0),
        0,
      ),
    [nights],
  );

  const selectedNight = useMemo(
    () => nights.find((night) => night.id === selectedNightId) ?? null,
    [nights, selectedNightId],
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

  function navigate(next: View) {
    setError("");
    setPasswordMessage("");
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEditor() {
    setTitle("Pokerabend");
    setPlayedAt(today());
    setPlayers([emptyPlayer(), emptyPlayer()]);
    setEditingId(null);
    setError("");
  }

  function startNewNight() {
    resetEditor();
    navigate("editor");
  }

  function openDetail(id: string) {
    setSelectedNightId(id);
    navigate("detail");
  }

  function editNight(night: PokerNight) {
    setEditingId(night.id);
    setTitle(night.title);
    setPlayedAt(night.playedAt);
    setPlayers(
      night.players.map((player) => ({
        key: crypto.randomUUID(),
        name: player.name,
        stake: moneyInput(player.stakeCents),
        cashOut: moneyInput(player.cashOutCents),
      })),
    );
    navigate("editor");
  }

  function updatePlayer(key: string, patch: Partial<DraftPlayer>) {
    setPlayers((current) =>
      current.map((player) => (player.key === key ? { ...player, ...patch } : player)),
    );
  }

  function buildInput(): NightInput | null {
    const cleanPlayers = [];

    for (const player of players) {
      const name = player.name.trim();
      if (!name) continue;

      const stakeCents = parseMoney(player.stake);
      const cashOutCents = parseMoney(player.cashOut);

      if (stakeCents === null || cashOutCents === null) {
        setError("Bitte für jeden Spieler gültige Beträge eintragen.");
        return null;
      }

      cleanPlayers.push({ name, stakeCents, cashOutCents });
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
      const result = editingId
        ? await updateNight(editingId, input)
        : await createNight(input);

      await refresh();
      setSelectedNightId(result.id);
      resetEditor();
      navigate("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pokerabend konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function removeNight(night: PokerNight) {
    if (!window.confirm("„" + night.title + "“ wirklich löschen?")) return;

    try {
      await deleteNight(night.id);
      await refresh();
      setSelectedNightId(null);
      resetEditor();
      navigate("home");
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
      setPasswordMessage("Gemeinsames Passwort wurde geändert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passwort konnte nicht geändert werden.");
    }
  }

  function BottomNav() {
    return (
      <nav className="bottom-nav" aria-label="Hauptnavigation">
        <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}>
          <span className="nav-icon">⌂</span>
          <small>Home</small>
        </button>
        <button className={view === "stats" ? "active" : ""} onClick={() => navigate("stats")}>
          <span className="nav-icon">▥</span>
          <small>Stats</small>
        </button>
        <button className="nav-create" onClick={startNewNight} aria-label="Neuen Pokerabend anlegen">
          <span>+</span>
        </button>
        <button className={view === "players" ? "active" : ""} onClick={() => navigate("players")}>
          <span className="nav-icon">♣</span>
          <small>Spieler</small>
        </button>
        <button className={view === "more" ? "active" : ""} onClick={() => navigate("more")}>
          <span className="nav-icon">•••</span>
          <small>Mehr</small>
        </button>
      </nav>
    );
  }

  function BrandHeader() {
    return (
      <header className="app-header">
        <button className="brand-button" type="button" onClick={() => navigate("home")}>
          <span className="brand-suit">♠</span>
          <span>
            <strong>PokerTracker</strong>
            <small>Good games. Better friends.</small>
          </span>
        </button>
        <button className="round-button" type="button" onClick={() => navigate("more")} aria-label="Einstellungen">
          ⚙
        </button>
      </header>
    );
  }

  function PageHeader({ title: pageTitle, eyebrow }: { title: string; eyebrow?: string }) {
    return (
      <header className="page-header">
        <button className="back-button" type="button" onClick={() => navigate("home")} aria-label="Zurück">
          ←
        </button>
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{pageTitle}</h1>
        </div>
      </header>
    );
  }

  function HomeView() {
    const leader = stats[0];

    return (
      <>
        <BrandHeader />

        <section className="hero-ledger">
          <div className="hero-ledger-copy">
            <span>Getrackte Einsätze</span>
            <strong>{formatMoney(totalStakeAllTime)}</strong>
            <small>über alle gespeicherten Pokerabende</small>
          </div>
          <div className="suit-watermark" aria-hidden="true">♠</div>
        </section>

        <section className="quick-stats">
          <div>
            <strong>{nights.length}</strong>
            <span>Abende</span>
          </div>
          <div>
            <strong>{stats.length}</strong>
            <span>Spieler</span>
          </div>
          <div>
            <strong>{leader ? leader.name : "—"}</strong>
            <span>Gesamtführung</span>
          </div>
        </section>

        <button className="gold-cta" type="button" onClick={startNewNight}>
          <span className="cta-plus">+</span>
          Neuer Pokerabend
        </button>

        <section className="screen-section">
          <div className="section-title-row">
            <h2>Letzte Abende</h2>
            {nights.length > 4 && (
              <button className="link-button" type="button" onClick={() => navigate("stats")}>
                Alle ansehen
              </button>
            )}
          </div>

          {loading ? (
            <div className="empty-card">Lädt …</div>
          ) : nights.length === 0 ? (
            <div className="empty-card">
              <span className="empty-suit">♣</span>
              <strong>Noch kein Pokerabend</strong>
              <p>Nach eurem nächsten Abend dauert der Eintrag nur ein bis zwei Minuten.</p>
            </div>
          ) : (
            <div className="session-stack">
              {nights.slice(0, 4).map((night) => {
                const totals = nightTotals(night);
                const sorted = [...night.players].sort(
                  (a, b) =>
                    playerResult(b.stakeCents, b.cashOutCents) -
                    playerResult(a.stakeCents, a.cashOutCents),
                );
                const topResult = sorted[0]
                  ? playerResult(sorted[0].stakeCents, sorted[0].cashOutCents)
                  : 0;

                return (
                  <button className="session-card" type="button" key={night.id} onClick={() => openDetail(night.id)}>
                    <div className="date-tile">
                      <span>{new Date(night.playedAt + "T12:00:00").toLocaleDateString("de-DE", { month: "short" })}</span>
                      <strong>{new Date(night.playedAt + "T12:00:00").getDate()}</strong>
                    </div>
                    <div className="session-copy">
                      <strong>{night.title}</strong>
                      <span>{night.players.length} Spieler · {formatMoney(totals.stakeCents)} Einsatz</span>
                    </div>
                    <div className="session-result">
                      <strong className={topResult >= 0 ? "positive" : "negative"}>
                        {topResult > 0 ? "+" : ""}{formatMoney(topResult)}
                      </strong>
                      <span>Top-Ergebnis</span>
                    </div>
                    <span className="chevron">›</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {stats.length > 0 && (
          <section className="screen-section">
            <div className="section-title-row">
              <h2>Gesamtstand</h2>
              <button className="link-button" type="button" onClick={() => navigate("stats")}>
                Details
              </button>
            </div>
            <div className="podium-preview">
              {stats.slice(0, 3).map((player, index) => (
                <div className="podium-row" key={player.id}>
                  <span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span>
                  <span className="avatar">{initials(player.name)}</span>
                  <strong>{player.name}</strong>
                  <b className={player.profitCents >= 0 ? "positive" : "negative"}>
                    {player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}
                  </b>
                </div>
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  function EditorView() {
    return (
      <>
        <PageHeader title={editingId ? "Pokerabend bearbeiten" : "Neuer Pokerabend"} eyebrow={editingId ? "Korrektur" : "Session"} />

        <form className="editor-form" onSubmit={saveNight}>
          <section className="form-card">
            <div className="form-card-title">
              <span className="gold-icon">♠</span>
              <h2>Basisdaten</h2>
            </div>
            <label>
              Name des Abends
              <input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Datum
              <input type="date" value={playedAt} onChange={(event) => setPlayedAt(event.target.value)} required />
            </label>
          </section>

          <section className="form-card">
            <div className="form-card-title split-title">
              <div>
                <span className="gold-icon">♣</span>
                <h2>Spieler</h2>
              </div>
              <button className="small-gold-button" type="button" onClick={() => setPlayers((current) => [...current, emptyPlayer()])}>
                + Spieler
              </button>
            </div>

            <datalist id="known-players">
              {knownNames.map((name) => <option value={name} key={name} />)}
            </datalist>

            <div className="editor-player-list">
              {players.map((player) => {
                const stake = parseMoney(player.stake);
                const cashOut = parseMoney(player.cashOut);
                const result = stake !== null && cashOut !== null ? cashOut - stake : null;

                return (
                  <div className="editor-player" key={player.key}>
                    <div className="player-identity">
                      <span className="avatar">{initials(player.name || "?")}</span>
                      <input
                        list="known-players"
                        maxLength={50}
                        placeholder="Spielername"
                        value={player.name}
                        onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                      />
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

                    <div className="money-row">
                      <label>
                        Gesamteinsatz
                        <div className="money-input">
                          <input
                            inputMode="decimal"
                            placeholder="0,00"
                            value={player.stake}
                            onChange={(event) => updatePlayer(player.key, { stake: event.target.value })}
                          />
                          <span>€</span>
                        </div>
                      </label>
                      <label>
                        Endbetrag
                        <div className="money-input">
                          <input
                            inputMode="decimal"
                            placeholder="0,00"
                            value={player.cashOut}
                            onChange={(event) => updatePlayer(player.key, { cashOut: event.target.value })}
                          />
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
            <div>
              <span>Gesamteinsatz</span>
              <strong>{formatMoney(draftTotals.stakeCents)}</strong>
            </div>
            <div>
              <span>Endbeträge</span>
              <strong>{formatMoney(draftTotals.cashOutCents)}</strong>
            </div>
            <div className="reconcile-status">
              {draftTotals.differenceCents === 0
                ? "✓ Bilanz stimmt"
                : "Differenz " + formatMoney(draftTotals.differenceCents)}
            </div>
          </section>

          {error && <p className="error-banner">{error}</p>}

          <button className="gold-cta editor-submit" type="submit" disabled={saving}>
            {saving ? "Speichert …" : editingId ? "Änderungen speichern" : "Pokerabend speichern"}
          </button>
        </form>
      </>
    );
  }

  function DetailView() {
    if (!selectedNight) {
      return (
        <>
          <PageHeader title="Pokerabend" />
          <div className="empty-card">Dieser Pokerabend ist nicht verfügbar.</div>
        </>
      );
    }

    const totals = nightTotals(selectedNight);
    const ranking = [...selectedNight.players].sort(
      (a, b) =>
        playerResult(b.stakeCents, b.cashOutCents) -
        playerResult(a.stakeCents, a.cashOutCents),
    );
    const winner = ranking[0];
    const winnerResult = winner ? playerResult(winner.stakeCents, winner.cashOutCents) : 0;

    return (
      <>
        <PageHeader title={selectedNight.title} eyebrow={formatDate(selectedNight.playedAt)} />

        <section className="winner-card">
          <div className="winner-decoration" aria-hidden="true">♠</div>
          <span className="trophy">♛</span>
          <small>Bestes Ergebnis des Abends</small>
          <strong>{winner?.name ?? "—"}</strong>
          <b className={winnerResult >= 0 ? "positive" : "negative"}>
            {winnerResult > 0 ? "+" : ""}{formatMoney(winnerResult)}
          </b>
        </section>

        <section className="screen-section">
          <div className="section-title-row">
            <h2>Ergebnisse</h2>
            <span className={totals.differenceCents === 0 ? "balance-pill good" : "balance-pill bad"}>
              {totals.differenceCents === 0 ? "Bilanz stimmt" : "Differenz " + formatMoney(totals.differenceCents)}
            </span>
          </div>

          <div className="results-card">
            <div className="results-head">
              <span>#</span>
              <span>Spieler</span>
              <span>Einsatz</span>
              <span>Ende</span>
              <span>+/−</span>
            </div>
            {ranking.map((player, index) => {
              const result = playerResult(player.stakeCents, player.cashOutCents);
              return (
                <div className="results-line" key={player.id}>
                  <span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span>
                  <span className="result-player"><span className="avatar">{initials(player.name)}</span>{player.name}</span>
                  <span>{formatMoney(player.stakeCents)}</span>
                  <span>{formatMoney(player.cashOutCents)}</span>
                  <strong className={result >= 0 ? "positive" : "negative"}>
                    {result > 0 ? "+" : ""}{formatMoney(result)}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="total-cards">
          <div>
            <span className="coin-icon">◉</span>
            <small>Gesamteinsätze</small>
            <strong>{formatMoney(totals.stakeCents)}</strong>
          </div>
          <div>
            <span className="coin-icon silver">◉</span>
            <small>Endbeträge</small>
            <strong>{formatMoney(totals.cashOutCents)}</strong>
          </div>
        </section>

        <div className="detail-actions">
          <button className="secondary-button" type="button" onClick={() => editNight(selectedNight)}>Bearbeiten</button>
          <button className="danger-outline" type="button" onClick={() => removeNight(selectedNight)}>Löschen</button>
        </div>

        {error && <p className="error-banner">{error}</p>}
      </>
    );
  }

  function StatsView() {
    return (
      <>
        <BrandHeader />
        <div className="screen-heading">
          <p className="eyebrow">Gesamtstand</p>
          <h1>Statistik</h1>
          <p>Alle Ergebnisse werden direkt aus euren gespeicherten Pokerabenden berechnet.</p>
        </div>

        {stats.length === 0 ? (
          <div className="empty-card">Noch keine Statistik vorhanden.</div>
        ) : (
          <div className="leaderboard-card">
            <div className="leaderboard-head">
              <span>Spieler</span><span>Abende</span><span>Einsatz</span><span>Bilanz</span>
            </div>
            {stats.map((player, index) => (
              <div className="leaderboard-row" key={player.id}>
                <div className="leader-player">
                  <span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span>
                  <span className="avatar">{initials(player.name)}</span>
                  <strong>{player.name}</strong>
                </div>
                <span>{player.nights}</span>
                <span>{formatMoney(player.stakeCents)}</span>
                <b className={player.profitCents >= 0 ? "positive" : "negative"}>
                  {player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}
                </b>
              </div>
            ))}
          </div>
        )}

        <section className="screen-section">
          <div className="section-title-row"><h2>Alle Pokerabende</h2><span>{nights.length}</span></div>
          <div className="session-stack">
            {nights.map((night) => (
              <button className="session-card compact" type="button" key={night.id} onClick={() => openDetail(night.id)}>
                <div className="date-tile">
                  <span>{new Date(night.playedAt + "T12:00:00").toLocaleDateString("de-DE", { month: "short" })}</span>
                  <strong>{new Date(night.playedAt + "T12:00:00").getDate()}</strong>
                </div>
                <div className="session-copy"><strong>{night.title}</strong><span>{night.players.length} Spieler</span></div>
                <span className="chevron">›</span>
              </button>
            ))}
          </div>
        </section>
      </>
    );
  }

  function PlayersView() {
    return (
      <>
        <BrandHeader />
        <div className="screen-heading">
          <p className="eyebrow">Eure Runde</p>
          <h1>Spieler</h1>
          <p>Spieler entstehen automatisch, sobald sie an einem gespeicherten Abend teilnehmen.</p>
        </div>

        {stats.length === 0 ? (
          <div className="empty-card">Noch keine Spieler gespeichert.</div>
        ) : (
          <div className="player-profile-grid">
            {stats.map((player) => (
              <article className="player-profile" key={player.id}>
                <span className="avatar large">{initials(player.name)}</span>
                <div className="player-profile-main">
                  <strong>{player.name}</strong>
                  <span>{player.nights} Abende · {player.wins} positive Abende</span>
                </div>
                <b className={player.profitCents >= 0 ? "positive" : "negative"}>
                  {player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}
                </b>
                <div className="player-mini-stats">
                  <span>Einsatz <strong>{formatMoney(player.stakeCents)}</strong></span>
                  <span>Ausgezahlt <strong>{formatMoney(player.cashOutCents)}</strong></span>
                </div>
              </article>
            ))}
          </div>
        )}
      </>
    );
  }

  function MoreView() {
    return (
      <>
        <BrandHeader />
        <div className="screen-heading">
          <p className="eyebrow">Private Table</p>
          <h1>Mehr</h1>
          <p>Zugang und Einstellungen für eure gemeinsame Pokerrunde.</p>
        </div>

        <section className="settings-card">
          <div className="form-card-title"><span className="gold-icon">♠</span><h2>Gemeinsames Passwort</h2></div>
          <p>Ein Passwort für alle. Nach einer Änderung bleiben nur neue Sessions gültig.</p>
          <form onSubmit={submitPassword}>
            <label>Aktuelles Passwort<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label>Neues Passwort<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <label>Neues Passwort wiederholen<input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            {error && <p className="error-banner">{error}</p>}
            {passwordMessage && <p className="success-banner">{passwordMessage}</p>}
            <button className="secondary-button wide" type="submit">Passwort ändern</button>
          </form>
        </section>

        <section className="settings-card">
          <div className="form-card-title"><span className="gold-icon">♦</span><h2>Session</h2></div>
          <p>Du kannst dich auf diesem Gerät abmelden. Die gespeicherten Pokerabende bleiben in der gemeinsamen Datenbank.</p>
          <form action="/api/logout" method="post">
            <button className="danger-outline wide" type="submit">Abmelden</button>
          </form>
        </section>
      </>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        {view === "home" && <HomeView />}
        {view === "editor" && <EditorView />}
        {view === "detail" && <DetailView />}
        {view === "stats" && <StatsView />}
        {view === "players" && <PlayersView />}
        {view === "more" && <MoreView />}
      </div>

      {view !== "editor" && <BottomNav />}
    </main>
  );
}
