import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatMoney, parseMoney } from "./lib/money";
import { EMPTY_STATE, loadState, makeId, saveState } from "./lib/storage";
import type { PlayerResult, PokerNight, PokerTrackerState } from "./types";

type DraftPlayer = {
  id: string;
  name: string;
  stake: string;
  cashOut: string;
};

function emptyPlayer(): DraftPlayer {
  return { id: makeId(), name: "", stake: "", cashOut: "" };
}

export default function App() {
  const [state, setState] = useState<PokerTrackerState>(() => loadState());
  const [title, setTitle] = useState("Pokerabend");
  const [playedAt, setPlayedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [players, setPlayers] = useState<DraftPlayer[]>([emptyPlayer(), emptyPlayer()]);
  const [error, setError] = useState("");

  useEffect(() => {
    saveState(state);
  }, [state]);

  const history = useMemo(
    () => [...state.nights].sort((a, b) => b.playedAt.localeCompare(a.playedAt)),
    [state.nights],
  );

  function updatePlayer(id: string, patch: Partial<DraftPlayer>) {
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...patch } : player)),
    );
  }

  function saveNight(event: FormEvent) {
    event.preventDefault();
    setError("");

    const cleanPlayers: PlayerResult[] = [];

    for (const player of players) {
      const name = player.name.trim();
      if (!name) continue;

      const stakeCents = parseMoney(player.stake);
      const cashOutCents = parseMoney(player.cashOut);

      if (stakeCents === null || cashOutCents === null) {
        setError("Bitte für jeden Spieler gültige Beträge eintragen.");
        return;
      }

      cleanPlayers.push({
        id: makeId(),
        name,
        stakeCents,
        cashOutCents,
      });
    }

    if (cleanPlayers.length < 2) {
      setError("Ein Pokerabend braucht mindestens zwei Spieler.");
      return;
    }

    const night: PokerNight = {
      id: makeId(),
      title: title.trim() || "Pokerabend",
      playedAt,
      createdAt: new Date().toISOString(),
      players: cleanPlayers,
    };

    setState((current) => ({
      ...current,
      nights: [night, ...current.nights],
    }));

    setTitle("Pokerabend");
    setPlayedAt(new Date().toISOString().slice(0, 10));
    setPlayers([emptyPlayer(), emptyPlayer()]);
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Private poker nights</p>
        <h1>PokerTracker</h1>
        <p className="subtitle">
          Einen Abend eintragen. Einsatz und Auszahlung festhalten. Ergebnis automatisch sehen.
        </p>
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Neue Session</p>
            <h2>Pokerabend eintragen</h2>
          </div>
        </div>

        <form onSubmit={saveNight}>
          <div className="session-grid">
            <label>
              Name
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Datum
              <input
                type="date"
                value={playedAt}
                onChange={(event) => setPlayedAt(event.target.value)}
              />
            </label>
          </div>

          <div className="player-list">
            {players.map((player, index) => (
              <div className="player-card" key={player.id}>
                <div className="player-number">{index + 1}</div>
                <label className="player-name">
                  Spieler
                  <input
                    placeholder="Name"
                    value={player.name}
                    onChange={(event) => updatePlayer(player.id, { name: event.target.value })}
                  />
                </label>
                <label>
                  Einsatz
                  <div className="money-input">
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={player.stake}
                      onChange={(event) => updatePlayer(player.id, { stake: event.target.value })}
                    />
                    <span>€</span>
                  </div>
                </label>
                <label>
                  Rausgegangen mit
                  <div className="money-input">
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={player.cashOut}
                      onChange={(event) => updatePlayer(player.id, { cashOut: event.target.value })}
                    />
                    <span>€</span>
                  </div>
                </label>
                {players.length > 2 && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Spieler entfernen"
                    onClick={() =>
                      setPlayers((current) => current.filter((item) => item.id !== player.id))
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setPlayers((current) => [...current, emptyPlayer()])}
            >
              + Spieler
            </button>
            <button className="primary" type="submit">
              Abend speichern
            </button>
          </div>

          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="history">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Historie</p>
            <h2>Gespeicherte Abende</h2>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="empty-state">Noch kein Pokerabend gespeichert.</div>
        ) : (
          <div className="night-list">
            {history.map((night) => {
              const totalStake = night.players.reduce((sum, player) => sum + player.stakeCents, 0);
              const totalCashOut = night.players.reduce(
                (sum, player) => sum + player.cashOutCents,
                0,
              );
              const difference = totalCashOut - totalStake;

              return (
                <article className="night-card" key={night.id}>
                  <div className="night-header">
                    <div>
                      <h3>{night.title}</h3>
                      <p>{new Date(night.playedAt + "T12:00:00").toLocaleDateString("de-DE")}</p>
                    </div>
                    <span className={difference === 0 ? "balanced" : "unbalanced"}>
                      {difference === 0 ? "Bilanz stimmt" : "Differenz " + formatMoney(difference)}
                    </span>
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
                            {result >= 0 ? "+" : ""}
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
    </main>
  );
}
