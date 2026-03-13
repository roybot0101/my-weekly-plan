import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  Calendar,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  ListRestart,
  Plus,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { TaskCard } from './components/TaskCard';
import { TaskModal } from './components/TaskModal';
import {
  addWeeks,
  durationToSlots,
  formatDayLabel,
  formatWeekLabel,
  nowWeekStartKey,
  timeLabel,
  toLocalDateKey,
  weekStartMonday,
} from './lib/dateTime';
import {
  createRepeatTemplate,
  createTask,
  deleteTask,
  ensureRepeatingTasksForWeek,
  getSessionUser,
  loadPlannerData,
  makeScheduled,
  onAuthStateChange,
  signIn,
  signOut,
  signUp,
  signInWithOAuth,
  changePassword,
  deleteAccount,
  updateBacklogOrder,
  updateKanbanOrder,
  updateSelectedWeekStart,
  updateTask,
  updateUserSettings,
} from './lib/cloudStore';
import { hasSupabaseEnv } from './lib/supabase';
import {
  DAY_NAMES,
  END_HOUR,
  SLOT_HEIGHT,
  SLOT_MINUTES,
  START_HOUR,
  STATUS_ORDER,
  TOTAL_SLOTS,
  localTimezone,
  type Duration,
  type Task,
  type TaskRepeat,
  type TaskStatus,
  type ViewMode,
  type WorkBlock,
} from './types';

type DropTarget = { dayIndex: number; slot: number } | null;
type AuthMode = 'sign-in' | 'sign-up';
const SCHEDULED_CARD_TOP_OFFSET = 1;
const SCHEDULED_CARD_BOTTOM_GAP = 2;
type KanbanDropTarget = { status: TaskStatus; insertIndex: number } | null;
type FloatingDayPill = { dayIndex: number; left: number };
type TempoScheduleOverlaySegment = { key: string; top: number; height: number };
type TempoWorkRange = { startSlot: number; endSlot: number; blockType: 'early' | 'daylight' | 'late' | 'general' };
type TempoPlanNotice = { tone: 'neutral' | 'warning'; text: string };
type TempoUndoEntry = {
  taskId: string;
  previousScheduled?: Task['scheduled'];
  previousPlanningSource?: Task['planningSource'];
  plannedWeekKey: string;
  plannedDayIndex: number;
  plannedSlot: number;
};
type TempoPastDuePlacement = {
  taskId: string;
  title: string;
  dueDateLabel: string;
  scheduledDateLabel: string;
};
type SwipeAxis = 'x' | 'y' | null;
type MobileSwipeGesture = {
  startX: number;
  startY: number;
  lastX: number;
  axis: SwipeAxis;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
};
const MOBILE_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const KANBAN_DAY_NAMES = ['Mon', 'Tues', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const RESIZE_STEP_SLOTS = 2;
const RESIZE_STEP_MINUTES = SLOT_MINUTES * RESIZE_STEP_SLOTS;
const CLIENT_SUGGESTIONS_STORAGE_KEY_PREFIX = 'plan-with-tempo:hidden-client-suggestions:';
const normalizeClientKey = (value: string) => value.trim().toLocaleLowerCase();
const KANBAN_COLUMNS: Array<{ label: string; statuses: TaskStatus[]; dropStatus: TaskStatus }> = [
  { label: 'Not Started', statuses: ['Not Started'], dropStatus: 'Not Started' },
  { label: 'Waiting', statuses: ['Blocked'], dropStatus: 'Blocked' },
  { label: 'In Progress', statuses: ['In Progress'], dropStatus: 'In Progress' },
  { label: 'In Review', statuses: ['In Review'], dropStatus: 'In Review' },
  { label: 'Done', statuses: ['Done'], dropStatus: 'Done' },
];
const naturalTitleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function isRepeatTemplate(task: Task) {
  return Boolean(task.repeat?.enabled && !task.repeatParentId);
}

function hasValidRepeatParent(task: Task | undefined, taskById: Map<string, Task>) {
  if (!task?.repeatParentId) return false;
  const parent = taskById.get(task.repeatParentId);
  return Boolean(parent?.repeat);
}

function compareRepeatPosition(
  left: Pick<NonNullable<Task['scheduled']>, 'weekKey' | 'dayIndex'>,
  right: Pick<NonNullable<Task['scheduled']>, 'weekKey' | 'dayIndex'>,
) {
  if (left.weekKey !== right.weekKey) return left.weekKey.localeCompare(right.weekKey);
  return left.dayIndex - right.dayIndex;
}

function anchorRepeatToScheduled(repeat: TaskRepeat, scheduled: NonNullable<Task['scheduled']>): TaskRepeat {
  return {
    ...repeat,
    startWeekKey: scheduled.weekKey,
    startDayIndex: scheduled.dayIndex,
    endWeekKey: undefined,
    endDayIndex: undefined,
  };
}

function endRepeatBeforeScheduled(repeat: TaskRepeat, scheduled: NonNullable<Task['scheduled']>): TaskRepeat {
  return {
    ...repeat,
    endWeekKey: scheduled.weekKey,
    endDayIndex: scheduled.dayIndex,
  };
}

function isSeriesTaskOnOrAfterAnchor(task: Task, anchorTask: Task) {
  if (task.id === anchorTask.id) return true;
  if (task.scheduled && anchorTask.scheduled) {
    if (task.scheduled.weekKey !== anchorTask.scheduled.weekKey) {
      return task.scheduled.weekKey.localeCompare(anchorTask.scheduled.weekKey) >= 0;
    }
    if (task.scheduled.dayIndex !== anchorTask.scheduled.dayIndex) {
      return task.scheduled.dayIndex >= anchorTask.scheduled.dayIndex;
    }
    return task.scheduled.slot >= anchorTask.scheduled.slot;
  }
  return task.createdAt >= anchorTask.createdAt;
}

function getResizedDuration(startDuration: Duration, deltaPixels: number) {
  const stepPixels = SLOT_HEIGHT * RESIZE_STEP_SLOTS;
  const deltaSteps =
    deltaPixels >= 0 ? Math.floor(deltaPixels / stepPixels) : Math.ceil(deltaPixels / stepPixels);
  const minDuration = Math.min(startDuration, RESIZE_STEP_MINUTES);
  const nextDuration = startDuration + deltaSteps * RESIZE_STEP_MINUTES;
  return Math.max(minDuration, Math.min(240, nextDuration)) as Duration;
}

function parseTimeValueToMinutes(value: string) {
  const [hoursRaw, minutesRaw] = value.split(':').map(Number);
  const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;
  const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 0;
  return hours * 60 + minutes;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
}

function sortWorkBlocks(blocks: WorkBlock[]) {
  return [...blocks].sort((a, b) => parseTimeValueToMinutes(a.start) - parseTimeValueToMinutes(b.start));
}

function getWorkBlockEndMinutes(block: WorkBlock) {
  return block.end === '00:00' ? 24 * 60 : parseTimeValueToMinutes(block.end);
}

function isValidTimezone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function listSupportedTimezones() {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };

  return typeof intlWithSupportedValues.supportedValuesOf === 'function'
    ? intlWithSupportedValues.supportedValuesOf('timeZone')
    : [];
}

function formatWorkBlockTime(value: string) {
  const [hoursRaw, minutesRaw] = value.split(':').map(Number);
  const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;
  const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 0;
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function parseDateKey(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function differenceInCalendarDays(from: Date, to: Date) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function getScheduledDateFromWeekDay(weekKey: string, dayIndex: number) {
  const monday = parseDateKey(weekKey);
  if (!monday) return null;
  const scheduled = new Date(monday);
  scheduled.setDate(scheduled.getDate() + dayIndex);
  return new Date(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate());
}

function parseProjectValueAmount(value: string) {
  const normalized = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(normalized) ? normalized : 0;
}

function getEffectiveDeadline(task: Task) {
  const dueDate = parseDateKey(task.dueDate);
  const projectDeadline = parseDateKey(task.projectDeadline);
  if (dueDate && projectDeadline) {
    return dueDate.getTime() <= projectDeadline.getTime() ? task.dueDate : task.projectDeadline;
  }
  return task.dueDate || task.projectDeadline || '';
}

function getTempoProjectFlowRank(activity: Task['activity']) {
  if (activity === 'Script') return 0;
  if (activity === 'Prep') return 1;
  if (activity === 'Shoot') return 2;
  if (activity === 'Edit') return 3;
  if (activity === 'Admin') return 4;
  if (activity === 'Personal') return 5;
  if (activity === 'Outreach') return 6;
  return 7;
}

function getTempoBlockType(startMinutes: number, endMinutes: number): TempoWorkRange['blockType'] {
  if (startMinutes >= 20 * 60) return 'late';
  if (endMinutes <= 8 * 60) return 'early';
  if (startMinutes >= 8 * 60 && endMinutes <= 18 * 60) return 'daylight';
  return 'general';
}

function getTempoRangePreference(task: Task, range: TempoWorkRange) {
  if (task.activity === 'Shoot') {
    return range.blockType === 'daylight' ? 0 : Number.POSITIVE_INFINITY;
  }

  if (task.activity === 'Edit') {
    if (range.blockType === 'late') return 0;
    if (range.blockType === 'daylight') return 1;
    if (range.blockType === 'general') return 2;
    return 3;
  }

  if (task.activity === 'Script' || task.activity === 'Prep' || task.activity === 'Admin') {
    if (range.blockType === 'early') return 0;
    if (range.blockType === 'daylight') return 1;
    if (range.blockType === 'late') return 2;
    return 3;
  }

  if (task.activity === 'Personal') {
    if (range.blockType === 'daylight') return 0;
    if (range.blockType === 'early') return 1;
    if (range.blockType === 'late') return 2;
    return 3;
  }

  if (task.activity === 'Outreach') {
    if (range.blockType === 'early') return 0;
    if (range.blockType === 'daylight') return 1;
    if (range.blockType === 'late') return 2;
    return 3;
  }

  if (range.blockType === 'daylight') return 0;
  if (range.blockType === 'early') return 1;
  if (range.blockType === 'late') return 2;
  return 3;
}

function getTempoPriorityScore(task: Task, weekStartKey: string) {
  let score = 0;

  if (task.urgent) score += 40;
  if (task.important) score += 30;

  const weekStart = parseDateKey(weekStartKey);
  const effectiveDeadline = getEffectiveDeadline(task);
  const deadlineDate = parseDateKey(effectiveDeadline);
  if (weekStart && deadlineDate) {
    const daysUntilDeadline = differenceInCalendarDays(weekStart, deadlineDate);
    if (daysUntilDeadline < 0) {
      if (task.status !== 'Blocked') score += 85;
    } else if (daysUntilDeadline <= 1) {
      score += 60;
    } else if (daysUntilDeadline <= 3) {
      score += 40;
    } else if (daysUntilDeadline <= 7) {
      score += 25;
    } else {
      score += 10;
    }
  }

  if (task.activity && task.activity !== 'Admin' && task.activity !== 'Personal') score += 10;
  if (task.client.trim()) score += 5;
  if (task.activity === 'Admin') score -= 18;
  if (task.activity === 'Personal') score -= 24;
  if (task.activity === 'Outreach') score -= 12;

  return score;
}

function getTempoDeadlineSortValue(task: Task) {
  const deadline = parseDateKey(getEffectiveDeadline(task));
  return deadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function getTempoProjectStatusSortValue(tasks: Task[]) {
  if (tasks.some((task) => task.status === 'In Progress')) return 0;
  if (tasks.some((task) => task.status === 'Not Started')) return 1;
  if (tasks.some((task) => task.status === 'In Review')) return 2;
  if (tasks.some((task) => task.status === 'Blocked')) return 3;
  return 4;
}

function getTempoProjectPriorityScore(tasks: Task[], weekStartKey: string) {
  const earliestDeadline = tasks.reduce<number>((currentEarliest, task) => {
    const deadline = parseDateKey(getEffectiveDeadline(task));
    const nextTime = deadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return Math.min(currentEarliest, nextTime);
  }, Number.MAX_SAFE_INTEGER);
  const syntheticTask = tasks.reduce<Task>((current, task) => {
    const effectiveDeadline = getEffectiveDeadline(task);
    const currentDeadline = getEffectiveDeadline(current);
    const shouldUseTaskDeadline =
      Boolean(effectiveDeadline) &&
      (!currentDeadline || getTempoDeadlineSortValue(task) < getTempoDeadlineSortValue(current));

    return {
      ...current,
      urgent: current.urgent || task.urgent,
      important: current.important || task.important,
      projectValue:
        parseProjectValueAmount(task.projectValue) > parseProjectValueAmount(current.projectValue)
          ? task.projectValue
          : current.projectValue,
      dueDate: shouldUseTaskDeadline ? task.dueDate : current.dueDate,
      projectDeadline: shouldUseTaskDeadline ? task.projectDeadline : current.projectDeadline,
      activity: current.activity || task.activity,
      client: current.client || task.client,
    };
  }, {
    ...tasks[0],
    urgent: false,
    important: false,
    dueDate: '',
    projectDeadline: '',
    projectValue: '',
    activity: '',
    client: tasks[0]?.client ?? '',
  });

  let score = getTempoPriorityScore(syntheticTask, weekStartKey);

  const oldestCreatedAt = tasks.reduce(
    (currentOldest, task) => Math.min(currentOldest, new Date(task.createdAt).getTime()),
    Number.MAX_SAFE_INTEGER,
  );
  if (Number.isFinite(oldestCreatedAt)) {
    const ageInDays = Math.max(0, differenceInCalendarDays(new Date(oldestCreatedAt), new Date()));
    score += Math.min(18, ageInDays);
  }

  if (earliestDeadline === Number.MAX_SAFE_INTEGER) {
    score -= 4;
  }

  const statusSortValue = getTempoProjectStatusSortValue(tasks);
  if (statusSortValue === 0) score += 12;
  if (statusSortValue === 2) score -= 10;
  if (statusSortValue === 3) score -= 18;

  return score;
}

function getTempoPlanningStartDay(weekStartKey: string, todayWeekKey: string, todayDayIndex: number) {
  if (weekStartKey < todayWeekKey) return DAY_NAMES.length;
  if (weekStartKey === todayWeekKey) return todayDayIndex + 1;
  return 0;
}

function App() {
  const [initializing, setInitializing] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [backlogOrder, setBacklogOrder] = useState<string[]>([]);
  const [kanbanOrder, setKanbanOrder] = useState<string[]>([]);
  const [selectedWeekStart, setSelectedWeekStart] = useState(nowWeekStartKey());
  const [profileTimezone, setProfileTimezone] = useState(localTimezone());
  const [workBlocks, setWorkBlocks] = useState<WorkBlock[]>([]);
  const [loadingPlanner, setLoadingPlanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tempoPlanning, setTempoPlanning] = useState(false);
  const [tempoPlanNotice, setTempoPlanNotice] = useState<TempoPlanNotice | null>(null);
  const [tempoUndoEntries, setTempoUndoEntries] = useState<TempoUndoEntry[]>([]);
  const [tempoPastDuePlacements, setTempoPastDuePlacements] = useState<TempoPastDuePlacement[] | null>(null);
  const [savingDotCount, setSavingDotCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTempoHelpOpen, setSettingsTempoHelpOpen] = useState(false);
  const [settingsTimezoneDraft, setSettingsTimezoneDraft] = useState(localTimezone());
  const [settingsWorkBlocksDraft, setSettingsWorkBlocksDraft] = useState<WorkBlock[]>([]);
  const [pendingWorkBlockStart, setPendingWorkBlockStart] = useState('');
  const [pendingWorkBlockEnd, setPendingWorkBlockEnd] = useState('');
  const [settingsPasswordDraft, setSettingsPasswordDraft] = useState('');
  const [settingsPasswordConfirmDraft, setSettingsPasswordConfirmDraft] = useState('');
  const [deleteAccountConfirmDraft, setDeleteAccountConfirmDraft] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('plan');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const [dragBox, setDragBox] = useState<{ width: number; height: number; offsetX: number; offsetY: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [shiftPreviewPatches, setShiftPreviewPatches] = useState<Array<{ taskId: string; dayIndex: number; slot: number }>>(
    [],
  );
  const [dragOverBacklog, setDragOverBacklog] = useState(false);
  const [backlogInsertIndex, setBacklogInsertIndex] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [kanbanDropTarget, setKanbanDropTarget] = useState<KanbanDropTarget>(null);
  const [taskInModal, setTaskInModal] = useState<string | null>(null);
  const [resizingTaskId, setResizingTaskId] = useState<string | null>(null);
  const [resizePreviewDuration, setResizePreviewDuration] = useState<Duration | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [mobileBacklogTitle, setMobileBacklogTitle] = useState('');
  const [mobileDay, setMobileDay] = useState((new Date().getDay() + 6) % 7);
  const [mobileSwipeOffsetPx, setMobileSwipeOffsetPx] = useState(0);
  const [mobileSwipeDragging, setMobileSwipeDragging] = useState(false);
  const [mobileSlotPicker, setMobileSlotPicker] = useState<{ dayIndex: number; slot: number } | null>(null);
  const [mobileSlotPickerError, setMobileSlotPickerError] = useState<string | null>(null);
  const [fixedDayPills, setFixedDayPills] = useState<FloatingDayPill[]>([]);
  const [showViewportTimelineScrollbar, setShowViewportTimelineScrollbar] = useState(false);
  const [timelineScrollbarContentWidth, setTimelineScrollbarContentWidth] = useState(0);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [taskContextMenu, setTaskContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [hiddenClientSuggestions, setHiddenClientSuggestions] = useState<string[]>([]);
  const [loadedHiddenClientSuggestionsKey, setLoadedHiddenClientSuggestionsKey] = useState<string | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);
  const taskInModalRef = useRef<string | null>(null);
  const dayHeaderRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dayColumnRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const timelineGridRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportScrollbarRef = useRef<HTMLDivElement | null>(null);
  const timelineAreaRef = useRef<HTMLElement | null>(null);
  const timeAxisRef = useRef<HTMLDivElement | null>(null);
  const mobileSwipeRef = useRef<MobileSwipeGesture | null>(null);
  const headerCollapseLockedRef = useRef(false);
  const headerResetToTopRef = useRef(false);
  const headerResetTimeoutRef = useRef<number | null>(null);
  const settingsTempoSignalsRef = useRef<HTMLDivElement | null>(null);
  const hiddenClientSuggestionsStorageKey = `${CLIENT_SUGGESTIONS_STORAGE_KEY_PREFIX}${userId ?? 'guest'}`;

  const weekKey = selectedWeekStart;
  const now = new Date(currentTimeMs);
  const todayWeekKey = toLocalDateKey(weekStartMonday(now));
  const todayDayIndex = (now.getDay() + 6) % 7;
  const slotsPerHour = 60 / SLOT_MINUTES;
  const currentTimeLabel = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(now);
  const currentTimeLineTop = (() => {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const plannerStartMinutes = START_HOUR * 60;
    const plannerEndMinutes = END_HOUR * 60;
    if (currentMinutes < plannerStartMinutes || currentMinutes > plannerEndMinutes) return null;
    return ((currentMinutes - plannerStartMinutes) / SLOT_MINUTES) * SLOT_HEIGHT;
  })();

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const mobileTimelineStyle = useMemo(
    () =>
      ({
        '--mobile-day-index': mobileDay,
        '--mobile-swipe-offset': `${mobileSwipeOffsetPx}px`,
        '--mobile-swipe-duration': mobileSwipeDragging ? '0ms' : '260ms',
      }) as CSSProperties,
    [mobileDay, mobileSwipeDragging, mobileSwipeOffsetPx],
  );
  const tempoNonWorkSegments = useMemo(() => {
    if (workBlocks.length === 0) return [];

    const plannerStartMinutes = START_HOUR * 60;
    const plannerEndMinutes = END_HOUR * 60;
    const segments: TempoScheduleOverlaySegment[] = [];
    let cursor = plannerStartMinutes;

    sortWorkBlocks(workBlocks).forEach((block) => {
      const startMinutes = parseTimeValueToMinutes(block.start);
      const endMinutes = getWorkBlockEndMinutes(block);
      const clampedStart = Math.max(startMinutes, plannerStartMinutes);
      const clampedEnd = Math.min(endMinutes, plannerEndMinutes);
      if (clampedEnd <= clampedStart) return;

      if (clampedStart > cursor) {
        segments.push({
          key: `${cursor}-${clampedStart}`,
          top: ((cursor - plannerStartMinutes) / SLOT_MINUTES) * SLOT_HEIGHT,
          height: ((clampedStart - cursor) / SLOT_MINUTES) * SLOT_HEIGHT,
        });
      }

      cursor = Math.max(cursor, clampedEnd);
    });

    if (cursor < plannerEndMinutes) {
      segments.push({
        key: `${cursor}-${plannerEndMinutes}`,
        top: ((cursor - plannerStartMinutes) / SLOT_MINUTES) * SLOT_HEIGHT,
        height: ((plannerEndMinutes - cursor) / SLOT_MINUTES) * SLOT_HEIGHT,
      });
    }

    return segments;
  }, [workBlocks]);
  const tempoWorkRangesByDay = useMemo(() => {
    const plannerStartMinutes = START_HOUR * 60;
    const plannerEndMinutes = END_HOUR * 60;
    const rangesByDay = Array.from({ length: DAY_NAMES.length }, () => Array<TempoWorkRange>());

    sortWorkBlocks(workBlocks).forEach((block) => {
      const startMinutes = Math.max(parseTimeValueToMinutes(block.start), plannerStartMinutes);
      const endMinutes = Math.min(getWorkBlockEndMinutes(block), plannerEndMinutes);
      const startSlot = Math.max(0, Math.ceil((startMinutes - plannerStartMinutes) / SLOT_MINUTES));
      const endSlot = Math.min(TOTAL_SLOTS, Math.floor((endMinutes - plannerStartMinutes) / SLOT_MINUTES));
      if (endSlot <= startSlot) return;
      const blockType = getTempoBlockType(startMinutes, endMinutes);

      DAY_NAMES.forEach((_, dayIndex) => {
        rangesByDay[dayIndex].push({ startSlot, endSlot, blockType });
      });
    });

    return rangesByDay.map((ranges) => ranges.sort((a, b) => a.startSlot - b.startSlot));
  }, [workBlocks]);
  const supportedTimezones = useMemo(() => {
    const fallback = [profileTimezone, localTimezone()];
    const supportedValues = listSupportedTimezones();
    if (supportedValues.length === 0) {
      return Array.from(new Set(fallback.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    }

    return Array.from(new Set([...supportedValues, ...fallback.filter(Boolean)])).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [profileTimezone]);

  function sortTasksByOrder(taskList: Task[], orderedIds: string[]) {
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    return [...taskList].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank === undefined && bRank === undefined) return a.createdAt < b.createdAt ? 1 : -1;
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      return aRank - bRank;
    });
  }

  function sortTasksByWeeklySchedule(taskList: Task[], orderedIds: string[]) {
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    return [...taskList].sort((a, b) => {
      const aDay = a.scheduled?.dayIndex ?? Number.MAX_SAFE_INTEGER;
      const bDay = b.scheduled?.dayIndex ?? Number.MAX_SAFE_INTEGER;
      if (aDay !== bDay) return aDay - bDay;

      const aSlot = a.scheduled?.slot ?? Number.MAX_SAFE_INTEGER;
      const bSlot = b.scheduled?.slot ?? Number.MAX_SAFE_INTEGER;
      if (aSlot !== bSlot) return aSlot - bSlot;

      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank === undefined && bRank === undefined) return a.createdAt < b.createdAt ? 1 : -1;
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      return aRank - bRank;
    });
  }

  const backlogTasks = useMemo(() => {
    const backlog = tasks.filter((task) => !task.scheduled && !isRepeatTemplate(task));
    return sortTasksByOrder(backlog, backlogOrder);
  }, [tasks, backlogOrder]);
  const tempoPlannableTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (task.completed || task.status === 'Done') return false;
        if (task.scheduled) return false;
        if (task.repeatParentId) return false;
        if (isRepeatTemplate(task)) return false;
        return task.duration > 0;
      }),
    [tasks],
  );

  const weekTasks = useMemo(
    () => tasks.filter((task) => task.scheduled?.weekKey === weekKey && !isRepeatTemplate(task)),
    [tasks, weekKey],
  );
  const unfinishedWeekTasks = useMemo(
    () => weekTasks.filter((task) => !task.completed && task.status !== 'Done'),
    [weekTasks],
  );
  const kanbanVisibleTasks = useMemo(
    () => tasks.filter((task) => !isRepeatTemplate(task) && task.scheduled?.weekKey === weekKey),
    [tasks, weekKey],
  );
  const clientSuggestions = useMemo(() => {
    const hiddenKeys = new Set(hiddenClientSuggestions.map(normalizeClientKey));
    const seen = new Set<string>();
    return tasks
      .map((task) => task.client.trim())
      .filter(Boolean)
      .filter((client) => !hiddenKeys.has(normalizeClientKey(client)))
      .filter((client) => {
        const key = client.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [tasks, hiddenClientSuggestions]);
  const projectDeadlineByClient = useMemo(() => {
    const deadlines: Record<string, string> = {};
    [...tasks]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .forEach((task) => {
        const clientKey = normalizeClientKey(task.client);
        const projectDeadline = task.projectDeadline.trim();
        if (!clientKey || !projectDeadline || deadlines[clientKey]) return;
        deadlines[clientKey] = projectDeadline;
      });
    return deadlines;
  }, [tasks]);
  const projectValueByClient = useMemo(() => {
    const values: Record<string, string> = {};
    [...tasks]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .forEach((task) => {
        const clientKey = normalizeClientKey(task.client);
        const projectValue = task.projectValue.trim();
        if (!clientKey || !projectValue || values[clientKey]) return;
        values[clientKey] = projectValue;
      });
    return values;
  }, [tasks]);
  const projectPriorityByClient = useMemo(() => {
    const priorities: Record<string, { urgent: boolean; important: boolean }> = {};
    tasks.forEach((task) => {
      const clientKey = normalizeClientKey(task.client);
      if (!clientKey) return;
      const current = priorities[clientKey] ?? { urgent: false, important: false };
      priorities[clientKey] = {
        urgent: current.urgent || Boolean(task.urgent),
        important: current.important || Boolean(task.important),
      };
    });
    return priorities;
  }, [tasks]);
  const activeTaskCountByClient = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((task) => {
      if (task.completed) return;
      const clientKey = normalizeClientKey(task.client);
      if (!clientKey) return;
      counts[clientKey] = (counts[clientKey] ?? 0) + 1;
    });
    return counts;
  }, [tasks]);

  const completedCount = weekTasks.filter((task) => task.completed).length;
  const completionPct = weekTasks.length === 0 ? 0 : Math.round((completedCount / weekTasks.length) * 100);
  const tempoPlanningStartDay = getTempoPlanningStartDay(weekKey, todayWeekKey, todayDayIndex);
  const tempoPlanHint = useMemo<TempoPlanNotice>(() => {
    if (tempoPlanNotice) return tempoPlanNotice;
    if (tempoPlanningStartDay >= DAY_NAMES.length) {
      return {
        tone: 'warning',
        text: 'Tempo only plans future days, so this week has no schedulable days left.',
      };
    }
    if (workBlocks.length === 0) {
      return {
        tone: 'warning',
        text: 'Add work blocks in Settings before Tempo can place tasks for you.',
      };
    }
    if (tempoPlannableTasks.length === 0) {
      return {
        tone: 'neutral',
        text: 'Nothing unscheduled is waiting for Tempo right now.',
      };
    }
    return {
      tone: 'neutral',
      text: '',
    };
  }, [tempoPlanNotice, tempoPlannableTasks.length, tempoPlanningStartDay, workBlocks.length]);

  const modalTask = useMemo(() => {
    if (!taskInModal) return undefined;
    const selected = taskById.get(taskInModal);
    if (!selected) return undefined;
    if (!selected.repeatParentId) return selected;
    const parent = taskById.get(selected.repeatParentId);
    if (!parent?.repeat) return selected;
    return { ...selected, repeat: parent.repeat };
  }, [taskInModal, taskById]);
  const modalTaskHasValidRepeatParent = useMemo(
    () => hasValidRepeatParent(modalTask, taskById),
    [modalTask, taskById],
  );

  function isMobileViewport() {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 1120px)').matches;
  }

  function slotTimeLabel(slot: number) {
    const totalMinutes = 5 * 60 + slot * SLOT_MINUTES;
    const h24 = Math.floor(totalMinutes / 60);
    const mins = `${totalMinutes % 60}`.padStart(2, '0');
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${mins} ${period}`;
  }

  function mobileHourLabel(slot: number) {
    return timeLabel(slot).replace(' AM', 'A').replace(' PM', 'P');
  }

  function scheduledTooltip(weekStart: string, dayIndex: number) {
    const monday = new Date(`${weekStart}T00:00:00`);
    monday.setDate(monday.getDate() + dayIndex);
    const formatted = new Intl.DateTimeFormat('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    }).format(monday);
    return `Scheduled ${formatted}`;
  }

  function resetMobileSwipe() {
    mobileSwipeRef.current = null;
    setMobileSwipeDragging(false);
    setMobileSwipeOffsetPx(0);
  }

  function handleTimelineTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (!isMobileViewport()) return;
    if (event.touches.length !== 1) {
      resetMobileSwipe();
      return;
    }
    const touch = event.touches[0];
    mobileSwipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      axis: null,
    };
    setMobileSwipeDragging(false);
    setMobileSwipeOffsetPx(0);
  }

  function handleTimelineTouchMove(event: ReactTouchEvent<HTMLElement>) {
    const gesture = mobileSwipeRef.current;
    if (!gesture || event.touches.length !== 1) return;

    const touch = event.touches[0];
    gesture.lastX = touch.clientX;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;

    if (gesture.axis === null) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX < 8 && absY < 8) return;

      const horizontalIntent = absX > 18 && absX > absY * 1.35;
      const verticalIntent = absY > 10 && absY > absX * 1.1;
      if (!horizontalIntent && !verticalIntent) return;

      gesture.axis = horizontalIntent ? 'x' : 'y';
      if (gesture.axis !== 'x') {
        setMobileSwipeDragging(false);
        setMobileSwipeOffsetPx(0);
        return;
      }

      setMobileSwipeDragging(true);
    }

    if (gesture.axis !== 'x') return;

    if (event.cancelable) event.preventDefault();

    const trackWidth = timelineAreaRef.current?.clientWidth ?? window.innerWidth;
    const maxPeekOffset = Math.max(48, Math.round(trackWidth * 0.34));
    const canPeekPrev = mobileDay > 0;
    const canPeekNext = mobileDay < DAY_NAMES.length - 1;
    let offset = deltaX;
    if ((deltaX > 0 && !canPeekPrev) || (deltaX < 0 && !canPeekNext)) {
      offset = deltaX * 0.22;
    }
    offset = Math.max(-maxPeekOffset, Math.min(maxPeekOffset, offset));
    setMobileSwipeOffsetPx(offset);
  }

  function handleTimelineTouchEnd() {
    const gesture = mobileSwipeRef.current;
    if (!gesture) {
      resetMobileSwipe();
      return;
    }

    if (gesture.axis === 'x') {
      const deltaX = gesture.lastX - gesture.startX;
      const trackWidth = timelineAreaRef.current?.clientWidth ?? window.innerWidth;
      const snapThreshold = Math.max(42, trackWidth * 0.18);

      if (deltaX <= -snapThreshold && mobileDay < DAY_NAMES.length - 1) {
        setMobileDay((current) => Math.min(current + 1, DAY_NAMES.length - 1));
      } else if (deltaX >= snapThreshold && mobileDay > 0) {
        setMobileDay((current) => Math.max(current - 1, 0));
      }
    }

    resetMobileSwipe();
  }

  async function refreshPlannerData(nextUserId: string, options?: { foreground?: boolean }) {
    const foreground = options?.foreground ?? false;
    if (foreground) setLoadingPlanner(true);
    try {
      const data = await loadPlannerData(nextUserId);
      setTasks(data.tasks);
      setBacklogOrder(data.backlogOrder);
      setKanbanOrder(data.kanbanOrder);
      setSelectedWeekStart(data.selectedWeekStart);
      setProfileTimezone(data.timezone);
      setWorkBlocks(sortWorkBlocks(data.workBlocks));
      setSettingsTimezoneDraft(data.timezone);
      setSettingsWorkBlocksDraft(sortWorkBlocks(data.workBlocks));
      setPendingWorkBlockStart('');
      setPendingWorkBlockEnd('');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load planner data.');
    } finally {
      if (foreground) setLoadingPlanner(false);
    }
  }

  function runTaskTransition(update: () => void) {
    if (typeof document === 'undefined') {
      update();
      return;
    }

    const transitionDocument = document as ViewTransitionDocument;
    if (typeof transitionDocument.startViewTransition !== 'function') {
      update();
      return;
    }

    transitionDocument.startViewTransition(() => {
      flushSync(() => {
        update();
      });
    });
  }

  useEffect(() => {
    draggingTaskIdRef.current = draggingTaskId;
  }, [draggingTaskId]);

  useEffect(() => {
    taskInModalRef.current = taskInModal;
  }, [taskInModal]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!taskInModal && !settingsOpen && !mobileSlotPicker && !tempoPastDuePlacements) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [taskInModal, settingsOpen, mobileSlotPicker, tempoPastDuePlacements]);

  useEffect(() => {
    setTempoPlanNotice(null);
    setTempoUndoEntries([]);
    setTempoPastDuePlacements(null);
  }, [weekKey]);

  useEffect(() => {
    if (viewMode !== 'plan') {
      setFixedDayPills([]);
      setShowViewportTimelineScrollbar(false);
      return;
    }

    const updateStickyPills = () => {
      const stickyBar = document.querySelector('.sticky-planning-bar') as HTMLElement | null;
      const stickyBottom = Math.max(0, Math.ceil(stickyBar?.getBoundingClientRect().bottom ?? 0));
      document.documentElement.style.setProperty('--sticky-bar-bottom', `${stickyBottom}px`);
      const timelineRect = timelineAreaRef.current?.getBoundingClientRect();
      const calendarLeftEdge = timelineRect?.left ?? 0;
      const calendarRightEdge = timelineRect?.right ?? window.innerWidth;
      const timelineWidth = Math.max(0, timelineRect?.width ?? window.innerWidth);
      document.documentElement.style.setProperty('--timeline-pill-layer-left', `${Math.max(0, calendarLeftEdge)}px`);
      document.documentElement.style.setProperty('--timeline-pill-layer-width', `${timelineWidth}px`);

      const timelineGrid = timelineGridRef.current;
      const isDesktopPlan = !isMobileViewport();
      if (timelineGrid && isDesktopPlan) {
        const nextWidth = timelineGrid.scrollWidth;
        const hasHorizontalOverflow = nextWidth > timelineGrid.clientWidth + 1;
        setShowViewportTimelineScrollbar((current) => (current === hasHorizontalOverflow ? current : hasHorizontalOverflow));
        setTimelineScrollbarContentWidth((current) => (current === nextWidth ? current : nextWidth));

        const viewportScrollbar = timelineViewportScrollbarRef.current;
        if (viewportScrollbar && Math.abs(viewportScrollbar.scrollLeft - timelineGrid.scrollLeft) > 1) {
          viewportScrollbar.scrollLeft = timelineGrid.scrollLeft;
        }
      } else {
        setShowViewportTimelineScrollbar((current) => (current ? false : current));
      }

      const next: FloatingDayPill[] = [];
      DAY_NAMES.forEach((_, dayIndex) => {
        const header = dayHeaderRefs.current[dayIndex];
        const column = dayColumnRefs.current[dayIndex];
        if (!header) return;
        if (!column) return;
        const rect = header.getBoundingClientRect();
        const colRect = column.getBoundingClientRect();
        const isVisible =
          colRect.left < calendarRightEdge &&
          colRect.right > calendarLeftEdge;
        if (rect.top < stickyBottom && isVisible) {
          next.push({
            dayIndex,
            left: colRect.left + colRect.width / 2 - calendarLeftEdge,
          });
        }
      });

      setFixedDayPills(next);
    };

    let rafId = 0;
    const tick = () => {
      updateStickyPills();
      rafId = window.requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener('resize', updateStickyPills);
    return () => {
      window.removeEventListener('resize', updateStickyPills);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [viewMode, weekKey, mobileDay]);

  useEffect(() => {
    if (viewMode !== 'plan' || !showViewportTimelineScrollbar) return;
    const timelineGrid = timelineGridRef.current;
    const viewportScrollbar = timelineViewportScrollbarRef.current;
    if (!timelineGrid || !viewportScrollbar) return;

    const syncFromGrid = () => {
      if (Math.abs(viewportScrollbar.scrollLeft - timelineGrid.scrollLeft) > 1) {
        viewportScrollbar.scrollLeft = timelineGrid.scrollLeft;
      }
    };
    const syncFromViewport = () => {
      if (Math.abs(timelineGrid.scrollLeft - viewportScrollbar.scrollLeft) > 1) {
        timelineGrid.scrollLeft = viewportScrollbar.scrollLeft;
      }
    };

    syncFromGrid();
    timelineGrid.addEventListener('scroll', syncFromGrid, { passive: true });
    viewportScrollbar.addEventListener('scroll', syncFromViewport, { passive: true });
    return () => {
      timelineGrid.removeEventListener('scroll', syncFromGrid);
      viewportScrollbar.removeEventListener('scroll', syncFromViewport);
    };
  }, [viewMode, showViewportTimelineScrollbar, weekKey]);

  useEffect(() => {
    if (!saving) {
      setSavingDotCount(0);
      return;
    }
    const timer = window.setInterval(() => {
      setSavingDotCount((prev) => (prev + 1) % 3);
    }, 300);
    return () => window.clearInterval(timer);
  }, [saving]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!taskContextMenu) return;

    const dismiss = (event?: Event) => {
      const target = event?.target as HTMLElement | null;
      if (target?.closest('[data-task-context-menu]')) return;
      setTaskContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTaskContextMenu(null);
    };

    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [taskContextMenu]);

  useEffect(() => {
    if (!settingsTempoHelpOpen) return;

    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (settingsTempoSignalsRef.current?.contains(target)) return;
      setSettingsTempoHelpOpen(false);
    };

    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [settingsTempoHelpOpen]);

  useEffect(() => {
    const collapseThreshold = 36;
    const updateHeaderCollapsed = () => {
      const scrollTop = window.scrollY || window.pageYOffset || 0;

      if (headerResetToTopRef.current) {
        if (scrollTop <= 2) {
          headerResetToTopRef.current = false;
          headerCollapseLockedRef.current = false;
          setHeaderCollapsed(false);
        }
        return;
      }

      if (headerCollapseLockedRef.current) {
        setHeaderCollapsed((current) => (current ? current : true));
        return;
      }

      if (scrollTop > collapseThreshold) {
        headerCollapseLockedRef.current = true;
        setHeaderCollapsed(true);
        return;
      }

      setHeaderCollapsed(false);
    };

    window.addEventListener('scroll', updateHeaderCollapsed, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateHeaderCollapsed);
      if (headerResetTimeoutRef.current) {
        window.clearTimeout(headerResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setInitializing(false);
      return;
    }

    const bootstrap = async () => {
      try {
        const user = await getSessionUser();
        if (user) {
          setUserId(user.id);
          setUserEmail(user.email ?? '');
          await refreshPlannerData(user.id, { foreground: true });
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to initialize auth.');
      } finally {
        setInitializing(false);
      }
    };

    void bootstrap();

    const unsubscribe = onAuthStateChange((event) => {
      void (async () => {
        try {
          if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
          const user = await getSessionUser();
          if (!user) {
            setUserId(null);
            setUserEmail('');
            setTasks([]);
            setBacklogOrder([]);
            setKanbanOrder([]);
            setSelectedWeekStart(nowWeekStartKey());
            setProfileTimezone(localTimezone());
            setWorkBlocks([]);
            setSettingsTimezoneDraft(localTimezone());
            setSettingsWorkBlocksDraft([]);
            setPendingWorkBlockStart('');
            setPendingWorkBlockEnd('');
            setSettingsOpen(false);
            return;
          }

          setUserId(user.id);
          setUserEmail(user.email ?? '');
          if (taskInModalRef.current) return;
          await refreshPlannerData(user.id);
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh session.');
        }
      })();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (taskInModal) return;
    if (!userId || tasks.length === 0) return;
    if (!tasks.some((task) => task.repeat?.enabled && !task.repeatParentId)) return;

    let cancelled = false;
    void (async () => {
      try {
        const created = await ensureRepeatingTasksForWeek(userId, weekKey, tasks);
        if (cancelled || created.length === 0) return;
        setTasks((current) => [...created, ...current]);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(getErrorMessage(error, 'Failed to generate recurring tasks.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, weekKey, tasks, taskInModal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      clearDragState();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rawValue = window.localStorage.getItem(hiddenClientSuggestionsStorageKey);
      if (!rawValue) {
        setHiddenClientSuggestions([]);
        setLoadedHiddenClientSuggestionsKey(hiddenClientSuggestionsStorageKey);
        return;
      }

      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) {
        setHiddenClientSuggestions([]);
        setLoadedHiddenClientSuggestionsKey(hiddenClientSuggestionsStorageKey);
        return;
      }

      setHiddenClientSuggestions(
        parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      );
      setLoadedHiddenClientSuggestionsKey(hiddenClientSuggestionsStorageKey);
    } catch {
      setHiddenClientSuggestions([]);
      setLoadedHiddenClientSuggestionsKey(hiddenClientSuggestionsStorageKey);
    }
  }, [hiddenClientSuggestionsStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loadedHiddenClientSuggestionsKey !== hiddenClientSuggestionsStorageKey) return;
    window.localStorage.setItem(hiddenClientSuggestionsStorageKey, JSON.stringify(hiddenClientSuggestions));
  }, [hiddenClientSuggestions, hiddenClientSuggestionsStorageKey, loadedHiddenClientSuggestionsKey]);

  function replaceTask(nextTask: Task) {
    setTasks((current) => current.map((task) => (task.id === nextTask.id ? nextTask : task)));
  }

  function hideClientSuggestion(client: string) {
    const clientKey = normalizeClientKey(client);
    if (!clientKey) return;

    setHiddenClientSuggestions((current) => {
      if (current.some((value) => normalizeClientKey(value) === clientKey)) return current;
      return [...current, client];
    });
  }

  function restoreClientSuggestion(client: string) {
    const clientKey = normalizeClientKey(client);
    if (!clientKey) return;

    setHiddenClientSuggestions((current) => current.filter((value) => normalizeClientKey(value) !== clientKey));
  }

  function clearDragState() {
    setDraggingTaskId(null);
    setDragCursor(null);
    setDragBox(null);
    setDropTarget(null);
    setShiftPreviewPatches([]);
    setDragOverBacklog(false);
    setBacklogInsertIndex(null);
    setDragOverStatus(null);
    setKanbanDropTarget(null);
  }

  function openTaskContextMenu(taskId: string, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 170;
    const menuHeight = 44;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
    setTaskContextMenu({ taskId, x, y });
  }

  function startTaskResize(task: Task, event: ReactMouseEvent<HTMLDivElement>) {
    if (!task.scheduled) return;
    event.preventDefault();
    if (event.button !== 0) return;

    const startY = event.clientY;
    const startDuration = task.duration;
    setResizingTaskId(task.id);
    setResizePreviewDuration(startDuration);

    const onMove = (moveEvent: MouseEvent) => {
      const nextDuration = getResizedDuration(startDuration, moveEvent.clientY - startY);
      setResizePreviewDuration(nextDuration);
    };

    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const nextDuration = getResizedDuration(startDuration, upEvent.clientY - startY);
      setResizingTaskId(null);
      setResizePreviewDuration(null);
      if (nextDuration !== startDuration) {
        void patchTask(task.id, { duration: nextDuration });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function getBacklogInsertIndex(y: number) {
    const nodes = Array.from(document.querySelectorAll('[data-backlog-index]')) as HTMLElement[];
    if (nodes.length === 0) return 0;

    for (const node of nodes) {
      const idx = Number(node.dataset.backlogIndex);
      if (!Number.isFinite(idx)) continue;
      const rect = node.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return idx;
    }

    return nodes.length;
  }

  function getKanbanInsertIndex(statusColumn: HTMLElement, y: number) {
    const status = statusColumn.dataset.dropStatus as TaskStatus | undefined;
    if (!status) return 0;

    const nodes = Array.from(
      statusColumn.querySelectorAll(`[data-kanban-status="${status}"][data-kanban-index]`),
    ) as HTMLElement[];
    if (nodes.length === 0) return 0;

    for (const node of nodes) {
      const idx = Number(node.dataset.kanbanIndex);
      if (!Number.isFinite(idx)) continue;
      const rect = node.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return idx;
    }

    return nodes.length;
  }

  function detectDropTarget(x: number, y: number) {
    const element = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!element) return { type: 'none' as const };

    const dayTrackEl = element.closest('[data-day-track]') as HTMLElement | null;
    const dayTrackIndex = Number(dayTrackEl?.dataset.dayTrack);
    if (dayTrackEl && Number.isFinite(dayTrackIndex)) {
      const rect = dayTrackEl.getBoundingClientRect();
      const rawSlot = Math.floor((y - rect.top) / SLOT_HEIGHT);
      const clampedSlot = Math.max(0, Math.min(TOTAL_SLOTS - 1, rawSlot));
      return { type: 'slot' as const, dayIndex: dayTrackIndex, slot: clampedSlot };
    }

    const slotEl = element.closest('[data-drop-slot]') as HTMLElement | null;
    if (slotEl?.dataset.dropSlot) {
      const [dayIndex, slot] = slotEl.dataset.dropSlot.split(':').map(Number);
      if (Number.isFinite(dayIndex) && Number.isFinite(slot)) {
        return { type: 'slot' as const, dayIndex, slot };
      }
    }

    const backlogEl = element.closest('[data-drop-backlog]');
    if (backlogEl) return { type: 'backlog' as const, insertIndex: getBacklogInsertIndex(y) };

    const statusEl = element.closest('[data-drop-status]') as HTMLElement | null;
    const status = statusEl?.dataset.dropStatus as TaskStatus | undefined;
    if (status && statusEl) {
      return { type: 'status' as const, status, insertIndex: getKanbanInsertIndex(statusEl, y) };
    }

    return { type: 'none' as const };
  }

  function updateHoverTargets(x: number, y: number) {
    const target = detectDropTarget(x, y);
    if (target.type === 'slot' && draggingTaskIdRef.current) {
      const shiftPlan = buildStableShiftPlan(draggingTaskIdRef.current, target.dayIndex, target.slot);
      if (shiftPlan) {
        setDropTarget({ dayIndex: target.dayIndex, slot: shiftPlan.movedTaskSlot });
        setShiftPreviewPatches(
          shiftPlan.patches.map((patch) => ({
            taskId: patch.taskId,
            dayIndex: shiftPlan.dayIndex,
            slot: patch.slot,
          })),
        );
      } else {
        const nextSlot = findNearestAvailableSlot(draggingTaskIdRef.current, target.dayIndex, target.slot);
        setDropTarget(nextSlot !== null ? { dayIndex: target.dayIndex, slot: nextSlot } : null);
        setShiftPreviewPatches([]);
      }
    } else {
      setDropTarget(null);
      setShiftPreviewPatches([]);
    }
    setDragOverBacklog(target.type === 'backlog');
    setBacklogInsertIndex(target.type === 'backlog' ? target.insertIndex : null);
    setDragOverStatus(target.type === 'status' ? target.status : null);
    setKanbanDropTarget(target.type === 'status' ? { status: target.status, insertIndex: target.insertIndex } : null);
  }

  function findNearestAvailableSlot(taskId: string, dayIndex: number, desiredSlot: number): number | null {
    const movingTask = taskById.get(taskId);
    if (!movingTask) return null;

    const neededSlots = durationToSlots(movingTask.duration);
    const maxStart = TOTAL_SLOTS - neededSlots;
    if (maxStart < 0) return null;

    const clampedDesired = Math.max(0, Math.min(desiredSlot, maxStart));

    const occupied = Array.from({ length: TOTAL_SLOTS }, () => false);
    tasks
      .filter((task) => task.id !== taskId && task.scheduled?.weekKey === weekKey && task.scheduled.dayIndex === dayIndex)
      .forEach((task) => {
        const start = task.scheduled?.slot ?? 0;
        const end = Math.min(TOTAL_SLOTS, start + durationToSlots(task.duration));
        for (let i = start; i < end; i += 1) occupied[i] = true;
      });

    const canPlaceAt = (start: number) => {
      const end = start + neededSlots;
      if (end > TOTAL_SLOTS) return false;
      for (let i = start; i < end; i += 1) {
        if (occupied[i]) return false;
      }
      return true;
    };

    if (canPlaceAt(clampedDesired)) return clampedDesired;

    for (let delta = 1; delta <= TOTAL_SLOTS; delta += 1) {
      const forward = clampedDesired + delta;
      if (forward <= maxStart && canPlaceAt(forward)) return forward;

      const backward = clampedDesired - delta;
      if (backward >= 0 && canPlaceAt(backward)) return backward;
    }

    return null;
  }

  function findNextAvailableTimelineSlotAfter(sourceTask: Task) {
    if (!sourceTask.scheduled) return null;

    const neededSlots = durationToSlots(sourceTask.duration);
    const maxStart = TOTAL_SLOTS - neededSlots;
    if (maxStart < 0) return null;

    const canPlaceAt = (dayIndex: number, start: number) => {
      if (start < 0 || start > maxStart) return false;
      const end = start + neededSlots;

      return !tasks.some((task) => {
        const scheduled = task.scheduled;
        if (!scheduled) return false;
        if (scheduled.weekKey !== sourceTask.scheduled?.weekKey) return false;
        if (scheduled.dayIndex !== dayIndex) return false;

        const taskStart = scheduled.slot;
        const taskEnd = taskStart + durationToSlots(task.duration);
        return start < taskEnd && end > taskStart;
      });
    };

    for (let dayIndex = sourceTask.scheduled.dayIndex; dayIndex < DAY_NAMES.length; dayIndex += 1) {
      const startSlot =
        dayIndex === sourceTask.scheduled.dayIndex
          ? Math.max(0, sourceTask.scheduled.slot + neededSlots)
          : 0;

      for (let slot = startSlot; slot <= maxStart; slot += 1) {
        if (canPlaceAt(dayIndex, slot)) {
          return { dayIndex, slot };
        }
      }
    }

    return null;
  }

  function buildStableShiftPlan(
    taskId: string,
    dayIndex: number,
    desiredSlot: number,
    movingDurationOverride?: Task['duration'],
    targetWeekKeyOverride?: string,
  ) {
    const movingTask = taskById.get(taskId);
    if (!movingTask) return null;

    const targetWeekKey = targetWeekKeyOverride ?? weekKey;
    const movingSlots = durationToSlots(movingDurationOverride ?? movingTask.duration);
    const movingMaxStart = TOTAL_SLOTS - movingSlots;
    if (movingMaxStart < 0) return null;

    const sameDayTasks = tasks
      .filter(
        (task) =>
          task.id !== taskId &&
          task.scheduled?.weekKey === targetWeekKey &&
          task.scheduled.dayIndex === dayIndex,
      )
      .sort((a, b) => (a.scheduled?.slot ?? 0) - (b.scheduled?.slot ?? 0));

    let movingStart = Math.max(0, Math.min(desiredSlot, movingMaxStart));

    for (const task of sameDayTasks) {
      const start = task.scheduled?.slot ?? 0;
      const end = start + durationToSlots(task.duration);
      if (start < movingStart && end > movingStart) {
        movingStart = end;
      }
    }

    if (movingStart > movingMaxStart) return null;

    const patches: Array<{ taskId: string; slot: number }> = [{ taskId, slot: movingStart }];
    let cursor = movingStart + movingSlots;

    for (const task of sameDayTasks) {
      const start = task.scheduled?.slot ?? 0;
      if (start < movingStart) continue;

      const taskSlots = durationToSlots(task.duration);
      const maxStart = TOTAL_SLOTS - taskSlots;
      const nextStart = Math.max(start, cursor);
      if (nextStart > maxStart) return null;

      if (nextStart !== start) patches.push({ taskId: task.id, slot: nextStart });
      cursor = nextStart + taskSlots;
    }

    return { weekKey: targetWeekKey, dayIndex, movedTaskSlot: movingStart, patches };
  }

  async function applyShiftPlan(
    dayIndex: number,
    patches: Array<{ taskId: string; slot: number }>,
  ) {
    if (!userId) return;
    setSaving(true);
    try {
      const updatedTasks = await Promise.all(
        patches.map((patch) =>
          updateTask(userId, patch.taskId, {
            scheduled: makeScheduled(weekKey, dayIndex, patch.slot),
            planningSource: undefined,
          }),
        ),
      );
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => updatedById.get(task.id) ?? task));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reorder timeline tasks.');
    } finally {
      setSaving(false);
    }
  }

  async function persistBacklogOrder(nextOrder: string[]) {
    if (!userId) return;
    setBacklogOrder(nextOrder);
    try {
      await updateBacklogOrder(userId, nextOrder, selectedWeekStart);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save backlog order.');
    }
  }

  async function persistKanbanOrder(nextOrder: string[]) {
    if (!userId) return;
    setKanbanOrder(nextOrder);
    try {
      await updateKanbanOrder(userId, nextOrder, selectedWeekStart);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save kanban order.');
    }
  }

  async function reorderBacklogTaskToIndex(dragTaskId: string, insertIndex: number) {
    const backlogIds = backlogTasks.map((task) => task.id).filter((id) => id !== dragTaskId);
    const safeIndex = Math.max(0, Math.min(insertIndex, backlogIds.length));
    backlogIds.splice(safeIndex, 0, dragTaskId);
    await persistBacklogOrder(backlogIds);
  }

  async function reorderKanbanTaskToIndex(dragTaskId: string, status: TaskStatus, insertIndex: number) {
    const isKanbanVisible = (task: Task) => !isRepeatTemplate(task) && task.scheduled?.weekKey === weekKey;

    const tasksInTargetStatus = sortTasksByOrder(
      tasks.filter((task) => task.id !== dragTaskId && task.status === status && isKanbanVisible(task)),
      kanbanOrder,
    );
    const targetIds = tasksInTargetStatus.map((task) => task.id);
    const safeIndex = Math.max(0, Math.min(insertIndex, targetIds.length));
    targetIds.splice(safeIndex, 0, dragTaskId);

    const nextVisibleKanbanOrder: string[] = [];
    STATUS_ORDER.forEach((statusName) => {
      if (statusName === status) {
        nextVisibleKanbanOrder.push(...targetIds);
        return;
      }
      const ids = sortTasksByOrder(
        tasks.filter((task) => task.id !== dragTaskId && task.status === statusName && isKanbanVisible(task)),
        kanbanOrder,
      ).map((task) => task.id);
      nextVisibleKanbanOrder.push(...ids);
    });

    // Keep hidden task ids stable in order storage; append them after visible ids.
    const visibleSet = new Set(nextVisibleKanbanOrder);
    const hiddenExisting = kanbanOrder.filter((id) => !visibleSet.has(id));
    const nextKanbanOrder = [...nextVisibleKanbanOrder, ...hiddenExisting];

    await persistKanbanOrder(nextKanbanOrder);
  }

  function onTaskHandlePointerDown(taskId: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();

    const card = (event.currentTarget as HTMLElement).closest('.task-card') as HTMLElement | null;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    setDraggingTaskId(taskId);
    setDragCursor({ x: event.clientX, y: event.clientY });
    setDragBox({
      width: rect.width,
      height: rect.height,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    });
    updateHoverTargets(event.clientX, event.clientY);

    const onMove = (moveEvent: PointerEvent) => {
      setDragCursor({ x: moveEvent.clientX, y: moveEvent.clientY });
      updateHoverTargets(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      const dragTaskId = draggingTaskIdRef.current;
      if (!dragTaskId) {
        clearDragState();
        return;
      }

      const target = detectDropTarget(upEvent.clientX, upEvent.clientY);
      void (async () => {
        if (target.type === 'slot') {
          const shiftPlan = buildStableShiftPlan(dragTaskId, target.dayIndex, target.slot);
          if (shiftPlan) {
            await applyShiftPlan(shiftPlan.dayIndex, shiftPlan.patches);
          } else {
            const nextSlot = findNearestAvailableSlot(dragTaskId, target.dayIndex, target.slot);
            if (nextSlot === null) {
              setErrorMessage('No room in that day for this task duration.');
            } else {
              await moveTaskToTimeline(dragTaskId, target.dayIndex, nextSlot);
              setErrorMessage(null);
            }
          }
        } else if (target.type === 'backlog') {
          const sourceTask = taskById.get(dragTaskId);
          if (sourceTask?.scheduled) {
            await moveTaskToBacklog(dragTaskId);
          }
          await reorderBacklogTaskToIndex(dragTaskId, target.insertIndex);
        } else if (target.type === 'status') {
          const sourceTask = taskById.get(dragTaskId);
          const nextCompleted = target.status === 'Done';
          if (!sourceTask || sourceTask.status !== target.status || sourceTask.completed !== nextCompleted) {
            await patchTask(dragTaskId, { status: target.status, completed: nextCompleted });
          }
          await reorderKanbanTaskToIndex(dragTaskId, target.status, target.insertIndex);
        }
      })();

      clearDragState();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  async function handleCreateTask() {
    const title = newTaskTitle.trim();
    if (!title || !userId) return;

    setSaving(true);
    try {
      const task = await createTask(userId, title);
      setTasks((current) => [task, ...current]);
      const nextOrder = [task.id, ...backlogOrder.filter((id) => id !== task.id)];
      await persistBacklogOrder(nextOrder);
      const nextKanbanOrder = [task.id, ...kanbanOrder.filter((id) => id !== task.id)];
      await persistKanbanOrder(nextKanbanOrder);
      setNewTaskTitle('');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicateTask(taskId: string) {
    if (!userId) return;
    const source = taskById.get(taskId);
    if (!source) return;

    setTaskContextMenu(null);
    setSaving(true);
    try {
      const scheduledPlacement = source.scheduled ? findNextAvailableTimelineSlotAfter(source) : null;
      const created = await createTask(userId, source.title);
      const duplicatePatch: Partial<Task> = {
        client: source.client,
        activity: source.activity,
        planningSource: undefined,
        projectValue: source.projectValue,
        completed: false,
        duration: source.duration,
        dueDate: source.dueDate,
        projectDeadline: source.projectDeadline,
        urgent: source.urgent,
        important: source.important,
        notes: source.notes,
        links: [...source.links],
        attachments: source.attachments.map((attachment) => ({ ...attachment })),
        status: source.status === 'Done' ? 'Not Started' : source.status,
        scheduled:
          source.scheduled && scheduledPlacement
            ? makeScheduled(source.scheduled.weekKey, scheduledPlacement.dayIndex, scheduledPlacement.slot)
            : undefined,
        repeat: undefined,
        repeatParentId: undefined,
      };
      const duplicated = await updateTask(userId, created.id, duplicatePatch);
      setTasks((current) => [duplicated, ...current]);
      if (!duplicated.scheduled) {
        const nextOrder = [duplicated.id, ...backlogOrder.filter((id) => id !== duplicated.id)];
        await persistBacklogOrder(nextOrder);
      }
      if (duplicated.scheduled?.weekKey === weekKey) {
        const nextKanbanOrder = [duplicated.id, ...kanbanOrder.filter((id) => id !== duplicated.id)];
        await persistKanbanOrder(nextKanbanOrder);
      }
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to duplicate task.');
    } finally {
      setSaving(false);
    }
  }

  async function scheduleTaskAtSlot(taskId: string, dayIndex: number, slot: number) {
    const shiftPlan = buildStableShiftPlan(taskId, dayIndex, slot);
    if (shiftPlan) {
      await applyShiftPlan(shiftPlan.dayIndex, shiftPlan.patches);
      return;
    }
    const nextSlot = findNearestAvailableSlot(taskId, dayIndex, slot);
    if (nextSlot === null) {
      setErrorMessage('No room in that day for this task duration.');
      return;
    }
    await moveTaskToTimeline(taskId, dayIndex, nextSlot);
    setErrorMessage(null);
  }

  async function createAndScheduleTaskAtSlot(title: string, dayIndex: number, slot: number) {
    if (!userId) return null;
    const task = await createTask(userId, title);
    const scheduledTask = await updateTask(userId, task.id, {
      scheduled: makeScheduled(weekKey, dayIndex, slot),
      planningSource: undefined,
    });
    setTasks((current) => [scheduledTask, ...current]);
    const nextKanbanOrder = [scheduledTask.id, ...kanbanOrder.filter((id) => id !== scheduledTask.id)];
    void persistKanbanOrder(nextKanbanOrder);
    return scheduledTask;
  }

  function isSlotOccupied(dayIndex: number, slot: number) {
    return weekTasks.some((task) => {
      if (task.scheduled?.dayIndex !== dayIndex) return false;
      const start = task.scheduled.slot;
      const end = start + durationToSlots(task.duration);
      return slot >= start && slot < end;
    });
  }

  async function handleCreateTaskAtSlot(dayIndex: number, slot: number) {
    if (!userId || saving || draggingTaskId || resizingTaskId) return;
    if (isSlotOccupied(dayIndex, slot)) return;

    if (isMobileViewport() && viewMode === 'plan') {
      setMobileSlotPicker({ dayIndex, slot });
      setMobileBacklogTitle('');
      setMobileSlotPickerError(null);
      return;
    }

    setSaving(true);
    try {
      const created = await createAndScheduleTaskAtSlot('New Task', dayIndex, slot);
      if (!created) return;
      setTaskInModal(created.id);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAndAssignMobileTask() {
    if (!mobileSlotPicker) return;
    const title = mobileBacklogTitle.trim();
    if (!title || !userId) {
      setMobileSlotPickerError('Enter a task title first.');
      return;
    }

    setSaving(true);
    setMobileSlotPickerError(null);
    try {
      const created = await createAndScheduleTaskAtSlot(title, mobileSlotPicker.dayIndex, mobileSlotPicker.slot);
      if (!created) return;
      setMobileBacklogTitle('');
      setMobileSlotPicker(null);
      setErrorMessage(null);
    } catch (error) {
      setMobileSlotPickerError(error instanceof Error ? error.message : 'Failed to create task.');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignExistingTaskToMobileSlot(taskId: string) {
    if (!mobileSlotPicker) return;
    setSaving(true);
    try {
      await scheduleTaskAtSlot(taskId, mobileSlotPicker.dayIndex, mobileSlotPicker.slot);
      setMobileSlotPicker(null);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to schedule task.');
    } finally {
      setSaving(false);
    }
  }

  function compareScheduledPosition(
    a: { weekKey: string; dayIndex: number; slot: number },
    b: { weekKey: string; dayIndex: number; slot: number },
  ) {
    if (a.weekKey !== b.weekKey) return a.weekKey.localeCompare(b.weekKey);
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    return a.slot - b.slot;
  }

  function buildTemplatePatchFromTaskPatch(patch: Partial<Task>): Partial<Task> {
    const templatePatch: Partial<Task> = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) templatePatch.title = patch.title;
    if (Object.prototype.hasOwnProperty.call(patch, 'client')) templatePatch.client = patch.client;
    if (Object.prototype.hasOwnProperty.call(patch, 'activity')) templatePatch.activity = patch.activity;
    if (Object.prototype.hasOwnProperty.call(patch, 'projectValue')) templatePatch.projectValue = patch.projectValue;
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) templatePatch.status = patch.status;
    if (Object.prototype.hasOwnProperty.call(patch, 'duration')) templatePatch.duration = patch.duration;
    if (Object.prototype.hasOwnProperty.call(patch, 'dueDate')) templatePatch.dueDate = patch.dueDate;
    if (Object.prototype.hasOwnProperty.call(patch, 'projectDeadline')) templatePatch.projectDeadline = patch.projectDeadline;
    if (Object.prototype.hasOwnProperty.call(patch, 'urgent')) templatePatch.urgent = patch.urgent;
    if (Object.prototype.hasOwnProperty.call(patch, 'important')) templatePatch.important = patch.important;
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) templatePatch.notes = patch.notes;
    if (Object.prototype.hasOwnProperty.call(patch, 'links')) templatePatch.links = patch.links;
    if (Object.prototype.hasOwnProperty.call(patch, 'attachments')) templatePatch.attachments = patch.attachments;
    return templatePatch;
  }

  function mergeTaskDetails(nextTask: Task, existingTask?: Task, patch?: Partial<Task>) {
    const hasClientPatch = patch ? Object.prototype.hasOwnProperty.call(patch, 'client') : false;
    const hasActivityPatch = patch ? Object.prototype.hasOwnProperty.call(patch, 'activity') : false;
    const hasPlanningSourcePatch = patch ? Object.prototype.hasOwnProperty.call(patch, 'planningSource') : false;
    const hasProjectValuePatch = patch ? Object.prototype.hasOwnProperty.call(patch, 'projectValue') : false;
    const hasProjectDeadlinePatch = patch ? Object.prototype.hasOwnProperty.call(patch, 'projectDeadline') : false;

    return {
      ...(existingTask ?? nextTask),
      ...nextTask,
      client: hasClientPatch ? patch?.client ?? '' : nextTask.client ?? existingTask?.client ?? '',
      activity: hasActivityPatch ? patch?.activity ?? '' : nextTask.activity ?? existingTask?.activity ?? '',
      planningSource: hasPlanningSourcePatch ? patch?.planningSource ?? undefined : nextTask.planningSource ?? existingTask?.planningSource,
      projectValue: hasProjectValuePatch ? patch?.projectValue ?? '' : nextTask.projectValue ?? existingTask?.projectValue ?? '',
      projectDeadline: hasProjectDeadlinePatch
        ? patch?.projectDeadline ?? ''
        : nextTask.projectDeadline ?? existingTask?.projectDeadline ?? '',
    };
  }

  function inheritProjectDeadlineForBrand(patch: Partial<Task>, currentTask?: Task) {
    const hasClientPatch = Object.prototype.hasOwnProperty.call(patch, 'client');
    const hasProjectDeadlinePatch = Object.prototype.hasOwnProperty.call(patch, 'projectDeadline');
    if (!hasClientPatch && !hasProjectDeadlinePatch) return patch;

    const nextClient = hasClientPatch ? patch.client ?? '' : currentTask?.client ?? '';
    const nextProjectDeadline = hasProjectDeadlinePatch ? patch.projectDeadline ?? '' : currentTask?.projectDeadline ?? '';
    if (!nextClient.trim() || nextProjectDeadline) return patch;

    const inheritedProjectDeadline = projectDeadlineByClient[normalizeClientKey(nextClient)] ?? '';

    if (!inheritedProjectDeadline) return patch;
    return { ...patch, projectDeadline: inheritedProjectDeadline };
  }

  function inheritProjectValueForBrand(patch: Partial<Task>, currentTask?: Task) {
    const hasClientPatch = Object.prototype.hasOwnProperty.call(patch, 'client');
    const hasProjectValuePatch = Object.prototype.hasOwnProperty.call(patch, 'projectValue');
    if (!hasClientPatch && !hasProjectValuePatch) return patch;

    const nextClient = hasClientPatch ? patch.client ?? '' : currentTask?.client ?? '';
    const nextProjectValue = hasProjectValuePatch ? patch.projectValue ?? '' : currentTask?.projectValue ?? '';
    if (!nextClient.trim() || nextProjectValue) return patch;

    const inheritedProjectValue = projectValueByClient[normalizeClientKey(nextClient)] ?? '';

    if (!inheritedProjectValue) return patch;
    return { ...patch, projectValue: inheritedProjectValue };
  }

  function inheritProjectPriorityForBrand(patch: Partial<Task>, currentTask?: Task) {
    const hasClientPatch = Object.prototype.hasOwnProperty.call(patch, 'client');
    const hasUrgentPatch = Object.prototype.hasOwnProperty.call(patch, 'urgent');
    const hasImportantPatch = Object.prototype.hasOwnProperty.call(patch, 'important');
    if (!hasClientPatch && !hasUrgentPatch && !hasImportantPatch) return patch;

    const nextClient = hasClientPatch ? patch.client ?? '' : currentTask?.client ?? '';
    const projectKey = normalizeClientKey(nextClient);
    if (!projectKey) return patch;

    const inheritedPriority = projectPriorityByClient[projectKey];
    if (!inheritedPriority) return patch;

    const nextPatch = { ...patch };
    if (!hasUrgentPatch) nextPatch.urgent = inheritedPriority.urgent;
    if (!hasImportantPatch) nextPatch.important = inheritedPriority.important;
    return nextPatch;
  }

  function getProjectDeadlinePropagation(taskId: string, patch: Partial<Task>, currentTask?: Task) {
    if (!Object.prototype.hasOwnProperty.call(patch, 'projectDeadline')) return null;

    const nextClient = Object.prototype.hasOwnProperty.call(patch, 'client') ? patch.client ?? '' : currentTask?.client ?? '';
    const brandKey = normalizeClientKey(nextClient);
    if (!brandKey) return null;

    const nextProjectDeadline = patch.projectDeadline ?? '';
    const relatedTasks = tasks.filter((task) => normalizeClientKey(task.client) === brandKey);
    const taskIds = new Set(relatedTasks.map((task) => task.id));
    taskIds.add(taskId);
    const hasMismatch = relatedTasks.some((task) => (task.projectDeadline ?? '') !== nextProjectDeadline);
    if (!hasMismatch && (currentTask?.projectDeadline ?? '') === nextProjectDeadline) return null;

    return {
      taskIds: [...taskIds],
      projectDeadline: nextProjectDeadline,
    };
  }

  function getProjectValuePropagation(taskId: string, patch: Partial<Task>, currentTask?: Task) {
    if (!Object.prototype.hasOwnProperty.call(patch, 'projectValue')) return null;

    const nextClient = Object.prototype.hasOwnProperty.call(patch, 'client') ? patch.client ?? '' : currentTask?.client ?? '';
    const projectKey = normalizeClientKey(nextClient);
    if (!projectKey) return null;

    const nextProjectValue = patch.projectValue ?? '';
    const relatedTasks = tasks.filter((task) => normalizeClientKey(task.client) === projectKey);
    const taskIds = new Set(relatedTasks.map((task) => task.id));
    taskIds.add(taskId);
    const hasMismatch = relatedTasks.some((task) => (task.projectValue ?? '') !== nextProjectValue);
    if (!hasMismatch && (currentTask?.projectValue ?? '') === nextProjectValue) return null;

    return {
      taskIds: [...taskIds],
      projectValue: nextProjectValue,
    };
  }

  function getProjectPriorityPropagation(taskId: string, patch: Partial<Task>, currentTask?: Task) {
    const hasUrgentPatch = Object.prototype.hasOwnProperty.call(patch, 'urgent');
    const hasImportantPatch = Object.prototype.hasOwnProperty.call(patch, 'important');
    if (!hasUrgentPatch && !hasImportantPatch) return null;

    const nextClient = Object.prototype.hasOwnProperty.call(patch, 'client') ? patch.client ?? '' : currentTask?.client ?? '';
    const projectKey = normalizeClientKey(nextClient);
    if (!projectKey) return null;

    const nextUrgent = hasUrgentPatch ? Boolean(patch.urgent) : Boolean(currentTask?.urgent);
    const nextImportant = hasImportantPatch ? Boolean(patch.important) : Boolean(currentTask?.important);
    const relatedTasks = tasks.filter((task) => normalizeClientKey(task.client) === projectKey);
    const taskIds = new Set(relatedTasks.map((task) => task.id));
    taskIds.add(taskId);
    const hasMismatch = relatedTasks.some((task) => task.urgent !== nextUrgent || task.important !== nextImportant);
    const currentTaskMatches = Boolean(currentTask?.urgent) === nextUrgent && Boolean(currentTask?.important) === nextImportant;
    if (!hasMismatch && currentTaskMatches) return null;

    return {
      taskIds: [...taskIds],
      urgent: nextUrgent,
      important: nextImportant,
    };
  }

  async function applyProjectDeadlinePropagation(
    propagation: { taskIds: string[]; projectDeadline: string } | null,
    updatesById?: Map<string, Task>,
  ) {
    const nextUpdatesById = updatesById ? new Map(updatesById) : new Map<string, Task>();
    if (!propagation || !userId) return nextUpdatesById;

    const taskIdsToUpdate = propagation.taskIds.filter((id) => {
      const currentTask = nextUpdatesById.get(id) ?? taskById.get(id);
      return (currentTask?.projectDeadline ?? '') !== propagation.projectDeadline;
    });

    if (taskIdsToUpdate.length === 0) return nextUpdatesById;

    const propagatedTasks = await Promise.all(
      taskIdsToUpdate.map((id) => updateTask(userId, id, { projectDeadline: propagation.projectDeadline })),
    );

    propagatedTasks.forEach((task) => nextUpdatesById.set(task.id, task));
    return nextUpdatesById;
  }

  async function applyProjectValuePropagation(
    propagation: { taskIds: string[]; projectValue: string } | null,
    updatesById?: Map<string, Task>,
  ) {
    const nextUpdatesById = updatesById ? new Map(updatesById) : new Map<string, Task>();
    if (!propagation || !userId) return nextUpdatesById;

    const taskIdsToUpdate = propagation.taskIds.filter((id) => {
      const currentTask = nextUpdatesById.get(id) ?? taskById.get(id);
      return (currentTask?.projectValue ?? '') !== propagation.projectValue;
    });

    if (taskIdsToUpdate.length === 0) return nextUpdatesById;

    const propagatedTasks = await Promise.all(
      taskIdsToUpdate.map((id) => updateTask(userId, id, { projectValue: propagation.projectValue })),
    );

    propagatedTasks.forEach((task) => nextUpdatesById.set(task.id, task));
    return nextUpdatesById;
  }

  async function applyProjectPriorityPropagation(
    propagation: { taskIds: string[]; urgent: boolean; important: boolean } | null,
    updatesById?: Map<string, Task>,
  ) {
    const nextUpdatesById = updatesById ? new Map(updatesById) : new Map<string, Task>();
    if (!propagation || !userId) return nextUpdatesById;

    const taskIdsToUpdate = propagation.taskIds.filter((id) => {
      const currentTask = nextUpdatesById.get(id) ?? taskById.get(id);
      return Boolean(currentTask?.urgent) !== propagation.urgent || Boolean(currentTask?.important) !== propagation.important;
    });

    if (taskIdsToUpdate.length === 0) return nextUpdatesById;

    const propagatedTasks = await Promise.all(
      taskIdsToUpdate.map((id) => updateTask(userId, id, { urgent: propagation.urgent, important: propagation.important })),
    );

    propagatedTasks.forEach((task) => nextUpdatesById.set(task.id, task));
    return nextUpdatesById;
  }

  async function patchTask(taskId: string, patch: Partial<Task>, updateScope: 'single' | 'future' = 'single') {
    if (!userId) return;

    const currentTask = taskById.get(taskId);
    const currentTaskHasValidRepeatParent = hasValidRepeatParent(currentTask, taskById);
    patch = inheritProjectDeadlineForBrand(patch, currentTask);
    patch = inheritProjectValueForBrand(patch, currentTask);
    patch = inheritProjectPriorityForBrand(patch, currentTask);
    const projectDeadlinePropagation = getProjectDeadlinePropagation(taskId, patch, currentTask);
    const projectValuePropagation = getProjectValuePropagation(taskId, patch, currentTask);
    const projectPriorityPropagation = getProjectPriorityPropagation(taskId, patch, currentTask);
    let hasRepeatPatch = Object.prototype.hasOwnProperty.call(patch, 'repeat');
    const repeatPatch = hasRepeatPatch ? patch.repeat : undefined;
    if (currentTask?.repeatParentId && currentTaskHasValidRepeatParent && hasRepeatPatch && !repeatPatch?.enabled) {
      updateScope = 'future';
    }
    const hasScheduledPatch = Object.prototype.hasOwnProperty.call(patch, 'scheduled');
    const hasEffectiveScheduledPatch =
      hasScheduledPatch &&
      (() => {
        const nextScheduled = patch.scheduled;
        const prevScheduled = currentTask?.scheduled;
        if (!prevScheduled && !nextScheduled) return false;
        if (!prevScheduled || !nextScheduled) return true;
        return (
          prevScheduled.weekKey !== nextScheduled.weekKey ||
          prevScheduled.dayIndex !== nextScheduled.dayIndex ||
          prevScheduled.slot !== nextScheduled.slot ||
          prevScheduled.timezone !== nextScheduled.timezone
        );
      })();

    if (hasEffectiveScheduledPatch && !Object.prototype.hasOwnProperty.call(patch, 'planningSource')) {
      patch = { ...patch, planningSource: undefined };
    }

    if (currentTask?.repeatParentId && currentTaskHasValidRepeatParent && updateScope === 'future') {
      const anchorScheduled = currentTask.scheduled;
      const parentId = currentTask.repeatParentId;
      const parentTask = taskById.get(parentId);
      const taskPatch: Partial<Task> = { ...patch };
      delete taskPatch.repeat;
      delete taskPatch.scheduled;
      delete taskPatch.completed;

      setSaving(true);
      try {
        let updatesById = new Map<string, Task>();
        const deleteIds = new Set<string>();
        const parentPatch: Partial<Task> = buildTemplatePatchFromTaskPatch(taskPatch);
        const shouldSplitSeriesFromAnchor = Boolean(hasRepeatPatch && anchorScheduled && parentTask?.repeat);
        let nextSeriesParentId = parentId;
        const shouldDisableSeriesFromAnchor = Boolean(hasRepeatPatch && !repeatPatch?.enabled);

        if (shouldDisableSeriesFromAnchor) {
          parentPatch.repeat = anchorScheduled && parentTask?.repeat
            ? endRepeatBeforeScheduled(parentTask.repeat, anchorScheduled)
            : undefined;
        } else if (shouldSplitSeriesFromAnchor && parentTask?.repeat) {
          parentPatch.repeat = endRepeatBeforeScheduled(parentTask.repeat, anchorScheduled!);
        } else if (hasRepeatPatch) {
          parentPatch.repeat = repeatPatch?.enabled ? repeatPatch : undefined;
        }

        if (Object.keys(parentPatch).length > 0) {
          const updatedParent = await updateTask(userId, parentId, parentPatch);
          updatesById.set(updatedParent.id, updatedParent);
        }

        if (shouldSplitSeriesFromAnchor && repeatPatch?.enabled && anchorScheduled) {
          const templateSource = {
            ...currentTask,
            ...taskPatch,
            repeatParentId: undefined,
            repeat: undefined,
            scheduled: anchorScheduled,
          };
          const nextTemplate = await createRepeatTemplate(userId, templateSource, anchorRepeatToScheduled(repeatPatch, anchorScheduled));
          updatesById.set(nextTemplate.id, nextTemplate);
          nextSeriesParentId = nextTemplate.id;
        }

        const seriesInstances = tasks.filter((task) => {
          if (task.repeatParentId !== parentId) return false;
          return isSeriesTaskOnOrAfterAnchor(task, currentTask);
        });
        const currentInstancePatch = {
          ...taskPatch,
          ...(hasRepeatPatch ? { repeatParentId: repeatPatch?.enabled ? nextSeriesParentId : undefined } : {}),
        };
        const otherFutureInstances = seriesInstances.filter((task) => task.id !== currentTask.id);

        if (shouldDisableSeriesFromAnchor) {
          otherFutureInstances.forEach((task) => deleteIds.add(task.id));
        }

        const updatedInstances = await Promise.all([
          updateTask(userId, currentTask.id, currentInstancePatch),
          ...(!shouldDisableSeriesFromAnchor
            ? otherFutureInstances.map((instance) =>
                updateTask(userId, instance.id, {
                  ...taskPatch,
                  ...(hasRepeatPatch ? { repeatParentId: repeatPatch?.enabled ? nextSeriesParentId : undefined } : {}),
                }),
              )
            : []),
        ]);
        updatedInstances.forEach((task) => updatesById.set(task.id, task));
        if (deleteIds.size > 0) {
          await Promise.all(Array.from(deleteIds, (id) => deleteTask(userId, id)));
        }

        let created: Task[] = [];
        if (hasRepeatPatch && repeatPatch?.enabled) {
          const existingIds = new Set(tasks.map((task) => task.id));
          const nextTasks = tasks.map((task) => updatesById.get(task.id) ?? task);
          updatesById.forEach((task) => {
            if (!existingIds.has(task.id)) nextTasks.unshift(task);
          });
          created = await ensureRepeatingTasksForWeek(userId, weekKey, nextTasks);
        }

        updatesById = await applyProjectDeadlinePropagation(projectDeadlinePropagation, updatesById);
        updatesById = await applyProjectValuePropagation(projectValuePropagation, updatesById);
        updatesById = await applyProjectPriorityPropagation(projectPriorityPropagation, updatesById);

        setTasks((current) => {
          const next = current
            .filter((task) => !deleteIds.has(task.id))
            .map((task) => {
            const updatedTask = updatesById.get(task.id);
            if (!updatedTask) return task;
            const patchSource = task.id === parentId ? parentPatch : taskPatch;
            return mergeTaskDetails(updatedTask, task, patchSource);
            });
          const existing = new Set(next.map((task) => task.id));
          updatesById.forEach((task) => {
            if (!existing.has(task.id)) {
              next.unshift(task);
              existing.add(task.id);
            }
          });
          created.forEach((task) => {
            if (!existing.has(task.id)) {
              next.unshift(task);
              existing.add(task.id);
            }
          });
          return next;
        });
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Failed to update future recurring tasks.'));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (currentTask?.repeatParentId && currentTaskHasValidRepeatParent && updateScope === 'single' && hasRepeatPatch) {
      const taskPatch: Partial<Task> = { ...patch };
      delete taskPatch.repeat;
      patch = taskPatch;
      hasRepeatPatch = false;
    }

    if (currentTask && hasRepeatPatch) {
      const taskPatch: Partial<Task> = { ...patch };
      delete taskPatch.repeat;
      const shouldDetachOrphanSeries = Boolean(currentTask.repeatParentId && !currentTaskHasValidRepeatParent);

      setSaving(true);
      try {
        let updatesById = new Map<string, Task>();

        if (shouldDetachOrphanSeries) {
          taskPatch.repeatParentId = undefined;
        }

        if (currentTask.repeatParentId && currentTaskHasValidRepeatParent) {
          const parentPatch: Partial<Task> = { repeat: repeatPatch?.enabled ? repeatPatch : undefined };
          const updatedParent = await updateTask(userId, currentTask.repeatParentId, parentPatch);
          updatesById.set(updatedParent.id, updatedParent);
        } else if (repeatPatch?.enabled) {
          const templateSource = { ...currentTask, ...taskPatch, repeatParentId: undefined, repeat: undefined };
          const anchoredRepeat =
            templateSource.scheduled ? anchorRepeatToScheduled(repeatPatch, templateSource.scheduled) : repeatPatch;
          const template = await createRepeatTemplate(userId, templateSource, anchoredRepeat);
          updatesById.set(template.id, template);
          taskPatch.repeatParentId = template.id;
        }

        taskPatch.repeat = undefined;
        const updatedTask = await updateTask(userId, taskId, taskPatch);
        updatesById.set(updatedTask.id, updatedTask);

        let created: Task[] = [];
        if (repeatPatch?.enabled) {
          const existingIds = new Set(tasks.map((task) => task.id));
          const nextTasks = tasks.map((task) => updatesById.get(task.id) ?? task);
          updatesById.forEach((task) => {
            if (!existingIds.has(task.id)) nextTasks.unshift(task);
          });
          created = await ensureRepeatingTasksForWeek(userId, weekKey, nextTasks);
        }

        updatesById = await applyProjectDeadlinePropagation(projectDeadlinePropagation, updatesById);
        updatesById = await applyProjectValuePropagation(projectValuePropagation, updatesById);
        updatesById = await applyProjectPriorityPropagation(projectPriorityPropagation, updatesById);

        setTasks((current) => {
          const next = current.map((task) => {
            const updatedTask = updatesById.get(task.id);
            if (!updatedTask) return task;
            const patchSource = task.id === taskId ? taskPatch : undefined;
            return mergeTaskDetails(updatedTask, task, patchSource);
          });
          const existing = new Set(next.map((task) => task.id));
          updatesById.forEach((task) => {
            if (!existing.has(task.id)) {
              next.unshift(task);
              existing.add(task.id);
            }
          });
          created.forEach((task) => {
            if (!existing.has(task.id)) {
              next.unshift(task);
              existing.add(task.id);
            }
          });
          return next;
        });

        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Failed to update recurring task settings.'));
      } finally {
        setSaving(false);
      }
      return;
    }

    const hasDurationChange = patch.duration !== undefined && currentTask && patch.duration !== currentTask.duration;

    if (currentTask?.scheduled && hasDurationChange && !hasEffectiveScheduledPatch) {
      const plan = buildStableShiftPlan(
        taskId,
        currentTask.scheduled.dayIndex,
        currentTask.scheduled.slot,
        patch.duration,
        currentTask.scheduled.weekKey,
      );

      if (!plan) {
        setErrorMessage('Not enough room in that day for the new duration.');
        return;
      }

      setSaving(true);
      try {
        const shiftedPatches = plan.patches.filter((entry) => entry.taskId !== taskId);
        const updates = await Promise.all([
          updateTask(userId, taskId, {
            ...patch,
            scheduled: makeScheduled(plan.weekKey, plan.dayIndex, plan.movedTaskSlot),
            planningSource: undefined,
          }),
          ...shiftedPatches.map((entry) =>
            updateTask(userId, entry.taskId, {
              scheduled: makeScheduled(plan.weekKey, plan.dayIndex, entry.slot),
              planningSource: undefined,
            }),
          ),
        ]);

        let updatedById = new Map(updates.map((task) => [task.id, task]));
        updatedById = await applyProjectDeadlinePropagation(projectDeadlinePropagation, updatedById);
        updatedById = await applyProjectValuePropagation(projectValuePropagation, updatedById);
        updatedById = await applyProjectPriorityPropagation(projectPriorityPropagation, updatedById);
        setTasks((current) =>
          current.map((task) => {
            const updatedTask = updatedById.get(task.id);
            if (!updatedTask) return task;
            const patchSource = task.id === taskId ? patch : undefined;
            return mergeTaskDetails(updatedTask, task, patchSource);
          }),
        );
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to update task duration.');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const nextTask = await updateTask(userId, taskId, patch);
      let updatedById = new Map([[nextTask.id, nextTask]]);
      updatedById = await applyProjectDeadlinePropagation(projectDeadlinePropagation, updatedById);
      updatedById = await applyProjectValuePropagation(projectValuePropagation, updatedById);
      updatedById = await applyProjectPriorityPropagation(projectPriorityPropagation, updatedById);
      setTasks((current) =>
        current.map((task) => {
          const updatedTask = updatedById.get(task.id);
          if (!updatedTask) return task;
          const patchSource = task.id === taskId ? patch : undefined;
          return mergeTaskDetails(updatedTask, task, patchSource);
        }),
      );
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (!userId) return;

    setSaving(true);
    try {
      await deleteTask(userId, taskId);
      setTasks((current) => current.filter((task) => task.id !== taskId));
      const nextOrder = backlogOrder.filter((id) => id !== taskId);
      await persistBacklogOrder(nextOrder);
      const nextKanbanOrder = kanbanOrder.filter((id) => id !== taskId);
      await persistKanbanOrder(nextKanbanOrder);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete task.');
    } finally {
      setSaving(false);
    }
  }

  async function moveTaskToTimeline(taskId: string, dayIndex: number, slot: number) {
    await patchTask(taskId, {
      scheduled: makeScheduled(weekKey, dayIndex, slot),
    });
  }

  async function moveTaskToBacklog(taskId: string) {
    await patchTask(taskId, { scheduled: undefined });
  }

  async function changeSelectedWeek(nextWeekKey: string) {
    if (!userId) return;

    setSelectedWeekStart(nextWeekKey);
    try {
      await updateSelectedWeekStart(userId, nextWeekKey, backlogOrder);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save selected week.');
    }
  }

  function handleExpandHeaderFromOwl() {
    headerResetToTopRef.current = true;
    headerCollapseLockedRef.current = false;
    setHeaderCollapsed(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (headerResetTimeoutRef.current) {
      window.clearTimeout(headerResetTimeoutRef.current);
    }

    headerResetTimeoutRef.current = window.setTimeout(() => {
      if (!headerResetToTopRef.current) return;
      headerResetToTopRef.current = false;
      const scrollTop = window.scrollY || window.pageYOffset || 0;
      if (scrollTop <= 2) {
        headerCollapseLockedRef.current = false;
        setHeaderCollapsed(false);
        return;
      }
      headerCollapseLockedRef.current = true;
      setHeaderCollapsed(true);
    }, 1200);
  }

  async function handlePlanMyWeek() {
    if (!userId) return;
    setTempoPastDuePlacements(null);

    if (tempoPlanningStartDay >= DAY_NAMES.length) {
      setTempoPlanNotice({
        tone: 'warning',
        text: 'Tempo only plans future days, so there is nothing left to schedule in this week.',
      });
      return;
    }

    if (workBlocks.length === 0) {
      setTempoPlanNotice({
        tone: 'warning',
        text: 'Set up at least one work block in settings before Tempo can plan your week.',
      });
      return;
    }

    if (tempoPlannableTasks.length === 0) {
      setTempoPlanNotice({
        tone: 'neutral',
        text: 'Nothing unscheduled is waiting for Tempo right now.',
      });
      return;
    }

    const occupied = Array.from({ length: DAY_NAMES.length }, () => Array.from({ length: TOTAL_SLOTS }, () => false));
    weekTasks.forEach((task) => {
      if (!task.scheduled) return;
      const start = task.scheduled.slot;
      const end = Math.min(TOTAL_SLOTS, start + durationToSlots(task.duration));
      for (let slot = start; slot < end; slot += 1) {
        occupied[task.scheduled.dayIndex][slot] = true;
      }
    });

    const tasksByProject = new Map<string, Task[]>();
    tempoPlannableTasks.forEach((task) => {
      const projectKey = normalizeClientKey(task.client) || `task:${task.id}`;
      const projectTasks = tasksByProject.get(projectKey);
      if (projectTasks) {
        projectTasks.push(task);
      } else {
        tasksByProject.set(projectKey, [task]);
      }
    });

    const orderedProjectQueues = Array.from(tasksByProject.entries())
      .map(([projectKey, projectTasks]) => ({
        projectKey,
        projectPriorityScore: getTempoProjectPriorityScore(projectTasks, weekKey),
        earliestDeadlineSortValue: projectTasks.reduce<number>((currentEarliest, task) => {
          const deadlineTime = parseDateKey(getEffectiveDeadline(task))?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return Math.min(currentEarliest, deadlineTime);
        }, Number.MAX_SAFE_INTEGER),
        oldestCreatedAt: projectTasks.reduce(
          (currentOldest, task) =>
            currentOldest.localeCompare(task.createdAt) <= 0 ? currentOldest : task.createdAt,
          projectTasks[0].createdAt,
        ),
        highestProjectValue: Math.max(...projectTasks.map((task) => parseProjectValueAmount(task.projectValue))),
        statusSortValue: getTempoProjectStatusSortValue(projectTasks),
        tasks: [...projectTasks].sort((a, b) => {
          const flowDiff = getTempoProjectFlowRank(a.activity) - getTempoProjectFlowRank(b.activity);
          if (flowDiff !== 0) return flowDiff;

          const titleDiff = naturalTitleCollator.compare(a.title, b.title);
          if (titleDiff !== 0) return titleDiff;

          return a.createdAt.localeCompare(b.createdAt);
        }),
      }))
      .sort((a, b) => {
        const deadlineDiff = a.earliestDeadlineSortValue - b.earliestDeadlineSortValue;
        if (deadlineDiff !== 0) return deadlineDiff;

        const scoreDiff = b.projectPriorityScore - a.projectPriorityScore;
        if (scoreDiff !== 0) return scoreDiff;

        const valueDiff = b.highestProjectValue - a.highestProjectValue;
        if (valueDiff !== 0) return valueDiff;

        const statusDiff = a.statusSortValue - b.statusSortValue;
        if (statusDiff !== 0) return statusDiff;

        return a.oldestCreatedAt.localeCompare(b.oldestCreatedAt);
      });

    const orderedTasks = orderedProjectQueues.flatMap((projectQueue) =>
      projectQueue.tasks.map((task) => ({ task, projectKey: projectQueue.projectKey })),
    );

    const plannedEntries: Array<{ taskId: string; dayIndex: number; slot: number }> = [];
    const unscheduledCountByTaskId = new Set<string>();
    const nextEarliestByProject = new Map<string, { dayIndex: number; slot: number }>();
    const weekStartDate = parseDateKey(weekKey);

    function tryPlaceTask(
      task: Task,
      projectKey: string,
      mode: 'primary' | 'backfill',
    ) {
      const neededSlots = durationToSlots(task.duration);
      const earliestPlacement = nextEarliestByProject.get(projectKey);
      const startDayIndex = Math.max(tempoPlanningStartDay, earliestPlacement?.dayIndex ?? tempoPlanningStartDay);
      const taskDeadline = parseDateKey(getEffectiveDeadline(task));
      const latestDayIndex = (() => {
        if (!weekStartDate || !taskDeadline) return DAY_NAMES.length - 1;
        const relativeDeadlineDay = differenceInCalendarDays(weekStartDate, taskDeadline);
        // If the task is already overdue before this selected week starts, still allow Tempo to place it this week.
        if (relativeDeadlineDay < 0) return DAY_NAMES.length - 1;
        return Math.min(DAY_NAMES.length - 1, relativeDeadlineDay);
      })();

      if (latestDayIndex < 0 || startDayIndex > latestDayIndex) {
        return false;
      }

      for (let dayIndex = startDayIndex; dayIndex <= latestDayIndex; dayIndex += 1) {
        const candidateRanges = [...tempoWorkRangesByDay[dayIndex]]
          .map((range) => ({ ...range, preference: getTempoRangePreference(task, range) }))
          .filter((range) => Number.isFinite(range.preference))
          .sort((a, b) =>
            mode === 'backfill'
              ? a.startSlot - b.startSlot || a.preference - b.preference
              : a.preference - b.preference || a.startSlot - b.startSlot,
          );

        for (const range of candidateRanges) {
          const earliestSlotInRange =
            earliestPlacement && dayIndex === earliestPlacement.dayIndex ? earliestPlacement.slot : 0;
          const rangeStart = Math.max(range.startSlot, earliestSlotInRange);
          const latestStart = range.endSlot - neededSlots;
          if (latestStart < rangeStart) continue;

          for (let slot = rangeStart; slot <= latestStart; slot += 1) {
            let canFit = true;
            for (let cursor = slot; cursor < slot + neededSlots; cursor += 1) {
              if (occupied[dayIndex][cursor]) {
                canFit = false;
                break;
              }
            }

            if (!canFit) continue;

            for (let cursor = slot; cursor < slot + neededSlots; cursor += 1) {
              occupied[dayIndex][cursor] = true;
            }
            plannedEntries.push({ taskId: task.id, dayIndex, slot });
            const nextSlot = slot + neededSlots;
            if (nextSlot >= TOTAL_SLOTS) {
              nextEarliestByProject.set(projectKey, { dayIndex: dayIndex + 1, slot: 0 });
            } else {
              nextEarliestByProject.set(projectKey, { dayIndex, slot: nextSlot });
            }
            return true;
          }
        }
      }

      return false;
    }

    const primaryTasks = orderedTasks.filter(({ task }) => task.activity !== 'Outreach');
    const backfillQueue: Array<{ task: Task; projectKey: string }> = [];

    primaryTasks.forEach(({ task, projectKey }) => {
      if (!tryPlaceTask(task, projectKey, 'primary')) {
        backfillQueue.push({ task, projectKey });
      }
    });

    const outreachTasks = orderedTasks.filter(({ task }) => task.activity === 'Outreach');
    const secondPassTasks = [...backfillQueue, ...outreachTasks];

    secondPassTasks.forEach(({ task, projectKey }) => {
      if (!tryPlaceTask(task, projectKey, 'backfill')) {
        unscheduledCountByTaskId.add(task.id);
      }
    });

    const patchByTaskId = new Map(
      plannedEntries.map((entry) => [
        entry.taskId,
        {
          scheduled: makeScheduled(weekKey, entry.dayIndex, entry.slot),
          planningSource: 'tempo' as const,
        },
      ]),
    );
    const undoEntries = plannedEntries.map((entry) => {
      const task = taskById.get(entry.taskId);
      return {
        taskId: entry.taskId,
        previousScheduled: task?.scheduled,
        previousPlanningSource: task?.planningSource,
        plannedWeekKey: weekKey,
        plannedDayIndex: entry.dayIndex,
        plannedSlot: entry.slot,
      } satisfies TempoUndoEntry;
    });

    setTempoPlanning(true);
    setSaving(true);
    try {
      const updatedTasks = await Promise.all(
        plannedEntries.map((entry) =>
          updateTask(userId, entry.taskId, {
            scheduled: makeScheduled(weekKey, entry.dayIndex, entry.slot),
            planningSource: 'tempo',
          }),
        ),
      );
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      runTaskTransition(() => {
        setTasks((current) =>
          current.map((task) => {
            const updatedTask = updatedById.get(task.id);
            if (!updatedTask) return task;
            return mergeTaskDetails(updatedTask, task, patchByTaskId.get(task.id));
          }),
        );
      });

      const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
      const scheduledFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const pastDuePlacements = updatedTasks
        .map((task) => {
          if (!task.scheduled) return null;
          const effectiveDeadline = parseDateKey(getEffectiveDeadline(task));
          if (!effectiveDeadline) return null;
          const scheduledDate = getScheduledDateFromWeekDay(task.scheduled.weekKey, task.scheduled.dayIndex);
          if (!scheduledDate) return null;
          if (scheduledDate.getTime() <= effectiveDeadline.getTime()) return null;

          return {
            taskId: task.id,
            title: task.title.trim() || 'Untitled task',
            dueDateLabel: dateFormatter.format(effectiveDeadline),
            scheduledDateLabel: scheduledFormatter.format(scheduledDate),
          } satisfies TempoPastDuePlacement;
        })
        .filter((entry): entry is TempoPastDuePlacement => Boolean(entry))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

      setTempoUndoEntries(undoEntries);
      setTempoPlanNotice({
        tone: unscheduledCountByTaskId.size > 0 ? 'warning' : 'neutral',
        text:
          plannedEntries.length > 0
            ? `Plan complete. ${plannedEntries.length} task${plannedEntries.length === 1 ? '' : 's'} scheduled.${unscheduledCountByTaskId.size > 0 ? ` ${unscheduledCountByTaskId.size} could not fit into future work-block time this week.` : ''}`
            : `Plan complete. No future work-block window was large enough for the remaining ${tempoPlannableTasks.length} task${tempoPlannableTasks.length === 1 ? '' : 's'}.`,
      });
      setTempoPastDuePlacements(pastDuePlacements.length > 0 ? pastDuePlacements : null);
      setErrorMessage(null);
    } catch (error) {
      setTempoUndoEntries([]);
      setTempoPastDuePlacements(null);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to plan your week.');
    } finally {
      setTempoPlanning(false);
      setSaving(false);
    }
  }

  async function handleUndoTempoPlan() {
    if (!userId || tempoUndoEntries.length === 0) return;

    const undoableEntries = tempoUndoEntries.filter((entry) => {
      const task = taskById.get(entry.taskId);
      const scheduled = task?.scheduled;
      if (!task || !scheduled) return false;
      return (
        task.planningSource === 'tempo' &&
        scheduled.weekKey === entry.plannedWeekKey &&
        scheduled.dayIndex === entry.plannedDayIndex &&
        scheduled.slot === entry.plannedSlot
      );
    });

    if (undoableEntries.length === 0) {
      setTempoUndoEntries([]);
      setTempoPlanNotice({
        tone: 'warning',
        text: 'Nothing from the last Tempo run is still in its original spot, so there is nothing left to undo.',
      });
      return;
    }

    const patchByTaskId = new Map(
      undoableEntries.map((entry) => [
        entry.taskId,
        {
          scheduled: entry.previousScheduled,
          planningSource: entry.previousPlanningSource,
        } satisfies Partial<Task>,
      ]),
    );

    setSaving(true);
    try {
      const updatedTasks = await Promise.all(
        undoableEntries.map((entry) =>
          updateTask(userId, entry.taskId, {
            scheduled: entry.previousScheduled,
            planningSource: entry.previousPlanningSource,
          }),
        ),
      );
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      runTaskTransition(() => {
        setTasks((current) =>
          current.map((task) => {
            const updatedTask = updatedById.get(task.id);
            if (!updatedTask) return task;
            return mergeTaskDetails(updatedTask, task, patchByTaskId.get(task.id));
          }),
        );
      });
      const skippedCount = tempoUndoEntries.length - undoableEntries.length;
      setTempoUndoEntries([]);
      setTempoPlanNotice({
        tone: skippedCount > 0 ? 'warning' : 'neutral',
        text: `Undo complete. ${undoableEntries.length} task${undoableEntries.length === 1 ? '' : 's'} returned to the backlog.${skippedCount > 0 ? ` ${skippedCount} changed since the plan run and were left alone.` : ''}`,
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to undo the last Tempo plan.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUnschedulePastDueTempoTasks() {
    if (!userId || !tempoPastDuePlacements || tempoPastDuePlacements.length === 0) return;

    const taskIds = tempoPastDuePlacements.map((entry) => entry.taskId);
    const patchByTaskId = new Map(
      taskIds.map((taskId) => [
        taskId,
        {
          scheduled: undefined,
          planningSource: undefined,
        } satisfies Partial<Task>,
      ]),
    );

    setSaving(true);
    try {
      const updatedTasks = await Promise.all(
        taskIds.map((taskId) =>
          updateTask(userId, taskId, {
            scheduled: undefined,
            planningSource: undefined,
          }),
        ),
      );
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      runTaskTransition(() => {
        setTasks((current) =>
          current.map((task) => {
            const updatedTask = updatedById.get(task.id);
            if (!updatedTask) return task;
            return mergeTaskDetails(updatedTask, task, patchByTaskId.get(task.id));
          }),
        );
      });

      const nextBacklogOrder = [...taskIds, ...backlogOrder.filter((id) => !taskIds.includes(id))];
      await persistBacklogOrder(nextBacklogOrder);
      setTempoPastDuePlacements(null);
      setTempoPlanNotice({
        tone: 'warning',
        text: `${taskIds.length} task${taskIds.length === 1 ? '' : 's'} unscheduled because they were placed past due date.`,
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to unschedule past-due tasks.');
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveUnfinishedWeekTasksToBacklog() {
    if (!userId || unfinishedWeekTasks.length === 0) return;

    const tasksToMove = sortTasksByWeeklySchedule(unfinishedWeekTasks, kanbanOrder);
    const patchByTaskId = new Map(
      tasksToMove.map((task) => [
        task.id,
        {
          scheduled: undefined,
          planningSource: undefined,
        } satisfies Partial<Task>,
      ]),
    );

    setSaving(true);
    try {
      const updatedTasks = await Promise.all(
        tasksToMove.map((task) =>
          updateTask(userId, task.id, {
            scheduled: undefined,
            planningSource: undefined,
          }),
        ),
      );
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      runTaskTransition(() => {
        setTasks((current) =>
          current.map((task) => {
            const updatedTask = updatedById.get(task.id);
            if (!updatedTask) return task;
            return mergeTaskDetails(updatedTask, task, patchByTaskId.get(task.id));
          }),
        );
      });

      const movedIds = tasksToMove.map((task) => task.id);
      const nextBacklogOrder = [...movedIds, ...backlogOrder.filter((id) => !movedIds.includes(id))];
      await persistBacklogOrder(nextBacklogOrder);
      setTempoUndoEntries([]);
      setTempoPlanNotice({
        tone: 'neutral',
        text: `${tasksToMove.length} unfinished task${tasksToMove.length === 1 ? '' : 's'} moved back to backlog for ${formatWeekLabel(weekKey)}.`,
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to move unfinished tasks back to backlog.');
    } finally {
      setSaving(false);
    }
  }

  function openSettingsModal() {
    setSettingsTempoHelpOpen(false);
    setSettingsTimezoneDraft(profileTimezone);
    setSettingsWorkBlocksDraft(sortWorkBlocks(workBlocks.map((block) => ({ ...block }))));
    setPendingWorkBlockStart('');
    setPendingWorkBlockEnd('');
    setSettingsPasswordDraft('');
    setSettingsPasswordConfirmDraft('');
    setDeleteAccountConfirmDraft('');
    setSettingsOpen(true);
  }

  function addDraftWorkBlock() {
    const nextBlock = {
      start: pendingWorkBlockStart.trim(),
      end: pendingWorkBlockEnd.trim(),
    };
    if (!nextBlock.start || !nextBlock.end) return;

    try {
      const normalized = normalizeWorkBlocksForSave([...settingsWorkBlocksDraft, nextBlock]);
      setSettingsWorkBlocksDraft(normalized);
      setPendingWorkBlockStart('');
      setPendingWorkBlockEnd('');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Invalid work block.');
    }
  }

  function removeDraftWorkBlock(index: number) {
    setSettingsWorkBlocksDraft((current) => current.filter((_, blockIndex) => blockIndex !== index));
  }

  function normalizeWorkBlocksForSave(blocks: WorkBlock[]) {
    const cleaned = blocks
      .map((block) => ({ start: block.start.trim(), end: block.end.trim() }))
      .filter((block) => block.start || block.end);

    if (cleaned.some((block) => !block.start || !block.end)) {
      throw new Error('Each work block needs both a start and end time.');
    }

    const sorted = sortWorkBlocks(cleaned);

    sorted.forEach((block) => {
      if (getWorkBlockEndMinutes(block) <= parseTimeValueToMinutes(block.start)) {
        throw new Error('Each work block must end after it starts.');
      }
    });

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (parseTimeValueToMinutes(current.start) < getWorkBlockEndMinutes(previous)) {
        throw new Error('Work blocks cannot overlap.');
      }
    }

    return sorted;
  }

  async function handleSaveSettings() {
    if (!userId) return;

    const nextTimezone = settingsTimezoneDraft.trim() || localTimezone();
    if (!isValidTimezone(nextTimezone)) {
      setErrorMessage('Enter a valid IANA timezone, like America/Los_Angeles.');
      return;
    }

    let normalizedBlocks: WorkBlock[];
    try {
      normalizedBlocks = normalizeWorkBlocksForSave(settingsWorkBlocksDraft);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Invalid work blocks.');
      return;
    }

    setSaving(true);
    try {
      await updateUserSettings(
        userId,
        {
          timezone: nextTimezone,
          workBlocks: normalizedBlocks,
        },
        selectedWeekStart,
      );
      setProfileTimezone(nextTimezone);
      setWorkBlocks(normalizedBlocks);
      setSettingsTimezoneDraft(nextTimezone);
      setSettingsWorkBlocksDraft(normalizedBlocks);
      setPendingWorkBlockStart('');
      setPendingWorkBlockEnd('');
      setSettingsOpen(false);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!settingsPasswordDraft) {
      setErrorMessage('Enter a new password.');
      return;
    }
    if (settingsPasswordDraft !== settingsPasswordConfirmDraft) {
      setErrorMessage('New password and confirmation must match.');
      return;
    }

    setSaving(true);
    try {
      await changePassword(settingsPasswordDraft);
      setSettingsPasswordDraft('');
      setSettingsPasswordConfirmDraft('');
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to change password.';
      if (message.toLowerCase().includes('nonce') || message.toLowerCase().includes('reauth')) {
        setErrorMessage('Supabase requires re-authentication before changing your password. Sign in again and retry.');
      } else {
        setErrorMessage(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteAccountConfirmDraft.trim() !== 'DELETE') {
      setErrorMessage('Type DELETE to confirm account deletion.');
      return;
    }

    setSaving(true);
    try {
      await deleteAccount();
      setSettingsOpen(false);
      setDeleteAccountConfirmDraft('');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete account.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAuthSubmit() {
    if (!email.trim() || !password) return;

    setInitializing(true);
    try {
      if (authMode === 'sign-up') {
        await signUp(email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }
      setErrorMessage(null);
      setPassword('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setInitializing(false);
    }
  }

  async function handleOAuth(provider: 'google' | 'facebook') {
    setInitializing(true);
    try {
      await signInWithOAuth(provider);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'OAuth sign-in failed.');
      setInitializing(false);
    }
  }

  if (!hasSupabaseEnv) {
    return (
      <div className="login-shell login-shell-grain">
        <main className="login-card">
          <h1>Supabase Required</h1>
          <p>Add environment variables to enable account-based auth and cloud persistence.</p>
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_ANON_KEY</code>
        </main>
      </div>
    );
  }

  if (initializing) {
    return (
      <div className="login-shell login-shell-grain">
        <main className="login-card">
          <h1>Loading Planner</h1>
          <p>Connecting to your workspace...</p>
        </main>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="login-shell login-shell-grain">
        <div className="login-stack">
          <div className="login-brand" aria-hidden="true">
            <img className="login-brand-icon logo-entrance" src="/img/tempo-icon.png" alt="" />
            <h1 className="login-title-script">Plan with Tempo</h1>
          </div>

          <main className="login-card">
          <p>Turn your to-do list into a calm, doable week.</p>

          {errorMessage && <div className="error-banner">{errorMessage}</div>}

          <label>
            Email
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleAuthSubmit()}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleAuthSubmit()}
            />
          </label>

          <div className="auth-actions">
            <button
              onClick={() => {
                setAuthMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'));
                setErrorMessage(null);
              }}
            >
              {authMode === 'sign-up' ? 'Use Existing Account' : 'Create New Account'}
            </button>
            <button onClick={() => void handleAuthSubmit()}>
              {authMode === 'sign-up' ? 'Create Account' : 'Sign In'}
            </button>
          </div>

          <div className="oauth-divider" role="separator" aria-label="OAuth sign-in options">
            <span>or continue with</span>
          </div>

          <div className="auth-actions oauth-actions oauth-brand-stack single-provider">
            <button className="oauth-button oauth-google" onClick={() => void handleOAuth('google')}>
              <span className="oauth-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <path
                    d="M21.99 12.23c0-.78-.07-1.53-.2-2.25H12v4.26h5.61a4.8 4.8 0 0 1-2.08 3.16v2.63h3.37c1.97-1.82 3.09-4.5 3.09-7.8Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 22.4c2.8 0 5.15-.93 6.86-2.5l-3.37-2.63c-.94.63-2.14 1.01-3.49 1.01-2.68 0-4.95-1.81-5.76-4.24H2.77v2.72A10.38 10.38 0 0 0 12 22.4Z"
                    fill="#34A853"
                  />
                  <path
                    d="M6.24 14.04a6.23 6.23 0 0 1 0-4.08V7.24H2.77a10.38 10.38 0 0 0 0 9.52l3.47-2.72Z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.72c1.52 0 2.88.52 3.95 1.55l2.97-2.97C17.14 2.66 14.79 1.6 12 1.6A10.38 10.38 0 0 0 2.77 7.24l3.47 2.72c.8-2.43 3.08-4.24 5.76-4.24Z"
                    fill="#EA4335"
                  />
                </svg>
              </span>
              <span>Continue with Google</span>
            </button>
          </div>
          <p className="login-trust-note">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Secure sign-in powered by Google + Supabase</span>
          </p>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`planner-shell grain-bg view-${viewMode} ${headerCollapsed ? 'header-collapsed' : ''}`}>
      <section className="header-hero">
        <header className="top-bar">
          <div className="header-brand" aria-hidden="true">
            <img className="header-title-icon" src="/img/tempo-icon.png" alt="" />
            <h1 className="header-title">Plan with Tempo</h1>
          </div>
          <img className="header-logo" src="/img/tempo2.png" alt="Plan with Tempo" />
          <div className="account-row">
            <span className="account-email">{userEmail || 'Signed in'}</span>
            <button className="account-link" type="button" onClick={openSettingsModal}>Settings</button>
            <button className="account-link" type="button" onClick={() => void signOut()}>Log Out</button>
          </div>
        </header>
        {errorMessage && <section className="error-banner">{errorMessage}</section>}
        <section className="status-slot" aria-live="polite">
          {saving ? (
            <span className="status-text status-saving">
              Saving<span className="status-dots">{'.'.repeat(savingDotCount + 1)}</span>
            </span>
          ) : loadingPlanner ? (
            <span className="status-text status-saving">Syncing planner</span>
          ) : (
            <span className="status-text status-saved">
              <Check size={13} aria-hidden="true" />
              <span>Saved</span>
            </span>
          )}
        </section>
      </section>

      <section className="sticky-planning-bar">
        <div className="top-controls">
          <div className="week-nav-row">
            <button
              type="button"
              className="week-nav-owl-wrap week-nav-owl-button"
              onClick={handleExpandHeaderFromOwl}
              aria-label="Back to top and expand header"
              title="Back to top and expand header"
              disabled={!headerCollapsed}
              tabIndex={headerCollapsed ? 0 : -1}
            >
              <img className="week-nav-owl" src="/img/tempo-icon.png" alt="" />
            </button>
            <button className="icon-text-button" aria-label="Previous week" onClick={() => void changeSelectedWeek(addWeeks(weekKey, -1))}>
              <ChevronLeft size={15} />
            </button>
            <h2>{formatWeekLabel(weekKey)}</h2>
            <button className="icon-text-button" aria-label="Next week" onClick={() => void changeSelectedWeek(addWeeks(weekKey, 1))}>
              <ChevronRight size={15} />
            </button>
            <button className="icon-text-button" onClick={() => void changeSelectedWeek(nowWeekStartKey())}>
              <CalendarDays size={15} />
              <span>This Week</span>
            </button>
          </div>
          <div className="mobile-day-nav-inline">
            <button
              type="button"
              className="mobile-nav-owl-wrap mobile-nav-owl-button"
              onClick={handleExpandHeaderFromOwl}
              aria-label="Back to top and expand header"
              title="Back to top and expand header"
              disabled={!headerCollapsed}
              tabIndex={headerCollapsed ? 0 : -1}
            >
              <img className="mobile-nav-owl" src="/img/tempo-icon.png" alt="" />
            </button>
            <button
              className="icon-text-button"
              aria-label="Previous day"
              onClick={() => setMobileDay((current) => (current + 6) % 7)}
            >
              <ChevronLeft size={15} />
            </button>
            <strong>{MOBILE_DAY_NAMES[mobileDay]}</strong>
            <button
              className="icon-text-button"
              aria-label="Next day"
              onClick={() => setMobileDay((current) => (current + 1) % 7)}
            >
              <ChevronRight size={15} />
            </button>
            <button
              className="icon-text-button"
              aria-label="Go to current day"
              onClick={() => {
                void changeSelectedWeek(nowWeekStartKey());
                setMobileDay(todayDayIndex);
              }}
            >
              <CalendarCheck size={15} />
            </button>
          </div>
          <div className="tempo-cta-group">
            <div className="tempo-plan-action-row">
              <button
                className="icon-text-button tempo-primary-button tempo-plan-button"
                onClick={() => void handlePlanMyWeek()}
                disabled={saving || tempoPlanning}
              >
                <Sparkles size={15} />
                <span>{tempoPlanning ? 'Planning...' : 'Plan My Week'}</span>
              </button>
              <div className="tempo-link-row">
                <button
                  className="icon-text-button tempo-undo-button"
                  onClick={() => void handleUndoTempoPlan()}
                  disabled={saving || tempoPlanning || tempoUndoEntries.length === 0}
                  data-tooltip="Undo last Tempo run"
                  aria-label="Undo last Tempo run"
                >
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-text-button tempo-undo-button"
                  onClick={() => void handleMoveUnfinishedWeekTasksToBacklog()}
                  disabled={saving || tempoPlanning || unfinishedWeekTasks.length === 0}
                  data-tooltip="Move all unscheduled tasks to backlog"
                  aria-label="Move all unscheduled tasks to backlog"
                >
                  <ListRestart size={15} />
                </button>
              </div>
            </div>
            {tempoPlanHint.text && <p className={`tempo-plan-note ${tempoPlanHint.tone}`}>{tempoPlanHint.text}</p>}
          </div>
          <div className="view-toggle" role="tablist" aria-label="View mode">
            <button
              className={`icon-text-button view-toggle-button ${viewMode === 'plan' ? 'active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'plan'}
              aria-label="Weekly Plan"
              onClick={() => setViewMode('plan')}
            >
              <Calendar size={15} />
            </button>
            <button
              className={`icon-text-button view-toggle-button ${viewMode === 'kanban' ? 'active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'kanban'}
              aria-label="Kanban"
              onClick={() => setViewMode('kanban')}
            >
              <Columns3 size={15} />
            </button>
          </div>
        </div>

        <section className="progress-strip" aria-live="polite">
          <div className="progress-fill" style={{ width: `${completionPct}%` }} />
          <p className="progress-text progress-text-muted">
            <strong>{completedCount} / {weekTasks.length} ({completionPct}%)</strong> done this week
          </p>
          <p className="progress-text progress-text-fill" aria-hidden="true" style={{ width: `${completionPct}%` }}>
            <strong>{completedCount} / {weekTasks.length} ({completionPct}%)</strong> done this week
          </p>
        </section>
      </section>

      {draggingTaskId && dragCursor && dragBox && (
        <div
          className="drag-floating-card"
          style={{
            width: dragBox.width,
            left: dragCursor.x,
            top: dragCursor.y,
          }}
        >
          {taskById.get(draggingTaskId)?.title}
        </div>
      )}

      <div className={`layout ${viewMode === 'kanban' ? 'kanban-only' : ''}`}>
        <aside
          data-drop-backlog="1"
          className={`backlog-panel ${viewMode === 'plan' ? 'plan-sticky' : ''} ${dragOverBacklog ? 'drop-active' : ''}`}
        >
          <h2>{viewMode === 'plan' ? 'Tasks' : 'Unscheduled'}</h2>

          <div className="new-task-row">
            <input
              placeholder="Press enter to add task"
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleCreateTask();
                }
              }}
            />
            <button
              className="icon-text-button"
              aria-label="Add task"
              disabled={!newTaskTitle.trim() || saving}
              onClick={() => void handleCreateTask()}
            >
              <Plus size={15} />
            </button>
          </div>

          <div className={`backlog-scroll ${viewMode === 'plan' && !headerCollapsed ? 'locked' : ''}`}>
            <div className="task-stack">
              {backlogTasks.map((task, index) => (
                <div key={task.id} data-backlog-index={index}>
                  {draggingTaskId && dragOverBacklog && backlogInsertIndex === index && (
                    <div className="backlog-drop-line" />
                  )}
                  <TaskCard
                    task={task}
                    showDuration={false}
                    showMeta
                    showIndicators
                    onOpenDetails={() => setTaskInModal(task.id)}
                    onToggleComplete={() =>
                      void patchTask(task.id, {
                        completed: !task.completed,
                        status: !task.completed ? 'Done' : task.status === 'Done' ? 'Not Started' : task.status,
                      })
                    }
                    onHandlePointerDown={(event) => onTaskHandlePointerDown(task.id, event)}
                    onRequestContextMenu={(event) => openTaskContextMenu(task.id, event)}
                    isDragging={draggingTaskId === task.id}
                  />
                </div>
              ))}
              {draggingTaskId && dragOverBacklog && backlogInsertIndex === backlogTasks.length && (
                <div className="backlog-drop-line" />
              )}
            </div>
          </div>
        </aside>

        {viewMode === 'kanban' ? (
          <section className="kanban-board">
            {KANBAN_COLUMNS.map((column) => {
              const tasksInStatus = sortTasksByWeeklySchedule(
                kanbanVisibleTasks.filter((task) => column.statuses.includes(task.status)),
                kanbanOrder,
              );

              return (
                <div
                  key={column.label}
                  data-drop-status={column.dropStatus}
                  className={`kanban-column ${dragOverStatus === column.dropStatus ? 'drop-active' : ''}`}
                >
                  <h3>{column.label}</h3>
                  <div className="task-stack">
                    {tasksInStatus.map((task, index) => (
                      <div key={task.id} data-kanban-status={column.dropStatus} data-kanban-index={index}>
                        {draggingTaskId &&
                          dragOverStatus === column.dropStatus &&
                          kanbanDropTarget?.status === column.dropStatus &&
                          kanbanDropTarget.insertIndex === index && <div className="backlog-drop-line" />}
                        <TaskCard
                          task={task}
                          compact
                          showDuration
                          showMeta
                          showIndicators
                          scheduleBadge={task.scheduled ? KANBAN_DAY_NAMES[task.scheduled.dayIndex] : undefined}
                          scheduleTooltip={
                            task.scheduled
                              ? scheduledTooltip(task.scheduled.weekKey, task.scheduled.dayIndex)
                              : undefined
                          }
                          onOpenDetails={() => setTaskInModal(task.id)}
                          onToggleComplete={() =>
                            void patchTask(task.id, {
                              completed: !task.completed,
                              status: !task.completed ? 'Done' : task.status === 'Done' ? 'Not Started' : task.status,
                            })
                          }
                          onHandlePointerDown={(event) => onTaskHandlePointerDown(task.id, event)}
                          onRequestContextMenu={(event) => openTaskContextMenu(task.id, event)}
                          isDragging={draggingTaskId === task.id}
                        />
                      </div>
                    ))}
                    {draggingTaskId &&
                      dragOverStatus === column.dropStatus &&
                      kanbanDropTarget?.status === column.dropStatus &&
                      kanbanDropTarget.insertIndex === tasksInStatus.length && <div className="backlog-drop-line" />}
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <>
            <section
              className="timeline-area"
              ref={timelineAreaRef}
              onTouchStart={handleTimelineTouchStart}
              onTouchMove={handleTimelineTouchMove}
              onTouchEnd={handleTimelineTouchEnd}
              onTouchCancel={handleTimelineTouchEnd}
            >
              <div className="day-pill-layer" aria-hidden="true">
                {fixedDayPills.map((pill) => (
                  <div
                    key={`fixed-pill-${pill.dayIndex}`}
                    className={`day-scroll-pill ${weekKey === todayWeekKey && pill.dayIndex === todayDayIndex ? 'today' : ''}`}
                    style={{ left: pill.left }}
                  >
                    {DAY_NAMES[pill.dayIndex]}
                  </div>
                ))}
              </div>

              <div className="timeline-grid" ref={timelineGridRef} style={mobileTimelineStyle}>
              <div className="time-axis-column" aria-hidden="true" ref={timeAxisRef}>
                <div className="time-axis-header" />
                <div className="time-axis-track">
                  {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => {
                    const isHour = slot % slotsPerHour === 0;
                    const isHourBoundary = (slot + 1) % slotsPerHour === 0;
                    const hourBand = Math.floor(slot / slotsPerHour) % 2 === 0 ? 'band-a' : 'band-b';
                    return (
                      <div
                        key={`time-axis-${slot}`}
                        className={`time-axis-slot ${hourBand} ${isHour ? 'hour' : 'quarter'} ${isHourBoundary ? 'hour-boundary' : ''}`}
                        style={{ height: SLOT_HEIGHT }}
                      >
                        {isHour && <span className="time-axis-label">{timeLabel(slot)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {DAY_NAMES.map((dayName, dayIndex) => {
                const isToday = weekKey === todayWeekKey && dayIndex === todayDayIndex;
                const dayTasks = weekTasks
                  .filter((task) => task.scheduled?.dayIndex === dayIndex)
                  .sort((a, b) => (a.scheduled?.slot ?? 0) - (b.scheduled?.slot ?? 0));
                const dayShiftPreview = shiftPreviewPatches.filter((patch) => patch.dayIndex === dayIndex);
                const previewByTaskId = new Map(dayShiftPreview.map((patch) => [patch.taskId, patch.slot]));

                return (
                  <div
                    key={dayName}
                    className={`day-column ${isToday ? 'today' : ''} ${mobileDay === dayIndex ? 'mobile-visible' : ''}`}
                    ref={(element) => {
                      dayColumnRefs.current[dayIndex] = element;
                    }}
                  >
                    <div
                      className="day-header"
                      ref={(element) => {
                        dayHeaderRefs.current[dayIndex] = element;
                      }}
                    >
                      <h3>{dayName}</h3>
                      <span>{formatDayLabel(weekKey, dayIndex)}</span>
                    </div>
                    <div className="day-track" data-day-track={dayIndex}>
                      {isToday && currentTimeLineTop !== null && (
                        <div
                          className="current-time-line"
                          style={{ top: currentTimeLineTop }}
                        >
                          <span className="current-time-pill">{currentTimeLabel}</span>
                        </div>
                      )}
                      {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => {
                        const isHour = slot % slotsPerHour === 0;
                        const isHourBoundary = (slot + 1) % slotsPerHour === 0;
                        const hourBand = Math.floor(slot / slotsPerHour) % 2 === 0 ? 'band-a' : 'band-b';
                        const isDropTarget = dropTarget?.dayIndex === dayIndex && dropTarget.slot === slot;
                        return (
                          <div
                            key={slot}
                            data-drop-slot={`${dayIndex}:${slot}`}
                            className={`time-slot ${isHour ? 'hour' : 'quarter'} ${isHourBoundary ? 'hour-boundary' : ''} ${hourBand} ${isDropTarget ? 'drop-target' : ''}`}
                            style={{ height: SLOT_HEIGHT }}
                            onClick={() => void handleCreateTaskAtSlot(dayIndex, slot)}
                          >
                            {isHour && <span className="mobile-hour-label">{mobileHourLabel(slot)}</span>}
                          </div>
                        );
                      })}

                      {tempoNonWorkSegments.length > 0 && (
                        <div className="tempo-work-block-layer" aria-hidden="true">
                          {tempoNonWorkSegments.map((segment) => (
                            <div
                              key={`${dayIndex}-${segment.key}`}
                              className="tempo-work-block-band"
                              style={{ top: segment.top, height: segment.height }}
                            />
                          ))}
                        </div>
                      )}

                      {dayTasks.map((task) => {
                        const top = (task.scheduled?.slot ?? 0) * SLOT_HEIGHT + SCHEDULED_CARD_TOP_OFFSET;
                        const renderedDuration =
                          resizingTaskId === task.id && resizePreviewDuration ? resizePreviewDuration : task.duration;
                        const slotCount = durationToSlots(renderedDuration);
                        const isSingleSlot = slotCount === 1;
                        const isHalfHourSlot = slotCount === 2;
                        const height =
                          slotCount * SLOT_HEIGHT -
                          (SCHEDULED_CARD_TOP_OFFSET + SCHEDULED_CARD_BOTTOM_GAP);
                        const hasPreviewShift = draggingTaskId !== null && previewByTaskId.has(task.id);
                        return (
                          <div
                            key={task.id}
                            className={`scheduled-task ${renderedDuration > 30 ? 'two-line-title' : ''} ${isSingleSlot ? 'single-slot' : ''} ${isHalfHourSlot ? 'half-hour-slot' : ''} ${hasPreviewShift ? 'preview-source' : ''}`}
                            style={{
                              top,
                              height,
                              left: 'var(--scheduled-card-left-inset, 2px)',
                              right: 'var(--scheduled-card-right-inset, 2px)',
                            }}
                          >
                            <TaskCard
                              task={task}
                              compact
                              showDuration={false}
                              showMeta
                              showIndicators
                              onOpenDetails={() => setTaskInModal(task.id)}
                              onToggleComplete={() =>
                                void patchTask(task.id, {
                                  completed: !task.completed,
                                  status: !task.completed ? 'Done' : task.status === 'Done' ? 'Not Started' : task.status,
                                })
                              }
                              onHandlePointerDown={(event) => onTaskHandlePointerDown(task.id, event)}
                              onRequestContextMenu={(event) => openTaskContextMenu(task.id, event)}
                              onResizeMouseDown={(event) => startTaskResize(task, event)}
                              resizable
                              isDragging={draggingTaskId === task.id}
                            />
                          </div>
                        );
                      })}

                      {dayShiftPreview.map((patch) => {
                        const task = taskById.get(patch.taskId);
                        if (!task) return null;
                        const top = patch.slot * SLOT_HEIGHT + SCHEDULED_CARD_TOP_OFFSET;
                        const height =
                          durationToSlots(task.duration) * SLOT_HEIGHT - (SCHEDULED_CARD_TOP_OFFSET + SCHEDULED_CARD_BOTTOM_GAP);
                        return (
                          <div
                            key={`preview-${patch.taskId}-${patch.slot}`}
                            className={`scheduled-preview ${patch.taskId === draggingTaskId ? 'moving' : 'shifted'}`}
                            style={{
                              top,
                              height,
                              left: 'var(--scheduled-card-left-inset, 2px)',
                              right: 'var(--scheduled-card-right-inset, 2px)',
                            }}
                          >
                            {task.title}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              </div>

            </section>
            {showViewportTimelineScrollbar && (
              <div className="timeline-viewport-scrollbar" ref={timelineViewportScrollbarRef} aria-hidden="true">
                <div className="timeline-viewport-scrollbar-inner" style={{ width: timelineScrollbarContentWidth }} />
              </div>
            )}
          </>
        )}
      </div>

      {modalTask && (
        <TaskModal
          task={modalTask}
          isRepeatingSeries={modalTaskHasValidRepeatParent}
          clientSuggestions={clientSuggestions}
          projectDeadlineByClient={projectDeadlineByClient}
          projectValueByClient={projectValueByClient}
          projectPriorityByClient={projectPriorityByClient}
          activeTaskCountByClient={activeTaskCountByClient}
          onRemoveClientSuggestion={hideClientSuggestion}
          onRestoreClientSuggestion={restoreClientSuggestion}
          onClose={() => setTaskInModal(null)}
          onDelete={() => {
            void handleDeleteTask(modalTask.id);
            setTaskInModal(null);
          }}
          onSave={(patch, scope) => void patchTask(modalTask.id, patch, scope ?? 'single')}
        />
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <section
            className="task-modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Planner settings"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="task-modal-header">
              <h3>Settings</h3>
              <button type="button" onClick={() => setSettingsOpen(false)} className="icon-text-button">
                <X size={16} />
                <span>Close</span>
              </button>
            </header>

            <div className="task-modal-body settings-modal-body">
              <section className="modal-section settings-section">
                <div className="settings-section-head">
                  <div>
                    <h4>Timezone</h4>
                  </div>
                </div>
                <select
                  value={settingsTimezoneDraft}
                  onChange={(event) => setSettingsTimezoneDraft(event.target.value)}
                >
                  {supportedTimezones.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </section>

              <section className="modal-section settings-section settings-tempo-section">
                <div className="settings-section-head">
                  <div>
                    <h4>Work Blocks</h4>
                    <p>Define the time windows that Tempo can schedule tasks within.</p>
                  </div>
                  <div className="settings-tempo-help" ref={settingsTempoSignalsRef}>
                    <button
                      type="button"
                      className={`tempo-chip tempo-signal-button settings-tempo-chip icon-only ${settingsTempoHelpOpen ? 'open' : ''}`}
                      aria-label={settingsTempoHelpOpen ? 'Hide Tempo work-block help' : 'Show Tempo work-block help'}
                      aria-expanded={settingsTempoHelpOpen}
                      onClick={() => setSettingsTempoHelpOpen((current) => !current)}
                    >
                      <Sparkles size={13} />
                    </button>
                    {settingsTempoHelpOpen && (
                      <div className="tempo-help-tooltip settings-tempo-tooltip" role="note">
                        <p>
                          Tempo will only schedule your tasks during these blocks. You can still manually schedule
                          tasks outside of these times.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="work-block-list">
                  {settingsWorkBlocksDraft.map((block, index) => (
                    <div key={`work-block-${block.start}-${block.end}-${index}`} className="inline-row work-block-display-row">
                      <span className="work-block-display-text">
                        {formatWorkBlockTime(block.start)} - {formatWorkBlockTime(block.end)}
                      </span>
                      <button
                        type="button"
                        className="link-icon-button work-block-remove"
                        aria-label={`Remove work block ${index + 1}`}
                        onClick={() => removeDraftWorkBlock(index)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}

                  <div className="work-block-entry-row">
                    <input
                      type="time"
                      value={pendingWorkBlockStart}
                      onChange={(event) => setPendingWorkBlockStart(event.target.value)}
                    />
                    <input
                      type="time"
                      value={pendingWorkBlockEnd}
                      onChange={(event) => setPendingWorkBlockEnd(event.target.value)}
                    />
                    <button
                      type="button"
                      className="link-icon-button"
                      aria-label="Add work block"
                      disabled={!pendingWorkBlockStart || !pendingWorkBlockEnd}
                      onClick={addDraftWorkBlock}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </section>

              <section className="modal-section settings-section">
                <div className="settings-section-head">
                  <div>
                    <h4>Change Password</h4>
                  </div>
                </div>
                <div className="settings-field-stack">
                  <label>
                    New password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={settingsPasswordDraft}
                      onChange={(event) => setSettingsPasswordDraft(event.target.value)}
                    />
                  </label>
                  <label>
                    Confirm new password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={settingsPasswordConfirmDraft}
                      onChange={(event) => setSettingsPasswordConfirmDraft(event.target.value)}
                    />
                  </label>
                  <div className="settings-action-row">
                    <button
                      type="button"
                      className="success"
                      disabled={!settingsPasswordDraft || !settingsPasswordConfirmDraft || saving}
                      onClick={() => void handleChangePassword()}
                    >
                      Update Password
                    </button>
                  </div>
                </div>
              </section>

              <section className="modal-section settings-section danger-section">
                <div className="settings-section-head">
                  <div>
                    <h4>Delete Account</h4>
                    <p>This permanently deletes your account and all planner data.</p>
                  </div>
                </div>
                <div className="settings-field-stack">
                  <label>
                    Type DELETE to confirm
                    <input
                      value={deleteAccountConfirmDraft}
                      onChange={(event) => setDeleteAccountConfirmDraft(event.target.value)}
                    />
                  </label>
                  <div className="settings-action-row">
                    <button
                      type="button"
                      className="danger"
                      disabled={deleteAccountConfirmDraft.trim() !== 'DELETE' || saving}
                      onClick={() => void handleDeleteAccount()}
                    >
                      Delete Account
                    </button>
                  </div>
                </div>
              </section>
            </div>

            <footer className="task-modal-footer">
              <button type="button" onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button type="button" className="success" onClick={() => void handleSaveSettings()}>
                Save Settings
              </button>
            </footer>
          </section>
        </div>
      )}

      {tempoPastDuePlacements && tempoPastDuePlacements.length > 0 && (
        <div className="modal-overlay scope-choice-overlay" onClick={() => setTempoPastDuePlacements(null)}>
          <section
            className="scope-choice-modal project-confirm-modal tempo-overdue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Tasks scheduled past due date"
            onClick={(event) => event.stopPropagation()}
          >
            <h4>
              {tempoPastDuePlacements.length === 1
                ? '1 Task is scheduled past its due date.'
                : `${tempoPastDuePlacements.length} Tasks are scheduled past their due dates.`}
            </h4>
            <p className="scope-choice-copy">
              Would you like Tempo to unschedule these tasks?
            </p>
            <div className="tempo-overdue-list" role="list">
              {tempoPastDuePlacements.map((entry) => (
                <p key={entry.taskId} className="tempo-overdue-item" role="listitem">
                  <strong>{entry.title}</strong>
                  <span>Due {entry.dueDateLabel}</span>
                  <span>Scheduled {entry.scheduledDateLabel}</span>
                </p>
              ))}
            </div>
            <div className="scope-choice-actions scope-choice-actions-inline">
              <button type="button" onClick={() => setTempoPastDuePlacements(null)}>Keep scheduled</button>
              <button type="button" className="danger" disabled={saving} onClick={() => void handleUnschedulePastDueTempoTasks()}>
                Unschedule tasks
              </button>
            </div>
          </section>
        </div>
      )}

      {taskContextMenu && (
        <div
          className="task-context-menu"
          data-task-context-menu
          style={{ left: taskContextMenu.x, top: taskContextMenu.y }}
        >
          <button type="button" onClick={() => void handleDuplicateTask(taskContextMenu.taskId)}>
            <Copy size={14} />
            <span>Duplicate Task</span>
          </button>
        </div>
      )}

      {mobileSlotPicker && viewMode === 'plan' && (
        <div className="mobile-slot-picker-backdrop" onClick={() => setMobileSlotPicker(null)}>
          <section className="mobile-slot-picker" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>
                Add Task: {DAY_NAMES[mobileSlotPicker.dayIndex]} {slotTimeLabel(mobileSlotPicker.slot)}
              </h3>
              <button type="button" onClick={() => setMobileSlotPicker(null)}>Close</button>
            </header>

            <form
              className="new-task-row"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateAndAssignMobileTask();
              }}
            >
              <input
                placeholder="Add new task title"
                value={mobileBacklogTitle}
                onChange={(event) => {
                  setMobileBacklogTitle(event.target.value);
                  if (mobileSlotPickerError) setMobileSlotPickerError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreateAndAssignMobileTask();
                }}
              />
              <button
                type="submit"
                className="icon-text-button"
                aria-label="Create and assign task"
                disabled={!mobileBacklogTitle.trim() || saving}
                onClick={() => void handleCreateAndAssignMobileTask()}
              >
                <Plus size={15} />
              </button>
            </form>

            {mobileSlotPickerError && <p className="mobile-slot-error">{mobileSlotPickerError}</p>}

            <div className="mobile-slot-task-list">
              {backlogTasks.length === 0 ? (
                <p className="muted">No backlog tasks yet.</p>
              ) : (
                backlogTasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className="mobile-slot-task-option"
                    disabled={saving}
                    onClick={() => void handleAssignExistingTaskToMobileSlot(task.id)}
                  >
                    {task.title}
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
