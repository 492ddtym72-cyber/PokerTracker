import { createSessionCookie, type Env } from "../auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!context.env.APP_PASSWORD || !context.env.SESSION_SECRET) {
    return new Response("PokerTracker authentication is not configured.", { status: 503 });
  }

  const form = await context.request.formData();
  const password = String(form.get("password") ?? "");

  if (password !== context.env.APP_PASSWORD) {
    return Response.redirect(new URL("/login.html?error=1", context.request.url), 303);
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": await createSessionCookie(context.env),
      "Cache-Control": "no-store",
    },
  });
};
