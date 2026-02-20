import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CalendarDays, Check, ChevronLeft, ChevronRight, Columns3, Plus } from 'lucide-react';
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
  createTask,
  deleteTask,
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
import { DAY_NAMES, SLOT_HEIGHT, STATUS_ORDER, TOTAL_SLOTS, type Duration, type Task, type TaskStatus, type ViewMode } from './types';

type DropTarget = { dayIndex: number; slot: number } | null;
type AuthMode = 'sign-in' | 'sign-up';
const SCHEDULED_CARD_TOP_OFFSET = 12;
const SCHEDULED_CARD_BOTTOM_GAP = 6;
type KanbanDropTarget = { status: TaskStatus; insertIndex: number } | null;

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
  const [editingTitleTaskId, setEditingTitleTaskId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [mobileDay, setMobileDay] = useState((new Date().getDay() + 6) % 7);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);

  const weekKey = selectedWeekStart;
  const now = new Date();
  const todayWeekKey = toLocalDateKey(weekStartMonday(now));
  const todayDayIndex = (now.getDay() + 6) % 7;

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

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

  const backlogTasks = useMemo(() => {
    const backlog = tasks.filter((task) => !task.scheduled);
    return sortTasksByOrder(backlog, backlogOrder);
  }, [tasks, backlogOrder]);

  const weekTasks = useMemo(() => tasks.filter((task) => task.scheduled?.weekKey === weekKey), [tasks, weekKey]);

  const completedCount = weekTasks.filter((task) => task.completed).length;
  const completionPct = weekTasks.length === 0 ? 0 : Math.round((completedCount / weekTasks.length) * 100);

  const modalTask = taskInModal ? taskById.get(taskInModal) : undefined;

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
      const deltaSlots = Math.round((moveEvent.clientY - startY) / SLOT_HEIGHT);
      const targetMinutes = startDuration + deltaSlots * 30;
      const snapped = Math.round(targetMinutes / 30) * 30;
      const nextDuration = Math.max(30, Math.min(240, snapped)) as Duration;
      setResizePreviewDuration(nextDuration);
    };

    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const deltaSlots = Math.round((upEvent.clientY - startY) / SLOT_HEIGHT);
      const targetMinutes = startDuration + deltaSlots * 30;
      const snapped = Math.round(targetMinutes / 30) * 30;
      const nextDuration = Math.max(30, Math.min(240, snapped)) as Duration;
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
    const tasksInTargetStatus = sortTasksByOrder(
      tasks.filter((task) => task.id !== dragTaskId && task.status === status),
      kanbanOrder,
    );
    const targetIds = tasksInTargetStatus.map((task) => task.id);
    const safeIndex = Math.max(0, Math.min(insertIndex, targetIds.length));
    targetIds.splice(safeIndex, 0, dragTaskId);

    const nextKanbanOrder: string[] = [];
    STATUS_ORDER.forEach((statusName) => {
      if (statusName === status) {
        nextKanbanOrder.push(...targetIds);
        return;
      }
      const ids = sortTasksByOrder(
        tasks.filter((task) => task.id !== dragTaskId && task.status === statusName),
        kanbanOrder,
      ).map((task) => task.id);
      nextKanbanOrder.push(...ids);
    });

    await persistKanbanOrder(nextKanbanOrder);
  }

  function onTaskHandleMouseDown(taskId: string, event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
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

    const onMove = (moveEvent: MouseEvent) => {
      setDragCursor({ x: moveEvent.clientX, y: moveEvent.clientY });
      updateHoverTargets(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

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
          await patchTask(dragTaskId, { status: target.status, completed: target.status === 'Done' });
          await reorderKanbanTaskToIndex(dragTaskId, target.status, target.insertIndex);
        }
      })();

      clearDragState();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

  async function patchTask(taskId: string, patch: Partial<Task>) {
    if (!userId) return;

    const currentTask = taskById.get(taskId);
    const hasDurationChange = patch.duration !== undefined && currentTask && patch.duration !== currentTask.duration;
    const hasScheduledPatch = Object.prototype.hasOwnProperty.call(patch, 'scheduled');

    if (currentTask?.scheduled && hasDurationChange && !hasScheduledPatch) {
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
      <div className="login-shell">
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
      <div className="login-shell">
        <main className="login-card">
          <h1>Loading Planner</h1>
          <p>Connecting to your workspace...</p>
        </main>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="login-shell">
        <main className="login-card">
          <h1 className="login-title-script">My Weekly Plan</h1>
          <p>Sign in to keep tasks synced to your account.</p>

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
              <span>Continue with Facebook</span>
            </button>
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
        </main>
      </div>
    );
  }

  return (
    <div className={`planner-shell grain-bg view-${viewMode}`}>
      <section className="header-hero">
        <header className="top-bar">
          <h1 className="header-title">My Weekly Plan</h1>
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

      <section className="sticky-planning-bar">
        <div className="top-controls">
          <div className="week-nav-row">
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
          <p>
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
          <h2>Backlog</h2>

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

          <div className="backlog-scroll">
            <div className="task-stack">
              {backlogTasks.map((task, index) => (
                <div key={task.id} data-backlog-index={index}>
                  {draggingTaskId && dragOverBacklog && backlogInsertIndex === index && (
                    <div className="backlog-drop-line" />
                  )}
                  <TaskCard
                    task={task}
                    isTitleEditing={editingTitleTaskId === task.id}
                    onTitleEditToggle={(editing) => setEditingTitleTaskId(editing ? task.id : null)}
                    onTitleSave={(title) => void patchTask(task.id, { title })}
                    onOpenDetails={() => setTaskInModal(task.id)}
                    onToggleComplete={() =>
                      void patchTask(task.id, {
                        completed: !task.completed,
                        status: !task.completed ? 'Done' : task.status === 'Done' ? 'Not Started' : task.status,
                      })
                    }
                    onHandleMouseDown={(event) => onTaskHandleMouseDown(task.id, event)}
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
            {STATUS_ORDER.map((status) => {
              const tasksInStatus = sortTasksByOrder(
                tasks.filter((task) => task.status === status),
                kanbanOrder,
              );

              return (
                <div key={status} data-drop-status={status} className={`kanban-column ${dragOverStatus === status ? 'drop-active' : ''}`}>
                  <h3>{status}</h3>
                  <div className="task-stack">
                    {tasksInStatus.map((task, index) => (
                      <div key={task.id} data-kanban-status={status} data-kanban-index={index}>
                        {draggingTaskId &&
                          dragOverStatus === status &&
                          kanbanDropTarget?.status === status &&
                          kanbanDropTarget.insertIndex === index && <div className="backlog-drop-line" />}
                        <TaskCard
                          task={task}
                          compact
                          isTitleEditing={editingTitleTaskId === task.id}
                          onTitleEditToggle={(editing) => setEditingTitleTaskId(editing ? task.id : null)}
                          onTitleSave={(title) => void patchTask(task.id, { title })}
                          onOpenDetails={() => setTaskInModal(task.id)}
                          onToggleComplete={() =>
                            void patchTask(task.id, {
                              completed: !task.completed,
                              status: !task.completed ? 'Done' : task.status === 'Done' ? 'Not Started' : task.status,
                            })
                          }
                          onHandleMouseDown={(event) => onTaskHandleMouseDown(task.id, event)}
                          isDragging={draggingTaskId === task.id}
                        />
                      </div>
                    ))}
                    {draggingTaskId &&
                      dragOverStatus === status &&
                      kanbanDropTarget?.status === status &&
                      kanbanDropTarget.insertIndex === tasksInStatus.length && <div className="backlog-drop-line" />}
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <section
            className="timeline-area"
            onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
            onTouchEnd={(event) => {
              if (touchStartX === null) return;
              const endX = event.changedTouches[0]?.clientX ?? null;
              if (endX === null) return;
              const delta = endX - touchStartX;
              if (Math.abs(delta) > 40) {
                setMobileDay((current) => (delta < 0 ? (current + 1) % 7 : (current + 6) % 7));
              }
              setTouchStartX(null);
            }}
          >
            <div className="mobile-day-nav">
              <button onClick={() => setMobileDay((current) => (current + 6) % 7)}>Previous Day</button>
              <strong>{DAY_NAMES[mobileDay]}</strong>
              <button onClick={() => setMobileDay((current) => (current + 1) % 7)}>Next Day</button>
            </div>

            <div className="timeline-grid">
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
                  >
                    <div className="day-header">
                      <h3>{dayName}</h3>
                      <span>{formatDayLabel(weekKey, dayIndex)}</span>
                    </div>

                    <div className="day-track" data-day-track={dayIndex}>
                      {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => {
                        const isHour = slot % 2 === 0;
                        const hourBand = Math.floor(slot / 2) % 2 === 0 ? 'band-a' : 'band-b';
                        const isDropTarget = dropTarget?.dayIndex === dayIndex && dropTarget.slot === slot;
                        return (
                          <div
                            key={slot}
                            data-drop-slot={`${dayIndex}:${slot}`}
                            className={`time-slot ${isHour ? 'hour' : 'half'} ${hourBand} ${isDropTarget ? 'drop-target' : ''}`}
                            style={{ height: SLOT_HEIGHT }}
                          >
                            <span className="time-label">{timeLabel(slot)}</span>
                          </div>
                        );
                      })}

                      {dayTasks.map((task) => {
                        const top = (task.scheduled?.slot ?? 0) * SLOT_HEIGHT + SCHEDULED_CARD_TOP_OFFSET;
                        const renderedDuration =
                          resizingTaskId === task.id && resizePreviewDuration ? resizePreviewDuration : task.duration;
                        const height =
                          durationToSlots(renderedDuration) * SLOT_HEIGHT -
                          (SCHEDULED_CARD_TOP_OFFSET + SCHEDULED_CARD_BOTTOM_GAP);
                        const hasPreviewShift = draggingTaskId !== null && previewByTaskId.has(task.id);
                        return (
                          <div
                            key={task.id}
                            className={`scheduled-task ${hasPreviewShift ? 'preview-source' : ''}`}
                            style={{ top, height }}
                          >
                            <TaskCard
                              task={task}
                              compact
                              isTitleEditing={editingTitleTaskId === task.id}
                              onTitleEditToggle={(editing) => setEditingTitleTaskId(editing ? task.id : null)}
                              onTitleSave={(title) => void patchTask(task.id, { title })}
                              onOpenDetails={() => setTaskInModal(task.id)}
                              onToggleComplete={() =>
                                void patchTask(task.id, {
                                  completed: !task.completed,
                                  status: !task.completed ? 'Done' : task.status === 'Done' ? 'Not Started' : task.status,
                                })
                              }
                              onHandleMouseDown={(event) => onTaskHandleMouseDown(task.id, event)}
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
                            style={{ top, height }}
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
          onSave={(patch) => void patchTask(modalTask.id, patch)}
        />
      )}
    </div>
  );
}

export default App;
