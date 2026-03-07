import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Link2, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { toLocalDateKey, weekStartMonday } from '../lib/dateTime';
import {
  DAY_NAMES,
  DURATIONS,
  SLOT_MINUTES,
  START_HOUR,
  TOTAL_SLOTS,
  localTimezone,
  uid,
  type Duration,
  type Task,
  type TaskRepeat,
  type TaskStatus,
} from '../types';

type StatusFieldValue = 'Not Started' | 'Waiting' | 'In Progress' | 'In Review' | 'Done';

const STATUS_FIELD_OPTIONS: StatusFieldValue[] = ['Not Started', 'Waiting', 'In Progress', 'In Review', 'Done'];

function statusToFieldValue(status: TaskStatus): StatusFieldValue {
  if (status === 'Blocked') return 'Waiting';
  return status;
}

function fieldValueToStatus(value: StatusFieldValue): TaskStatus {
  if (value === 'Waiting') return 'Blocked';
  return value;
}

type TaskModalProps = {
  task: Task;
  onClose: () => void;
  onSave: (patch: Partial<Task>, scope?: 'single' | 'future') => void;
  onDelete: () => void;
};

export function TaskModal({ task, onClose, onSave, onDelete }: TaskModalProps) {
  const durationOptions = DURATIONS.filter((duration) => duration % 30 === 0);
  const [draft, setDraft] = useState<Task>(task);
  const [scheduleDate, setScheduleDate] = useState(task.scheduled ? scheduledDateKey(task.scheduled.weekKey, task.scheduled.dayIndex) : '');
  const [scheduleTime, setScheduleTime] = useState(task.scheduled ? slotToTimeValue(task.scheduled.slot) : '');
  const [pendingLink, setPendingLink] = useState('');
  const [repeatEnabled, setRepeatEnabled] = useState(Boolean(task.repeat?.enabled));
  const [repeatExpanded, setRepeatExpanded] = useState(false);
  const [repeatSameTimeEveryDay, setRepeatSameTimeEveryDay] = useState(task.repeat?.sameTimeEveryDay ?? true);
  const [repeatDays, setRepeatDays] = useState<number[]>(
    task.repeat?.days?.length ? [...task.repeat.days] : task.scheduled ? [task.scheduled.dayIndex] : [],
  );
  const [repeatSlot, setRepeatSlot] = useState<number>(task.repeat?.slot ?? task.scheduled?.slot ?? 0);
  const [repeatDaySlots, setRepeatDaySlots] = useState<Record<number, number>>(() => {
    const seeded: Record<number, number> = {};
    if (task.repeat?.daySlots) {
      Object.entries(task.repeat.daySlots).forEach(([key, value]) => {
        const day = Number(key);
        if (Number.isFinite(day) && Number.isFinite(value)) seeded[day] = Number(value);
      });
    }
    if (task.repeat?.days?.length) {
      task.repeat.days.forEach((day) => {
        if (!Number.isFinite(seeded[day])) seeded[day] = task.repeat?.slot ?? task.scheduled?.slot ?? 0;
      });
    }
    return seeded;
  });
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const didFocusTitleRef = useRef(false);
  const [pendingSavePatch, setPendingSavePatch] = useState<Partial<Task> | null>(null);
  const allDaysSelected = repeatDays.length === 7;
  const repeatToggleId = `repeat-toggle-${task.id}`;
  const repeatSelectAllId = `repeat-select-all-${task.id}`;
  const repeatSameTimeId = `repeat-same-time-${task.id}`;
  const shouldSelectDefaultTitle = task.title.trim().toLowerCase() === 'new task';
  const statusFieldValue = statusToFieldValue(draft.status);

  useEffect(() => {
    if (didFocusTitleRef.current) return;
    const input = titleInputRef.current;
    if (!input) return;

    input.focus();
    if (shouldSelectDefaultTitle) {
      input.select();
    } else {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
    didFocusTitleRef.current = true;
  }, [shouldSelectDefaultTitle]);

  useEffect(() => {
    setRepeatExpanded(false);
  }, [task.id]);

  function removeLink(index: number) {
    setDraft({ ...draft, links: draft.links.filter((_, i) => i !== index) });
  }

  function normalizeLink(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  function confirmPendingLink() {
    const link = normalizeLink(pendingLink);
    if (!link) return;
    if (draft.links.includes(link)) {
      setPendingLink('');
      return;
    }
    setDraft({ ...draft, links: [...draft.links, link] });
    setPendingLink('');
  }

  function removeAttachment(id: string) {
    setDraft({ ...draft, attachments: draft.attachments.filter((attachment) => attachment.id !== id) });
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setDraft((prev) => ({
          ...prev,
          attachments: [
            ...prev.attachments,
            {
              id: uid(),
              name: file.name,
              mimeType: file.type,
              size: file.size,
              dataUrl: String(reader.result ?? ''),
            },
          ],
        }));
      };
      reader.readAsDataURL(file);
    });
  }

  function toggleRepeatDay(dayIndex: number) {
    setRepeatDays((current) => {
      if (current.includes(dayIndex)) {
        const next = current.filter((day) => day !== dayIndex);
        setRepeatDaySlots((prev) => {
          const copy = { ...prev };
          delete copy[dayIndex];
          return copy;
        });
        return next;
      }
      setRepeatDaySlots((prev) => ({ ...prev, [dayIndex]: prev[dayIndex] ?? repeatSlot }));
      return [...current, dayIndex].sort((a, b) => a - b);
    });
  }

  function setRepeatSlotFromTime(value: string) {
    setRepeatSlot(timeValueToSlot(value));
  }

  function setRepeatDaySlotFromTime(dayIndex: number, value: string) {
    const nextSlot = timeValueToSlot(value);
    setRepeatDaySlots((prev) => ({ ...prev, [dayIndex]: nextSlot }));
  }

  function buildSavePatch() {
    const savePatch: Partial<Task> = {
      title: draft.title.trim() || task.title,
      status: draft.status,
      completed: draft.completed,
      duration: draft.duration,
      dueDate: draft.dueDate,
      urgent: draft.urgent,
      important: draft.important,
      notes: draft.notes,
      links: draft.links.map((link) => link.trim()).filter(Boolean),
      attachments: draft.attachments,
    };
    savePatch.scheduled = scheduleDate
      ? buildScheduleFromInputs(scheduleDate, scheduleTime || `${`${START_HOUR}`.padStart(2, '0')}:00`)
      : undefined;

    let repeat: TaskRepeat | undefined;
    if (repeatEnabled && repeatDays.length > 0) {
      const daySlots = repeatSameTimeEveryDay
        ? undefined
        : repeatDays.reduce<Record<number, number>>((acc, day) => {
            acc[day] = repeatDaySlots[day] ?? repeatSlot;
            return acc;
          }, {});
      repeat = {
        enabled: true,
        days: [...new Set(repeatDays)].sort((a, b) => a - b),
        slot: repeatSlot,
        sameTimeEveryDay: repeatSameTimeEveryDay,
        daySlots,
        timezone: task.repeat?.timezone ?? task.scheduled?.timezone ?? localTimezone(),
      };
    }
    if (repeatEnabled && repeat) {
      savePatch.repeat = repeat;
    } else if (task.repeat?.enabled) {
      savePatch.repeat = undefined;
    }

    return savePatch;
  }

  function handleSaveClick() {
    const savePatch = buildSavePatch();
    if (task.repeatParentId) {
      setPendingSavePatch(savePatch);
      return;
    }
    onSave(savePatch, 'single');
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="task-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="task-modal-header">
          <h3>Task Details</h3>
          <button onClick={onClose} className="icon-text-button">
            <X size={16} />
            <span>Close</span>
          </button>
        </header>

        <div className="task-modal-body">
        <label>
          Title
          <input
            ref={titleInputRef}
            placeholder="Enter task title"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <div className="modal-grid-2">
          <label>
            Status
            <select
              value={statusFieldValue}
              onChange={(event) => {
                const fieldValue = event.target.value as StatusFieldValue;
                const status = fieldValueToStatus(fieldValue);
                setDraft({ ...draft, status, completed: status === 'Done' });
              }}
            >
              {STATUS_FIELD_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label>
            Duration
            <select
              value={draft.duration}
              onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) as Duration })}
            >
              {durationOptions.map((duration) => (
                <option key={duration} value={duration}>
                  {durationOptionLabel(duration)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="due-flags-row">
          <label className="due-date-field">
            Due Date
            <input
              type="date"
              value={draft.dueDate}
              onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
            />
          </label>
          <div className="modal-grid-2 checks due-flags-inline">
            <label>
              <input
                type="checkbox"
                checked={draft.urgent}
                onChange={(event) => setDraft({ ...draft, urgent: event.target.checked })}
              />
              Urgent
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.important}
                onChange={(event) => setDraft({ ...draft, important: event.target.checked })}
              />
              Important
            </label>
          </div>
        </div>

        <section className="modal-section repeat-section">
          <div className="schedule-repeat-head">
            <label className="schedule-main-field">
              Schedule date and time
              <div className="inline-row schedule-row">
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
                <input
                  type="time"
                  step={SLOT_MINUTES * 60}
                  value={scheduleTime}
                  onChange={(event) => setScheduleTime(event.target.value)}
                />
              </div>
            </label>

            <div className="repeat-check-row repeat-head-toggle">
              <input
                id={repeatToggleId}
                type="checkbox"
                checked={repeatEnabled}
                onChange={(event) => {
                  const next = event.target.checked;
                  setRepeatEnabled(next);
                  setRepeatExpanded(next);
                  if (!next) return;
                  if (repeatDays.length > 0) return;
                  if (task.scheduled) {
                    setRepeatDays([task.scheduled.dayIndex]);
                    setRepeatDaySlots((prev) => ({ ...prev, [task.scheduled!.dayIndex]: prev[task.scheduled!.dayIndex] ?? repeatSlot }));
                  } else {
                    const today = (new Date().getDay() + 6) % 7;
                    setRepeatDays([today]);
                    setRepeatDaySlots((prev) => ({ ...prev, [today]: prev[today] ?? repeatSlot }));
                  }
                }}
              />
              <label htmlFor={repeatToggleId}>Repeat</label>
              {repeatEnabled && (
                <button
                  type="button"
                  className="repeat-collapse-toggle"
                  aria-label={repeatExpanded ? 'Collapse repeat options' : 'Expand repeat options'}
                  onClick={() => setRepeatExpanded((current) => !current)}
                >
                  {repeatExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}
            </div>
          </div>

          {repeatEnabled && repeatExpanded && (
            <>
              <div className="repeat-days-grid">
                {DAY_NAMES.map((label, dayIndex) => (
                  <button
                    key={label}
                    type="button"
                    className={`repeat-day-chip ${repeatDays.includes(dayIndex) ? 'active' : ''}`}
                    onClick={() => toggleRepeatDay(dayIndex)}
                  >
                    {label.slice(0, 3)}
                  </button>
                ))}
              </div>

              <div className="repeat-check-row">
                <input
                  id={repeatSelectAllId}
                  type="checkbox"
                  checked={allDaysSelected}
                  onChange={(event) => {
                    if (event.target.checked) {
                      const allDays = [0, 1, 2, 3, 4, 5, 6];
                      setRepeatDays(allDays);
                      setRepeatDaySlots((prev) => {
                        const next = { ...prev };
                        allDays.forEach((day) => {
                          next[day] = next[day] ?? repeatSlot;
                        });
                        return next;
                      });
                      return;
                    }
                    setRepeatDays([]);
                  }}
                />
                <label htmlFor={repeatSelectAllId}>Select all days</label>
              </div>

              <div className="repeat-check-row">
                <input
                  id={repeatSameTimeId}
                  type="checkbox"
                  checked={repeatSameTimeEveryDay}
                  onChange={(event) => setRepeatSameTimeEveryDay(event.target.checked)}
                />
                <label htmlFor={repeatSameTimeId}>Same time every day</label>
              </div>

              {repeatSameTimeEveryDay ? (
                <label className="repeat-time-field">
                  Time
                  <input
                    type="time"
                    step={SLOT_MINUTES * 60}
                    value={slotToTimeValue(repeatSlot)}
                    onChange={(event) => setRepeatSlotFromTime(event.target.value)}
                  />
                </label>
              ) : (
                <div className="repeat-day-times">
                  {repeatDays.map((dayIndex) => (
                    <label key={`repeat-time-${dayIndex}`} className="repeat-time-row">
                      <span>{DAY_NAMES[dayIndex].slice(0, 3)}</span>
                      <input
                        type="time"
                        step={SLOT_MINUTES * 60}
                        value={slotToTimeValue(repeatDaySlots[dayIndex] ?? repeatSlot)}
                        onChange={(event) => setRepeatDaySlotFromTime(dayIndex, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <label>
          Notes
          <textarea
            rows={5}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>

        <section className="modal-section">
          <div className="section-title-row">
            <strong className="section-title-icon">
              <Link2 size={15} />
              <span>Links</span>
            </strong>
          </div>

          <div className="stack">
            {draft.links.length === 0 && <p className="muted">No links yet.</p>}
            {draft.links.map((link, index) => (
              <div key={index} className="inline-row link-row">
                <a href={link} target="_blank" rel="noreferrer">
                  {link}
                </a>
                <button className="link-icon-button" onClick={() => removeLink(index)} aria-label="Remove link">
                  <X size={14} />
                </button>
              </div>
            ))}
            <div className="inline-row link-entry-row">
              <input
                placeholder="https://"
                value={pendingLink}
                onChange={(event) => setPendingLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    confirmPendingLink();
                  }
                }}
              />
              <button
                className="link-icon-button"
                aria-label="Add link"
                disabled={!pendingLink.trim()}
                onClick={confirmPendingLink}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </section>

        <section className="modal-section">
          <div className="section-title-row">
            <strong className="section-title-icon">
              <Paperclip size={15} />
              <span>Attachments</span>
            </strong>
          </div>
          <div className="stack">
            {draft.attachments.length === 0 && <p className="muted">No attachments yet.</p>}
            {draft.attachments.map((attachment) => (
              <div key={attachment.id} className="inline-row">
                <a href={attachment.dataUrl} download={attachment.name}>
                  {attachment.name}
                </a>
                <button
                  className="link-icon-button"
                  aria-label="Remove attachment"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <input
            ref={attachmentInputRef}
            className="attachment-picker"
            type="file"
            multiple
            onChange={(event) => {
              onFilesSelected(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </section>
        </div>

        <footer className="task-modal-footer">
          <button className="danger icon-text-button" onClick={onDelete}>
            <Trash2 size={15} />
            <span>Delete Task</span>
          </button>
          <button
            className="success"
            onClick={handleSaveClick}
          >
            Save
          </button>
        </footer>

        {pendingSavePatch && (
          <div className="modal-overlay scope-choice-overlay" onClick={() => setPendingSavePatch(null)}>
            <section
              className="scope-choice-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Update repeating task"
              onClick={(event) => event.stopPropagation()}
            >
              <h4>Apply changes to repeating task</h4>
              <div className="scope-choice-actions">
                <button
                  onClick={() => {
                    onSave(pendingSavePatch, 'single');
                    setPendingSavePatch(null);
                    onClose();
                  }}
                >
                  Update this task
                </button>
                <button
                  className="success"
                  onClick={() => {
                    onSave(pendingSavePatch, 'future');
                    setPendingSavePatch(null);
                    onClose();
                  }}
                >
                  Update future tasks
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
function durationOptionLabel(duration: number) {
    if (duration < 60) return `${duration} min`;
    if (duration % 60 === 0) return `${duration / 60} hr`;
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    return `${hours} hr ${minutes} min`;
}

function scheduledDateKey(weekKey: string, dayIndex: number) {
  const monday = new Date(`${weekKey}T00:00:00`);
  monday.setDate(monday.getDate() + dayIndex);
  return toLocalDateKey(monday);
}

function slotToTimeValue(slot: number) {
  const totalMinutes = START_HOUR * 60 + slot * SLOT_MINUTES;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
}

function timeValueToSlot(timeValue: string) {
  const [h, m] = timeValue.split(':').map(Number);
  const hours = Number.isFinite(h) ? h : START_HOUR;
  const minutesRaw = Number.isFinite(m) ? m : 0;
  const snappedMinute = Math.round(minutesRaw / SLOT_MINUTES) * SLOT_MINUTES;
  const totalMinutesRaw = hours * 60 + snappedMinute;
  const minStart = START_HOUR * 60;
  const maxStart = START_HOUR * 60 + (TOTAL_SLOTS - 1) * SLOT_MINUTES;
  const totalMinutes = Math.max(minStart, Math.min(maxStart, totalMinutesRaw));
  return Math.round((totalMinutes - minStart) / SLOT_MINUTES);
}

function buildScheduleFromInputs(dateValue: string, timeValue: string) {
  const parsedDate = new Date(`${dateValue}T00:00:00`);
  const slot = timeValueToSlot(timeValue);

  const monday = weekStartMonday(parsedDate);
  const dayIndex = (parsedDate.getDay() + 6) % 7;

  return {
    weekKey: toLocalDateKey(monday),
    dayIndex,
    slot,
    timezone: localTimezone(),
  };
}
