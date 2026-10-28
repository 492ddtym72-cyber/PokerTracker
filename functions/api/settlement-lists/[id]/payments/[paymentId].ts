import type { Env } from "../../../../auth";
import { apiError, json } from "../../../../lib/http";
import { voidListPayment } from "../../../../lib/settlementLists";
export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  try { return json(await voidListPayment(env,String(params.id??""),String(params.paymentId??""))); }
  catch(error) { return apiError(error instanceof Error ? error.message : "Zahlung konnte nicht storniert werden.",400); }
};
