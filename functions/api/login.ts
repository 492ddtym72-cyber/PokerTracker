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

    return new Response(
      `<!doctype html>
      <html lang="de">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>PokerTracker</title>
          <meta http-equiv="refresh" content="0;url=/">
        </head>
        <body style="margin:0;background:#07100d;color:#f4f1e8;font-family:system-ui;display:grid;place-items:center;min-height:100vh">
          <p>Login erfolgreich …</p>
          <script>window.location.replace("/");</script>
        </body>
      </html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": await createSessionCookie(context.env),
          "Cache-Control": "no-store",
        },
      },
    );
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
