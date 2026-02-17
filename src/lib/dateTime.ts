import { END_HOUR, SLOT_MINUTES, START_HOUR, type Duration } from '../types';

export function weekStartMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatWeekLabel(weekStartKey: string): string {
  const d = fromLocalDateKey(weekStartKey);
  return `Week of ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

export function formatDayLabel(weekStartKey: string, dayIndex: number): string {
  const d = fromLocalDateKey(weekStartKey);
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function nowWeekStartKey() {
  return toLocalDateKey(weekStartMonday(new Date()));
}

export function timeLabel(slot: number) {
  const totalMinutes = START_HOUR * 60 + slot * SLOT_MINUTES;
  const h24 = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

export function durationToSlots(duration: Duration) {
  return Math.max(1, Math.round(duration / SLOT_MINUTES));
}

export const TOTAL_MINUTES_IN_TIMELINE = (END_HOUR - START_HOUR) * 60;
