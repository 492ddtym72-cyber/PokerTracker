import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { createSettlementList, listSettlementLists } from "../../lib/settlementLists";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try { return json(await listSettlementLists(env)); }
  catch (error) { console.error(error); return apiError("Abrechnungslisten konnten nicht geladen werden.",500); }
};
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  try { return json(await createSettlementList(env,await request.json()), { status: 201 }); }
  catch (error) { return apiError(error instanceof Error ? error.message : "Liste konnte nicht angelegt werden.",400); }
};
