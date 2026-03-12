export type ViewMode = 'plan' | 'kanban';

export type TaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'In Review' | 'Done';
export type TaskActivity = 'Script' | 'Prep' | 'Shoot' | 'Edit' | 'Outreach' | 'Admin' | 'Personal';
export type Duration = number;

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type TaskSchedule = {
  weekKey: string;
  dayIndex: number;
  slot: number;
  timezone: string;
};

export type TaskRepeat = {
  enabled: boolean;
  days: number[];
  slot: number;
  sameTimeEveryDay?: boolean;
  daySlots?: Partial<Record<number, number>>;
  timezone: string;
  startWeekKey?: string;
  startDayIndex?: number;
  endWeekKey?: string;
  endDayIndex?: number;
};

export type WorkBlock = {
  start: string;
  end: string;
};

export type Task = {
  id: string;
  title: string;
  client: string;
  activity: TaskActivity | '';
  projectValue: string;
  completed: boolean;
  duration: Duration;
  dueDate: string;
  projectDeadline: string;
  urgent: boolean;
  important: boolean;
  notes: string;
  links: string[];
  attachments: Attachment[];
  status: TaskStatus;
  scheduled?: TaskSchedule;
  planningSource?: 'tempo';
  repeat?: TaskRepeat;
  repeatParentId?: string;
  createdAt: string;
  updatedAt: string;
};

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const STATUS_ORDER: TaskStatus[] = ['Not Started', 'Blocked', 'In Progress', 'In Review', 'Done'];
export const ACTIVITY_OPTIONS: TaskActivity[] = ['Script', 'Prep', 'Shoot', 'Edit', 'Outreach', 'Admin', 'Personal'];

export const DURATIONS: Duration[] = Array.from({ length: 15 }, (_, index) => (index + 2) * 15);

export const START_HOUR = 5;
export const END_HOUR = 24;
export const SLOT_MINUTES = 15;
export const SLOT_HEIGHT = 11.5;
export const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;

export const uid = () => Math.random().toString(36).slice(2, 11);

export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
