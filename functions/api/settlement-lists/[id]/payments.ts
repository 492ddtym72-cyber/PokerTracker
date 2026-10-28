import type { Env } from "../../../auth";
import { apiError, json } from "../../../lib/http";
import { recordListPayment } from "../../../lib/settlementLists";
export const onRequestPost: PagesFunction<Env> = async ({ env, params, request }) => {
  try { return json(await recordListPayment(env,String(params.id??""),await request.json()),{status:201}); }
  catch(error) { return apiError(error instanceof Error ? error.message : "Zahlung konnte nicht erfasst werden.",400); }
};
