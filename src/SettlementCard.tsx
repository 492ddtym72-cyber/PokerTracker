import type { ReactNode } from "react";

export function SettlementCard({
  title,
  meta,
  amount,
  expanded,
  panelId,
  onToggle,
  disabled = false,
  children,
}: {
  title: string;
  meta: string;
  amount: string;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <article className={"settlement-ledger-item" + (expanded ? " is-expanded" : "")}>
      <button
        type="button"
        className="settlement-ledger-trigger"
        aria-expanded={disabled ? undefined : expanded}
        aria-controls={disabled ? undefined : panelId}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="settlement-ledger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <rect x="4" y="5" width="13" height="16" rx="2" />
            <path d="M8 9h5M8 12h5M18 3l3 4-3 4-3-4 3-4Z" />
          </svg>
        </span>
        <span className="settlement-ledger-name">
          <strong>{title}</strong>
          <small>{meta}</small>
        </span>
        <span className="settlement-ledger-amount">
          <strong>{amount}</strong>
        </span>
        {!disabled && (
          <svg
            className={"settlement-ledger-chevron" + (expanded ? " is-open" : "")}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>
      {expanded && (
        <div className="settlement-ledger-detail" id={panelId}>
          {children}
        </div>
      )}
    </article>
  );
}
