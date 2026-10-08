import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { createPaymentRequest, loadPaymentRequests } from "../../lib/paymentRequests";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const playerId = new URL(request.url).searchParams.get("playerId");
    if (!playerId) return apiError("Bitte zuerst ein Profil auswählen.");
    return json(await loadPaymentRequests(env, playerId));
  } catch (error) {
    console.error(error);
    return apiError(error instanceof Error ? error.message : "Postfach konnte nicht geladen werden.");
  }
};
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return json(await createPaymentRequest(env, await request.json()), { status: 201 });
  } catch (error) {
    console.error(error);
    return apiError(error instanceof Error ? error.message : "Anforderung konnte nicht versendet werden.",409);
  }
};
