import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createSettlementPayment,
  loadSettlements,
  preparePayPalPayment,
  voidSettlementPayment,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { getLocale, t } from "./i18n";
import type {
  SettlementPaymentInput,
  SettlementResponse,
  SettlementSuggestion,
} from "./types";

const PAYPAL_MARK_URL =
  "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg";
const PAYPAL_RETURN_NOTICE_KEY = "pokertracker-paypal-return-notice";

type SettlementView = "list" | "flow";

type PaymentDraft = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: string;
  paidAt: string;
  note: string;
  clientToken: string;
};

type PayPalFallback = {
  amountCents: number;
  paypalUrl: string;
  toPlayerName: string;
};

function localToday() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatPaymentDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString(getLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function personLabel(id: string, name: string, currentPlayerId: string | null) {
  return id === currentPlayerId ? t("Du") : name;
}

function clipboardAmount(cents: number) {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(cents / 100);
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  } catch {
    return false;
  }
}

function emptyDraft(): PaymentDraft {
  return {
    fromPlayerId: "",
    toPlayerId: "",
    amount: "",
    paidAt: localToday(),
    note: "",
    clientToken: crypto.randomUUID(),
  };
}

function suggestionDraft(suggestion: SettlementSuggestion): PaymentDraft {
  return {
    fromPlayerId: suggestion.fromPlayerId,
    toPlayerId: suggestion.toPlayerId,
    amount: (suggestion.amountCents / 100).toFixed(2).replace(".", ","),
    paidAt: localToday(),
    note: "",
    clientToken: crypto.randomUUID(),
  };
}

function SettlementFlow({
  suggestions,
  currentPlayerId,
  onSelect,
}: {
  suggestions: SettlementSuggestion[];
  currentPlayerId: string | null;
  onSelect: (suggestion: SettlementSuggestion) => void;
}) {
  const payers = Array.from(
    new Map(
      suggestions.map((item) => [
        item.fromPlayerId,
        { id: item.fromPlayerId, name: item.fromPlayerName },
      ]),
    ).values(),
  ).sort((a, b) =>
    Number(b.id === currentPlayerId) - Number(a.id === currentPlayerId) ||
    a.name.localeCompare(b.name, getLocale())
  );

  const receivers = Array.from(
    new Map(
      suggestions.map((item) => [
        item.toPlayerId,
        { id: item.toPlayerId, name: item.toPlayerName },
      ]),
    ).values(),
  ).sort((a, b) =>
    Number(b.id === currentPlayerId) - Number(a.id === currentPlayerId) ||
    a.name.localeCompare(b.name, getLocale())
  );

  const rowHeight = 92;
  const height = Math.max(220, Math.max(payers.length, receivers.length) * rowHeight + 54);
  const maxAmount = Math.max(1, ...suggestions.map((item) => item.amountCents));
  const payerY = new Map(
    payers.map((player, index) => [player.id, 58 + index * rowHeight]),
  );
  const receiverY = new Map(
    receivers.map((player, index) => [player.id, 58 + index * rowHeight]),
  );

  return (
    <div className="settlement-flow-card">
      <div className="settlement-flow-headings" aria-hidden="true">
        <span>{t("Zahlt")}</span>
        <span>{t("Erhält")}</span>
      </div>

      <svg
        className="settlement-network"
        viewBox={`0 0 680 ${height}`}
        role="img"
        aria-label={t("Visuelle Übersicht der empfohlenen Zahlungen")}
      >
        {suggestions.map((suggestion, index) => {
          const fromY = payerY.get(suggestion.fromPlayerId) ?? 58;
          const toY = receiverY.get(suggestion.toPlayerId) ?? 58;
          const strokeWidth = 2.5 + (suggestion.amountCents / maxAmount) * 5.5;
          const labelY = (fromY + toY) / 2 - 7;
          const path = `M 148 ${fromY} C 270 ${fromY}, 410 ${toY}, 532 ${toY}`;

          return (
            <g
              key={suggestion.fromPlayerId + ":" + suggestion.toPlayerId + ":" + index}
              className="settlement-network-transfer"
              onClick={() => onSelect(suggestion)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(suggestion);
                }
              }}
            >
              <path
                d={path}
                className="settlement-network-line"
                style={{ strokeWidth }}
              />
              <path d={path} className="settlement-network-hitarea" />
              <text x="340" y={labelY} textAnchor="middle" className="settlement-network-amount">
                {formatMoney(suggestion.amountCents)}
              </text>
            </g>
          );
        })}

        {payers.map((player) => {
          const y = payerY.get(player.id) ?? 58;
          const isMe = player.id === currentPlayerId;
          return (
            <g key={player.id} className={isMe ? "settlement-network-node is-me" : "settlement-network-node"}>
              <circle cx="92" cy={y} r="30" className="settlement-network-node-circle payer" />
              <text x="92" y={y + 5} textAnchor="middle" className="settlement-network-initials">
                {initials(player.name)}
              </text>
              <text x="92" y={y + 45} textAnchor="middle" className="settlement-network-name">
                {personLabel(player.id, player.name, currentPlayerId)}
              </text>
            </g>
          );
        })}

        {receivers.map((player) => {
          const y = receiverY.get(player.id) ?? 58;
          const isMe = player.id === currentPlayerId;
          return (
            <g key={player.id} className={isMe ? "settlement-network-node is-me" : "settlement-network-node"}>
              <circle cx="588" cy={y} r="30" className="settlement-network-node-circle receiver" />
              <text x="588" y={y + 5} textAnchor="middle" className="settlement-network-initials">
                {initials(player.name)}
              </text>
              <text x="588" y={y + 45} textAnchor="middle" className="settlement-network-name">
                {personLabel(player.id, player.name, currentPlayerId)}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="settlement-flow-note">
        {t("Die Pfeile zeigen optimierte Ausgleichszahlungen, nicht direkte Schulden aus einzelnen Pokerabenden.")}
      </p>
    </div>
  );
}

export function SettlementSummary({ onOpen }: { onOpen: () => void }) {
  const [data, setData] = useState<SettlementResponse | null>(null);

  useEffect(() => {
    let active = true;

    const reload = () => {
      loadSettlements()
        .then((response) => {
          if (active) setData(response);
        })
        .catch(() => {
          // Keep the rest of the app usable if this optional summary cannot load.
        });
    };

    reload();

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") reload();
    };

    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("pageshow", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, []);

  if (!data) return null;

  const balanced = data.totalOutstandingCents === 0 && data.groupDifferenceCents === 0;

  return (
    <button className="settlement-summary-card" type="button" onClick={onOpen}>
      <span className="settlement-summary-icon" aria-hidden="true">↔</span>
      <span className="settlement-summary-copy">
        <strong>{t("Ausgleichen")}</strong>
        <small>
          {balanced
            ? t("Alles ausgeglichen")
            : t("Noch auszugleichen") + " " + formatMoney(data.totalOutstandingCents)}
        </small>
        {data.groupDifferenceCents !== 0 && (
          <em>
            {t("Offene Session-Differenz")}: {formatMoney(data.groupDifferenceCents)}
          </em>
        )}
      </span>
      <span className="chevron">›</span>
    </button>
  );
}

export function SettlementScreen({
  onClose,
  currentPlayerId,
  onCurrentPlayerChange,
}: {
  onClose: () => void;
  currentPlayerId: string | null;
  onCurrentPlayerChange: (playerId: string | null) => void;
}) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [view, setView] = useState<SettlementView>(() =>
    window.localStorage.getItem("pokertracker-settlement-view") === "flow" ? "flow" : "list"
  );
  const [paypalOpeningKey, setPaypalOpeningKey] = useState<string | null>(null);
  const [paypalFallback, setPaypalFallback] = useState<PayPalFallback | null>(null);
  const [paypalNotice, setPaypalNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await loadSettlements();
    setData(response);
    return response;
  }

  useEffect(() => {
    let active = true;

    const reload = (showError: boolean) =>
      loadSettlements()
        .then((response) => {
          if (active) setData(response);
        })
        .catch((err: unknown) => {
          if (active && showError) {
            setError(
              err instanceof Error
                ? err.message
                : t("Ausgleichsdaten konnten nicht geladen werden."),
            );
          }
        });

    reload(true).finally(() => {
      if (active) setLoading(false);
    });

    const returnNotice = window.sessionStorage.getItem(PAYPAL_RETURN_NOTICE_KEY);
    if (returnNotice) {
      window.sessionStorage.removeItem(PAYPAL_RETURN_NOTICE_KEY);
      setPaypalNotice(returnNotice);
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void reload(false);
    };

    const intervalId = window.setInterval(refreshIfVisible, 15_000);
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("pageshow", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, []);

  useEffect(() => {
    if (!paypalNotice) return;
    const timeout = window.setTimeout(() => setPaypalNotice(""), 6500);
    return () => window.clearTimeout(timeout);
  }, [paypalNotice]);

  const debtors = useMemo(
    () => data?.players
      .filter((player) => player.openBalanceCents < 0)
      .sort((a, b) => a.openBalanceCents - b.openBalanceCents || a.name.localeCompare(b.name)) ?? [],
    [data],
  );

  const creditors = useMemo(
    () => data?.players
      .filter((player) => player.openBalanceCents > 0)
      .sort((a, b) => b.openBalanceCents - a.openBalanceCents || a.name.localeCompare(b.name)) ?? [],
    [data],
  );

  const currentPlayer = useMemo(
    () => data?.players.find((player) => player.id === currentPlayerId) ?? null,
    [data, currentPlayerId],
  );

  const suggestions = useMemo(() => {
    if (!data) return [];
    if (!currentPlayerId) return data.suggestions;

    return data.suggestions
      .map((suggestion, index) => ({ suggestion, index }))
      .sort((a, b) => {
        const aMine =
          a.suggestion.fromPlayerId === currentPlayerId ||
          a.suggestion.toPlayerId === currentPlayerId;
        const bMine =
          b.suggestion.fromPlayerId === currentPlayerId ||
          b.suggestion.toPlayerId === currentPlayerId;

        return Number(bMine) - Number(aMine) || a.index - b.index;
      })
      .map(({ suggestion }) => suggestion);
  }, [data, currentPlayerId]);

  function changeView(next: SettlementView) {
    setView(next);
    window.localStorage.setItem("pokertracker-settlement-view", next);
  }

  function openManualPayment() {
    setDraft(emptyDraft());
    setError("");
  }

  function openSuggestedPayment(suggestion: SettlementSuggestion) {
    setDraft(suggestionDraft(suggestion));
    setError("");
  }

  async function openPayPal(suggestion: SettlementSuggestion) {
    const key = suggestion.fromPlayerId + ":" + suggestion.toPlayerId;
    setPaypalOpeningKey(key);
    setError("");
    setPaypalFallback(null);

    try {
      const prepared = await preparePayPalPayment(
        suggestion.fromPlayerId,
        suggestion.toPlayerId,
      );
      const amount = clipboardAmount(prepared.amountCents);
      const copied = await copyText(amount);

      if (!copied) {
        setPaypalFallback({
          amountCents: prepared.amountCents,
          paypalUrl: prepared.paypalUrl,
          toPlayerName: prepared.toPlayerName,
        });
        return;
      }

      window.sessionStorage.setItem(
        PAYPAL_RETURN_NOTICE_KEY,
        t("{amount} kopiert · Empfänger in PayPal auswählen")
          .replace("{amount}", formatMoney(prepared.amountCents)),
      );
      window.location.assign(prepared.paypalUrl);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("PayPal-Zahlung konnte nicht vorbereitet werden."),
      );
      await refresh().catch(() => undefined);
    } finally {
      setPaypalOpeningKey(null);
    }
  }

  async function continuePayPalFallback() {
    if (!paypalFallback) return;

    const copied = await copyText(clipboardAmount(paypalFallback.amountCents));
    if (!copied) {
      setError(t("Der Betrag konnte nicht kopiert werden. Bitte manuell übernehmen."));
      return;
    }

    window.sessionStorage.setItem(
      PAYPAL_RETURN_NOTICE_KEY,
      t("{amount} kopiert · Empfänger in PayPal auswählen")
        .replace("{amount}", formatMoney(paypalFallback.amountCents)),
    );
    window.location.assign(paypalFallback.paypalUrl);
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setError("");

    if (!draft.fromPlayerId || !draft.toPlayerId) {
      setError(t("Bitte Zahler und Empfänger auswählen."));
      return;
    }

    if (draft.fromPlayerId === draft.toPlayerId) {
      setError(t("Zahler und Empfänger müssen verschieden sein."));
      return;
    }

    const amountCents = parseMoney(draft.amount);
    if (amountCents === null || amountCents <= 0) {
      setError(t("Bitte einen gültigen Zahlungsbetrag eintragen."));
      return;
    }

    const input: SettlementPaymentInput = {
      fromPlayerId: draft.fromPlayerId,
      toPlayerId: draft.toPlayerId,
      amountCents,
      paidAt: draft.paidAt,
      note: draft.note.trim(),
      clientToken: draft.clientToken,
    };

    setSaving(true);
    try {
      const response = await createSettlementPayment(input);
      setData(response);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Zahlung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }

  async function undoPayment(id: string) {
    if (!window.confirm(t("Diese Zahlung wirklich rückgängig machen?"))) return;

    setVoidingId(id);
    setError("");
    try {
      const response = await voidSettlementPayment(id);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Zahlung konnte nicht storniert werden."));
    } finally {
      setVoidingId(null);
    }
  }

  return (
    <>
      <div className="settlement-heading">
        <button className="back-button" type="button" onClick={onClose} aria-label={t("Zurück")}>‹</button>
        <div className="screen-heading">
          <h1>{t("Ausgleichen")}</h1>
          <p>{t("Offene Zahlungen und bereits erfasste Auszahlungen.")}</p>
        </div>
      </div>

      {paypalNotice && (
        <div className="settlement-toast" role="status">
          <span>✓</span>
          <strong>{paypalNotice}</strong>
        </div>
      )}

      {loading ? (
        <div className="empty-card">{t("Lädt …")}</div>
      ) : data ? (
        <>
          <section className="settlement-total-card">
            <span>{t("Noch auszugleichen")}</span>
            <strong>{formatMoney(data.totalOutstandingCents)}</strong>
            <small>
              {data.totalOutstandingCents === 0 && data.groupDifferenceCents === 0
                ? "✓ " + t("Alles ausgeglichen")
                : t("Zahlungen verändern die Pokerbilanz nicht.")}
            </small>
          </section>

          {currentPlayer ? (
            <section className="my-settlement-card">
              <div>
                <span>{t("Dein Ausgleich")}</span>
                <strong>{currentPlayer.name}</strong>
              </div>
              <b className={
                currentPlayer.openBalanceCents > 0
                  ? "positive"
                  : currentPlayer.openBalanceCents < 0
                    ? "negative"
                    : ""
              }>
                {currentPlayer.openBalanceCents > 0
                  ? t("Du bekommst noch {amount}").replace(
                      "{amount}",
                      formatMoney(currentPlayer.openBalanceCents),
                    )
                  : currentPlayer.openBalanceCents < 0
                    ? t("Du zahlst noch {amount}").replace(
                        "{amount}",
                        formatMoney(Math.abs(currentPlayer.openBalanceCents)),
                      )
                    : t("Du bist ausgeglichen")}
              </b>
            </section>
          ) : (
            <section className="settlement-profile-nudge">
              <div>
                <strong>{t("PokerTracker personalisieren")}</strong>
                <span>{t("Wer bist du? Die Auswahl bleibt nur auf diesem Gerät.")}</span>
              </div>
              <select
                value=""
                aria-label={t("Wer bist du?")}
                onChange={(event) => {
                  if (event.target.value) onCurrentPlayerChange(event.target.value);
                }}
              >
                <option value="">{t("Spieler wählen")}</option>
                {data.players
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, getLocale()))
                  .map((player) => (
                    <option key={player.id} value={player.id}>{player.name}</option>
                  ))}
              </select>
            </section>
          )}

          {data.groupDifferenceCents !== 0 && (
            <section className="settlement-warning">
              <strong>{t("Offene Session-Differenz")}: {formatMoney(data.groupDifferenceCents)}</strong>
              <span>{t("Mindestens ein Pokerabend ist noch nicht vollständig ausgeglichen. Vorschläge berücksichtigen nur Beträge, die sich bereits eindeutig gegenüberstehen.")}</span>
            </section>
          )}

          <section className="settlement-section">
            <div className="settlement-section-head">
              <div className="section-title-row">
                <h2>{t("Zahlungsvorschläge")}</h2>
                <span>{data.suggestions.length}</span>
              </div>
              <div className="settlement-view-toggle" role="group" aria-label={t("Ansicht")}>
                <button
                  type="button"
                  className={view === "list" ? "active" : ""}
                  aria-pressed={view === "list"}
                  onClick={() => changeView("list")}
                >
                  {t("Liste")}
                </button>
                <button
                  type="button"
                  className={view === "flow" ? "active" : ""}
                  aria-pressed={view === "flow"}
                  onClick={() => changeView("flow")}
                >
                  {t("Fluss")}
                </button>
              </div>
            </div>

            {data.suggestions.length === 0 ? (
              <div className="settlement-empty-inline">
                <strong>{t("Keine Zahlungen nötig.")}</strong>
              </div>
            ) : view === "flow" ? (
              <SettlementFlow
                suggestions={suggestions}
                currentPlayerId={currentPlayerId}
                onSelect={openSuggestedPayment}
              />
            ) : (
              <div className="settlement-suggestion-list">
                {suggestions.map((suggestion, index) => {
                  const paypalAvailable =
                    !currentPlayerId || suggestion.fromPlayerId === currentPlayerId;
                  const paypalKey = suggestion.fromPlayerId + ":" + suggestion.toPlayerId;

                  return (
                    <article
                      className={
                        "settlement-payment-card" +
                        (
                          currentPlayerId &&
                          (
                            suggestion.fromPlayerId === currentPlayerId ||
                            suggestion.toPlayerId === currentPlayerId
                          )
                            ? " is-personal"
                            : ""
                        )
                      }
                      key={paypalKey + ":" + index}
                    >
                      <div className="settlement-payment-flow">
                        <div className="settlement-flow-player">
                          <span className={
                            "settlement-flow-avatar settlement-flow-avatar-payer" +
                            (suggestion.fromPlayerId === currentPlayerId ? " is-me" : "")
                          }>
                            {initials(suggestion.fromPlayerName)}
                          </span>
                          <strong>
                            {personLabel(
                              suggestion.fromPlayerId,
                              suggestion.fromPlayerName,
                              currentPlayerId,
                            )}
                          </strong>
                          <small>{t("Zahlt")}</small>
                        </div>

                        <div className="settlement-flow-direction" aria-hidden="true">
                          <span className="settlement-flow-line" />
                          <span className="settlement-flow-arrow">→</span>
                        </div>

                        <div className="settlement-flow-player">
                          <span className={
                            "settlement-flow-avatar settlement-flow-avatar-receiver" +
                            (suggestion.toPlayerId === currentPlayerId ? " is-me" : "")
                          }>
                            {initials(suggestion.toPlayerName)}
                          </span>
                          <strong>
                            {personLabel(
                              suggestion.toPlayerId,
                              suggestion.toPlayerName,
                              currentPlayerId,
                            )}
                          </strong>
                          <small>{t("Erhält")}</small>
                        </div>
                      </div>

                      <div className="settlement-payment-amount">
                        <span aria-hidden="true">€</span>
                        <strong>{formatMoney(suggestion.amountCents)}</strong>
                      </div>

                      <div className={
                        "settlement-payment-actions" +
                        (paypalAvailable ? "" : " single-action")
                      }>
                        {paypalAvailable && (
                          <button
                            className="paypal-payment-button"
                            type="button"
                            disabled={paypalOpeningKey === paypalKey}
                            onClick={() => openPayPal(suggestion)}
                          >
                            <img src={PAYPAL_MARK_URL} alt="" aria-hidden="true" />
                            <span>
                              {paypalOpeningKey === paypalKey
                                ? t("Betrag wird geprüft …")
                                : t("Mit PayPal zahlen")}
                            </span>
                          </button>
                        )}

                        <button
                          type="button"
                          className="settlement-record-button"
                          onClick={() => openSuggestedPayment(suggestion)}
                        >
                          {t("Zahlung eintragen")}
                        </button>
                      </div>

                      {paypalAvailable && (
                        <small className="paypal-live-note">
                          {t("Der Betrag wird beim Öffnen frisch berechnet und in die Zwischenablage kopiert.")}
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            <button className="secondary-button settlement-manual-button" type="button" onClick={openManualPayment}>
              + {t("Andere Zahlung")}
            </button>
          </section>

          {paypalFallback && (
            <section className="paypal-fallback-card">
              <div className="form-card-title">
                <img src={PAYPAL_MARK_URL} alt="" aria-hidden="true" />
                <h2>{t("PayPal vorbereiten")}</h2>
              </div>
              <p>
                {t("Aktueller Betrag für {name}: {amount}")
                  .replace("{name}", paypalFallback.toPlayerName)
                  .replace("{amount}", formatMoney(paypalFallback.amountCents))}
              </p>
              <p>{t("Der Betrag konnte nicht automatisch kopiert werden. Tippe erneut, um ihn zu kopieren und PayPal zu öffnen.")}</p>
              <div className="payment-editor-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPaypalFallback(null)}
                >
                  {t("Abbrechen")}
                </button>
                <button
                  type="button"
                  className="paypal-save-button"
                  onClick={continuePayPalFallback}
                >
                  {t("Kopieren & PayPal öffnen")}
                </button>
              </div>
            </section>
          )}

          {draft && (
            <section className="payment-editor">
              <div className="form-card-title"><span>€</span><h2>{t("Zahlung eintragen")}</h2></div>
              <form onSubmit={submitPayment}>
                <label>
                  <span>{t("Zahler")}</span>
                  <select
                    value={draft.fromPlayerId}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      fromPlayerId: event.target.value,
                    } : current)}
                  >
                    <option value="">{t("Spieler wählen")}</option>
                    {debtors.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name} · {formatMoney(Math.abs(player.openBalanceCents))}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>{t("Empfänger")}</span>
                  <select
                    value={draft.toPlayerId}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      toPlayerId: event.target.value,
                    } : current)}
                  >
                    <option value="">{t("Spieler wählen")}</option>
                    {creditors.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name} · {formatMoney(player.openBalanceCents)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="payment-editor-grid">
                  <label>
                    <span>{t("Betrag")}</span>
                    <div className="money-input">
                      <input
                        inputMode="decimal"
                        placeholder="0,00"
                        value={draft.amount}
                        onChange={(event) => setDraft((current) => current ? {
                          ...current,
                          amount: event.target.value,
                        } : current)}
                      />
                      <span>€</span>
                    </div>
                  </label>

                  <label>
                    <span>{t("Datum")}</span>
                    <input
                      type="date"
                      value={draft.paidAt}
                      onChange={(event) => setDraft((current) => current ? {
                        ...current,
                        paidAt: event.target.value,
                      } : current)}
                    />
                  </label>
                </div>

                <label>
                  <span>{t("Notiz (optional)")}</span>
                  <input
                    maxLength={200}
                    value={draft.note}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      note: event.target.value,
                    } : current)}
                    placeholder={t("z. B. Überweisung oder bar")}
                  />
                </label>

                <div className="payment-editor-actions">
                  <button type="button" className="secondary-button" disabled={saving} onClick={() => setDraft(null)}>
                    {t("Abbrechen")}
                  </button>
                  <button type="submit" className="gold-cta" disabled={saving}>
                    {saving ? t("Speichert …") : t("Zahlung speichern")}
                  </button>
                </div>
              </form>
            </section>
          )}

          <section className="settlement-section">
            <div className="section-title-row">
              <h2>{t("Offene Salden")}</h2>
              <span>{data.players.length} {t("Spieler")}</span>
            </div>
            <div className="settlement-balance-list">
              {data.players
                .slice()
                .sort((a, b) =>
                  Number(b.id === currentPlayerId) - Number(a.id === currentPlayerId) ||
                  b.openBalanceCents - a.openBalanceCents ||
                  a.name.localeCompare(b.name)
                )
                .map((player) => (
                  <article className={player.id === currentPlayerId ? "is-current-player" : ""} key={player.id}>
                    <span className="avatar">{initials(player.name)}</span>
                    <div>
                      <strong>{personLabel(player.id, player.name, currentPlayerId)}</strong>
                      <small>
                        {t("Pokerbilanz")} {player.pokerBalanceCents > 0 ? "+" : ""}
                        {formatMoney(player.pokerBalanceCents)}
                        {player.paidOutCents > 0
                          ? " · " + t("gezahlt") + " " + formatMoney(player.paidOutCents)
                          : ""}
                        {player.receivedCents > 0
                          ? " · " + t("erhalten") + " " + formatMoney(player.receivedCents)
                          : ""}
                      </small>
                    </div>
                    <b className={
                      player.openBalanceCents > 0
                        ? "positive"
                        : player.openBalanceCents < 0
                          ? "negative"
                          : ""
                    }>
                      {player.openBalanceCents > 0
                        ? formatMoney(player.openBalanceCents) + " " + t("zu bekommen")
                        : player.openBalanceCents < 0
                          ? formatMoney(Math.abs(player.openBalanceCents)) + " " + t("zu zahlen")
                          : t("ausgeglichen")}
                    </b>
                  </article>
                ))}
            </div>
          </section>

          <section className="settlement-section">
            <div className="section-title-row">
              <h2>{t("Zahlungsverlauf")}</h2>
              <span>{data.payments.length}</span>
            </div>
            {data.payments.length === 0 ? (
              <div className="settlement-empty-inline">{t("Noch keine Zahlungen erfasst.")}</div>
            ) : (
              <div className="payment-history-list">
                {data.payments.map((payment) => (
                  <article className={payment.voidedAt ? "is-voided" : ""} key={payment.id}>
                    <div>
                      <strong>
                        {personLabel(payment.fromPlayerId, payment.fromPlayerName, currentPlayerId)}
                        {" → "}
                        {personLabel(payment.toPlayerId, payment.toPlayerName, currentPlayerId)}
                      </strong>
                      <small>
                        {formatPaymentDate(payment.paidAt)}
                        {payment.note ? " · " + payment.note : ""}
                      </small>
                    </div>
                    <b>{formatMoney(payment.amountCents)}</b>
                    {payment.voidedAt ? (
                      <span className="payment-status">{t("Storniert")}</span>
                    ) : (
                      <button
                        className="payment-undo"
                        type="button"
                        disabled={voidingId === payment.id}
                        onClick={() => undoPayment(payment.id)}
                      >
                        {voidingId === payment.id ? "…" : t("Rückgängig")}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {error && <p className="error-banner">{error}</p>}
    </>
  );
}
