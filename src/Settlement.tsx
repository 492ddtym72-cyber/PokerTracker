import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createSettlementPayment,
  loadSettlements,
  preparePaymentApp,
  voidSettlementPayment,
} from "./lib/api";
import { formatMoney, parseMoney } from "./lib/money";
import { getLocale, t } from "./i18n";
import { PlayerAvatar, playerInitials } from "./PlayerAvatar";
import type {
  PlayerProfile,
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

type SettlementView = "list" | "flow";

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

function SettlementFlow({
  suggestions,
  currentPlayerId,
  profilePhotoFor,
  onSelect,
}: {
  suggestions: SettlementSuggestion[];
  currentPlayerId: string | null;
  profilePhotoFor: (playerId: string) => string | null;
  onSelect: (suggestion: SettlementSuggestion) => void;
}) {
  type FlowPerson = {
    id: string;
    name: string;
    totalCents: number;
  };

  const payerMap = new Map<string, FlowPerson>();
  const receiverMap = new Map<string, FlowPerson>();

  for (const suggestion of suggestions) {
    const payer = payerMap.get(suggestion.fromPlayerId) ?? {
      id: suggestion.fromPlayerId,
      name: suggestion.fromPlayerName,
      totalCents: 0,
    };
    payer.totalCents += suggestion.amountCents;
    payerMap.set(payer.id, payer);

    const receiver = receiverMap.get(suggestion.toPlayerId) ?? {
      id: suggestion.toPlayerId,
      name: suggestion.toPlayerName,
      totalCents: 0,
    };
    receiver.totalCents += suggestion.amountCents;
    receiverMap.set(receiver.id, receiver);
  }

  let payers = Array.from(payerMap.values()).sort(
    (a, b) =>
      b.totalCents - a.totalCents ||
      a.name.localeCompare(b.name, getLocale()),
  );
  let receivers = Array.from(receiverMap.values()).sort(
    (a, b) =>
      b.totalCents - a.totalCents ||
      a.name.localeCompare(b.name, getLocale()),
  );

  function weightedNeighborPosition(
    personId: string,
    side: "payer" | "receiver",
    otherOrder: FlowPerson[],
  ) {
    const positions = new Map(otherOrder.map((person, index) => [person.id, index]));
    let weighted = 0;
    let total = 0;

    for (const suggestion of suggestions) {
      const belongs =
        side === "payer"
          ? suggestion.fromPlayerId === personId
          : suggestion.toPlayerId === personId;
      if (!belongs) continue;

      const otherId =
        side === "payer" ? suggestion.toPlayerId : suggestion.fromPlayerId;
      const position = positions.get(otherId);
      if (position === undefined) continue;

      weighted += position * suggestion.amountCents;
      total += suggestion.amountCents;
    }

    return total > 0 ? weighted / total : Number.MAX_SAFE_INTEGER;
  }

  // A few barycentric passes are enough for this small bipartite graph and
  // greatly reduce crossings compared with alphabetical ordering.
  for (let pass = 0; pass < 4; pass += 1) {
    payers = payers.slice().sort((a, b) => {
      const delta =
        weightedNeighborPosition(a.id, "payer", receivers) -
        weightedNeighborPosition(b.id, "payer", receivers);
      return (
        delta ||
        b.totalCents - a.totalCents ||
        a.name.localeCompare(b.name, getLocale())
      );
    });

    receivers = receivers.slice().sort((a, b) => {
      const delta =
        weightedNeighborPosition(a.id, "receiver", payers) -
        weightedNeighborPosition(b.id, "receiver", payers);
      return (
        delta ||
        b.totalCents - a.totalCents ||
        a.name.localeCompare(b.name, getLocale())
      );
    });
  }

  const rowHeight = 84;
  const topPadding = 62;
  const bottomPadding = 62;
  const height = Math.max(
    360,
    Math.max(payers.length, receivers.length) * rowHeight + 72,
  );

  function distributedY(index: number, count: number) {
    if (count <= 1) return height / 2;
    const usable = height - topPadding - bottomPadding;
    return topPadding + (usable * index) / (count - 1);
  }

  const payerY = new Map(
    payers.map((player, index) => [player.id, distributedY(index, payers.length)]),
  );
  const receiverY = new Map(
    receivers.map((player, index) => [
      player.id,
      distributedY(index, receivers.length),
    ]),
  );
  const maxAmount = Math.max(1, ...suggestions.map((item) => item.amountCents));
  const outgoingIndex = new Map<string, number>();

  return (
    <div className="settlement-flow-card">
      <div className="settlement-flow-headings" aria-hidden="true">
        <span>{t("Zahlt")}</span>
        <span>{t("Erhält")}</span>
      </div>

      <svg
        className="settlement-network"
        viewBox={`0 0 720 ${height}`}
        role="img"
        aria-label={t("Visuelle Übersicht der empfohlenen Zahlungen")}
      >
        <defs>
          <marker
            id="settlement-arrowhead"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" className="settlement-network-arrowhead" />
          </marker>
          {payers.map((player) => {
            const y = payerY.get(player.id) ?? height / 2;
            return (
              <clipPath id={`settlement-payer-avatar-${player.id}`} key={`payer-clip-${player.id}`}>
                <circle cx="68" cy={y} r="25.5" />
              </clipPath>
            );
          })}
          {receivers.map((player) => {
            const y = receiverY.get(player.id) ?? height / 2;
            return (
              <clipPath id={`settlement-receiver-avatar-${player.id}`} key={`receiver-clip-${player.id}`}>
                <circle cx="652" cy={y} r="25.5" />
              </clipPath>
            );
          })}
        </defs>

        {suggestions.map((suggestion, index) => {
          const fromY = payerY.get(suggestion.fromPlayerId) ?? height / 2;
          const toY = receiverY.get(suggestion.toPlayerId) ?? height / 2;
          const strokeWidth = 2.2 + (suggestion.amountCents / maxAmount) * 4.8;
          const edgeIndex = outgoingIndex.get(suggestion.fromPlayerId) ?? 0;
          outgoingIndex.set(suggestion.fromPlayerId, edgeIndex + 1);

          const startX = 118;
          const endX = 602;
          const path = `M ${startX} ${fromY} C 250 ${fromY}, 470 ${toY}, ${endX} ${toY}`;
          const labelX = 258 + Math.min(edgeIndex, 2) * 28;
          const labelY =
            fromY + (toY - fromY) * 0.30 - 9 + Math.min(edgeIndex, 2) * 9;

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
                markerEnd="url(#settlement-arrowhead)"
              />
              <path d={path} className="settlement-network-hitarea" />
              <g transform={`translate(${labelX} ${labelY})`}>
                <rect
                  className="settlement-network-amount-pill"
                  x="-36"
                  y="-13"
                  width="72"
                  height="23"
                  rx="11.5"
                />
                <text
                  x="0"
                  y="3"
                  textAnchor="middle"
                  className="settlement-network-amount"
                >
                  {formatMoney(suggestion.amountCents)}
                </text>
              </g>
            </g>
          );
        })}

        {payers.map((player) => {
          const y = payerY.get(player.id) ?? height / 2;
          const isMe = player.id === currentPlayerId;
          const photo = profilePhotoFor(player.id);
          return (
            <g key={player.id} className={isMe ? "settlement-network-node is-me" : "settlement-network-node"}>
              <circle cx="68" cy={y} r="28" className="settlement-network-node-circle payer" />
              {photo ? (
                <image
                  href={photo}
                  x="42.5"
                  y={y - 25.5}
                  width="51"
                  height="51"
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#settlement-payer-avatar-${player.id})`}
                />
              ) : (
                <text x="68" y={y + 5} textAnchor="middle" className="settlement-network-initials">
                  {playerInitials(player.name)}
                </text>
              )}
              <text x="68" y={y + 42} textAnchor="middle" className="settlement-network-name">
                {personLabel(player.id, player.name, currentPlayerId)}
              </text>
            </g>
          );
        })}

        {receivers.map((player) => {
          const y = receiverY.get(player.id) ?? height / 2;
          const isMe = player.id === currentPlayerId;
          const photo = profilePhotoFor(player.id);
          return (
            <g key={player.id} className={isMe ? "settlement-network-node is-me" : "settlement-network-node"}>
              <circle cx="652" cy={y} r="28" className="settlement-network-node-circle receiver" />
              {photo ? (
                <image
                  href={photo}
                  x="626.5"
                  y={y - 25.5}
                  width="51"
                  height="51"
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#settlement-receiver-avatar-${player.id})`}
                />
              ) : (
                <text x="652" y={y + 5} textAnchor="middle" className="settlement-network-initials">
                  {playerInitials(player.name)}
                </text>
              )}
              <text x="652" y={y + 42} textAnchor="middle" className="settlement-network-name">
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
    window.addEventListener("pageshow", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [onDataChange]);

  const balanced = data !== null && data.totalOutstandingCents === 0 && data.groupDifferenceCents === 0;

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
        <strong>{t("Ausgleichen")}</strong>
        {!data ? (
          <small>{t("Lädt …")}</small>
        ) : balanced ? (
          <small>{t("Alles ausgeglichen")}</small>
        ) : (
          <span className="settlement-summary-amount">{formatMoney(data.totalOutstandingCents)}</span>
        )}
        {data && data.groupDifferenceCents !== 0 && (
          <em>{t("Offene Session-Differenz")}: {formatMoney(data.groupDifferenceCents)}</em>
        )}
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
  onDataChange,
}: {
  onClose: () => void;
  currentPlayerId: string | null;
  onCurrentPlayerChange: (playerId: string | null) => void;
  playerProfiles: PlayerProfile[];
  onDataChange: (data: SettlementResponse) => void;
}) {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [view, setView] = useState<SettlementView>(() =>
    window.localStorage.getItem("pokertracker-settlement-view") === "flow" ? "flow" : "list"
  );
  const [paymentAppOpeningKey, setPaymentAppOpeningKey] = useState<string | null>(null);
  const [paymentAppFallback, setPaymentAppFallback] = useState<PaymentAppFallback | null>(null);
  const [paymentAppNotice, setPaymentAppNotice] = useState("");
  const [copyingTransferKey, setCopyingTransferKey] = useState<string | null>(null);
  const [copiedTransferKey, setCopiedTransferKey] = useState<string | null>(null);
  const [error, setError] = useState("");

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
    window.addEventListener("pageshow", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [onDataChange]);

  useEffect(() => {
    if (!paymentAppNotice) return;
    const timeout = window.setTimeout(() => setPaymentAppNotice(""), 6500);
    return () => window.clearTimeout(timeout);
  }, [paymentAppNotice]);

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
          <p>{t("Offene Zahlungen und bereits erfasste Auszahlungen.")}</p>
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
                profilePhotoFor={profilePhotoFor}
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
                          <PlayerAvatar
                            className={
                              "settlement-flow-avatar settlement-flow-avatar-payer" +
                              (suggestion.fromPlayerId === currentPlayerId ? " is-me" : "")
                            }
                            name={suggestion.fromPlayerName}
                            photo={profilePhotoFor(suggestion.fromPlayerId)}
                          />
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
                          <span className="settlement-flow-arrow">→</span>
                        </div>

                        <div className="settlement-flow-player">
                          <PlayerAvatar
                            className={
                              "settlement-flow-avatar settlement-flow-avatar-receiver" +
                              (suggestion.toPlayerId === currentPlayerId ? " is-me" : "")
                            }
                            name={suggestion.toPlayerName}
                            photo={profilePhotoFor(suggestion.toPlayerId)}
                          />
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
                        <strong>{formatMoney(suggestion.amountCents)}</strong>
                        <button
                          type="button"
                          className={
                            "settlement-copy-button" +
                            (
                              copiedTransferKey === paypalKey
                                ? " is-copied"
                                : ""
                            )
                          }
                          aria-label={
                            copiedTransferKey === paypalKey
                              ? t("Betrag kopiert")
                              : t("Betrag kopieren")
                          }
                          disabled={copyingTransferKey === paypalKey}
                          onClick={() => copySuggestionAmount(suggestion)}
                        >
                          {copiedTransferKey === paypalKey ? (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m5.5 12.5 4.1 4.1L18.7 7.5" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="8" y="8" width="10" height="10" rx="2" />
                              <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>

                      <div className={
                        "settlement-payment-actions" +
                        (paypalAvailable ? "" : " single-action")
                      }>
                        {paypalAvailable && (
                          <div className="settlement-wallet-actions">
                            <button
                              className="paypal-payment-button"
                              type="button"
                              disabled={paymentAppOpeningKey === paypalKey + ":paypal"}
                              onClick={() => openPaymentApp(suggestion, "paypal")}
                            >
                              <img src={PAYPAL_MARK_URL} alt="" aria-hidden="true" />
                              <span>
                                {paymentAppOpeningKey === paypalKey + ":paypal"
                                  ? "…"
                                  : "PayPal"}
                              </span>
                            </button>

                            <button
                              className="revolut-payment-button"
                              type="button"
                              disabled={paymentAppOpeningKey === paypalKey + ":revolut"}
                              onClick={() => openPaymentApp(suggestion, "revolut")}
                            >
                              <img src={REVOLUT_WORDMARK_URL} alt="Revolut" />
                            </button>
                          </div>
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
                    <PlayerAvatar name={player.name} photo={profilePhotoFor(player.id)} />
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
