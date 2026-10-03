import { isAuthenticated, type Env } from "./auth";

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  if (
    url.pathname === "/login" ||
    url.pathname === "/login.html" ||
    url.pathname === "/api/login" ||
    url.pathname === "/favicon.ico"
  ) {
    return context.next();
  }

  if (await isAuthenticated(context.request, context.env)) {
    return context.next();
  }

  return Response.redirect(new URL("/login", url), 302);
};
