import { useId } from "react";

type OpenTableIllustrationProps = {
  playerCount: number;
};

// These are illustrative community cards, not a live record of anyone's hand.
const COMMUNITY_CARDS = [
  { rank: "K", suit: "♠", red: false },
  { rank: "7", suit: "♥", red: true },
  { rank: "9", suit: "♣", red: false },
  { rank: "4", suit: "♦", red: true },
  { rank: "A", suit: "♥", red: true },
] as const;

function FeltChip({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={"translate(" + x + " " + y + ")"} className={"open-table-chip is-" + color}>
      <ellipse className="open-table-chip-shadow" cx="0" cy="4.5" rx="5.2" ry="2.8" />
      <path className="open-table-chip-side" d="M-5 0v3.1a5 3.2 0 0 0 10 0V0Z" />
      <circle className="open-table-chip-face" cx="0" cy="0" r="5" />
      <circle className="open-table-chip-inset" cx="0" cy="0" r="3.15" />
      <path className="open-table-chip-markings" d="M0-5v1.6M0 3.4V5M-5 0h1.6M3.4 0H5" />
    </g>
  );
}

/**
 * A decorative seven-seat-style table with a quiet flop / turn / river cycle.
 * Seats reflect the actual participant count; cards and chips do not represent
 * live hands, results, chip totals or other session data.
 */
export function OpenTableIllustration({ playerCount }: OpenTableIllustrationProps) {
  const uniqueId = useId().replace(/:/g, "");
  const feltId = uniqueId + "-felt";
  const rimId = uniqueId + "-rim";
  const seats = Array.from(
    { length: Math.min(12, Math.max(0, playerCount)) },
    (_, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, Math.min(12, playerCount));
      return {
        x: 115 + 99 * Math.cos(angle),
        y: 78 + 60 * Math.sin(angle),
        rotation: (angle * 180) / Math.PI + 90,
      };
    },
  );

  return (
    <svg
      className="open-table-illustration"
      viewBox="0 0 230 156"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={feltId} cx="44%" cy="40%" r="72%">
          <stop offset="0%" stopColor="#184737" />
          <stop offset="100%" stopColor="#0d3127" />
        </radialGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2=".85" y2="1">
          <stop offset="0%" stopColor="#a99a78" />
          <stop offset="42%" stopColor="#67745c" />
          <stop offset="100%" stopColor="#ad9268" />
        </linearGradient>
      </defs>

      <ellipse className="open-table-shadow" cx="115" cy="85" rx="95" ry="51" />
      {seats.map((seat, index) => (
        <g
          key={index}
          className="open-table-chair"
          transform={
            "translate(" + seat.x.toFixed(2) + " " + seat.y.toFixed(2) +
            ") rotate(" + seat.rotation.toFixed(2) + ")"
          }
        >
          <rect className="open-table-chair-frame" x="-14" y="-8" width="28" height="16" rx="7.5" />
          <rect className="open-table-chair-cushion" x="-11.5" y="-5.8" width="23" height="11.6" rx="5.3" />
          <path className="open-table-chair-seam" d="M-8 3.25Q0 5.5 8 3.25" />
        </g>
      ))}

      <ellipse className="open-table-rim" cx="115" cy="78" rx="92" ry="49" fill={"url(#" + rimId + ")"} />
      <ellipse className="open-table-rail" cx="115" cy="78" rx="89.5" ry="46.5" />
      <ellipse className="open-table-felt" cx="115" cy="78" rx="84" ry="41" fill={"url(#" + feltId + ")"} />
      <ellipse className="open-table-felt-line" cx="115" cy="78" rx="75" ry="32" />

      <g className="open-table-chip-cluster">
        <FeltChip x={84} y={50} color="green" />
        <FeltChip x={93} y={52} color="gold" />
        <FeltChip x={169} y={58} color="black" />
        <FeltChip x={176} y={63} color="green" />
        <FeltChip x={64} y={96} color="black" />
        <FeltChip x={73} y={103} color="red" />
        <FeltChip x={154} y={108} color="red" />
        <FeltChip x={164} y={104} color="green" />
      </g>

      <g className="open-table-community-cards">
        {COMMUNITY_CARDS.map((card, index) => (
          <g key={index} transform={"translate(" + (79 + index * 14.5) + " 69)"}>
            <g
              className={
                "open-table-community-card" +
                (index === 3 ? " is-turn" : index === 4 ? " is-river" : " is-flop")
              }
            >
              <rect className="open-table-card-paper" x="0" y="0" width="12.2" height="19.4" rx="1.5" />
              <text
                className={"open-table-card-rank" + (card.red ? " is-red" : "")}
                x="2.2"
                y="6.9"
              >{card.rank}</text>
              <text
                className={"open-table-card-suit" + (card.red ? " is-red" : "")}
                x="6.1"
                y="14.7"
                textAnchor="middle"
              >{card.suit}</text>
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}
