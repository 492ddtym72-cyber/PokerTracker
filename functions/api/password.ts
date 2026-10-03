import {
  changePassword,
  createSessionCookie,
  verifyPassword,
  type Env,
} from "../auth";
import { apiError, json } from "../lib/http";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };

    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";

    if (!(await verifyPassword(currentPassword, env))) {
      return apiError("Das aktuelle Passwort stimmt nicht.", 403);
    }

    await changePassword(newPassword, env);

    return json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": await createSessionCookie(env),
        },
      },
    );
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Passwort konnte nicht geändert werden.",
    );
  }
};
