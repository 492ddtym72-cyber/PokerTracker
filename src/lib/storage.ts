import type { PokerTrackerState } from "../types";

const STORAGE_KEY = "pokertracker-state-v1";

export const EMPTY_STATE: PokerTrackerState = {
  version: 1,
  nights: [],
};

export function loadState(): PokerTrackerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;

    const parsed = JSON.parse(raw) as PokerTrackerState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.nights)) {
      return EMPTY_STATE;
    }

    return parsed;
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(state: PokerTrackerState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function makeId() {
  return crypto.randomUUID();
}
