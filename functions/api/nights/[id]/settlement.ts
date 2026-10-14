import type { Env } from "../../../auth";
import { apiError, json } from "../../../lib/http";
import {
  loadSessionSettlement,
  recordSessionPayment,
  voidSessionPayment,
} from "../../../lib/sessionSettlement";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  try {
    return json(await loadSessionSettlement(env, String(params.id ?? "")));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Session-Abrechnung konnte nicht geladen werden.", 400);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ env, params, request }) => {
  try {
    return json(await recordSessionPayment(env, String(params.id ?? ""), await request.json()), { status: 201 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Zahlung konnte nicht gespeichert werden.", 400);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params, request }) => {
  try {
    const paymentId = new URL(request.url).searchParams.get("paymentId") ?? "";
    if (!paymentId) return apiError("Zahlung nicht gefunden.", 404);
    return json(await voidSessionPayment(env, String(params.id ?? ""), paymentId));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Zahlung konnte nicht storniert werden.", 400);
  }
};
