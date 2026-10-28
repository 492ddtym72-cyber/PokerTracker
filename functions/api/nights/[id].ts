import type { Env } from "../../auth";
import { apiError, json } from "../../lib/http";
import {
  deleteNightWithAudit,
  nightExists,
  validateNightAdjustments,
  validateNightInput,
  writeNight,
  writeNightAdjustments,
  writeNightStatus,
} from "../../lib/night";

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
    return apiError(
      error instanceof Error ? error.message : "Pokerabend konnte nicht aktualisiert werden.",
    );
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id ?? "");

  if (!id || !(await nightExists(env, id))) {
    return apiError("Pokerabend nicht gefunden.", 404);
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    if (body && "status" in body) {
      if (body.status !== "ongoing" && body.status !== "completed") {
        return apiError("Ungültiger Session-Status.");
      }
      await writeNightStatus(env, id, body.status);
      return json({ id, status: body.status });
    }
    const adjustments = validateNightAdjustments(body);
    const result = await writeNightAdjustments(env, id, adjustments);
    return json(result);
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Differenzausgleich konnte nicht gespeichert werden.",
    );
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id ?? "");

  if (!id) {
    return apiError("Pokerabend nicht gefunden.", 404);
  }

  try {
    const deleted = await deleteNightWithAudit(env, id);
    if (!deleted) return apiError("Pokerabend nicht gefunden.", 404);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(error);
    return apiError(
      error instanceof Error ? error.message : "Pokerabend konnte nicht gelöscht werden.",
      409,
    );
  }
};
