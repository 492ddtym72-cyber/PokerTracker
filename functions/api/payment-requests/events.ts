import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { markEventsRead } from "../../lib/paymentRequests";
export const onRequestPost: PagesFunction<Env> = async ({ request,env }) => {
  try { return json(await markEventsRead(env,await request.json())); }
  catch (error) {
    console.error(error);
    return apiError(error instanceof Error ? error.message : "Nachricht konnte nicht aktualisiert werden.");
  }
};
