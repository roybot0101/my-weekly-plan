import { useEffect, useMemo, useState } from 'react';

type ViewMode = 'plan' | 'kanban';

type TaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'In Review' | 'Done';
type Duration = 15 | 30 | 45 | 60 | 90 | 120 | 180 | 240;

type Attachment = { id: string; name: string; dataUrl: string };
type Task = {
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

type Store = {
  authName: string;
  selectedWeekStart: string;
  tasks: Task[];
};

const STORAGE_KEY = 'calm-weekly-dashboard-v1';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STATUS_ORDER: TaskStatus[] = ['Not Started', 'In Progress', 'Blocked', 'In Review', 'Done'];
const DURATIONS: Duration[] = [15, 30, 45, 60, 90, 120, 180, 240];
const START_HOUR = 5;
const END_HOUR = 24;
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = 100;
const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;

const uid = () => Math.random().toString(36).slice(2, 11);

function weekStartMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatWeekLabel(weekStartKey: string): string {
  const d = fromLocalDateKey(weekStartKey);
  return `Week of ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

function formatDayLabel(weekStartKey: string, dayIndex: number): string {
  const d = fromLocalDateKey(weekStartKey);
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function nowWeekStartKey() {
  return toLocalDateKey(weekStartMonday(new Date()));
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { authName: '', selectedWeekStart: nowWeekStartKey(), tasks: [] };
    }
    const parsed = JSON.parse(raw) as Store;
    return {
      authName: parsed.authName ?? '',
      selectedWeekStart: parsed.selectedWeekStart ?? nowWeekStartKey(),
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    return { authName: '', selectedWeekStart: nowWeekStartKey(), tasks: [] };
  }
}

function saveStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function timeLabel(slot: number) {
  const totalMinutes = START_HOUR * 60 + slot * SLOT_MINUTES;
  const h24 = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

function durationToSlots(duration: Duration) {
  return Math.max(1, Math.round(duration / SLOT_MINUTES));
}

function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [viewMode, setViewMode] = useState<ViewMode>('plan');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<{ dayIndex: number; slot: number } | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
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

  function onTaskDragStart(taskId: string) {
    setDraggingTaskId(taskId);
  }

  function onTaskDrop(dayIndex: number, slot: number) {
    if (!draggingTaskId) return;
    scheduleTask(draggingTaskId, dayIndex, slot);
    setDraggingTaskId(null);
    setHoverSlot(null);
  }

  function dropToBacklog() {
    if (!draggingTaskId) return;
    unscheduleTask(draggingTaskId);
    setDraggingTaskId(null);
    setHoverSlot(null);
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

  const modalTask = modalTaskId ? taskById.get(modalTaskId) : undefined;

  if (!store.authName) {
    return (
      <div className="login-screen grain-bg">
        <div className="login-card">
          <h1>Calm Weekly Planner</h1>
          <p>Local sign-in keeps your planning space private on this device.</p>
          <input
            placeholder="Your name"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTaskTitle.trim()) {
                updateStore({ ...store, authName: newTaskTitle.trim() });
                setNewTaskTitle('');
              }
            }}
          />
          <button
            onClick={() => {
              if (!newTaskTitle.trim()) return;
              updateStore({ ...store, authName: newTaskTitle.trim() });
              setNewTaskTitle('');
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

      <section className="progress-card">
        <strong>{completedCount} / {scheduledThisWeek.length} ({progress}%)</strong>
        <span>completed this week</span>
      </section>

      <div className="layout">
        <aside
          className="backlog"
          onDragOver={(e) => e.preventDefault()}
          onDrop={dropToBacklog}
        >
          <h2>Backlog</h2>
          <div className="new-task-row">
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add task"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTask()}
            />
            <button onClick={handleCreateTask}>Add</button>
          </div>
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
                onDragStart={() => onTaskDragStart(task.id)}
              />
            ))}
          </div>
        </aside>

        {viewMode === 'kanban' ? (
          <section className="kanban">
            {STATUS_ORDER.map((status) => (
              <div
                key={status}
                className="kanban-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!draggingTaskId) return;
                  const t = taskById.get(draggingTaskId);
                  if (!t) return;
                  updateTask(draggingTaskId, { status, completed: status === 'Done' });
                  setDraggingTaskId(null);
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
                      onDragStart={() => onTaskDragStart(task.id)}
                    />
                  ))}
              </div>
            ))}
          </section>
        ) : (
          <section
            className="timeline-wrap"
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
                              onDragStart={() => onTaskDragStart(task.id)}
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

type TaskCardProps = {
  task: Task;
  isEditing: boolean;
  onEditToggle: (on: boolean) => void;
  onTitleChange: (title: string) => void;
  onToggleComplete: () => void;
  onOpenDetails: () => void;
  onDragStart: () => void;
};

function TaskCard(props: TaskCardProps) {
  const { task, isEditing, onEditToggle, onTitleChange, onToggleComplete, onOpenDetails, onDragStart } = props;
  const [draftTitle, setDraftTitle] = useState(task.title);
  useEffect(() => {
    setDraftTitle(task.title);
  }, [task.title]);

  return (
    <article className={`task-card ${task.completed ? 'done' : ''}`}>
      <div className="task-main" onClick={onOpenDetails} role="button" tabIndex={0}>
        <label>
          <input
            type="checkbox"
            checked={task.completed}
            onChange={(e) => {
              e.stopPropagation();
              onToggleComplete();
            }}
          />
        </label>

        {isEditing ? (
          <input
            className="task-title-input"
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => {
              onTitleChange(draftTitle.trim() || task.title);
              onEditToggle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onTitleChange(draftTitle.trim() || task.title);
                onEditToggle(false);
              }
              if (e.key === 'Escape') {
                setDraftTitle(task.title);
                onEditToggle(false);
              }
            }}
          />
        ) : (
          <h4
            className="task-title"
            onClick={(e) => {
              e.stopPropagation();
              onEditToggle(true);
            }}
          >
            {task.title}
          </h4>
        )}

        <div className="task-meta">
          <span>{task.duration >= 60 ? `${task.duration / 60}h` : `${task.duration}m`}</span>
          <span>{task.status}</span>
          {task.notes && <span>Notes</span>}
          {task.links.length > 0 && <span>Links</span>}
          {task.attachments.length > 0 && <span>Files</span>}
        </div>
      </div>

      <button
        className="drag-handle"
        draggable
        aria-label="Drag task"
        onDragStart={onDragStart}
      >
        ⋮⋮
      </button>
    </article>
  );
}

type TaskModalProps = {
  task: Task;
  onClose: () => void;
  onSave: (patch: Partial<Task>) => void;
  onDelete: () => void;
};

function TaskModal({ task, onClose, onSave, onDelete }: TaskModalProps) {
  const [draft, setDraft] = useState<Task>(task);

  function updateLink(index: number, value: string) {
    const next = [...draft.links];
    next[index] = value;
    setDraft({ ...draft, links: next });
  }

  function addAttachment(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setDraft((current) => ({
          ...current,
          attachments: [
            ...current.attachments,
            { id: uid(), name: file.name, dataUrl: String(reader.result ?? '') },
          ],
        }));
      };
      reader.readAsDataURL(file);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Task Details</h3>
          <button onClick={onClose}>Close</button>
        </header>

        <label>Title</label>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />

        <label>Status</label>
        <select
          value={draft.status}
          onChange={(e) => {
            const status = e.target.value as TaskStatus;
            setDraft({ ...draft, status, completed: status === 'Done' });
          }}
        >
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

        <label>Duration</label>
        <select value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) as Duration })}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>{d >= 60 ? `${d / 60} hr` : `${d} min`}</option>
          ))}
        </select>

        <label>Due Date</label>
        <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />

        <div className="row-checks">
          <label><input type="checkbox" checked={draft.urgent} onChange={(e) => setDraft({ ...draft, urgent: e.target.checked })} /> Urgent</label>
          <label><input type="checkbox" checked={draft.important} onChange={(e) => setDraft({ ...draft, important: e.target.checked })} /> Important</label>
        </div>

        <label>Notes</label>
        <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={4} />

        <label>Links</label>
        <div className="links-list">
          {draft.links.map((link, i) => (
            <input key={i} value={link} onChange={(e) => updateLink(i, e.target.value)} placeholder="https://" />
          ))}
          <button onClick={() => setDraft({ ...draft, links: [...draft.links, ''] })}>Add Link</button>
        </div>

        <label>Attachments</label>
        <input type="file" multiple onChange={(e) => addAttachment(e.target.files)} />
        <div className="files-list">
          {draft.attachments.map((file) => (
            <a key={file.id} href={file.dataUrl} download={file.name}>{file.name}</a>
          ))}
        </div>

        <footer>
          <button className="danger" onClick={onDelete}>Delete Task</button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

export default App;
