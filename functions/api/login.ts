import { createSessionCookie, verifyPassword, type Env } from "../auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const form = await context.request.formData();
  const password = String(form.get("password") ?? "");

  if (!(await verifyPassword(password, context.env))) {
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
