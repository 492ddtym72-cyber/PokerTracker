import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { loadListSnapshot, setSettlementListStatus } from "../../lib/settlementLists";
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  try { return json(await loadListSnapshot(env,String(params.id??""))); }
  catch(error) { return apiError(error instanceof Error ? error.message : "Liste konnte nicht geladen werden.",400); }
};
export const onRequestPatch: PagesFunction<Env> = async ({ env, params, request }) => {
  try { return json(await setSettlementListStatus(env,String(params.id??""),await request.json())); }
  catch(error) { return apiError(error instanceof Error ? error.message : "Status konnte nicht geändert werden.",400); }
};
