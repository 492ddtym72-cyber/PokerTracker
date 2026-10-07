import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { voidSettlementPayment } from "../../lib/settlement";

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id ?? "").trim();

  if (!id) {
    return apiError("Zahlung nicht gefunden.", 404);
  }

  try {
    return json(await voidSettlementPayment(env, id));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Zahlung konnte nicht storniert werden.";
    return apiError(message, message === "Zahlung nicht gefunden." ? 404 : 400);
  }
};
