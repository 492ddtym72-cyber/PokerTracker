import type { Env } from "../../../auth";
import { apiError, json } from "../../../lib/http";
import {
  validatePayPalMeValue,
  writePlayerPayPalMe,
} from "../../../lib/settlement";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id ?? "").trim();

  try {
    const body = await request.json() as { paypalMe?: unknown };
    const paypalMe = validatePayPalMeValue(body.paypalMe ?? "");
    return json(await writePlayerPayPalMe(env, id, paypalMe));
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "PayPal.Me konnte nicht gespeichert werden.",
    );
  }
};
