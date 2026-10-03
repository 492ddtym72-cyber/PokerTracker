import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import { nightExists, validateNightInput, writeNight } from "../../lib/night";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id ?? "");

  if (!id || !(await nightExists(env, id))) {
    return apiError("Pokerabend nicht gefunden.", 404);
  }

  try {
    const input = validateNightInput(await request.json());
    await writeNight(env, input, id, "update");
    return json({ id });
  } catch (error) {
    console.error(error);
    return apiError(error instanceof Error ? error.message : "Pokerabend konnte nicht aktualisiert werden.");
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id ?? "");

  if (!id || !(await nightExists(env, id))) {
    return apiError("Pokerabend nicht gefunden.", 404);
  }

  await env.DB.prepare("DELETE FROM poker_nights WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
};
