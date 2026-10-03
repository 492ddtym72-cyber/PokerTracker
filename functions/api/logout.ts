import { clearSessionCookie, type Env } from "../auth";

export const onRequestPost: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/login",
      "Set-Cookie": clearSessionCookie(),
      "Cache-Control": "no-store",
    },
  });
};
