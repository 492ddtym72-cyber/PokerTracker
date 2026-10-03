import { isAuthenticated, type Env } from "../auth";
import { json } from "../lib/http";

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  if (url.pathname === "/api/login" || url.pathname === "/api/logout") {
    return context.next();
  }

  try {
    if (await isAuthenticated(context.request, context.env)) {
      return context.next();
    }

    return json({ error: "Nicht angemeldet." }, { status: 401 });
  } catch (error) {
    console.error("Authentication middleware failed", error);
    return json({ error: "Authentifizierung ist vorübergehend nicht verfügbar." }, { status: 503 });
  }
};
