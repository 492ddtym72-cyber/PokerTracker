import { FormEvent, useEffect, useMemo, useState } from "react";
import { createNight, deleteNight, loadNights, updateNight } from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import type { NightInput, PokerNight } from "./types";

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

function nightDifference(night: PokerNight) {
  const stake = night.players.reduce((sum, player) => sum + player.stakeCents, 0);
  const cashOut = night.players.reduce((sum, player) => sum + player.cashOutCents, 0);
  return cashOut - stake;
}

export default function App() {
  const [nights, setNights] = useState<PokerNight[]>([]);
  const [title, setTitle] = useState("Pokerabend");
  const [playedAt, setPlayedAt] = useState(today);
  const [players, setPlayers] = useState<DraftPlayer[]>([emptyPlayer(), emptyPlayer()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    () =>
      nights.reduce(
        (nightSum, night) =>
          nightSum + night.players.reduce((playerSum, player) => playerSum + player.stakeCents, 0),
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

    return {
      stakeCents,
      cashOutCents,
      differenceCents: cashOutCents - stakeCents,
    };
  }, [players]);

  function resetForm() {
    setTitle("Pokerabend");
    setPlayedAt(today());
    setPlayers([emptyPlayer(), emptyPlayer()]);
    setEditingId(null);
    setError("");
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

  async function save(event: FormEvent) {
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
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pokerabend konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  function edit(night: PokerNight) {
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
    setError("");
    document.getElementById("night-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function remove(night: PokerNight) {
    if (!window.confirm(`„${night.title}“ wirklich löschen?`)) return;

    try {
      await deleteNight(night.id);
      if (editingId === night.id) resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pokerabend konnte nicht gelöscht werden.");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span>♠</span>
          </div>
          <div>
            <strong>PokerTracker</strong>
            <small>Private table ledger</small>
          </div>
        </div>

        <form action="/api/logout" method="post">
          <button className="text-button" type="submit">Abmelden</button>
        </form>
      </header>

      <section className="hero">
        <p className="eyebrow">Nach dem letzten Blatt</p>
        <h1>Der Abend zählt.</h1>
        <p className="subtitle">
          Gesamteinsatz und Endbetrag eintragen. PokerTracker speichert die Abende eurer Runde
          und berechnet automatisch Gewinn, Verlust und Gesamtstand.
        </p>

        <div className="summary-strip">
          <div>
            <span>Abende</span>
            <strong>{nights.length}</strong>
          </div>
          <div>
            <span>Spieler</span>
            <strong>{stats.length}</strong>
          </div>
          <div>
            <span>Gesamte Einsätze</span>
            <strong>{formatMoney(totalStakeAllTime)}</strong>
          </div>
        </div>
      </section>

      <section className="panel entry-panel" id="night-form">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{editingId ? "Korrektur" : "Neuer Eintrag"}</p>
            <h2>{editingId ? "Pokerabend bearbeiten" : "Pokerabend eintragen"}</h2>
          </div>
          {editingId && (
            <button className="text-button" type="button" onClick={resetForm}>
              Abbrechen
            </button>
          )}
        </div>

        <form onSubmit={save}>
          <div className="session-grid">
            <label>
              Bezeichnung
              <input
                maxLength={80}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Datum
              <input
                type="date"
                value={playedAt}
                onChange={(event) => setPlayedAt(event.target.value)}
                required
              />
            </label>
          </div>

          <div className="player-table-head" aria-hidden="true">
            <span>Spieler</span>
            <span>Gesamteinsatz</span>
            <span>Endbetrag</span>
            <span>Ergebnis</span>
            <span />
          </div>

          <div className="player-list">
            {players.map((player) => {
              const stake = parseMoney(player.stake);
              const cashOut = parseMoney(player.cashOut);
              const result = stake !== null && cashOut !== null ? cashOut - stake : null;

              return (
                <div className="player-card" key={player.key}>
                  <label className="player-name">
                    <span className="mobile-label">Spieler</span>
                    <input
                      list="known-players"
                      maxLength={50}
                      placeholder="Name"
                      value={player.name}
                      onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                    />
                  </label>

                  <label>
                    <span className="mobile-label">Gesamteinsatz</span>
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
                    <span className="mobile-label">Endbetrag</span>
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

                  <div
                    className={
                      "live-result " +
                      (result === null ? "" : result >= 0 ? "positive" : "negative")
                    }
                  >
                    {result === null ? "—" : (result > 0 ? "+" : "") + formatMoney(result)}
                  </div>

                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Spieler entfernen"
                    disabled={players.length <= 2}
                    onClick={() =>
                      setPlayers((current) => current.filter((item) => item.key !== player.key))
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <datalist id="known-players">
            {knownNames.map((name) => (
              <option value={name} key={name} />
            ))}
          </datalist>

          <div className="form-footer">
            <button
              className="secondary"
              type="button"
              onClick={() => setPlayers((current) => [...current, emptyPlayer()])}
            >
              + Spieler
            </button>

            <div
              className={
                "balance-box " +
                (draftTotals.differenceCents === 0 ? "balance-ok" : "balance-warning")
              }
            >
              <span>
                Einsatz <b>{formatMoney(draftTotals.stakeCents)}</b>
              </span>
              <span>
                Endbetrag <b>{formatMoney(draftTotals.cashOutCents)}</b>
              </span>
              <strong>
                {draftTotals.differenceCents === 0
                  ? "Bilanz stimmt"
                  : "Differenz " + formatMoney(draftTotals.differenceCents)}
              </strong>
            </div>

            <button className="primary" type="submit" disabled={saving}>
              {saving ? "Speichert …" : editingId ? "Änderungen speichern" : "Abend speichern"}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Gesamtstand</p>
            <h2>Spielerstatistik</h2>
          </div>
          <span className="section-note">Aus allen gespeicherten Abenden</span>
        </div>

        {loading ? (
          <div className="empty-state">Lädt …</div>
        ) : stats.length === 0 ? (
          <div className="empty-state">Nach dem ersten Abend erscheint hier euer Gesamtstand.</div>
        ) : (
          <div className="stats-table">
            <div className="stats-head">
              <span>Spieler</span>
              <span>Abende</span>
              <span>Einsatz</span>
              <span>Ausgezahlt</span>
              <span>Bilanz</span>
            </div>

            {stats.map((player, index) => (
              <div className="stats-row" key={player.id}>
                <div className="rank-name">
                  <span className="rank">{index + 1}</span>
                  <strong>{player.name}</strong>
                </div>
                <span>{player.nights}</span>
                <span>{formatMoney(player.stakeCents)}</span>
                <span>{formatMoney(player.cashOutCents)}</span>
                <b className={player.profitCents >= 0 ? "positive" : "negative"}>
                  {player.profitCents > 0 ? "+" : ""}
                  {formatMoney(player.profitCents)}
                </b>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Archiv</p>
            <h2>Pokerabende</h2>
          </div>
          <span className="section-note">{nights.length} gespeichert</span>
        </div>

        {loading ? (
          <div className="empty-state">Lädt …</div>
        ) : nights.length === 0 ? (
          <div className="empty-state">Noch kein Pokerabend gespeichert.</div>
        ) : (
          <div className="night-list">
            {nights.map((night) => {
              const difference = nightDifference(night);
              const totalStake = night.players.reduce(
                (sum, player) => sum + player.stakeCents,
                0,
              );

              return (
                <article className="night-card" key={night.id}>
                  <div className="night-header">
                    <div>
                      <h3>{night.title}</h3>
                      <p>
                        {new Date(night.playedAt + "T12:00:00").toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                        {" · "}
                        {night.players.length} Spieler
                        {" · "}
                        {formatMoney(totalStake)} Einsatz
                      </p>
                    </div>

                    <div className="night-actions">
                      <span className={difference === 0 ? "balanced" : "unbalanced"}>
                        {difference === 0 ? "Bilanz stimmt" : "Differenz " + formatMoney(difference)}
                      </span>
                      <button className="text-button" type="button" onClick={() => edit(night)}>
                        Bearbeiten
                      </button>
                      <button className="danger-button" type="button" onClick={() => remove(night)}>
                        Löschen
                      </button>
                    </div>
                  </div>

                  <div className="results">
                    {night.players.map((player) => {
                      const result = player.cashOutCents - player.stakeCents;

                      return (
                        <div className="result-row" key={player.id}>
                          <strong>{player.name}</strong>
                          <span>{formatMoney(player.stakeCents)} Einsatz</span>
                          <span>{formatMoney(player.cashOutCents)} Ende</span>
                          <b className={result >= 0 ? "positive" : "negative"}>
                            {result > 0 ? "+" : ""}
                            {formatMoney(result)}
                          </b>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer>
        <span>♣</span>
        <p>Nur der Abend. Keine Hände, keine Ablenkung.</p>
        <span>♦</span>
      </footer>
    </main>
  );
}
