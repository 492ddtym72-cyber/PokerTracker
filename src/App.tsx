import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createNight,
  deleteNight,
  loadHistory,
  loadNights,
  loadPlayers,
  loadPlayerProfilePhotoSource,
  updateNight,
  updateNightAdjustments,
  updatePlayerProfilePhoto,
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
import { SettlementScreen, SettlementSummary } from "./Settlement";
import { ProfilePhotoCropper } from "./ProfilePhotoCropper";
import { PlayerAvatar, playerInitials } from "./PlayerAvatar";
import type {
  AuditChange,
  AuditEvent,
  HistoryResponse,
  NightInput,
  PlayerProfile,
  PokerNight,
  SettlementResponse,
} from "./types";

type Screen = "home" | "history" | "players" | "settlement" | "more";
type ReconcileMode = "all" | "selected" | "custom";

const CURRENT_PLAYER_KEY = "pokertracker-current-player-id";

function storedCurrentPlayerId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CURRENT_PLAYER_KEY);
}

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

type PlayerCardDetails = PlayerStats & {
  rank: number | null;
  winRate: number;
  averageProfitCents: number;
  bestResultCents: number;
  worstResultCents: number;
  bestWinStreak: number;
  currentWinStreak: number;
  bestMonthLabel: string | null;
  bestMonthProfitCents: number;
  baselineCents: number;
  trend: number[];
};

function playerCardSuit(playerId: string) {
  const suits = ["♠", "♥", "♦", "♣"] as const;
  const hash = Array.from(playerId).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return suits[hash % suits.length];
}

function calculatePlayerCardDetails(
  player: PlayerStats,
  rank: number | null,
  nights: PokerNight[],
): PlayerCardDetails {
  const baselineCents = nights
    .filter((night) => night.recordType === "baseline")
    .reduce((sum, night) => {
      const result = night.players.find((candidate) => candidate.id === player.id);
      return sum + (result ? playerResultCents(result) : 0);
    }, 0);

  const appearances = nights
    .filter((night) => night.recordType === "session")
    .flatMap((night) => {
      const result = night.players.find((candidate) => candidate.id === player.id);
      return result
        ? [{
            playedAt: night.playedAt,
            createdAt: night.createdAt,
            resultCents: playerResultCents(result),
          }]
        : [];
    })
    .sort(
      (a, b) =>
        a.playedAt.localeCompare(b.playedAt) ||
        a.createdAt.localeCompare(b.createdAt),
    );

  let cumulative = baselineCents;
  let runningWinStreak = 0;
  let bestWinStreak = 0;
  const trend = [baselineCents];
  const monthTotals = new Map<string, number>();

  for (const appearance of appearances) {
    cumulative += appearance.resultCents;
    trend.push(cumulative);

    if (appearance.resultCents > 0) {
      runningWinStreak += 1;
      bestWinStreak = Math.max(bestWinStreak, runningWinStreak);
    } else {
      runningWinStreak = 0;
    }

    const monthKey = appearance.playedAt.slice(0, 7);
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + appearance.resultCents);
  }

  let currentWinStreak = 0;
  for (let index = appearances.length - 1; index >= 0; index -= 1) {
    if (appearances[index].resultCents <= 0) break;
    currentWinStreak += 1;
  }

  const results = appearances.map((appearance) => appearance.resultCents);
  const sessionProfitCents = results.reduce((sum, value) => sum + value, 0);
  const bestMonth = Array.from(monthTotals.entries()).sort(
    (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
  )[0];

  return {
    ...player,
    rank,
    winRate: player.nights > 0 ? player.wins / player.nights : 0,
    averageProfitCents: player.nights > 0 ? Math.round(sessionProfitCents / player.nights) : 0,
    bestResultCents: results.length > 0 ? Math.max(...results) : 0,
    worstResultCents: results.length > 0 ? Math.min(...results) : 0,
    bestWinStreak,
    currentWinStreak,
    bestMonthLabel: bestMonth
      ? new Date(bestMonth[0] + "-01T12:00:00").toLocaleDateString(getLocale(), {
          month: "long",
          year: "numeric",
        })
      : null,
    bestMonthProfitCents: bestMonth?.[1] ?? 0,
    baselineCents,
    trend,
  };
}

function PlayerTrendChart({ values }: { values: number[] }) {
  const width = 300;
  const height = 84;
  const padding = 7;
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const range = Math.max(1, maxValue - minValue);
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  const yFor = (value: number) =>
    padding + ((maxValue - value) / range) * (height - padding * 2);
  const points = values
    .map((value, index) => `${padding + index * step},${yFor(value)}`)
    .join(" ");
  const lastX = padding + Math.max(0, values.length - 1) * step;
  const lastY = yFor(values[values.length - 1] ?? 0);

  return (
    <svg
      className="player-trend-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("Bilanzverlauf")}
    >
      <line
        className="player-trend-zero"
        x1={padding}
        x2={width - padding}
        y1={yFor(0)}
        y2={yFor(0)}
      />
      <polyline className="player-trend-line" points={points} />
      <circle className="player-trend-dot" cx={lastX} cy={lastY} r="3.2" />
    </svg>
  );
}

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
      return t("Bilanz erfasst");
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

type ChipSuit = "spade" | "heart" | "diamond" | "club";

const CHIP_SUITS: ChipSuit[] = ["spade", "heart", "diamond", "club"];

function ChipSuitIcon({ suit }: { suit: ChipSuit }) {
  return (
    <svg
      className={`brand-chip-suit is-${suit}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {suit === "spade" && (
        <path d="M12 2.1C10.45 5.1 4.15 8.8 4.15 13.05c0 2.72 2.07 4.77 4.63 4.77 1.16 0 2.2-.42 3.02-1.16-.38 2.12-1.34 3.78-2.88 5.24h6.16c-1.54-1.46-2.5-3.12-2.88-5.24.82.74 1.86 1.16 3.02 1.16 2.56 0 4.63-2.05 4.63-4.77C19.85 8.8 13.55 5.1 12 2.1Z" />
      )}
      {suit === "heart" && (
        <path d="M12 21.2 10.48 19.8C5.08 14.85 1.5 11.58 1.5 7.55 1.5 4.28 4.05 2 7.12 2c1.73 0 3.39.8 4.88 2.32C13.49 2.8 15.15 2 16.88 2 19.95 2 22.5 4.28 22.5 7.55c0 4.03-3.58 7.3-8.98 12.25L12 21.2Z" />
      )}
      {suit === "diamond" && (
        <path d="M12 1.8 20.25 12 12 22.2 3.75 12 12 1.8Z" />
      )}
      {suit === "club" && (
        <>
          <circle cx="12" cy="7.2" r="4.35" />
          <circle cx="7.15" cy="13" r="4.35" />
          <circle cx="16.85" cy="13" r="4.35" />
          <path d="M10.55 13.7h2.9c.08 3.65.84 5.72 3.15 7.3H7.4c2.31-1.58 3.07-3.65 3.15-7.3Z" />
        </>
      )}
    </svg>
  );
}


function ProfileSwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="7.25" r="3.15" />
      <path d="M3.75 18.25c.55-3.15 2.38-5.05 5.25-5.05 1.55 0 2.8.53 3.72 1.5" />
      <path d="M15.35 8.2h4.7m-2.05-2.05 2.05 2.05L18 10.25" />
      <path d="M20.25 15.8h-4.7m2.05 2.05-2.05-2.05 2.05-2.05" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.75 7.75h2.1l1.2-2h7.9l1.2 2h2.1A1.75 1.75 0 0 1 21 9.5v8A1.75 1.75 0 0 1 19.25 19h-14A1.75 1.75 0 0 1 3.5 17.5v-8a1.75 1.75 0 0 1 1.25-1.75Z" />
      <circle cx="12.25" cy="13" r="3.35" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.7 12h16.6M12 3.25c2.15 2.35 3.3 5.25 3.3 8.75S14.15 18.4 12 20.75M12 3.25C9.85 5.6 8.7 8.5 8.7 12s1.15 6.4 3.3 8.75" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.25 4.25H6.5A2.25 2.25 0 0 0 4.25 6.5v11A2.25 2.25 0 0 0 6.5 19.75h3.75" />
      <path d="M13.25 8.25 17 12l-3.75 3.75M8.75 12H17" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9.5 5.75 6.25 6.25-6.25 6.25" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5.75 12.5 4 4 8.5-9" />
    </svg>
  );
}

function GermanyFlag() {
  return (
    <svg className="language-flag" viewBox="0 0 60 40" aria-hidden="true" focusable="false">
      <rect width="60" height="13.34" y="0" fill="#111111" />
      <rect width="60" height="13.34" y="13.33" fill="#DD0000" />
      <rect width="60" height="13.34" y="26.66" fill="#FFCE00" />
    </svg>
  );
}

function UnitedKingdomFlag() {
  return (
    <svg className="language-flag" viewBox="0 0 60 40" aria-hidden="true" focusable="false">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#FFFFFF" strokeWidth="8" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#C8102E" strokeWidth="4" />
      <path d="M30 0v40M0 20h60" stroke="#FFFFFF" strokeWidth="12" />
      <path d="M30 0v40M0 20h60" stroke="#C8102E" strokeWidth="7" />
    </svg>
  );
}

function AnimatedPokerChipPair({ onClick }: { onClick: () => void }) {
  const [motionEnabled, setMotionEnabled] = useState(true);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => setMotionEnabled(!mediaQuery.matches);

    syncMotionPreference();
    mediaQuery.addEventListener?.("change", syncMotionPreference);

    return () => mediaQuery.removeEventListener?.("change", syncMotionPreference);
  }, []);

  useEffect(() => {
    const leftCanvas = leftCanvasRef.current;
    const rightCanvas = rightCanvasRef.current;
    if (!leftCanvas || !rightCanvas) return;

    // Both chips share one requestAnimationFrame, easing curve and turn clock.
    // Keep the 32-unit 3D geometry and high-resolution 44px canvas unchanged.
    const size = 32;
    const displaySize = 44;
    const center = size / 2;
    const radius = 13.75;
    const halfThickness = 2.65;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const leftContext = leftCanvas.getContext("2d");
    const rightContext = rightCanvas.getContext("2d");
    if (!leftContext || !rightContext) return;
    const canvases = [leftCanvas, rightCanvas] as const;
    const contexts = [leftContext, rightContext] as const;

    for (let index = 0; index < canvases.length; index += 1) {
      const canvas = canvases[index];
      const context = contexts[index];
      canvas.width = Math.round(displaySize * dpr);
      canvas.height = Math.round(displaySize * dpr);
      const scale = canvas.width / size;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    }

    const suitGlyphs: Record<ChipSuit, string> = {
      spade: "♠",
      heart: "♥",
      diamond: "♦",
      club: "♣",
    };

    const drawHull = (
      context: CanvasRenderingContext2D,
      leftCenter: number,
      rightCenter: number,
      rx: number,
      sideVisibility: number,
    ) => {
      const safeRx = Math.max(rx, 0.02);
      const top = center - radius;
      const bottom = center + radius;
      const left = leftCenter - safeRx;
      const right = rightCenter + safeRx;
      const width = right - left;

      const traceHullPath = () => {
        context.beginPath();
        context.moveTo(leftCenter, top);
        context.lineTo(rightCenter, top);
        context.ellipse(
          rightCenter, center, safeRx, radius, 0,
          -Math.PI / 2, Math.PI / 2,
        );
        context.lineTo(leftCenter, bottom);
        context.ellipse(
          leftCenter, center, safeRx, radius, 0,
          Math.PI / 2, (Math.PI * 3) / 2,
        );
        context.closePath();
      };

      // A poker-chip edge is an opaque, dark clay cylinder, not a gold tube.
      // Subtle lighting changes across its thickness, but the base is solid.
      const clay = context.createLinearGradient(left, 0, right, 0);
      clay.addColorStop(0, "#081c17");
      clay.addColorStop(0.15, "#123629");
      clay.addColorStop(0.40, "#245441");
      clay.addColorStop(0.62, "#1b4433");
      clay.addColorStop(0.85, "#102c23");
      clay.addColorStop(1, "#081b16");

      context.save();
      traceHullPath();
      context.fillStyle = clay;
      context.globalAlpha = 1;
      context.shadowColor = "rgba(0,0,0,.48)";
      context.shadowBlur = 2.4;
      context.shadowOffsetY = 1;
      context.fill();
      context.restore();

      context.save();
      traceHullPath();
      context.clip();

      // Four thick metallic-gold inlays around the circumference: these are
      // real poker-chip edge spots rather than the uniform lines of a tube.
      // They remain physically part of the opaque sidewall at every angle.
      if (width > 2) {
        const inlay = context.createLinearGradient(left, 0, right, 0);
        inlay.addColorStop(0, "#614a2b");
        inlay.addColorStop(0.24, "#bb9853");
        inlay.addColorStop(0.50, "#edce82");
        inlay.addColorStop(0.74, "#b69350");
        inlay.addColorStop(1, "#5e4829");

        // As the chip becomes edge-on the color blocks, not transparency,
        // reveal the three-dimensional molded rim.
        context.globalAlpha = Math.min(1, sideVisibility * 1.4);
        for (const degrees of [-60, -20, 20, 60]) {
          const phi = (degrees * Math.PI) / 180;
          const y = center + Math.sin(phi) * radius;
          const stripeHeight = 2.9 - Math.abs(Math.sin(phi)) * 0.7;
          const inset = Math.min(0.65, width / 8);

          context.fillStyle = inlay;
          context.fillRect(
            left + inset,
            y - stripeHeight / 2,
            width - inset * 2,
            stripeHeight,
          );

          // Fine inset seams: no long horizontal lines across the entire rim.
          context.fillStyle = "rgba(8,22,17,.50)";
          context.fillRect(
            left + inset,
            y - stripeHeight / 2 - 0.45,
            width - inset * 2,
            0.48,
          );
          context.fillRect(
            left + inset,
            y + stripeHeight / 2 - 0.03,
            width - inset * 2,
            0.48,
          );
        }
      }

      // Thin raised lips make the two face/edge boundaries legible at 32px.
      // They are vertical (across the chip thickness), and stay clipped.
      if (width > 2.2) {
        context.globalAlpha = Math.min(0.88, sideVisibility * 1.2);
        context.lineWidth = 0.58;

        for (const x of [left + 0.72, right - 0.72]) {
          context.strokeStyle = "rgba(239,206,128,.68)";
          context.beginPath();
          context.moveTo(x, top + 1.5);
          context.lineTo(x, bottom - 1.5);
          context.stroke();
        }
      }
      context.restore();

      context.save();
      traceHullPath();
      context.strokeStyle = "rgba(195,162,88,.65)";
      context.lineWidth = 0.65;
      context.stroke();
      context.restore();
    };

    const drawFace = (
      context: CanvasRenderingContext2D,
      faceCenterX: number,
      faceScale: number,
      suit: ChipSuit,
    ) => {
      context.save();
      context.translate(faceCenterX, center);
      context.scale(Math.max(faceScale, 0.026), 1);
      // The molded face is always fully opaque. Only its decorative details
      // become less legible when foreshortened, never the underlying material.
      context.globalAlpha = 1;

      const faceGradient = context.createRadialGradient(
        -radius * 0.28,
        -radius * 0.34,
        1,
        0,
        0,
        radius,
      );
      faceGradient.addColorStop(0, "#285642");
      faceGradient.addColorStop(0.56, "#12382b");
      faceGradient.addColorStop(1, "#09261d");

      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fillStyle = faceGradient;
      context.fill();
      context.strokeStyle = "#b99d57";
      context.lineWidth = 1.15;
      context.stroke();

      context.globalAlpha = Math.max(
        0,
        Math.min(1, (faceScale - 0.16) / 0.32),
      );

      context.beginPath();
      context.arc(0, 0, radius - 3, 0, Math.PI * 2);
      context.strokeStyle = "rgba(231,198,117,.48)";
      context.lineWidth = 1;
      context.stroke();

      context.beginPath();
      context.arc(0, 0, radius - 6.1, 0, Math.PI * 2);
      context.strokeStyle = "rgba(231,198,117,.22)";
      context.lineWidth = 0.8;
      context.stroke();

      context.strokeStyle = "#dfc174";
      context.lineWidth = 2.35;
      context.lineCap = "butt";

      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        const inner = radius - 2.8;
        const outer = radius - 0.25;
        context.beginPath();
        context.moveTo(
          Math.cos(angle) * inner,
          Math.sin(angle) * inner,
        );
        context.lineTo(
          Math.cos(angle) * outer,
          Math.sin(angle) * outer,
        );
        context.stroke();
      }

      const isRed = suit === "heart" || suit === "diamond";
      context.fillStyle = isRed ? "#cf6b65" : "#f1dfac";
      context.shadowColor = "rgba(0,0,0,.34)";
      context.shadowBlur = 1.2;
      context.shadowOffsetY = 0.7;
      context.font = '700 14px Georgia, "Times New Roman", serif';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(suitGlyphs[suit], 0, 0.65);

      context.restore();
    };

    const drawChip = (
      context: CanvasRenderingContext2D,
      angle: number,
      suit: ChipSuit,
      zRotation = 0,
    ) => {
      // Clear in canvas coordinates before rotating the entire rendered chip.
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(center, center);
      context.rotate(zRotation);
      context.translate(-center, -center);

      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const faceScale = Math.abs(cosine);
      const sideVisibility = Math.abs(sine);
      const faceRx = radius * faceScale;
      const projectedHalfThickness = halfThickness * sideVisibility;
      const leftCenter = center - projectedHalfThickness;
      const rightCenter = center + projectedHalfThickness;

      drawHull(context, leftCenter, rightCenter, faceRx, sideVisibility);

      const nearFaceSign = cosine >= 0 ? 1 : -1;
      const nearFaceCenter =
        center + nearFaceSign * halfThickness * sine;
      // Draw the nearest surface as opaque clay. Only the last few degrees
      // are edge-only, when the face is physically too thin to be visible.
      if (faceScale > 0.075) {
        drawFace(context, nearFaceCenter, faceScale, suit);
      }
      context.restore();
    };

    // Offset the right chip by exactly one turn in the four-turn sequence:
    // one chip flips around Y while the other spins around Z, then they swap.
    // Canvas positive rotation is clockwise (Y coordinates point down).
    const turnModes = [
      "flipY",
      "spinZClockwise",
      "flipY",
      "spinZCounterclockwise",
    ] as const;

    // One Y flip advances the suit, so the right chip begins one turn ahead.
    const chipStates = [
      { suitIndex: 0, restingAngle: 0 },
      { suitIndex: 1, restingAngle: Math.PI },
    ];
    const drawRestingChips = () => {
      for (let index = 0; index < chipStates.length; index += 1) {
        const chip = chipStates[index];
        drawChip(contexts[index], chip.restingAngle, CHIP_SUITS[chip.suitIndex]);
      }
    };

    let disposed = false;
    let frame: number | undefined;
    let timer: number | undefined;
    let turnIndex = 0;
    let turning = false;

    const cancelScheduledWork = () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
        frame = undefined;
      }
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const scheduleNextTurn = (delay = 950) => {
      if (
        disposed ||
        !motionEnabled ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        startTurn();
      }, delay);
    };

    const startTurn = () => {
      if (
        disposed ||
        turning ||
        !motionEnabled ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      turning = true;
      const startedAt = performance.now();
      const duration = 1900;
      const startingAngles = chipStates.map((chip) => chip.restingAngle);
      const modes = [
        turnModes[turnIndex],
        turnModes[(turnIndex + 1) % turnModes.length],
      ];

      const animate = (now: number) => {
        if (
          disposed ||
          !motionEnabled ||
          document.visibilityState !== "visible"
        ) {
          turning = false;
          drawRestingChips();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);

        // Both surfaces are drawn on the same frame with the same progress.
        // Only the rotation axis and sequence phase differ.
        for (let index = 0; index < chipStates.length; index += 1) {
          const chip = chipStates[index];
          const mode = modes[index];
          const isFlip = mode === "flipY";
          const angle = isFlip
            ? startingAngles[index] + Math.PI * eased
            : startingAngles[index];
          const zRotation = isFlip
            ? 0
            : (mode === "spinZClockwise" ? 1 : -1) * Math.PI * 2 * eased;
          const visibleSuitIndex =
            (chip.suitIndex + (isFlip && progress >= 0.5 ? 1 : 0)) %
            CHIP_SUITS.length;

          drawChip(
            contexts[index],
            angle,
            CHIP_SUITS[visibleSuitIndex],
            zRotation,
          );
        }

        if (progress < 1) {
          frame = window.requestAnimationFrame(animate);
          return;
        }

        frame = undefined;
        for (let index = 0; index < chipStates.length; index += 1) {
          if (modes[index] === "flipY") {
            chipStates[index].suitIndex =
              (chipStates[index].suitIndex + 1) % CHIP_SUITS.length;
            chipStates[index].restingAngle = startingAngles[index] + Math.PI;
          }
        }
        turnIndex = (turnIndex + 1) % turnModes.length;
        turning = false;
        drawRestingChips();
        scheduleNextTurn(1000);
      };

      frame = window.requestAnimationFrame(animate);
    };

    const handleVisibility = () => {
      cancelScheduledWork();
      turning = false;

      if (document.visibilityState === "visible") {
        drawRestingChips();
        scheduleNextTurn(500);
      }
    };

    drawRestingChips();

    if (motionEnabled) {
      scheduleNextTurn(650);
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      disposed = true;
      cancelScheduledWork();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [motionEnabled]);

  return (
    <button className="brand-button" type="button" onClick={onClick}>
      <span className="brand-chip-scene" aria-hidden="true">
        <canvas ref={leftCanvasRef} className="brand-chip-canvas" />
      </span>
      <strong>PokerTracker</strong>
      <span className="brand-chip-scene" aria-hidden="true">
        <canvas ref={rightCanvasRef} className="brand-chip-canvas" />
      </span>
    </button>
  );
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => getLanguage());
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(
    () => storedCurrentPlayerId(),
  );
  const [screen, setScreen] = useState<Screen>("home");
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [playerCardId, setPlayerCardId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailNightId, setDetailNightId] = useState<string | null>(null);
  const [nights, setNights] = useState<PokerNight[]>([]);
  const [playerProfiles, setPlayerProfiles] = useState<PlayerProfile[]>([]);
  // Keep the latest settlement snapshot across screen changes.
  const [settlementData, setSettlementData] = useState<SettlementResponse | null>(null);
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
  const [profilePhotoSaving, setProfilePhotoSaving] = useState(false);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<{
    playerId: string;
    photo: string | null;
  } | null>(null);
  const [profilePhotoCropSource, setProfilePhotoCropSource] = useState<File | string | null>(null);
  const [profilePhotoSourceLoading, setProfilePhotoSourceLoading] = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");

  async function refreshNights() {
    const data = await loadNights();
    setNights(data);
    return data;
  }

  async function refreshPlayers() {
    const data = await loadPlayers();
    setPlayerProfiles(data);
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
    await Promise.all([refreshNights(), refreshPlayers()]);

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
      refreshPlayers(),
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
      const countsAsSession = night.recordType === "session";

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
        existing.profitCents += profit;
        existing.stakeCents += player.stakeCents;
        existing.cashOutCents += player.cashOutCents;

        if (countsAsSession) {
          existing.nights += 1;
          if (profit > 0) existing.wins += 1;
        }

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

  const knownPlayers = useMemo<Array<{ id: string; name: string }>>(
    () => {
      const source = playerProfiles.length > 0
        ? playerProfiles.map(({ id, name }) => ({ id, name }))
        : stats.map(({ id, name }) => ({ id, name }));

      return source.sort((a, b) => a.name.localeCompare(b.name));
    },
    [playerProfiles, stats],
  );

  const profilePhotoByPlayer = useMemo(
    () => new Map(playerProfiles.map((player) => [player.id, player.profilePhoto])),
    [playerProfiles],
  );

  function profilePhotoFor(playerId: string | null | undefined) {
    if (!playerId) return null;
    if (profilePhotoPreview?.playerId === playerId) return profilePhotoPreview.photo;
    return profilePhotoByPlayer.get(playerId) ?? null;
  }

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

  useEffect(() => {
    if (!profileSwitcherOpen && !playerCardId && !profilePhotoCropSource) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProfileSwitcherOpen(false);
      setPlayerCardId(null);
      if (!profilePhotoSaving) setProfilePhotoCropSource(null);
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileSwitcherOpen, playerCardId, profilePhotoCropSource, profilePhotoSaving]);

  function changeLanguage(next: Language) {
    setLanguagePreference(next);
    setLanguage(next);
    setError("");
  }

  function changeCurrentPlayer(playerId: string | null) {
    setCurrentPlayerId(playerId);

    if (playerId) {
      window.localStorage.setItem(CURRENT_PLAYER_KEY, playerId);
    } else {
      window.localStorage.removeItem(CURRENT_PLAYER_KEY);
    }

    setError("");
  }

  async function saveProfilePhoto(profilePhoto: string, sourcePhoto: string) {
    if (!currentPlayerId) return t("Bitte zuerst ein Profil auswählen.");

    const playerId = currentPlayerId;
    setProfilePhotoSaving(true);
    setProfilePhotoPreview({ playerId, photo: profilePhoto });
    setError("");

    try {
      await updatePlayerProfilePhoto(playerId, profilePhoto, sourcePhoto);
      setPlayerProfiles((current) =>
        current.map((player) =>
          player.id === playerId ? { ...player, profilePhoto } : player,
        ),
      );
      setProfilePhotoPreview(null);
      return null;
    } catch (err) {
      setProfilePhotoPreview(null);
      const message =
        err instanceof Error
          ? err.message
          : t("Profilfoto konnte nicht gespeichert werden.");
      setError(message);
      return message;
    } finally {
      setProfilePhotoSaving(false);
    }
  }

  async function editCurrentProfilePhoto() {
    if (!currentPlayerId || profilePhotoSaving || profilePhotoSourceLoading) return;
    const playerId = currentPlayerId;
    const currentPhoto = profilePhotoFor(playerId);

    if (!currentPhoto) {
      profilePhotoInputRef.current?.click();
      return;
    }

    setProfilePhotoSourceLoading(true);
    setError("");
    try {
      const { sourcePhoto } = await loadPlayerProfilePhotoSource(playerId);
      // Ignore a response if another profile was selected while loading.
      if (storedCurrentPlayerId() === playerId) {
        setProfilePhotoCropSource(sourcePhoto ?? currentPhoto);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Fotovorlage konnte nicht geladen werden."),
      );
    } finally {
      setProfilePhotoSourceLoading(false);
    }
  }

  async function removeProfilePhoto() {
    if (!currentPlayerId) return;

    const playerId = currentPlayerId;
    setProfilePhotoSaving(true);
    setProfilePhotoPreview({ playerId, photo: null });
    setError("");

    try {
      await updatePlayerProfilePhoto(playerId, null);
      setPlayerProfiles((current) =>
        current.map((player) =>
          player.id === playerId ? { ...player, profilePhoto: null } : player,
        ),
      );
      setProfilePhotoPreview(null);
    } catch (err) {
      setProfilePhotoPreview(null);
      setError(
        err instanceof Error
          ? err.message
          : t("Profilfoto konnte nicht gespeichert werden."),
      );
    } finally {
      setProfilePhotoSaving(false);
    }
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

  function CurrentProfileBadge({ showHint = false }: { showHint?: boolean }) {
    const currentPlayer = knownPlayers.find((player) => player.id === currentPlayerId);

    if (!currentPlayer) {
      // Keep profile selection available without taking space in the home content.
      // The small hint only appears after the player list has loaded.
      return (
        <div className="profile-prompt-anchor">
          <button
            type="button"
            className="profile-prompt-trigger"
            aria-label={t("Profil wählen")}
            title={t("Profil wählen")}
            disabled={loading || knownPlayers.length === 0}
            onClick={() => setProfileSwitcherOpen(true)}
          >
            <ProfileSwitchIcon />
            <span className="profile-prompt-indicator" aria-hidden="true" />
          </button>
          {showHint && !loading && knownPlayers.length > 0 && (
            <button
              type="button"
              className="profile-prompt-bubble"
              onClick={() => setProfileSwitcherOpen(true)}
            >
              {t("Profil wählen")}
            </button>
          )}
        </div>
      );
    }

    return (
      <button
        type="button"
        className="current-profile-badge"
        aria-label={t("Profil wechseln") + ": " + currentPlayer.name}
        title={t("Profil wechseln")}
        onClick={() => setProfileSwitcherOpen(true)}
      >
        <PlayerAvatar
          className="current-profile-avatar"
          name={currentPlayer.name}
          photo={profilePhotoFor(currentPlayer.id)}
        />
        <strong>{currentPlayer.name}</strong>
      </button>
    );
  }

  function ProfileSwitcherDialog() {
    if (!profileSwitcherOpen) return null;

    return (
      <div
        className="profile-switcher-overlay"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setProfileSwitcherOpen(false);
        }}
      >
        <section
          className="profile-switcher-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-switcher-title"
        >
          <div className="profile-switcher-header">
            <div>
              <h2 id="profile-switcher-title">{currentPlayerId ? t("Profil wechseln") : t("Profil wählen")}</h2>
              <p>{t("Wer verwendet PokerTracker auf diesem Gerät?")}</p>
            </div>
            <button
              type="button"
              className="profile-switcher-close"
              aria-label={t("Schließen")}
              onClick={() => setProfileSwitcherOpen(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
              </svg>
            </button>
          </div>

          <div className="profile-switcher-list">
            {knownPlayers.map((player) => {
              const active = player.id === currentPlayerId;

              return (
                <button
                  key={player.id}
                  type="button"
                  className={"profile-switcher-option" + (active ? " is-active" : "")}
                  aria-pressed={active}
                  onClick={() => {
                    changeCurrentPlayer(player.id);
                    setProfileSwitcherOpen(false);
                  }}
                >
                  <PlayerAvatar
                    className="profile-switcher-avatar"
                    name={player.name}
                    photo={profilePhotoFor(player.id)}
                  />
                  <strong>{player.name}</strong>
                  <span className="profile-switcher-check" aria-hidden="true">
                    {active && <CheckIcon />}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="profile-switcher-none"
            onClick={() => {
              changeCurrentPlayer(null);
              setProfileSwitcherOpen(false);
            }}
          >
            {t("Kein Profil verwenden")}
          </button>
        </section>
      </div>
    );
  }

  function PlayerCardDialog() {
    if (!playerCardId) return null;

    const profile = knownPlayers.find((player) => player.id === playerCardId);
    const statsIndex = stats.findIndex((player) => player.id === playerCardId);
    const player = statsIndex >= 0
      ? stats[statsIndex]
      : profile
        ? {
            id: profile.id,
            name: profile.name,
            nights: 0,
            stakeCents: 0,
            cashOutCents: 0,
            profitCents: 0,
            wins: 0,
          }
        : null;

    if (!player) return null;

    const details = calculatePlayerCardDetails(
      player,
      statsIndex >= 0 ? statsIndex + 1 : null,
      nights,
    );
    const suit = playerCardSuit(player.id);
    const redSuit = suit === "♥" || suit === "♦";
    const winRate = details.nights > 0
      ? new Intl.NumberFormat(getLocale(), {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(details.winRate)
      : "—";

    return (
      <div
        className="player-card-overlay"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPlayerCardId(null);
        }}
      >
        <section
          className={"player-card-dialog" + (redSuit ? " is-red-suit" : "")}
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-card-name"
        >
          <div className="player-card-corner player-card-corner-top" aria-hidden="true">
            {details.rank !== null && <strong>{details.rank}</strong>}
            <span>{suit}</span>
          </div>
          <div className="player-card-corner player-card-corner-bottom" aria-hidden="true">
            {details.rank !== null && <strong>{details.rank}</strong>}
            <span>{suit}</span>
          </div>

          <button
            className="player-card-close"
            type="button"
            aria-label={t("Schließen")}
            onClick={() => setPlayerCardId(null)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
            </svg>
          </button>

          <div className="player-card-identity">
            <div
              className={
                "framed-avatar player-card-avatar-frame " +
                (details.rank !== null && details.rank <= 3
                  ? "frame-rank-" + details.rank
                  : "frame-neutral")
              }
            >
              <PlayerAvatar
                className="framed-avatar-core"
                name={player.name}
                photo={profilePhotoFor(player.id)}
              />
              <img src={leaderboardFrame(details.rank ?? 4)} alt="" aria-hidden="true" />
            </div>
            <h2 id="player-card-name">{player.name}</h2>
            {details.rank !== null && (
              <span className="player-card-visually-hidden">{t("Rang")} {details.rank}</span>
            )}
          </div>

          <div className="player-card-balance">
            <strong className={details.profitCents >= 0 ? "positive" : "negative"}>
              {details.profitCents > 0 ? "+" : ""}{formatMoney(details.profitCents)}
            </strong>
          </div>

          <div className="player-card-quick-stats">
            <div>
              <strong>{details.nights}</strong>
              <span>{t("Pokerabende")}</span>
            </div>
            <div>
              <strong>{winRate}</strong>
              <span>{t("Gewinnquote")}</span>
            </div>
            <div>
              <strong>{details.nights > 0
                ? (details.averageProfitCents > 0 ? "+" : "") + formatMoney(details.averageProfitCents)
                : "—"}</strong>
              <span>{t("Ø pro Abend")}</span>
            </div>
          </div>

          <div className="player-card-records">
            <div>
              <span>{t("Bester Abend")}</span>
              <strong className={details.bestResultCents >= 0 ? "positive" : "negative"}>
                {details.nights > 0
                  ? (details.bestResultCents > 0 ? "+" : "") + formatMoney(details.bestResultCents)
                  : "—"}
              </strong>
            </div>
            <div>
              <span>{t("Schwächster Abend")}</span>
              <strong className={details.worstResultCents >= 0 ? "positive" : "negative"}>
                {details.nights > 0
                  ? (details.worstResultCents > 0 ? "+" : "") + formatMoney(details.worstResultCents)
                  : "—"}
              </strong>
            </div>
            <div className="player-card-best-month">
              <span>{t("Bester Monat")}</span>
              <strong>{details.bestMonthLabel ?? "—"}</strong>
              {details.bestMonthLabel && (
                <small className={details.bestMonthProfitCents >= 0 ? "positive" : "negative"}>
                  {details.bestMonthProfitCents > 0 ? "+" : ""}{formatMoney(details.bestMonthProfitCents)}
                </small>
              )}
            </div>
          </div>

          <div className="player-card-trend">
            <div className="player-card-trend-heading">
              <span>{t("Bilanzverlauf")}</span>
            </div>
            <PlayerTrendChart values={details.trend} />
          </div>
        </section>
      </div>
    );
  }

  function Header() {
    return (
      <header className="app-header">
        <AnimatedPokerChipPair onClick={() => navigate("home")} />
        <CurrentProfileBadge showHint={screen === "home"} />
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
          <span>•••</span><small>{t("Einstellungen")}</small>
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
            <CurrentProfileBadge />
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
                        <PlayerAvatar
                          name={player.name || "?"}
                          photo={profilePhotoFor(player.playerId)}
                        />
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
        <ProfileSwitcherDialog />
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
            <div className="page-header-copy">
              <h1>{detailNight.title}</h1>
              <p>{formatDate(detailNight.playedAt)}</p>
            </div>
            <CurrentProfileBadge />
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
                        <PlayerAvatar name={player.name} photo={profilePhotoFor(player.id)} />
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
                  <PlayerAvatar name={player.name} photo={profilePhotoFor(player.id)} />
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
        <ProfileSwitcherDialog />
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

            <button className="dashboard-action-card" type="button" onClick={startNew}>
              <span className="dashboard-action-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48" focusable="false">
                  <path d="M24 11v26M11 24h26" />
                </svg>
              </span>
              <span className="dashboard-action-divider" aria-hidden="true" />
              <span className="dashboard-action-copy">
                <strong>{t("Neuer Pokerabend")}</strong>
              </span>
              <span className="dashboard-action-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><path d="m9 5 7 7-7 7" /></svg>
              </span>
            </button>

            <SettlementSummary
              onOpen={() => navigate("settlement")}
              data={settlementData}
              onDataChange={setSettlementData}
            />

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

        {screen === "settlement" && (
          <SettlementScreen
            onClose={() => navigate("home")}
            currentPlayerId={currentPlayerId}
            onCurrentPlayerChange={changeCurrentPlayer}
            playerProfiles={playerProfiles}
            onDataChange={setSettlementData}
          />
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
                    <div
                      className={
                        "podium-slot podium-rank-" + rank +
                        (player ? " is-clickable" : "")
                      }
                      key={rank}
                      role={player ? "button" : undefined}
                      tabIndex={player ? 0 : undefined}
                      aria-label={player ? player.name + " · " + t("Spielerprofil") : undefined}
                      onClick={() => {
                        if (player) setPlayerCardId(player.id);
                      }}
                      onKeyDown={(event) => {
                        if (!player || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        setPlayerCardId(player.id);
                      }}
                    >
                      {player ? (
                        <>
                          <div className={"framed-avatar podium-avatar frame-rank-" + rank}>
                            <PlayerAvatar
                              className="framed-avatar-core"
                              name={player.name}
                              photo={profilePhotoFor(player.id)}
                            />
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

                    return (
                      <article
                        className="leaderboard-row is-clickable"
                        key={player.id}
                        role="button"
                        tabIndex={0}
                        aria-label={player.name + " · " + t("Spielerprofil")}
                        onClick={() => setPlayerCardId(player.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setPlayerCardId(player.id);
                        }}
                      >
                        <span className={"leaderboard-rank leaderboard-place-" + rank}>{rank}</span>
                        <div className={"framed-avatar leaderboard-mini-avatar " + (rank <= 3 ? "frame-rank-" + rank : "frame-neutral")}>
                          <PlayerAvatar
                            className="framed-avatar-core"
                            name={player.name}
                            photo={profilePhotoFor(player.id)}
                          />
                          <img src={leaderboardFrame(rank)} alt="" aria-hidden="true" />
                        </div>
                        <div className="leaderboard-info">
                          <div className="leaderboard-primary-line">
                            <strong className="leaderboard-player-name">{player.name}</strong>
                            <b className={"leaderboard-balance " + (player.profitCents >= 0 ? "positive" : "negative")}>
                              {player.profitCents > 0 ? "+" : ""}{formatMoney(player.profitCents)}
                            </b>
                          </div>
                          <div className="leaderboard-stat-cells">
                            <span className="leaderboard-stat-cell">
                              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <rect x="3.5" y="5" width="17" height="16" rx="2" />
                                <path d="M7.5 3v4m9-4v4M3.5 10h17" />
                              </svg>
                              <span><strong>{player.nights}</strong> {t(player.nights === 1 ? "Abend" : "Abende")}</span>
                            </span>
                            <span className="leaderboard-stat-cell">
                              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <circle cx="12" cy="12" r="9" />
                                <circle cx="12" cy="12" r="4.1" />
                                <path d="M12 3v4.5m0 9V21M3 12h4.5m9 0H21" />
                              </svg>
                              <span><strong>{formatMoney(player.stakeCents)}</strong> {t("Einsatz")}</span>
                            </span>
                          </div>
                        </div>
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
            <div className="screen-heading settings-screen-heading">
              <h1>{t("Einstellungen")}</h1>
            </div>

            <section className="settings-card identity-settings-card profile-device-card">
              <div className="profile-device-heading">
                <h2>{t("Profil auf diesem Gerät")}</h2>
              </div>

              <div className="profile-device-center">
                {currentPlayerId ? (
                  <>
                    <div className="profile-device-avatar-wrap">
                      <button
                        type="button"
                        className="profile-device-avatar-button"
                        aria-label={profilePhotoFor(currentPlayerId)
                          ? t("Profilbild erneut zuschneiden")
                          : t("Foto auswählen")}
                        title={profilePhotoFor(currentPlayerId)
                          ? t("Profilbild erneut zuschneiden")
                          : t("Foto auswählen")}
                        disabled={profilePhotoSaving || profilePhotoSourceLoading}
                        onClick={() => void editCurrentProfilePhoto()}
                      >
                        <PlayerAvatar
                          className="profile-device-avatar"
                          name={knownPlayers.find((player) => player.id === currentPlayerId)?.name ?? "?"}
                          photo={profilePhotoFor(currentPlayerId)}
                        />
                      </button>

                      <label
                        className={
                          "profile-device-camera" +
                          (profilePhotoSaving || profilePhotoSourceLoading ? " is-disabled" : "")
                        }
                        aria-label={
                          profilePhotoFor(currentPlayerId)
                            ? t("Foto ändern")
                            : t("Foto auswählen")
                        }
                      >
                        <CameraIcon />
                        <input
                          ref={profilePhotoInputRef}
                          className="profile-photo-input"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={profilePhotoSaving || profilePhotoSourceLoading}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (!file) return;
                            setError("");
                            setProfilePhotoCropSource(file);
                          }}
                        />
                      </label>
                    </div>

                    <strong className="profile-device-name">
                      {knownPlayers.find((player) => player.id === currentPlayerId)?.name ?? ""}
                    </strong>

                    <p className="profile-device-hint">
                      {profilePhotoSaving
                        ? t("Foto wird gespeichert …")
                        : profilePhotoSourceLoading
                          ? t("Foto wird geladen …")
                          : profilePhotoFor(currentPlayerId)
                            ? t("Tippe auf das Profilbild, um den Ausschnitt zu ändern.")
                            : t("Tippe auf das Kamera-Symbol, um ein Profilbild zu wählen.")}
                    </p>
                  </>
                ) : (
                  <>
                    <span className="profile-device-avatar profile-device-avatar-empty" aria-hidden="true">
                      <ProfileSwitchIcon />
                    </span>
                    <strong className="profile-device-name">{t("Keine Person ausgewählt")}</strong>
                  </>
                )}
              </div>

              <button
                className="profile-device-switch"
                type="button"
                onClick={() => setProfileSwitcherOpen(true)}
              >
                <span className="profile-device-switch-icon" aria-hidden="true">
                  <ProfileSwitchIcon />
                </span>
                <strong>{t("Profil wechseln")}</strong>
                <span className="settings-chevron"><ChevronIcon /></span>
              </button>

              {currentPlayerId && (
                <button
                  className="player-card-settings-link profile-player-card-link"
                  type="button"
                  onClick={() => setPlayerCardId(currentPlayerId)}
                >
                  <span className="player-card-settings-suit" aria-hidden="true">
                    {playerCardSuit(currentPlayerId)}
                  </span>
                  <span className="player-card-settings-copy">
                    <strong>{t("Meine Spielerkarte")}</strong>
                    <small>{t("Statistiken & Verlauf")}</small>
                  </span>
                  <span className="settings-chevron"><ChevronIcon /></span>
                </button>
              )}
            </section>

            <section className="settings-card language-settings-card settings-compact-card">
              <div className="settings-card-title">
                <span className="settings-title-icon"><GlobeIcon /></span>
                <h2>{t("Sprache")}</h2>
              </div>

              <div className="language-picker" role="group" aria-label={t("Sprache")}>
                <button
                  type="button"
                  className={language === "de" ? "active" : ""}
                  aria-pressed={language === "de"}
                  onClick={() => changeLanguage("de")}
                >
                  <span className="language-flag-shell"><GermanyFlag /></span>
                  <strong>Deutsch</strong>
                  <span className="language-state" aria-hidden="true">
                    {language === "de" && <CheckIcon />}
                  </span>
                </button>
                <button
                  type="button"
                  className={language === "en" ? "active" : ""}
                  aria-pressed={language === "en"}
                  onClick={() => changeLanguage("en")}
                >
                  <span className="language-flag-shell"><UnitedKingdomFlag /></span>
                  <strong>English</strong>
                  <span className="language-state" aria-hidden="true">
                    {language === "en" && <CheckIcon />}
                  </span>
                </button>
              </div>
            </section>

            <section className="settings-card logout-settings-card">
              <form action="/api/logout" method="post">
                <button className="settings-logout-button" type="submit">
                  <span className="settings-action-icon"><LogoutIcon /></span>
                  <strong>{t("Abmelden")}</strong>
                  <span className="settings-chevron"><ChevronIcon /></span>
                </button>
              </form>
            </section>
          </>
        )}
      </div>

      <BottomNav />
      <ProfileSwitcherDialog />
      <PlayerCardDialog />
      {profilePhotoCropSource && (
        <ProfilePhotoCropper
          source={profilePhotoCropSource}
          saving={profilePhotoSaving}
          onCancel={() => {
            if (!profilePhotoSaving) setProfilePhotoCropSource(null);
          }}
          onConfirm={async (photo, sourcePhoto) => {
            const saveError = await saveProfilePhoto(photo, sourcePhoto);
            if (!saveError) setProfilePhotoCropSource(null);
            return saveError;
          }}
        />
      )}
    </main>
  );
}
