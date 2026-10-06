import { getLocale } from "../i18n";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function parseMoney(value: string) {
  const normalized = value.trim().replace(",", ".");
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
}
