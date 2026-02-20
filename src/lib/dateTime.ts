import { END_HOUR, SLOT_MINUTES, START_HOUR, type Duration } from '../types';

export function weekStartMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
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
  return new Date(year, (month || 1) - 1, day || 1);
}

export function nowWeekStartKey() {
  return toLocalDateKey(weekStartMonday(new Date()));
}

export function addWeeks(weekStartKey: string, delta: number) {
  const d = fromLocalDateKey(weekStartKey);
  d.setDate(d.getDate() + delta * 7);
  return toLocalDateKey(d);
}

export function formatWeekLabel(weekStartKey: string): string {
  const monday = fromLocalDateKey(weekStartKey);
  return `Week of ${monday.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

export function formatWeekRange(weekStartKey: string): string {
  const monday = fromLocalDateKey(weekStartKey);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const mondayMonth = monday.toLocaleDateString(undefined, { month: 'short' });
  const sundayMonth = sunday.toLocaleDateString(undefined, { month: 'short' });
  const mondayDay = monday.getDate();
  const sundayDay = sunday.getDate();
  const year = sunday.getFullYear();

  if (mondayMonth === sundayMonth) {
    return `${mondayMonth} ${mondayDay} - ${sundayDay}, ${year}`;
  }

  return `${mondayMonth} ${mondayDay} - ${sundayMonth} ${sundayDay}, ${year}`;
}

export function formatDayLabel(weekStartKey: string, dayIndex: number): string {
  const d = fromLocalDateKey(weekStartKey);
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeLabel(slot: number) {
  const totalMinutes = START_HOUR * 60 + slot * SLOT_MINUTES;
  const h24 = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${`${mins}`.padStart(2, '0')} ${period}`;
}

export function durationToSlots(duration: Duration) {
  return Math.max(1, Math.ceil(duration / SLOT_MINUTES));
}

export const TOTAL_TIMELINE_MINUTES = (END_HOUR - START_HOUR) * 60;
