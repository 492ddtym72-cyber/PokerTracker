import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import {
  loadSettlementSnapshot,
  validateSettlementPaymentInput,
  writeSettlementPayment,
} from "../../lib/settlement";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    return json(await loadSettlementSnapshot(env));
  } catch (error) {
    console.error(error);
    return apiError("Ausgleichsdaten konnten nicht geladen werden.", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const input = validateSettlementPaymentInput(await request.json());
    return json(await writeSettlementPayment(env, input), { status: 201 });
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Zahlung konnte nicht gespeichert werden.",
    );
  }
};
