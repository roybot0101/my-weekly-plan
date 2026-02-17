import { type DragEvent, useMemo, useState } from 'react';
import { TaskCard } from './components/TaskCard';
import { TaskModal } from './components/TaskModal';
import {
  durationToSlots,
  formatDayLabel,
  formatWeekLabel,
  fromLocalDateKey,
  nowWeekStartKey,
  timeLabel,
  toLocalDateKey,
  weekStartMonday,
} from './lib/dateTime';
import { loadStore, saveStore } from './lib/storage';
import {
  DAY_NAMES,
  SLOT_HEIGHT,
  STATUS_ORDER,
  TOTAL_SLOTS,
  type Store,
  type Task,
  type TaskStatus,
  type ViewMode,
  uid,
} from './types';

function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [viewMode, setViewMode] = useState<ViewMode>('plan');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverBacklog, setDragOverBacklog] = useState(false);
  const [dragOverKanbanStatus, setDragOverKanbanStatus] = useState<TaskStatus | null>(null);
  const [hoverSlot, setHoverSlot] = useState<{ dayIndex: number; slot: number } | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [authNameDraft, setAuthNameDraft] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [mobileDay, setMobileDay] = useState((new Date().getDay() + 6) % 7);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const weekKey = store.selectedWeekStart;
  const today = new Date();
  const todayWeek = toLocalDateKey(weekStartMonday(today));
  const todayDayIndex = (today.getDay() + 6) % 7;

  const backlogTasks = useMemo(
    () => store.tasks.filter((t) => !t.scheduled),
    [store.tasks],
  );

  const scheduledThisWeek = useMemo(
    () => store.tasks.filter((t) => t.scheduled?.weekKey === weekKey),
    [store.tasks, weekKey],
  );

  const completedCount = scheduledThisWeek.filter((t) => t.completed).length;
  const progress = scheduledThisWeek.length === 0 ? 0 : Math.round((completedCount / scheduledThisWeek.length) * 100);

  function updateStore(next: Store) {
    setStore(next);
    saveStore(next);
  }

  function updateTask(taskId: string, patch: Partial<Task>) {
    updateStore({
      ...store,
      tasks: store.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    });
  }

  function handleCreateTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    const task: Task = {
      id: uid(),
      title,
      completed: false,
      duration: 30,
      dueDate: '',
      urgent: false,
      important: false,
      notes: '',
      links: [],
      attachments: [],
      status: 'Not Started',
      createdAt: new Date().toISOString(),
    };
    updateStore({ ...store, tasks: [task, ...store.tasks] });
    setNewTaskTitle('');
  }

  function scheduleTask(taskId: string, dayIndex: number, slot: number) {
    updateTask(taskId, { scheduled: { weekKey, dayIndex, slot } });
  }

  function unscheduleTask(taskId: string) {
    updateTask(taskId, { scheduled: undefined });
  }

  function clearDragState() {
    setDraggingTaskId(null);
    setHoverSlot(null);
    setDragOverBacklog(false);
    setDragOverKanbanStatus(null);
  }

  function onTaskDragStart(taskId: string, event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = 'move';

    const taskCard = event.currentTarget.closest('.task-card') as HTMLElement | null;
    if (taskCard) {
      const ghost = taskCard.cloneNode(true) as HTMLElement;
      ghost.classList.add('drag-preview-card');
      ghost.style.position = 'fixed';
      ghost.style.top = '-9999px';
      ghost.style.left = '-9999px';
      ghost.style.width = `${taskCard.offsetWidth}px`;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 20, 20);
      requestAnimationFrame(() => {
        document.body.removeChild(ghost);
      });
    }

    setDraggingTaskId(taskId);
  }

  function onTaskDrop(dayIndex: number, slot: number) {
    if (!draggingTaskId) return;
    scheduleTask(draggingTaskId, dayIndex, slot);
    clearDragState();
  }

  function dropToBacklog() {
    if (!draggingTaskId) return;
    unscheduleTask(draggingTaskId);
    clearDragState();
  }

  function weekShift(delta: number) {
    const d = fromLocalDateKey(store.selectedWeekStart);
    d.setDate(d.getDate() + delta * 7);
    updateStore({ ...store, selectedWeekStart: toLocalDateKey(d) });
  }

  const taskById = useMemo(
    () => new Map(store.tasks.map((t) => [t.id, t])),
    [store.tasks],
  );

  const draggingTask = draggingTaskId ? taskById.get(draggingTaskId) : undefined;
  const modalTask = modalTaskId ? taskById.get(modalTaskId) : undefined;

  if (!store.authName) {
    return (
      <div className="login-screen grain-bg">
        <div className="login-card">
          <h1>Calm Weekly Planner</h1>
          <p>Local sign-in keeps your planning space private on this device.</p>
          <input
            placeholder="Your name"
            value={authNameDraft}
            onChange={(e) => setAuthNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && authNameDraft.trim()) {
                updateStore({ ...store, authName: authNameDraft.trim() });
                setAuthNameDraft('');
              }
            }}
          />
          <button
            onClick={() => {
              if (!authNameDraft.trim()) return;
              updateStore({ ...store, authName: authNameDraft.trim() });
              setAuthNameDraft('');
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app grain-bg">
      <header className="top-bar">
        <div>
          <h1>Weekly Planning Dashboard</h1>
          <p>{formatWeekLabel(store.selectedWeekStart)}</p>
        </div>
        <div className="controls">
          <button onClick={() => weekShift(-1)}>Previous Week</button>
          <button onClick={() => updateStore({ ...store, selectedWeekStart: nowWeekStartKey() })}>This Week</button>
          <button onClick={() => weekShift(1)}>Next Week</button>
          <button className={viewMode === 'plan' ? 'active' : ''} onClick={() => setViewMode('plan')}>
            Weekly Plan
          </button>
          <button className={viewMode === 'kanban' ? 'active' : ''} onClick={() => setViewMode('kanban')}>
            Kanban
          </button>
        </div>
      </header>
      {draggingTask && (
        <section className="drag-banner">
          <strong>Moving:</strong> {draggingTask.title}
          <span>Drop on calendar, backlog, or a status column.</span>
        </section>
      )}

      <section className="progress-card">
        <strong>{completedCount} / {scheduledThisWeek.length} ({progress}%)</strong>
        <span>completed this week</span>
      </section>

      <div className="layout">
        <aside
          className={`backlog ${dragOverBacklog ? 'drop-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (draggingTaskId) setDragOverBacklog(true);
          }}
          onDragEnter={() => {
            if (draggingTaskId) setDragOverBacklog(true);
          }}
          onDragLeave={() => setDragOverBacklog(false)}
          onDrop={dropToBacklog}
        >
          <h2>Backlog</h2>
          <div className="new-task-row">
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add a task and press Enter"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTask()}
            />
            <button disabled={!newTaskTitle.trim()} onClick={handleCreateTask}>Add</button>
          </div>
          <p className="helper-text">Click task title to rename. Click the card for full details.</p>
          <div className="task-list">
            {backlogTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isEditing={editingTaskId === task.id}
                onEditToggle={(on) => setEditingTaskId(on ? task.id : null)}
                onTitleChange={(title) => updateTask(task.id, { title })}
                onToggleComplete={() =>
                  updateTask(task.id, {
                    completed: !task.completed,
                    status: !task.completed ? 'Done' : 'Not Started',
                  })
                }
                onOpenDetails={() => setModalTaskId(task.id)}
                onDragStart={(e) => onTaskDragStart(task.id, e)}
              />
            ))}
          </div>
        </aside>

        {viewMode === 'kanban' ? (
          <section className="kanban">
            {STATUS_ORDER.map((status) => (
              <div
                key={status}
                className={`kanban-col ${dragOverKanbanStatus === status ? 'drop-active' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggingTaskId) setDragOverKanbanStatus(status);
                }}
                onDragEnter={() => {
                  if (draggingTaskId) setDragOverKanbanStatus(status);
                }}
                onDragLeave={() => setDragOverKanbanStatus(null)}
                onDrop={() => {
                  if (!draggingTaskId) return;
                  const t = taskById.get(draggingTaskId);
                  if (!t) return;
                  updateTask(draggingTaskId, { status, completed: status === 'Done' });
                  clearDragState();
                }}
              >
                <h3>{status}</h3>
                {store.tasks
                  .filter((task) => task.status === status)
                  .map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      isEditing={editingTaskId === task.id}
                      onEditToggle={(on) => setEditingTaskId(on ? task.id : null)}
                      onTitleChange={(title) => updateTask(task.id, { title })}
                      onToggleComplete={() =>
                        updateTask(task.id, {
                          completed: !task.completed,
                          status: !task.completed ? 'Done' : 'Not Started',
                        })
                      }
                      onOpenDetails={() => setModalTaskId(task.id)}
                      onDragStart={(e) => onTaskDragStart(task.id, e)}
                    />
                  ))}
              </div>
            ))}
          </section>
        ) : (
          <section
            className={`timeline-wrap ${draggingTaskId ? 'dragging' : ''}`}
            onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
            onTouchEnd={(e) => {
              const endX = e.changedTouches[0]?.clientX ?? null;
              if (touchStartX === null || endX === null) return;
              const delta = endX - touchStartX;
              if (Math.abs(delta) > 40) {
                setMobileDay((p) => (delta < 0 ? (p + 1) % 7 : (p + 6) % 7));
              }
              setTouchStartX(null);
            }}
          >
            <div className="mobile-day-switch">
              <button onClick={() => setMobileDay((p) => (p + 6) % 7)}>Previous Day</button>
              <strong>{DAY_NAMES[mobileDay]}</strong>
              <button onClick={() => setMobileDay((p) => (p + 1) % 7)}>Next Day</button>
            </div>
            <div className="timeline-grid">
              {DAY_NAMES.map((name, dayIndex) => {
                const dayTasks = scheduledThisWeek
                  .filter((t) => t.scheduled?.dayIndex === dayIndex)
                  .sort((a, b) => (a.scheduled!.slot - b.scheduled!.slot));

                const isToday = weekKey === todayWeek && dayIndex === todayDayIndex;
                return (
                  <div
                    className={`day-col ${isToday ? 'today' : ''} ${mobileDay === dayIndex ? 'mobile-visible' : ''}`}
                    key={name}
                  >
                    <div className="day-header">
                      <h3>{name}</h3>
                      <span>{formatDayLabel(store.selectedWeekStart, dayIndex)}</span>
                    </div>
                    <div className="day-body">
                      {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => {
                        const isHour = slot % 2 === 0;
                        const hover = hoverSlot?.dayIndex === dayIndex && hoverSlot.slot === slot;
                        return (
                          <div
                            key={slot}
                            className={`time-slot ${isHour ? 'hour-slot' : 'half-slot'} ${hover ? 'slot-hover' : ''}`}
                            style={{ height: SLOT_HEIGHT }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setHoverSlot({ dayIndex, slot });
                            }}
                            onDrop={() => onTaskDrop(dayIndex, slot)}
                            onDragLeave={() => setHoverSlot(null)}
                          >
                            <span className="slot-label">{timeLabel(slot)}</span>
                          </div>
                        );
                      })}

                      {dayTasks.map((task) => {
                        const top = task.scheduled!.slot * SLOT_HEIGHT;
                        const slots = durationToSlots(task.duration);
                        const height = slots * SLOT_HEIGHT - 8;
                        return (
                          <div key={task.id} className="absolute-task" style={{ top, height }}>
                            <TaskCard
                              task={task}
                              isEditing={editingTaskId === task.id}
                              onEditToggle={(on) => setEditingTaskId(on ? task.id : null)}
                              onTitleChange={(title) => updateTask(task.id, { title })}
                              onToggleComplete={() =>
                                updateTask(task.id, {
                                  completed: !task.completed,
                                  status: !task.completed ? 'Done' : 'Not Started',
                                })
                              }
                              onOpenDetails={() => setModalTaskId(task.id)}
                              onDragStart={(e) => onTaskDragStart(task.id, e)}
                            />
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
          onClose={() => setModalTaskId(null)}
          onSave={(patch) => updateTask(modalTask.id, patch)}
          onDelete={() => {
            updateStore({ ...store, tasks: store.tasks.filter((t) => t.id !== modalTask.id) });
            setModalTaskId(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
