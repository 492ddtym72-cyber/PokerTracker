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

type Screen = "home" | "stats" | "players" | "more";

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
  return { key: crypto.randomUUID(), name, stake: "", cashOut: "" };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function nightTotals(night: PokerNight) {
  const stakeCents = night.players.reduce((sum, player) => sum + player.stakeCents, 0);
  const cashOutCents = night.players.reduce((sum, player) => sum + player.cashOutCents, 0);
  return { stakeCents, cashOutCents, differenceCents: cashOutCents - stakeCents };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [editorOpen, setEditorOpen] = useState(false);
  const [nights, setNights] = useState<PokerNight[]>([]);
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
      (a, b) => b.profitCents - a.profitCents || b.nights - a.nights || a.name.localeCompare(b.name),
    );
  }, [nights]);

  const knownNames = useMemo(
    () => Array.from(new Set(stats.map((player) => player.name))).sort((a, b) => a.localeCompare(b)),
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

  const draftTotals = useMemo(() => {
    let stakeCents = 0;
    let cashOutCents = 0;

    for (const player of players) {
      stakeCents += parseMoney(player.stake) ?? 0;
      cashOutCents += parseMoney(player.cashOut) ?? 0;
    }

    return { stakeCents, cashOutCents, differenceCents: cashOutCents - stakeCents };
  }, [players]);

  function navigate(next: Screen) {
    setScreen(next);
    setEditorOpen(false);
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
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editNight(night: PokerNight) {
    setEditingId(night.id);
    setTitle(night.title);
    setPlayedAt(night.playedAt);
    setPlayers(night.players.map((player) => ({
      key: crypto.randomUUID(),
      name: player.name,
      stake: moneyInput(player.stakeCents),
      cashOut: moneyInput(player.cashOutCents),
    })));
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

    return { title: title.trim() || "Pokerabend", playedAt, players: cleanPlayers };
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

      await refresh();
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
    if (!window.confirm("„" + night.title + "“ wirklich löschen?")) return;

    try {
      await deleteNight(night.id);
      await refresh();
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

  function Header() {
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

  function BottomNav() {
    return (
      <nav className="bottom-nav">
        <button className={screen === "home" ? "active" : ""} onClick={() => navigate("home")}>
          <span>⌂</span><small>Home</small>
        </button>
        <button className={screen === "stats" ? "active" : ""} onClick={() => navigate("stats")}>
          <span>▥</span><small>Stats</small>
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
            <div>
              <p className="eyebrow">{editingId ? "Korrektur" : "Neue Session"}</p>
              <h1>{editingId ? "Pokerabend bearbeiten" : "Pokerabend anlegen"}</h1>
            </div>
          </header>

          <form className="editor-form" onSubmit={saveNight}>
            <section className="form-card">
              <div className="form-card-title"><span>♠</span><h2>Basisdaten</h2></div>
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
                <div><span>♣</span><h2>Spieler</h2></div>
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
                        >
                          ×
                        </button>
                      </div>
                      <div className="money-row">
                        <label>
                          Gesamteinsatz
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

  return (
    <main className="app-shell">
      <div className="app-frame">
        <Header />

        {screen === "home" && (
          <>
            <section className="hero-ledger">
              <span>Getrackte Einsätze</span>
              <strong>{formatMoney(totalStakeAllTime)}</strong>
              <small>über alle gespeicherten Pokerabende</small>
              <i>♠</i>
            </section>

            <section className="quick-stats">
              <div><strong>{nights.length}</strong><span>Abende</span></div>
              <div><strong>{stats.length}</strong><span>Spieler</span></div>
              <div><strong>{stats[0]?.name ?? "—"}</strong><span>Gesamtführung</span></div>
            </section>

            <button className="gold-cta" type="button" onClick={startNew}>
              <span className="cta-plus">+</span> Neuer Pokerabend
            </button>

            <section className="screen-section">
              <div className="section-title-row"><h2>Letzte Abende</h2><span>{nights.length} gesamt</span></div>

              {loading ? (
                <div className="empty-card">Lädt …</div>
              ) : nights.length === 0 ? (
                <div className="empty-card"><b>♣</b><strong>Noch kein Pokerabend</strong><p>Nach dem ersten Abend erscheint hier eure Historie.</p></div>
              ) : (
                <div className="night-list">
                  {nights.slice(0, 5).map((night) => {
                    const totals = nightTotals(night);
                    const ranking = [...night.players].sort(
                      (a, b) => (b.cashOutCents - b.stakeCents) - (a.cashOutCents - a.stakeCents),
                    );

                    return (
                      <article className="night-card" key={night.id}>
                        <div className="night-heading">
                          <div className="date-tile"><span>{new Date(night.playedAt + "T12:00:00").toLocaleDateString("de-DE", { month: "short" })}</span><strong>{new Date(night.playedAt + "T12:00:00").getDate()}</strong></div>
                          <div><h3>{night.title}</h3><p>{night.players.length} Spieler · {formatMoney(totals.stakeCents)} Einsatz</p></div>
                          <span className={totals.differenceCents === 0 ? "balance-pill good" : "balance-pill bad"}>
                            {totals.differenceCents === 0 ? "✓" : formatMoney(totals.differenceCents)}
                          </span>
                        </div>
                        <div className="night-results">
                          {ranking.map((player, index) => {
                            const result = player.cashOutCents - player.stakeCents;
                            return (
                              <div className="night-result-row" key={player.id}>
                                <span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span>
                                <span className="avatar">{initials(player.name)}</span>
                                <strong>{player.name}</strong>
                                <span>{formatMoney(player.stakeCents)} → {formatMoney(player.cashOutCents)}</span>
                                <b className={result >= 0 ? "positive" : "negative"}>{result > 0 ? "+" : ""}{formatMoney(result)}</b>
                              </div>
                            );
                          })}
                        </div>
                        <div className="night-actions">
                          <button type="button" onClick={() => editNight(night)}>Bearbeiten</button>
                          <button className="danger-link" type="button" onClick={() => removeNight(night)}>Löschen</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {screen === "stats" && (
          <>
            <div className="screen-heading"><p className="eyebrow">Gesamtstand</p><h1>Statistik</h1><p>Direkt aus allen gespeicherten Pokerabenden berechnet.</p></div>
            {stats.length === 0 ? (
              <div className="empty-card">Noch keine Statistik vorhanden.</div>
            ) : (
              <div className="stats-card">
                <div className="stats-head"><span>Spieler</span><span>Abende</span><span>Einsatz</span><span>Bilanz</span></div>
                {stats.map((player, index) => (
                  <div className="stats-row" key={player.id}>
                    <div><span className={"rank-badge rank-" + (index + 1)}>{index + 1}</span><span className="avatar">{initials(player.name)}</span><strong>{player.name}</strong></div>
                    <span>{player.nights}</span>
                    <span>{formatMoney(player.stakeCents)}</span>
                    <b className={player.profitCents >= 0 ? "positive" : "negative"}>{player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {screen === "players" && (
          <>
            <div className="screen-heading"><p className="eyebrow">Eure Runde</p><h1>Spieler</h1><p>Spieler werden automatisch aus euren Pokerabenden aufgebaut.</p></div>
            <div className="player-grid">
              {stats.map((player) => (
                <article className="player-profile" key={player.id}>
                  <span className="avatar large">{initials(player.name)}</span>
                  <div><strong>{player.name}</strong><span>{player.nights} Abende · {player.wins} positiv</span></div>
                  <b className={player.profitCents >= 0 ? "positive" : "negative"}>{player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}</b>
                  <footer><span>Einsatz <strong>{formatMoney(player.stakeCents)}</strong></span><span>Ausgezahlt <strong>{formatMoney(player.cashOutCents)}</strong></span></footer>
                </article>
              ))}
            </div>
          </>
        )}

        {screen === "more" && (
          <>
            <div className="screen-heading"><p className="eyebrow">Private Table</p><h1>Mehr</h1><p>Zugang und Einstellungen für eure Pokerrunde.</p></div>

            <section className="settings-card">
              <div className="form-card-title"><span>♠</span><h2>Gemeinsames Passwort</h2></div>
              <p>Das Passwort wird nur als gesalzener Hash in der privaten Datenbank gespeichert.</p>
              <form onSubmit={submitPassword}>
                <label>Aktuelles Passwort<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                <label>Neues Passwort<input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                <label>Neues Passwort wiederholen<input type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
                {error && <p className="error-banner">{error}</p>}
                {passwordMessage && <p className="success-banner">{passwordMessage}</p>}
                <button className="secondary-button" type="submit">Passwort ändern</button>
              </form>
            </section>

            <section className="settings-card">
              <div className="form-card-title"><span>♦</span><h2>Session</h2></div>
              <p>Die gemeinsamen Pokerabende bleiben beim Abmelden gespeichert.</p>
              <form action="/api/logout" method="post"><button className="danger-outline" type="submit">Abmelden</button></form>
            </section>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
