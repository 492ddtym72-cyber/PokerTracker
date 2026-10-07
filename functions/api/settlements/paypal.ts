import type { Env } from "../../auth";
import { loadSettlementSnapshot } from "../../lib/settlement";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function staleResponse(message: string) {
  const safeMessage = escapeHtml(message);

  return new Response(
    `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PokerTracker · Ausgleich aktualisiert</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#03110d;color:#f6f1e5}
    main{width:min(100%,420px);padding:22px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#092019}
    h1{margin:0 0 8px;font-size:20px}
    p{margin:0 0 18px;color:#91a49a;line-height:1.5;font-size:13px}
    button{width:100%;min-height:46px;border:1px solid rgba(231,198,117,.28);border-radius:12px;background:rgba(231,198,117,.09);color:#edd79f;font-weight:800}
  </style>
</head>
<body>
  <main>
    <h1>Ausgleich wurde aktualisiert</h1>
    <p>${safeMessage}</p>
    <button onclick="history.back()">Zurück zu PokerTracker</button>
  </main>
</body>
</html>`,
    {
      status: 409,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const fromPlayerId = url.searchParams.get("fromPlayerId")?.trim() ?? "";
  const toPlayerId = url.searchParams.get("toPlayerId")?.trim() ?? "";

  const snapshot = await loadSettlementSnapshot(env);
  const suggestion = snapshot.suggestions.find(
    (entry) =>
      entry.fromPlayerId === fromPlayerId &&
      entry.toPlayerId === toPlayerId,
  );

  if (!suggestion) {
    return staleResponse(
      "Die offene Zahlung hat sich seit dem Anzeigen geändert. Öffne den Ausgleich erneut, damit Betrag und Empfänger neu geladen werden.",
    );
  }

  const receiver = snapshot.players.find(
    (player) => player.id === suggestion.toPlayerId,
  );

  if (!receiver?.paypalMe) {
    return staleResponse(
      "Für den aktuellen Empfänger ist kein PayPal.Me-Link mehr hinterlegt.",
    );
  }

  const amount = (suggestion.amountCents / 100).toFixed(2);
  const paypalUrl =
    `https://paypal.me/${encodeURIComponent(receiver.paypalMe)}/${amount}EUR`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: paypalUrl,
      "Cache-Control": "no-store",
    },
  });
};
