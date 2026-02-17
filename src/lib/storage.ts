import { type Store } from '../types';
import { nowWeekStartKey } from './dateTime';

export const STORAGE_KEY = 'calm-weekly-dashboard-v1';

const EMPTY_STORE = (): Store => ({ authName: '', selectedWeekStart: nowWeekStartKey(), tasks: [] });

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE();

    const parsed = JSON.parse(raw) as Store;
    return {
      authName: parsed.authName ?? '',
      selectedWeekStart: parsed.selectedWeekStart ?? nowWeekStartKey(),
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    return EMPTY_STORE();
  }
}

export function saveStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
