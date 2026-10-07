import type {
  HistoryResponse,
  NightAdjustmentInput,
  NightInput,
  PokerNight,
  PreparedPayPalPayment,
  SettlementPaymentInput,
  SettlementResponse,
} from "../types";
import { t } from "../i18n";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error(t("Nicht angemeldet."));
  }

  if (!response.ok) {
    let message = t("Etwas ist schiefgelaufen.");

    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = t(body.error);
    } catch {
      // Keep the generic message when the server did not return JSON.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function loadNights() {
  const data = await api<{ nights: PokerNight[] }>("/api/nights");
  return data.nights;
}

export function createNight(input: NightInput) {
  return api<{ id: string }>("/api/nights", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateNight(id: string, input: NightInput) {
  return api<{ id: string }>("/api/nights/" + encodeURIComponent(id), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteNight(id: string) {
  return api<void>("/api/nights/" + encodeURIComponent(id), {
    method: "DELETE",
  });
}

export function updateNightAdjustments(id: string, adjustments: NightAdjustmentInput[]) {
  return api<{
    rawDifferenceCents: number;
    adjustmentTotalCents: number;
    remainingDifferenceCents: number;
  }>("/api/nights/" + encodeURIComponent(id), {
    method: "PATCH",
    body: JSON.stringify({ adjustments }),
  });
}

export function loadHistory(offset = 0, limit = 40) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  return api<HistoryResponse>("/api/history?" + params.toString());
}


export function loadSettlements() {
  return api<SettlementResponse>("/api/settlements");
}

export function createSettlementPayment(input: SettlementPaymentInput) {
  return api<SettlementResponse>("/api/settlements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function voidSettlementPayment(id: string) {
  return api<SettlementResponse>("/api/settlements/" + encodeURIComponent(id), {
    method: "DELETE",
  });
}



export function preparePayPalPayment(fromPlayerId: string, toPlayerId: string) {
  const params = new URLSearchParams({ fromPlayerId, toPlayerId });
  return api<PreparedPayPalPayment>("/api/settlements/paypal?" + params.toString());
}
