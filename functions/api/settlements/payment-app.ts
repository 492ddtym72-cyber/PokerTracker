import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { loadSettlementSnapshot } from "../../lib/settlement";
import { loadSessionSettlement } from "../../lib/sessionSettlement";
import { loadListSnapshot } from "../../lib/settlementLists";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const fromPlayerId = url.searchParams.get("fromPlayerId")?.trim() ?? "";
    const toPlayerId = url.searchParams.get("toPlayerId")?.trim() ?? "";

    const kind = url.searchParams.get("ledgerKind") ?? "legacy";
    const ledgerId = url.searchParams.get("ledgerId") ?? "";
    if (!["legacy","session","list"].includes(kind) ||
        (kind !== "legacy" && !/^[a-f0-9-]{36}$/i.test(ledgerId))) {
      return apiError("Ungültige Abrechnung.", 400);
    }
    const snapshot = kind === "session" ? await loadSessionSettlement(env, ledgerId)
      : kind === "list" ? await loadListSnapshot(env, ledgerId)
      : await loadSettlementSnapshot(env);
    const suggestion = snapshot.suggestions.find(
      (entry) =>
        entry.fromPlayerId === fromPlayerId &&
        entry.toPlayerId === toPlayerId,
    );

    if (!suggestion || ("status" in snapshot && snapshot.status === "closed")) {
      return apiError(
        "Die offene Zahlung hat sich geändert. Bitte den Ausgleich neu laden.",
        409,
      );
    }

    return json(
      {
        fromPlayerId: suggestion.fromPlayerId,
        fromPlayerName: suggestion.fromPlayerName,
        toPlayerId: suggestion.toPlayerId,
        toPlayerName: suggestion.toPlayerName,
        amountCents: suggestion.amountCents,
        currency: "EUR",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error
        ? error.message
        : "Zahlungs-App konnte nicht vorbereitet werden.",
      400,
    );
  }
};
