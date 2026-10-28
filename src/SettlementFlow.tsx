import { useId } from "react";
import { orderSettlementFlow } from "./lib/settlementFlowLayout";
import { formatMoney } from "./lib/money";
import { t } from "./i18n";
import { playerInitials } from "./PlayerAvatar";
import type { SettlementSuggestion } from "./types";

function personLabel(id: string, name: string, currentPlayerId: string | null) {
  return id === currentPlayerId ? t("Du") : name;
}

export function SettlementFlow({
  suggestions,
  currentPlayerId,
  profilePhotoFor,
  onSelect,
  note,
}: {
  suggestions: SettlementSuggestion[];
  currentPlayerId: string | null;
  profilePhotoFor: (playerId: string) => string | null;
  onSelect?: (suggestion: SettlementSuggestion) => void;
  note?: string;
}) {
  const { payers, receivers } = orderSettlementFlow(suggestions);
  // Multiple diagrams can be mounted on the settlement page simultaneously.
  const flowId = useId().replace(/:/g, "");

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
            id={flowId + "-arrowhead"}
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
              <clipPath id={`${flowId}-payer-avatar-${player.id}`} key={`payer-clip-${player.id}`}>
                <circle cx="68" cy={y} r="25.5" />
              </clipPath>
            );
          })}
          {receivers.map((player) => {
            const y = receiverY.get(player.id) ?? height / 2;
            return (
              <clipPath id={`${flowId}-receiver-avatar-${player.id}`} key={`receiver-clip-${player.id}`}>
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
              className={onSelect ? "settlement-network-transfer" : "settlement-network-transfer is-static"}
              onClick={onSelect ? () => onSelect(suggestion) : undefined}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={onSelect ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(suggestion);
                }
              } : undefined}
            >
              <path
                d={path}
                className="settlement-network-line"
                style={{ strokeWidth }}
                markerEnd={`url(#${flowId}-arrowhead)`}
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
                  clipPath={`url(#${flowId}-payer-avatar-${player.id})`}
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
                  clipPath={`url(#${flowId}-receiver-avatar-${player.id})`}
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
        {note ?? t("Die Pfeile zeigen optimierte Ausgleichszahlungen, nicht direkte Schulden aus einzelnen Pokerabenden.")}
      </p>
    </div>
  );
}

