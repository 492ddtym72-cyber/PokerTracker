import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createSettlementPayment,
  loadSettlements,
  voidSettlementPayment,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { getLocale, t } from "./i18n";
import type {
  SettlementPaymentInput,
  SettlementResponse,
  SettlementSuggestion,
} from "./types";

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

type PaymentDraft = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: string;
  paidAt: string;
  note: string;
  clientToken: string;
};

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

export function SettlementSummary({ onOpen }: { onOpen: () => void }) {
  const [data, setData] = useState<SettlementResponse | null>(null);

  useEffect(() => {
    let active = true;
    loadSettlements()
      .then((response) => {
        if (active) setData(response);
      })
      .catch(() => {
        // Keep the rest of the app usable if this optional summary cannot load.
      });
    return () => {
      active = false;
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

export function SettlementScreen({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await loadSettlements();
    setData(response);
    return response;
  }

  useEffect(() => {
    refresh()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t("Ausgleichsdaten konnten nicht geladen werden."));
      })
      .finally(() => setLoading(false));
  }, []);

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

  function openManualPayment() {
    setDraft(emptyDraft());
    setError("");
  }

  function openSuggestedPayment(suggestion: SettlementSuggestion) {
    setDraft(suggestionDraft(suggestion));
    setError("");
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

          {data.groupDifferenceCents !== 0 && (
            <section className="settlement-warning">
              <strong>{t("Offene Session-Differenz")}: {formatMoney(data.groupDifferenceCents)}</strong>
              <span>{t("Mindestens ein Pokerabend ist noch nicht vollständig ausgeglichen. Vorschläge berücksichtigen nur Beträge, die sich bereits eindeutig gegenüberstehen.")}</span>
            </section>
          )}

          <section className="settlement-section">
            <div className="section-title-row">
              <h2>{t("Zahlungsvorschläge")}</h2>
              <span>{data.suggestions.length}</span>
            </div>

            {data.suggestions.length === 0 ? (
              <div className="settlement-empty-inline">
                <strong>{t("Keine Zahlungen nötig.")}</strong>
              </div>
            ) : (
              <div className="settlement-suggestion-list">
                {data.suggestions.map((suggestion, index) => (
                  <article className="settlement-suggestion" key={
                    suggestion.fromPlayerId + ":" + suggestion.toPlayerId + ":" + index
                  }>
                    <div className="settlement-route">
                      <span className="avatar">{initials(suggestion.fromPlayerName)}</span>
                      <div>
                        <strong>{suggestion.fromPlayerName}</strong>
                        <small>→ {suggestion.toPlayerName}</small>
                      </div>
                    </div>
                    <b>{formatMoney(suggestion.amountCents)}</b>
                    <button
                      type="button"
                      className="balance-action"
                      onClick={() => openSuggestedPayment(suggestion)}
                    >
                      {t("Zahlung eintragen")}
                    </button>
                  </article>
                ))}
              </div>
            )}

            <button className="secondary-button settlement-manual-button" type="button" onClick={openManualPayment}>
              + {t("Andere Zahlung")}
            </button>
          </section>

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
                .sort((a, b) => b.openBalanceCents - a.openBalanceCents || a.name.localeCompare(b.name))
                .map((player) => (
                  <article key={player.id}>
                    <span className="avatar">{initials(player.name)}</span>
                    <div>
                      <strong>{player.name}</strong>
                      <small>{t("Pokerbilanz")} {player.pokerBalanceCents > 0 ? "+" : ""}{formatMoney(player.pokerBalanceCents)}</small>
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
                      <strong>{payment.fromPlayerName} → {payment.toPlayerName}</strong>
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
