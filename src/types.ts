export type ViewMode = 'plan' | 'kanban';

export type TaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'In Review' | 'Done';
export type Duration = 15 | 30 | 45 | 60 | 90 | 120 | 180 | 240;

export type Attachment = { id: string; name: string; dataUrl: string };

export type Task = {
  id: string;
  title: string;
  completed: boolean;
  duration: Duration;
  dueDate: string;
  urgent: boolean;
  important: boolean;
  notes: string;
  links: string[];
  attachments: Attachment[];
  status: TaskStatus;
  scheduled?: {
    weekKey: string;
    dayIndex: number;
    slot: number;
  };
  createdAt: string;
};

export type Store = {
  authName: string;
  selectedWeekStart: string;
  tasks: Task[];
};

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const STATUS_ORDER: TaskStatus[] = ['Not Started', 'In Progress', 'Blocked', 'In Review', 'Done'];

export const DURATIONS: Duration[] = [15, 30, 45, 60, 90, 120, 180, 240];

export const START_HOUR = 5;
export const END_HOUR = 24;
export const SLOT_MINUTES = 30;
export const SLOT_HEIGHT = 100;
export const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;

export const uid = () => Math.random().toString(36).slice(2, 11);
