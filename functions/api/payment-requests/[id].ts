import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import {
  cancelPaymentRequest, decidePayment, remindPaymentRequest, reportPayment
} from "../../lib/paymentRequests";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id=String(params.id??"");
    const body=await request.json() as Record<string,unknown>;
    switch (body.action) {
      case "remind": return json(await remindPaymentRequest(env,id,body.actorPlayerId));
      case "cancel": return json(await cancelPaymentRequest(env,id,body.actorPlayerId));
      case "report": return json(await reportPayment(env,id,body));
      case "confirm":
      case "reject":
        return json(await decidePayment(env,id,String(body.reportId??""),body,body.action==="confirm"));
      default: return apiError("Unbekannte Aktion.");
    }
  } catch (error) {
    console.error(error);
    return apiError(error instanceof Error ? error.message : "Aktion fehlgeschlagen.",409);
  }
};
