import { t } from "./i18n";

export type SettlementView = "list" | "flow";

export function SettlementViewToggle({
  view,
  onChange,
}: {
  view: SettlementView;
  onChange: (view: SettlementView) => void;
}) {
  return (
      <div
        className="settlement-view-toggle"
        data-view={view}
        role="group"
        aria-label={t("Ansicht")}
      >
        <button
          type="button"
          className={view === "list" ? "active" : ""}
          aria-pressed={view === "list"}
          onClick={() => onChange("list")}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
          </svg>
          <span>{t("Liste")}</span>
        </button>
        <button
          type="button"
          className={view === "flow" ? "active" : ""}
          aria-pressed={view === "flow"}
          onClick={() => onChange("flow")}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="8" height="8" rx="2" />
            <rect x="13" y="13" width="8" height="8" rx="2" />
            <path d="M7 11v4a2 2 0 0 0 2 2h4" />
            <path d="M11 7h3a3 3 0 0 1 3 3v3" />
          </svg>
          <span>{t("Fluss")}</span>
        </button>
      </div>
  );
}
