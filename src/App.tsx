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
import { Calendar, CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight, Columns3, Plus } from 'lucide-react';
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
  updateBacklogOrder,
  updateKanbanOrder,
  updateSelectedWeekStart,
  updateTask,
} from './lib/cloudStore';
import { hasSupabaseEnv } from './lib/supabase';
import {
  DAY_NAMES,
  SLOT_HEIGHT,
  SLOT_MINUTES,
  STATUS_ORDER,
  TOTAL_SLOTS,
  type Duration,
  type Task,
  type TaskRepeat,
  type TaskStatus,
  type ViewMode,
} from './types';

type DropTarget = { dayIndex: number; slot: number } | null;
type AuthMode = 'sign-in' | 'sign-up';
const SCHEDULED_CARD_TOP_OFFSET = 1;
const SCHEDULED_CARD_BOTTOM_GAP = 2;
type KanbanDropTarget = { status: TaskStatus; insertIndex: number } | null;
type FloatingDayPill = { dayIndex: number; left: number };
type SwipeAxis = 'x' | 'y' | null;
type MobileSwipeGesture = {
  startX: number;
  startY: number;
  lastX: number;
  axis: SwipeAxis;
};
const MOBILE_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const KANBAN_DAY_NAMES = ['Mon', 'Tues', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const RESIZE_STEP_SLOTS = 2;
const RESIZE_STEP_MINUTES = SLOT_MINUTES * RESIZE_STEP_SLOTS;
const KANBAN_COLUMNS: Array<{ label: string; statuses: TaskStatus[]; dropStatus: TaskStatus }> = [
  { label: 'Not Started', statuses: ['Not Started'], dropStatus: 'Not Started' },
  { label: 'Waiting', statuses: ['Blocked'], dropStatus: 'Blocked' },
  { label: 'In Progress', statuses: ['In Progress'], dropStatus: 'In Progress' },
  { label: 'In Review', statuses: ['In Review'], dropStatus: 'In Review' },
  { label: 'Done', statuses: ['Done'], dropStatus: 'Done' },
];

function isRepeatTemplate(task: Task) {
  return Boolean(task.repeat?.enabled && !task.repeatParentId);
}

function getResizedDuration(startDuration: Duration, deltaPixels: number) {
  const stepPixels = SLOT_HEIGHT * RESIZE_STEP_SLOTS;
  const deltaSteps =
    deltaPixels >= 0 ? Math.floor(deltaPixels / stepPixels) : Math.ceil(deltaPixels / stepPixels);
  const minDuration = Math.min(startDuration, RESIZE_STEP_MINUTES);
  const nextDuration = startDuration + deltaSteps * RESIZE_STEP_MINUTES;
  return Math.max(minDuration, Math.min(240, nextDuration)) as Duration;
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
  const [loadingPlanner, setLoadingPlanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDotCount, setSavingDotCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  const draggingTaskIdRef = useRef<string | null>(null);
  const dayHeaderRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dayColumnRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const timelineGridRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportScrollbarRef = useRef<HTMLDivElement | null>(null);
  const timelineAreaRef = useRef<HTMLElement | null>(null);
  const timeAxisRef = useRef<HTMLDivElement | null>(null);
  const mobileSwipeRef = useRef<MobileSwipeGesture | null>(null);
  const headerHeroRef = useRef<HTMLElement | null>(null);
  const stickyPlanningBarRef = useRef<HTMLElement | null>(null);

  const weekKey = selectedWeekStart;
  const now = new Date(currentTimeMs);
  const todayWeekKey = toLocalDateKey(weekStartMonday(now));
  const todayDayIndex = (now.getDay() + 6) % 7;
  const slotsPerHour = 60 / SLOT_MINUTES;

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

  const weekTasks = useMemo(
    () => tasks.filter((task) => task.scheduled?.weekKey === weekKey && !isRepeatTemplate(task)),
    [tasks, weekKey],
  );
  const kanbanVisibleTasks = useMemo(
    () => tasks.filter((task) => !isRepeatTemplate(task) && task.scheduled?.weekKey === weekKey),
    [tasks, weekKey],
  );

  const completedCount = weekTasks.filter((task) => task.completed).length;
  const completionPct = weekTasks.length === 0 ? 0 : Math.round((completedCount / weekTasks.length) * 100);

  const modalTask = useMemo(() => {
    if (!taskInModal) return undefined;
    const selected = taskById.get(taskInModal);
    if (!selected) return undefined;
    if (!selected.repeatParentId) return selected;
    const parent = taskById.get(selected.repeatParentId);
    if (!parent?.repeat) return selected;
    return { ...selected, repeat: parent.repeat };
  }, [taskInModal, taskById]);

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
    setMobileSwipeDragging(true);
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
      if (absX < 6 && absY < 6) return;
      gesture.axis = absX > absY ? 'x' : 'y';
    }

    if (gesture.axis !== 'x') return;

    if (event.cancelable) event.preventDefault();

    const canPeekPrev = mobileDay > 0;
    const canPeekNext = mobileDay < DAY_NAMES.length - 1;
    let offset = deltaX;
    if ((deltaX > 0 && !canPeekPrev) || (deltaX < 0 && !canPeekNext)) {
      offset = deltaX * 0.22;
    }
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

  async function refreshPlannerData(nextUserId: string) {
    setLoadingPlanner(true);
    try {
      const data = await loadPlannerData(nextUserId);
      setTasks(data.tasks);
      setBacklogOrder(data.backlogOrder);
      setKanbanOrder(data.kanbanOrder);
      setSelectedWeekStart(data.selectedWeekStart);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load planner data.');
    } finally {
      setLoadingPlanner(false);
    }
  }

  useEffect(() => {
    draggingTaskIdRef.current = draggingTaskId;
  }, [draggingTaskId]);

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
    const updateHeaderCollapsed = () => {
      const hero = headerHeroRef.current;
      const stickyBar = stickyPlanningBarRef.current;
      if (!hero || !stickyBar) return;
      const heroRect = hero.getBoundingClientRect();
      const stickyHeight = stickyBar.getBoundingClientRect().height;
      const next = heroRect.bottom <= stickyHeight + 4;
      setHeaderCollapsed((current) => (current === next ? current : next));
    };

    updateHeaderCollapsed();
    window.addEventListener('scroll', updateHeaderCollapsed, { passive: true });
    window.addEventListener('resize', updateHeaderCollapsed);
    return () => {
      window.removeEventListener('scroll', updateHeaderCollapsed);
      window.removeEventListener('resize', updateHeaderCollapsed);
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
          await refreshPlannerData(user.id);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to initialize auth.');
      } finally {
        setInitializing(false);
      }
    };

    void bootstrap();

    const unsubscribe = onAuthStateChange(() => {
      void (async () => {
        try {
          const user = await getSessionUser();
          if (!user) {
            setUserId(null);
            setUserEmail('');
            setTasks([]);
            setBacklogOrder([]);
            setKanbanOrder([]);
            setSelectedWeekStart(nowWeekStartKey());
            return;
          }

          setUserId(user.id);
          setUserEmail(user.email ?? '');
          await refreshPlannerData(user.id);
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh session.');
        }
      })();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
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
        setErrorMessage(error instanceof Error ? error.message : 'Failed to generate recurring tasks.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, weekKey, tasks]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      clearDragState();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function replaceTask(nextTask: Task) {
    setTasks((current) => current.map((task) => (task.id === nextTask.id ? nextTask : task)));
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
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) templatePatch.status = patch.status;
    if (Object.prototype.hasOwnProperty.call(patch, 'duration')) templatePatch.duration = patch.duration;
    if (Object.prototype.hasOwnProperty.call(patch, 'dueDate')) templatePatch.dueDate = patch.dueDate;
    if (Object.prototype.hasOwnProperty.call(patch, 'urgent')) templatePatch.urgent = patch.urgent;
    if (Object.prototype.hasOwnProperty.call(patch, 'important')) templatePatch.important = patch.important;
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) templatePatch.notes = patch.notes;
    if (Object.prototype.hasOwnProperty.call(patch, 'links')) templatePatch.links = patch.links;
    if (Object.prototype.hasOwnProperty.call(patch, 'attachments')) templatePatch.attachments = patch.attachments;
    return templatePatch;
  }

  async function patchTask(taskId: string, patch: Partial<Task>, updateScope: 'single' | 'future' = 'single') {
    if (!userId) return;

    const currentTask = taskById.get(taskId);
    let hasRepeatPatch = Object.prototype.hasOwnProperty.call(patch, 'repeat');
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

    if (currentTask?.repeatParentId && updateScope === 'future') {
      const anchorScheduled = currentTask.scheduled;
      const parentId = currentTask.repeatParentId;
      const repeatPatch = patch.repeat;
      const taskPatch: Partial<Task> = { ...patch };
      delete taskPatch.repeat;
      delete taskPatch.scheduled;
      delete taskPatch.completed;

      setSaving(true);
      try {
        const updatesById = new Map<string, Task>();
        const parentPatch: Partial<Task> = buildTemplatePatchFromTaskPatch(taskPatch);

        if (hasRepeatPatch) {
          parentPatch.repeat = repeatPatch?.enabled ? repeatPatch : undefined;
        }

        if (Object.keys(parentPatch).length > 0) {
          const updatedParent = await updateTask(userId, parentId, parentPatch);
          updatesById.set(updatedParent.id, updatedParent);
        }

        const seriesInstances = tasks.filter(
          (task) =>
            task.repeatParentId === parentId &&
            task.scheduled &&
            anchorScheduled &&
            compareScheduledPosition(task.scheduled, anchorScheduled) >= 0,
        );
        const updatedInstances = await Promise.all(
          seriesInstances.map((instance) => updateTask(userId, instance.id, taskPatch)),
        );
        updatedInstances.forEach((task) => updatesById.set(task.id, task));

        let created: Task[] = [];
        if (hasRepeatPatch && repeatPatch?.enabled) {
          const existingIds = new Set(tasks.map((task) => task.id));
          const nextTasks = tasks.map((task) => updatesById.get(task.id) ?? task);
          updatesById.forEach((task) => {
            if (!existingIds.has(task.id)) nextTasks.unshift(task);
          });
          created = await ensureRepeatingTasksForWeek(userId, weekKey, nextTasks);
        }

        setTasks((current) => {
          const next = current.map((task) => updatesById.get(task.id) ?? task);
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
        setErrorMessage(error instanceof Error ? error.message : 'Failed to update future recurring tasks.');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (currentTask?.repeatParentId && updateScope === 'single' && hasRepeatPatch) {
      const taskPatch: Partial<Task> = { ...patch };
      delete taskPatch.repeat;
      patch = taskPatch;
      hasRepeatPatch = false;
    }

    if (currentTask && hasRepeatPatch) {
      const repeatPatch = patch.repeat;
      const taskPatch: Partial<Task> = { ...patch };
      delete taskPatch.repeat;

      setSaving(true);
      try {
        const updatesById = new Map<string, Task>();

        if (currentTask.repeatParentId) {
          const parentPatch: Partial<Task> = { repeat: repeatPatch?.enabled ? repeatPatch : undefined };
          const updatedParent = await updateTask(userId, currentTask.repeatParentId, parentPatch);
          updatesById.set(updatedParent.id, updatedParent);
        } else if (repeatPatch?.enabled) {
          const templateSource = { ...currentTask, ...taskPatch };
          const template = await createRepeatTemplate(userId, templateSource, repeatPatch);
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

        setTasks((current) => {
          const next = current.map((task) => updatesById.get(task.id) ?? task);
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
        setErrorMessage(error instanceof Error ? error.message : 'Failed to update recurring task settings.');
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
          }),
          ...shiftedPatches.map((entry) =>
            updateTask(userId, entry.taskId, {
              scheduled: makeScheduled(plan.weekKey, plan.dayIndex, entry.slot),
            }),
          ),
        ]);

        const updatedById = new Map(updates.map((task) => [task.id, task]));
        setTasks((current) => current.map((task) => updatedById.get(task.id) ?? task));
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
      replaceTask(nextTask);
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

  if (initializing || loadingPlanner) {
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
            <h1 className="login-title-script">My Weekly Plan</h1>
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
            <button onClick={() => void handleAuthSubmit()}>
              {authMode === 'sign-up' ? 'Create Account' : 'Sign In'}
            </button>
            <button
              onClick={() => {
                setAuthMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'));
                setErrorMessage(null);
              }}
            >
              {authMode === 'sign-up' ? 'Use Existing Account' : 'Create New Account'}
            </button>
          </div>

          <div className="oauth-divider" role="separator" aria-label="OAuth sign-in options">
            <span>or continue with</span>
          </div>

          <div className="auth-actions oauth-actions oauth-brand-stack">
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
              <span>Continue</span>
            </button>
            <button className="oauth-button oauth-facebook" onClick={() => void handleOAuth('facebook')}>
              <span className="oauth-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <circle cx="12" cy="12" r="12" fill="#ffffff" />
                  <path
                    d="M13.37 8.35h1.64V5.5h-1.93c-2.52 0-3.9 1.54-3.9 4.1V11H7v2.68h2.18v4.82h2.93v-4.82h2.43l.39-2.68h-2.82V9.89c0-.88.3-1.54 1.26-1.54Z"
                    fill="#1877f2"
                  />
                </svg>
              </span>
              <span>Continue</span>
            </button>
          </div>
          <p className="login-trust-note">Secure sign-in powered by Google/Facebook + Supabase</p>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`planner-shell grain-bg view-${viewMode} ${headerCollapsed ? 'header-collapsed' : ''}`}>
      <section className="header-hero" ref={headerHeroRef}>
        <header className="top-bar">
          <div className="header-brand" aria-hidden="true">
            <img className="header-title-icon" src="/img/tempo-icon.png" alt="" />
            <h1 className="header-title">My Weekly Plan</h1>
          </div>
          <img className="header-logo" src="/img/tempo2.png" alt="My Weekly Plan" />
          <div className="account-row">
            <span className="account-email">{userEmail || 'Signed in'}</span>
            <button className="account-link" type="button">Settings</button>
            <button className="account-link" type="button" onClick={() => void signOut()}>Log Out</button>
          </div>
        </header>
        {errorMessage && <section className="error-banner">{errorMessage}</section>}
        <section className="status-slot" aria-live="polite">
          {saving ? (
            <span className="status-text status-saving">
              Saving<span className="status-dots">{'.'.repeat(savingDotCount + 1)}</span>
            </span>
          ) : (
            <span className="status-text status-saved">
              <Check size={13} aria-hidden="true" />
              <span>Saved</span>
            </span>
          )}
        </section>
      </section>

      <section className="sticky-planning-bar" ref={stickyPlanningBarRef}>
        <div className="top-controls">
          <div className="week-nav-row">
            <span className="week-nav-owl-wrap" aria-hidden="true">
              <img className="week-nav-owl" src="/img/tempo-icon.png" alt="" />
            </span>
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
            <span className="mobile-nav-owl-wrap" aria-hidden="true">
              <img className="mobile-nav-owl" src="/img/tempo-icon.png" alt="" />
            </span>
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
                    const hourBand = Math.floor(slot / slotsPerHour) % 2 === 0 ? 'band-a' : 'band-b';
                    return (
                      <div
                        key={`time-axis-${slot}`}
                        className={`time-axis-slot ${hourBand} ${isHour ? 'hour' : 'quarter'}`}
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
                      {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => {
                        const isHour = slot % slotsPerHour === 0;
                        const hourBand = Math.floor(slot / slotsPerHour) % 2 === 0 ? 'band-a' : 'band-b';
                        const isDropTarget = dropTarget?.dayIndex === dayIndex && dropTarget.slot === slot;
                        return (
                          <div
                            key={slot}
                            data-drop-slot={`${dayIndex}:${slot}`}
                            className={`time-slot ${isHour ? 'hour' : 'quarter'} ${hourBand} ${isDropTarget ? 'drop-target' : ''}`}
                            style={{ height: SLOT_HEIGHT }}
                            onClick={() => void handleCreateTaskAtSlot(dayIndex, slot)}
                          >
                            {isHour && <span className="mobile-hour-label">{mobileHourLabel(slot)}</span>}
                          </div>
                        );
                      })}

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
                            className={`scheduled-task ${isSingleSlot ? 'single-slot' : ''} ${isHalfHourSlot ? 'half-hour-slot' : ''} ${hasPreviewShift ? 'preview-source' : ''}`}
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
          onClose={() => setTaskInModal(null)}
          onDelete={() => {
            void handleDeleteTask(modalTask.id);
            setTaskInModal(null);
          }}
          onSave={(patch, scope) => void patchTask(modalTask.id, patch, scope ?? 'single')}
        />
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
