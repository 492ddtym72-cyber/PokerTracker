import { createSessionCookie, verifyPassword, type Env } from "../auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const form = await context.request.formData();
    const password = String(form.get("password") ?? "");

    if (!(await verifyPassword(password, context.env))) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/login?error=1",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": await createSessionCookie(context.env),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Login failed", error);

    return new Response(null, {
      status: 303,
      headers: {
        Location: "/login?system=1",
        "Cache-Control": "no-store",
      },
    });
  }
};
