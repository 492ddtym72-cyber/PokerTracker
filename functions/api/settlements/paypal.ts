import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { loadSettlementSnapshot } from "../../lib/settlement";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const fromPlayerId = url.searchParams.get("fromPlayerId")?.trim() ?? "";
    const toPlayerId = url.searchParams.get("toPlayerId")?.trim() ?? "";

    const snapshot = await loadSettlementSnapshot(env);
    const suggestion = snapshot.suggestions.find(
      (entry) =>
        entry.fromPlayerId === fromPlayerId &&
        entry.toPlayerId === toPlayerId,
    );

    if (!suggestion) {
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
        paypalUrl: "https://www.paypal.com/myaccount/transfer/homepage",
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
        : "PayPal-Zahlung konnte nicht vorbereitet werden.",
      400,
    );
  }
};
