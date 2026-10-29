import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createSettlementList,
  createSettlementPayment,
  loadSettlements,
  preparePaymentApp,
  voidSettlementPayment,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { SettlementFlow } from "./SettlementFlow";
import { SettlementBalanceHero } from "./SettlementBalanceHero";
import { SettlementPlayerResults } from "./SettlementPlayerResults";
import { SettlementViewToggle, type SettlementView } from "./SettlementViewToggle";
import { SeparateSessions } from "./SeparateSessions";
import { SettlementCard } from "./SettlementCard";
import { NamedSettlementLists } from "./NamedSettlementLists";
import { getLocale, t } from "./i18n";
import { PlayerAvatar } from "./PlayerAvatar";
import { PaymentRequestDialog } from "./PaymentRequestDialog";
import { SettlementTransferCard } from "./SettlementTransferCard";
import type {
  PlayerProfile,
  PokerNight,
  SettlementPaymentInput,
  SettlementResponse,
  SettlementSuggestion,
} from "./types";

const PAYPAL_MARK_URL =
  "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg";
const REVOLUT_WORDMARK_URL =
  "https://assets.revolut.com/Brand/Retail/Logos/Wordmark/Revolut_Black.svg";
const PAYMENT_RETURN_NOTICE_KEY = "pokertracker-payment-return-notice";

type PaymentApp = "paypal" | "revolut";

const PAYMENT_APP_URLS: Record<PaymentApp, string> = {
  paypal: "https://www.paypal.com/myaccount/transfer/homepage",
  revolut: "https://revolut.com/app",
};

type PaymentDraft = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: string;
  paidAt: string;
  note: string;
  clientToken: string;
};

type PaymentAppFallback = {
  amountCents: number;
  app: PaymentApp;
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


export function SettlementSummary({
  onOpen,
  data,
  onDataChange,
}: {
  onOpen: () => void;
  data: SettlementResponse | null;
  onDataChange: (data: SettlementResponse) => void;
}) {

  useEffect(() => {
    let active = true;

    const reload = () => {
      loadSettlements()
        .then((response) => {
          if (active) onDataChange(response);
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
    window.addEventListener("pokertracker:settlement-updated", refreshIfVisible);
    window.addEventListener("pageshow", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshIfVisible);
    window.removeEventListener("pokertracker:settlement-updated", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [onDataChange]);

  return (
    <button className="dashboard-action-card settlement-summary-card" type="button" onClick={onOpen}>
      <span className="dashboard-action-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" focusable="false">
          <path d="M24 7v33M12 14h24M18 40h12M14 44h20" />
          <path d="M12 14 5 29h14L12 14ZM36 14l-7 15h14l-7-15Z" />
          <path d="M5 29c1 6 13 6 14 0M29 29c1 6 13 6 14 0" />
        </svg>
      </span>
      <span className="dashboard-action-copy settlement-summary-copy">
        <strong>{t("Abrechnungen")}</strong>
      </span>
      <span className="dashboard-action-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="m9 5 7 7-7 7" /></svg>
      </span>
    </button>
  );
}

export function SettlementScreen({
  onClose,
  currentPlayerId,
  onCurrentPlayerChange,
  playerProfiles,
  nights,
  onDataChange,
}: {
  onClose: () => void;
  currentPlayerId: string | null;
  onCurrentPlayerChange: (playerId: string | null) => void;
  playerProfiles: PlayerProfile[];
  nights: PokerNight[];
  onDataChange: (data: SettlementResponse) => void;
}) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [requestDraft, setRequestDraft] = useState<SettlementSuggestion | null>(null);
  const [view, setView] = useState<SettlementView>(() =>
    window.localStorage.getItem("pokertracker-settlement-view") === "flow" ? "flow" : "list"
  );
  const [paymentAppOpeningKey, setPaymentAppOpeningKey] = useState<string | null>(null);
  const [paymentAppFallback, setPaymentAppFallback] = useState<PaymentAppFallback | null>(null);
  const [paymentAppNotice, setPaymentAppNotice] = useState("");
  const [copyingTransferKey, setCopyingTransferKey] = useState<string | null>(null);
  const [copiedTransferKey, setCopiedTransferKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [rigaOpen, setRigaOpen] = useState(false);
  const [newListVersion, setNewListVersion] = useState(0);
  const [creatingList, setCreatingList] = useState(false);

  async function addNamedList() {
    const name=window.prompt(t("Name der neuen Abrechnungsliste"));
    if(name===null) return;
    setCreatingList(true);
    setError("");
    try {
      await createSettlementList(name);
      setNewListVersion(v=>v+1);
      window.dispatchEvent(new Event("pokertracker:lists-updated"));
    } catch(err) {
      setError(err instanceof Error ? err.message : t("Liste konnte nicht angelegt werden."));
    } finally { setCreatingList(false); }
  }

  const profilePhotoByPlayer = useMemo(
    () => new Map(playerProfiles.map((player) => [player.id, player.profilePhoto])),
    [playerProfiles],
  );

  function profilePhotoFor(playerId: string) {
    return profilePhotoByPlayer.get(playerId) ?? null;
  }

  async function refresh() {
    const response = await loadSettlements();
    setData(response);
    onDataChange(response);
    return response;
  }

  useEffect(() => {
    let active = true;

    const reload = (showError: boolean) =>
      loadSettlements()
        .then((response) => {
          if (active) {
            setData(response);
            onDataChange(response);
          }
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

    const returnNotice = window.sessionStorage.getItem(PAYMENT_RETURN_NOTICE_KEY);
    if (returnNotice) {
      window.sessionStorage.removeItem(PAYMENT_RETURN_NOTICE_KEY);
      setPaymentAppNotice(returnNotice);
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void reload(false);
    };

    const intervalId = window.setInterval(refreshIfVisible, 15_000);
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("pokertracker:settlement-updated", refreshIfVisible);
    window.addEventListener("pageshow", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
    window.removeEventListener("pokertracker:settlement-updated", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [onDataChange]);

  useEffect(() => {
    if (!paymentAppNotice) return;
    const timeout = window.setTimeout(() => setPaymentAppNotice(""), 6500);
    return () => window.clearTimeout(timeout);
  }, [paymentAppNotice]);

  const rigaSessionCount = nights.filter((night) => night.recordType === "session" && night.settlementMode === "pooled" && night.status === "completed" && !night.settlementListId).length;

  const currentPlayer = useMemo(
    () => data?.players.find((player) => player.id === currentPlayerId) ?? null,
    [data, currentPlayerId],
  );

  // Keep the original list in view, including completed transfers. Only the
  // selected transfer's remaining amount changes; nobody is reassigned.
  const plannedTransfers = useMemo(() => {
    if (!data) return [];
    const plan = data.plan ?? data.suggestions.map(s => ({ ...s, paidCents: 0, remainingCents: s.amountCents }));
    if (!currentPlayerId) return plan;
    return plan.map((transfer, index) => ({ transfer, index }))
      .sort((a, b) =>
        Number(b.transfer.fromPlayerId === currentPlayerId || b.transfer.toPlayerId === currentPlayerId) -
        Number(a.transfer.fromPlayerId === currentPlayerId || a.transfer.toPlayerId === currentPlayerId) ||
        a.index - b.index
      ).map(({ transfer }) => transfer);
  }, [data, currentPlayerId]);

  function changeView(next: SettlementView) {
    setView(next);
    window.localStorage.setItem("pokertracker-settlement-view", next);
  }

  function openSuggestedPayment(suggestion: SettlementSuggestion) {
    setDraft(suggestionDraft(suggestion));
    setError("");
  }

  async function copySuggestionAmount(suggestion: SettlementSuggestion) {
    const key = suggestion.fromPlayerId + ":" + suggestion.toPlayerId;
    setCopyingTransferKey(key);
    setError("");

    try {
      const prepared = await preparePaymentApp(
        suggestion.fromPlayerId,
        suggestion.toPlayerId,
      );
      const copied = await copyText(clipboardAmount(prepared.amountCents));

      if (!copied) {
        setError(t("Der Betrag konnte nicht kopiert werden. Bitte manuell übernehmen."));
        return;
      }

      setCopiedTransferKey(key);
      setPaymentAppNotice(
        t("{amount} in die Zwischenablage kopiert")
          .replace("{amount}", formatMoney(prepared.amountCents)),
      );

      window.setTimeout(() => {
        setCopiedTransferKey((current) => current === key ? null : current);
      }, 1600);

      if (prepared.amountCents !== suggestion.amountCents) {
        await refresh().catch(() => undefined);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Betrag konnte nicht aktualisiert werden."),
      );
      await refresh().catch(() => undefined);
    } finally {
      setCopyingTransferKey(null);
    }
  }

  async function openPaymentApp(
    suggestion: SettlementSuggestion,
    app: PaymentApp,
  ) {
    const key =
      suggestion.fromPlayerId + ":" + suggestion.toPlayerId + ":" + app;
    setPaymentAppOpeningKey(key);
    setError("");
    setPaymentAppFallback(null);

    try {
      const prepared = await preparePaymentApp(
        suggestion.fromPlayerId,
        suggestion.toPlayerId,
      );
      const amount = clipboardAmount(prepared.amountCents);
      const copied = await copyText(amount);

      if (!copied) {
        setPaymentAppFallback({
          amountCents: prepared.amountCents,
          app,
          toPlayerName: prepared.toPlayerName,
        });
        return;
      }

      const appName = app === "paypal" ? "PayPal" : "Revolut";
      window.sessionStorage.setItem(
        PAYMENT_RETURN_NOTICE_KEY,
        t("{amount} kopiert · Empfänger in {app} auswählen")
          .replace("{amount}", formatMoney(prepared.amountCents))
          .replace("{app}", appName),
      );
      window.location.assign(PAYMENT_APP_URLS[app]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Zahlungs-App konnte nicht vorbereitet werden."),
      );
      await refresh().catch(() => undefined);
    } finally {
      setPaymentAppOpeningKey(null);
    }
  }

  async function continuePaymentAppFallback() {
    if (!paymentAppFallback) return;

    const copied = await copyText(clipboardAmount(paymentAppFallback.amountCents));
    if (!copied) {
      setError(t("Der Betrag konnte nicht kopiert werden. Bitte manuell übernehmen."));
      return;
    }

    const appName = paymentAppFallback.app === "paypal" ? "PayPal" : "Revolut";
    window.sessionStorage.setItem(
      PAYMENT_RETURN_NOTICE_KEY,
      t("{amount} kopiert · Empfänger in {app} auswählen")
        .replace("{amount}", formatMoney(paymentAppFallback.amountCents))
        .replace("{app}", appName),
    );
    window.location.assign(PAYMENT_APP_URLS[paymentAppFallback.app]);
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
      onDataChange(response);
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
      onDataChange(response);
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
        </div>
      </div>

      {paymentAppNotice && (
        <div className="settlement-toast" role="status">
          <span>✓</span>
          <strong>{paymentAppNotice}</strong>
        </div>
      )}

      {loading ? (
        <div className="empty-card">{t("Lädt …")}</div>
      ) : data ? (
        <>
          <section className="settlement-ledgers" aria-label={t("Abrechnungen")}>
            <div className="settlement-lists-topline">
              <h2>{t("Abrechnungen")}</h2>
              <button className="secondary-button" type="button" disabled={creatingList}
                onClick={()=>void addNamedList()}>
                + {t("Neue Liste")}
              </button>
            </div>
            <SettlementCard
              title="Riga"
              meta={rigaSessionCount + " " + t("Sessions")}
              amount={formatMoney(data.totalOutstandingCents)}
              expanded={rigaOpen}
              panelId="riga-settlement-detail"
              onToggle={() => setRigaOpen((open) => !open)}
            >
              {currentPlayer && <SettlementBalanceHero player={currentPlayer} />}

          {!currentPlayer && (
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

          {data.ongoingSessionCount > 0 && (
            <section className="settlement-ongoing-note">
              <strong>{data.ongoingSessionCount} {data.ongoingSessionCount === 1 ? t("laufende Session") : t("laufende Sessions")}</strong>
              <span>{t("Noch nicht abgeschlossene Sessions beeinflussen den Ausgleich nicht.")}</span>
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
              <SettlementViewToggle view={view} onChange={changeView} />
            </div>

            {plannedTransfers.length === 0 ? (
              <div className="settlement-empty-inline">
                <strong>{t("Keine Zahlungen nötig.")}</strong>
              </div>
            ) : view === "flow" ? (
              <SettlementFlow
                suggestions={plannedTransfers}
                currentPlayerId={currentPlayerId}
                profilePhotoFor={profilePhotoFor}
                onSelect={(transfer) => {
                  const remaining = "remainingCents" in transfer
                    ? Number(transfer.remainingCents) : transfer.amountCents;
                  if (remaining > 0) openSuggestedPayment({ ...transfer, amountCents: remaining });
                }}
              />
            ) : (
              <div className="settlement-suggestion-list">
                {plannedTransfers.map((suggestion, index) => {
                  const key = suggestion.fromPlayerId + ":" + suggestion.toPlayerId;
                  return <SettlementTransferCard
                    key={key + ":" + index}
                    transfer={suggestion}
                    currentPlayerId={currentPlayerId}
                    photoFor={profilePhotoFor}
                    onCopy={(remaining) => { void copySuggestionAmount(remaining); }}
                    onWallet={(remaining, app) => { void openPaymentApp(remaining, app); }}
                    onRecord={openSuggestedPayment}
                    onRequest={currentPlayerId ? setRequestDraft : undefined}
                    copying={copyingTransferKey === key}
                    copied={copiedTransferKey === key}
                    openingApp={paymentAppOpeningKey === key + ":paypal" ? "paypal" :
                      paymentAppOpeningKey === key + ":revolut" ? "revolut" : null}
                  />;
                })}
              </div>
            )}

          </section>

          {paymentAppFallback && (
            <section className="paypal-fallback-card">
              <div className="form-card-title">
                {paymentAppFallback.app === "revolut" ? (
                  <img
                    className="revolut-fallback-logo"
                    src={REVOLUT_WORDMARK_URL}
                    alt="Revolut"
                  />
                ) : (
                  <img src={PAYPAL_MARK_URL} alt="" aria-hidden="true" />
                )}
                <h2>{t("Zahlungs-App vorbereiten")}</h2>
              </div>
              <p>
                {t("Aktueller Betrag für {name}: {amount}")
                  .replace("{name}", paymentAppFallback.toPlayerName)
                  .replace("{amount}", formatMoney(paymentAppFallback.amountCents))}
              </p>
              <p>
                {t("Der Betrag konnte nicht automatisch kopiert werden. Tippe erneut, um ihn zu kopieren und die Zahlungs-App zu öffnen.")}
              </p>
              <div className="payment-editor-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPaymentAppFallback(null)}
                >
                  {t("Abbrechen")}
                </button>
                <button
                  type="button"
                  className="paypal-save-button"
                  onClick={continuePaymentAppFallback}
                >
                  {t("Kopieren & App öffnen")}
                </button>
              </div>
            </section>
          )}

          {draft && (
            <section className="payment-editor">
              <div className="form-card-title"><span>€</span><h2>{t("Zahlung eintragen")}</h2></div>
              <form onSubmit={submitPayment}>
                <div className="payment-editor-route">
                  <div>
                    <PlayerAvatar
                      name={data.players.find((player) => player.id === draft.fromPlayerId)?.name ?? "?"}
                      photo={profilePhotoFor(draft.fromPlayerId)}
                    />
                    <strong>
                      {personLabel(
                        draft.fromPlayerId,
                        data.players.find((player) => player.id === draft.fromPlayerId)?.name ?? t("Zahler"),
                        currentPlayerId,
                      )}
                    </strong>
                  </div>
                  <span className="payment-editor-route-arrow" aria-hidden="true">→</span>
                  <div>
                    <PlayerAvatar
                      name={data.players.find((player) => player.id === draft.toPlayerId)?.name ?? "?"}
                      photo={profilePhotoFor(draft.toPlayerId)}
                    />
                    <strong>
                      {personLabel(
                        draft.toPlayerId,
                        data.players.find((player) => player.id === draft.toPlayerId)?.name ?? t("Empfänger"),
                        currentPlayerId,
                      )}
                    </strong>
                  </div>
                </div>

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

          <SettlementPlayerResults players={data.players} currentPlayerId={currentPlayerId} photoFor={profilePhotoFor} />

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
            </SettlementCard>
            <NamedSettlementLists
              currentPlayerId={currentPlayerId}
              photoFor={profilePhotoFor}
              playerProfiles={playerProfiles}
              nightsVersion={newListVersion+":"+nights.map(n=>n.id+":"+n.updatedAt).join("|")}
            />
            <SeparateSessions
              nights={nights}
              currentPlayerId={currentPlayerId}
              photoFor={profilePhotoFor}
              playerProfiles={playerProfiles}
            />
          </section>
        </>
      ) : null}

      {error && <p className="error-banner">{error}</p>}
      {requestDraft && currentPlayerId === requestDraft.toPlayerId && (
        <PaymentRequestDialog
          suggestion={requestDraft}
          currentPlayerId={currentPlayerId}
          profiles={playerProfiles}
          onClose={() => setRequestDraft(null)}
        />
      )}
    </>
  );
}
