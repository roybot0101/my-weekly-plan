import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Link2, Paperclip, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { toLocalDateKey, weekStartMonday } from '../lib/dateTime';
import {
  ACTIVITY_OPTIONS,
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
  isRepeatingSeries?: boolean;
  clientSuggestions: string[];
  projectDeadlineByClient: Record<string, string>;
  projectValueByClient: Record<string, string>;
  projectPriorityByClient: Record<string, { urgent: boolean; important: boolean }>;
  activeTaskCountByClient: Record<string, number>;
  onRemoveClientSuggestion: (client: string) => void;
  onRestoreClientSuggestion: (client: string) => void;
  onClose: () => void;
  onSave: (patch: Partial<Task>, scope?: 'single' | 'future') => void;
  onDelete: () => void;
};

type SaveFlowStep = 'repeat-scope' | 'save-single' | 'save-future';

type ProjectDeadlineConfirmationState = {
  savePatch: Partial<Task>;
  nextStep: SaveFlowStep;
  projectName: string;
  projectDeadline: string;
};

type ProjectValueConfirmationState = {
  savePatch: Partial<Task>;
  nextStep: SaveFlowStep;
  projectName: string;
  projectValue: string;
};

type ProjectPriorityConfirmationState = {
  savePatch: Partial<Task>;
  nextStep: SaveFlowStep;
  projectName: string;
  urgent: boolean;
  important: boolean;
};

function normalizeClientKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function sanitizeCurrencyInput(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...decimalParts] = cleaned.split('.');
  const decimals = decimalParts.join('').slice(0, 2);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');

  if (cleaned.includes('.')) {
    return `${normalizedWhole || '0'}.${decimals}`;
  }

  return normalizedWhole;
}

export function TaskModal({
  task,
  isRepeatingSeries = false,
  clientSuggestions,
  projectDeadlineByClient,
  projectValueByClient,
  projectPriorityByClient,
  activeTaskCountByClient,
  onRemoveClientSuggestion,
  onRestoreClientSuggestion,
  onClose,
  onSave,
  onDelete,
}: TaskModalProps) {
  const durationOptions = DURATIONS.filter((duration) => duration % 30 === 0);
  const [draft, setDraft] = useState<Task>(task);
  const [projectDeadlineTouched, setProjectDeadlineTouched] = useState(false);
  const [projectValueTouched, setProjectValueTouched] = useState(false);
  const [projectPriorityTouched, setProjectPriorityTouched] = useState(false);
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);
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
  const clientAutocompleteRef = useRef<HTMLDivElement | null>(null);
  const prioritySignalsRef = useRef<HTMLDivElement | null>(null);
  const clientInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const didFocusTitleRef = useRef(false);
  const [pendingSavePatch, setPendingSavePatch] = useState<Partial<Task> | null>(null);
  const [projectDeadlineConfirmation, setProjectDeadlineConfirmation] =
    useState<ProjectDeadlineConfirmationState | null>(null);
  const [projectValueConfirmation, setProjectValueConfirmation] = useState<ProjectValueConfirmationState | null>(null);
  const [projectPriorityConfirmation, setProjectPriorityConfirmation] =
    useState<ProjectPriorityConfirmationState | null>(null);
  const [repeatScheduleNoticeOpen, setRepeatScheduleNoticeOpen] = useState(false);
  const [confirmedProjectDeadlineKey, setConfirmedProjectDeadlineKey] = useState<string | null>(null);
  const [confirmedProjectValueKey, setConfirmedProjectValueKey] = useState<string | null>(null);
  const [confirmedProjectPriorityKey, setConfirmedProjectPriorityKey] = useState<string | null>(null);
  const [tempoHelpOpen, setTempoHelpOpen] = useState(false);
  const allDaysSelected = repeatDays.length === 7;
  const canConfigureRepeatFromCurrentTask = Boolean(task.scheduled || isRepeatingSeries || repeatEnabled);
  const repeatToggleId = `repeat-toggle-${task.id}`;
  const repeatSelectAllId = `repeat-select-all-${task.id}`;
  const repeatSameTimeId = `repeat-same-time-${task.id}`;
  const shouldSelectDefaultTitle = task.title.trim().toLowerCase() === 'new task';
  const statusFieldValue = statusToFieldValue(draft.status);
  const filteredClientSuggestions = clientSuggestions.filter((client) => {
    const query = normalizeClientKey(draft.client);
    if (!query) return true;
    return normalizeClientKey(client).includes(query);
  });

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

  useEffect(() => {
    setProjectDeadlineTouched(false);
    setProjectValueTouched(false);
    setProjectPriorityTouched(false);
    setConfirmedProjectDeadlineKey(null);
    setConfirmedProjectValueKey(null);
    setConfirmedProjectPriorityKey(null);
    setProjectDeadlineConfirmation(null);
    setProjectValueConfirmation(null);
    setProjectPriorityConfirmation(null);
    setRepeatScheduleNoticeOpen(false);
    setTempoHelpOpen(false);
  }, [task.id]);

  useEffect(() => {
    if (!clientSuggestionsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (clientAutocompleteRef.current?.contains(target)) return;
      setClientSuggestionsOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [clientSuggestionsOpen]);

  useEffect(() => {
    if (!tempoHelpOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (prioritySignalsRef.current?.contains(target)) return;
      setTempoHelpOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [tempoHelpOpen]);

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

  function lookupProjectDeadline(client: string) {
    return projectDeadlineByClient[normalizeClientKey(client)] ?? '';
  }

  function lookupProjectValue(client: string) {
    return projectValueByClient[normalizeClientKey(client)] ?? '';
  }

  function lookupProjectPriority(client: string) {
    return projectPriorityByClient[normalizeClientKey(client)] ?? { urgent: false, important: false };
  }

  function handleClientChange(value: string) {
    setConfirmedProjectDeadlineKey(null);
    setConfirmedProjectValueKey(null);
    setConfirmedProjectPriorityKey(null);
    setDraft((prev) => {
      const previousInheritedDeadline = lookupProjectDeadline(prev.client);
      const previousInheritedProjectValue = lookupProjectValue(prev.client);
      const previousInheritedProjectPriority = lookupProjectPriority(prev.client);
      const shouldSyncProjectDeadline = !prev.projectDeadline || prev.projectDeadline === previousInheritedDeadline;
      const shouldSyncProjectValue = !prev.projectValue || prev.projectValue === previousInheritedProjectValue;
      const shouldSyncUrgent = !projectPriorityTouched || prev.urgent === previousInheritedProjectPriority.urgent;
      const shouldSyncImportant = !projectPriorityTouched || prev.important === previousInheritedProjectPriority.important;
      const nextInheritedProjectPriority = lookupProjectPriority(value);
      return {
        ...prev,
        client: value,
        projectDeadline: shouldSyncProjectDeadline ? lookupProjectDeadline(value) : prev.projectDeadline,
        projectValue: shouldSyncProjectValue ? lookupProjectValue(value) : prev.projectValue,
        urgent: shouldSyncUrgent ? nextInheritedProjectPriority.urgent : prev.urgent,
        important: shouldSyncImportant ? nextInheritedProjectPriority.important : prev.important,
      };
    });
  }

  function selectClientSuggestion(client: string) {
    handleClientChange(client);
    setClientSuggestionsOpen(false);
    clientInputRef.current?.focus();
  }

  function removeClientSuggestion(client: string) {
    onRemoveClientSuggestion(client);
    if (normalizeClientKey(draft.client) === normalizeClientKey(client)) {
      setClientSuggestionsOpen(false);
      return;
    }
    if (filteredClientSuggestions.length <= 1) {
      setClientSuggestionsOpen(false);
    }
  }

  function buildSavePatch() {
    const trimmedClient = draft.client.trim();
    const normalizedClient =
      clientSuggestions.find((client) => client.toLocaleLowerCase() === trimmedClient.toLocaleLowerCase()) ??
      trimmedClient;
    const inheritedProjectDeadline =
      !draft.projectDeadline && normalizedClient ? lookupProjectDeadline(normalizedClient) : '';
    const inheritedProjectValue = !draft.projectValue && normalizedClient ? lookupProjectValue(normalizedClient) : '';

    const savePatch: Partial<Task> = {
      title: draft.title.trim(),
      client: normalizedClient,
      activity: draft.activity,
      projectValue: draft.projectValue.trim() || inheritedProjectValue,
      status: draft.status,
      completed: draft.completed,
      duration: draft.duration,
      dueDate: draft.dueDate,
      projectDeadline: draft.projectDeadline || inheritedProjectDeadline,
      notes: draft.notes,
      links: draft.links.map((link) => link.trim()).filter(Boolean),
      attachments: draft.attachments,
    };
    if (projectPriorityTouched || draft.urgent !== task.urgent) savePatch.urgent = draft.urgent;
    if (projectPriorityTouched || draft.important !== task.important) savePatch.important = draft.important;
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

  function getProjectDeadlineConfirmationState(
    savePatch: Partial<Task>,
    nextStep: SaveFlowStep,
  ): ProjectDeadlineConfirmationState | null {
    const projectName = (savePatch.client ?? '').trim();
    const nextProjectDeadline = savePatch.projectDeadline ?? '';
    const confirmationKey = `${normalizeClientKey(projectName)}::${nextProjectDeadline}`;
    if (!projectDeadlineTouched || !projectName) return null;
    if (confirmationKey === confirmedProjectDeadlineKey) return null;
    if (nextProjectDeadline === lookupProjectDeadline(projectName)) return null;
    if (getActiveProjectTaskCount(savePatch) <= 1) return null;
    return {
      savePatch,
      nextStep,
      projectName,
      projectDeadline: nextProjectDeadline,
    };
  }

  function getProjectValueConfirmationState(
    savePatch: Partial<Task>,
    nextStep: SaveFlowStep,
  ): ProjectValueConfirmationState | null {
    const projectName = (savePatch.client ?? '').trim();
    const nextProjectValue = savePatch.projectValue ?? '';
    const confirmationKey = `${normalizeClientKey(projectName)}::${nextProjectValue}`;
    if (!projectValueTouched || !projectName) return null;
    if (confirmationKey === confirmedProjectValueKey) return null;
    if (nextProjectValue === lookupProjectValue(projectName)) return null;
    if (getActiveProjectTaskCount(savePatch) <= 1) return null;
    return {
      savePatch,
      nextStep,
      projectName,
      projectValue: nextProjectValue,
    };
  }

  function getProjectPriorityConfirmationState(
    savePatch: Partial<Task>,
    nextStep: SaveFlowStep,
  ): ProjectPriorityConfirmationState | null {
    const projectName = (savePatch.client ?? '').trim();
    const nextUrgent = Boolean(savePatch.urgent);
    const nextImportant = Boolean(savePatch.important);
    const confirmationKey = `${normalizeClientKey(projectName)}::${nextUrgent ? 1 : 0}:${nextImportant ? 1 : 0}`;
    if (!projectPriorityTouched || !projectName) return null;
    if (confirmationKey === confirmedProjectPriorityKey) return null;
    const inheritedPriority = lookupProjectPriority(projectName);
    if (nextUrgent === inheritedPriority.urgent && nextImportant === inheritedPriority.important) return null;
    if (getActiveProjectTaskCount(savePatch) <= 1) return null;
    return {
      savePatch,
      nextStep,
      projectName,
      urgent: nextUrgent,
      important: nextImportant,
    };
  }

  function finishSave(savePatch: Partial<Task>, scope: 'single' | 'future' = 'single') {
    if (savePatch.client) onRestoreClientSuggestion(savePatch.client);
    setPendingSavePatch(null);
    setProjectDeadlineConfirmation(null);
    setProjectValueConfirmation(null);
    setProjectPriorityConfirmation(null);
    onSave(savePatch, scope);
    onClose();
  }

  function continueSaveFlow(state: ProjectDeadlineConfirmationState) {
    setConfirmedProjectDeadlineKey(`${normalizeClientKey(state.projectName)}::${state.projectDeadline}`);
    setProjectDeadlineConfirmation(null);
    const projectValueState = getProjectValueConfirmationState(state.savePatch, state.nextStep);
    if (projectValueState) {
      setProjectValueConfirmation(projectValueState);
      return;
    }
    const projectPriorityState = getProjectPriorityConfirmationState(state.savePatch, state.nextStep);
    if (projectPriorityState) {
      setProjectPriorityConfirmation(projectPriorityState);
      return;
    }

    if (state.nextStep === 'repeat-scope') {
      setPendingSavePatch(state.savePatch);
      return;
    }

    finishSave(state.savePatch, state.nextStep === 'save-future' ? 'future' : 'single');
  }

  function continueProjectValueSaveFlow(state: ProjectValueConfirmationState) {
    setConfirmedProjectValueKey(`${normalizeClientKey(state.projectName)}::${state.projectValue}`);
    setProjectValueConfirmation(null);
    const projectPriorityState = getProjectPriorityConfirmationState(state.savePatch, state.nextStep);
    if (projectPriorityState) {
      setProjectPriorityConfirmation(projectPriorityState);
      return;
    }
    if (state.nextStep === 'repeat-scope') {
      setPendingSavePatch(state.savePatch);
      return;
    }

    finishSave(state.savePatch, state.nextStep === 'save-future' ? 'future' : 'single');
  }

  function continueProjectPrioritySaveFlow(state: ProjectPriorityConfirmationState) {
    setConfirmedProjectPriorityKey(
      `${normalizeClientKey(state.projectName)}::${state.urgent ? 1 : 0}:${state.important ? 1 : 0}`,
    );
    setProjectPriorityConfirmation(null);
    if (state.nextStep === 'repeat-scope') {
      setPendingSavePatch(state.savePatch);
      return;
    }

    finishSave(state.savePatch, state.nextStep === 'save-future' ? 'future' : 'single');
  }

  function requestSaveFlow(savePatch: Partial<Task>, nextStep: SaveFlowStep) {
    const confirmationState = getProjectDeadlineConfirmationState(savePatch, nextStep);
    if (confirmationState) {
      setProjectDeadlineConfirmation(confirmationState);
      return;
    }

    const projectValueState = getProjectValueConfirmationState(savePatch, nextStep);
    if (projectValueState) {
      setProjectValueConfirmation(projectValueState);
      return;
    }

    const projectPriorityState = getProjectPriorityConfirmationState(savePatch, nextStep);
    if (projectPriorityState) {
      setProjectPriorityConfirmation(projectPriorityState);
      return;
    }

    if (nextStep === 'repeat-scope') {
      setPendingSavePatch(savePatch);
      return;
    }

    finishSave(savePatch, nextStep === 'save-future' ? 'future' : 'single');
  }

  function formatProjectDeadline(value: string) {
    if (!value) return '';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  function formatProjectValue(value: string) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return value || '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: parsed % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(parsed);
  }

  function formatProjectPrioritySignals(urgent: boolean, important: boolean) {
    if (urgent && important) return 'Urgent + Important';
    if (urgent) return 'Urgent';
    if (important) return 'Important';
    return 'No urgency flags';
  }

  function getActiveProjectTaskCount(savePatch: Partial<Task>) {
    const projectName = (savePatch.client ?? '').trim();
    const projectKey = normalizeClientKey(projectName);
    if (!projectKey) return 0;

    const baseCount = activeTaskCountByClient[projectKey] ?? 0;
    const currentMatches = normalizeClientKey(task.client) === projectKey;
    const currentIncluded = currentMatches && !task.completed;
    const nextCompleted = savePatch.completed ?? task.completed;
    const nextIncluded = !nextCompleted;

    return Math.max(0, baseCount - (currentIncluded ? 1 : 0) + (nextIncluded ? 1 : 0));
  }

  function handleSaveClick() {
    const savePatch = buildSavePatch();
    const startedFromBacklog = !task.scheduled;
    const isCreatingFirstRepeatFromBacklog = startedFromBacklog && savePatch.repeat?.enabled && !isRepeatingSeries;
    const isDisablingExistingSeries = isRepeatingSeries && Boolean(task.repeat?.enabled) && !savePatch.repeat?.enabled;

    if (isCreatingFirstRepeatFromBacklog || (savePatch.repeat?.enabled && !savePatch.scheduled)) {
      setRepeatScheduleNoticeOpen(true);
      return;
    }
    if (isDisablingExistingSeries) {
      requestSaveFlow(savePatch, 'save-future');
      return;
    }
    if (isRepeatingSeries) {
      requestSaveFlow(savePatch, 'repeat-scope');
      return;
    }
    requestSaveFlow(savePatch, 'save-single');
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
        <div className="modal-grid-2">
          <label>
            Activity
            <select
              value={draft.activity}
              onChange={(event) => setDraft({ ...draft, activity: event.target.value as Task['activity'] })}
            >
              <option value="">Select activity</option>
              {ACTIVITY_OPTIONS.map((activity) => (
                <option key={activity} value={activity}>
                  {activity}
                </option>
              ))}
            </select>
          </label>

          <label>
            Project
            <div className="autocomplete-control" ref={clientAutocompleteRef}>
              <input
                ref={clientInputRef}
                className="autocomplete-input"
                placeholder="Project name"
                value={draft.client}
                autoComplete="off"
                onChange={(event) => {
                  handleClientChange(event.target.value);
                  setClientSuggestionsOpen(true);
                }}
                onFocus={() => setClientSuggestionsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setClientSuggestionsOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className={`autocomplete-toggle ${clientSuggestionsOpen ? 'open' : ''}`}
                aria-label={clientSuggestionsOpen ? 'Hide project suggestions' : 'Show project suggestions'}
                onClick={() => {
                  setClientSuggestionsOpen((current) => !current);
                  clientInputRef.current?.focus();
                }}
              >
                <ChevronDown size={14} />
              </button>

              {clientSuggestionsOpen && filteredClientSuggestions.length > 0 && (
                <div className="autocomplete-menu" role="listbox" aria-label="Project suggestions">
                  {filteredClientSuggestions.map((client) => (
                    <div key={client} className="autocomplete-option">
                      <button
                        type="button"
                        className="autocomplete-option-label"
                        onClick={() => selectClientSuggestion(client)}
                      >
                        {client}
                      </button>
                      <button
                        type="button"
                        className="autocomplete-option-remove"
                        aria-label={`Remove saved project suggestion ${client}`}
                        onClick={() => removeClientSuggestion(client)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>
        </div>

        <label>
          Title
          <input
            ref={titleInputRef}
            placeholder="Enter task title"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <section className="tempo-priority-panel" aria-label="Priority signals">
          <div className="tempo-priority-toolbar" ref={prioritySignalsRef}>
            <button
              type="button"
              className={`tempo-chip tempo-signal-button ${tempoHelpOpen ? 'open' : ''}`}
              aria-label={tempoHelpOpen ? 'Hide how Tempo uses these fields' : 'Show how Tempo uses these fields'}
              aria-expanded={tempoHelpOpen}
              onClick={() => setTempoHelpOpen((current) => !current)}
            >
              <Sparkles size={12} />
              <span>Priority Signals</span>
            </button>

            {tempoHelpOpen && (
              <div className="tempo-help-tooltip" role="note">
                <strong>How Tempo Plans Your Week</strong>
                <p>
                  Tempo uses a few simple signals to figure out what you should work on first. It looks at things
                  like deadlines, how long the task will take, and whether you marked it urgent or important.
                </p>
                <p>
                  Then it places the highest-priority tasks into your available work blocks for the week.
                </p>
                <p>
                  You can always move or schedule tasks yourself if you want.
                </p>
              </div>
            )}
          </div>

          <div className="tempo-priority-grid">
            <div className="modal-grid-2 project-details-row">
              <label className="due-date-field tempo-field">
                Project Deadline
                <input
                  type="date"
                  value={draft.projectDeadline}
                  onChange={(event) => {
                    setConfirmedProjectDeadlineKey(null);
                    setProjectDeadlineTouched(true);
                    setDraft({ ...draft, projectDeadline: event.target.value });
                  }}
                />
              </label>

              <label className="project-value-inline-field tempo-field">
                <span>Project Value</span>
                <div className="currency-input-wrap">
                  <span className="currency-input-prefix" aria-hidden="true">
                    $
                  </span>
                  <input
                    className="project-value-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={draft.projectValue}
                    onChange={(event) => {
                      setConfirmedProjectValueKey(null);
                      setProjectValueTouched(true);
                      setDraft({ ...draft, projectValue: sanitizeCurrencyInput(event.target.value) });
                    }}
                  />
                </div>
              </label>
            </div>

            <div className="modal-grid-2">
              <label className="tempo-field">
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

              <label className="tempo-field">
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
            </div>

            <div className="due-flags-row tempo-priority-bottom-row">
              <label className="due-date-field tempo-field">
                Task Deadline
                <input
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
                />
              </label>

              <div className="due-flags-inline">
                <label className="priority-toggle tempo-priority-toggle">
                  <input
                    type="checkbox"
                    checked={draft.urgent}
                    onChange={(event) => {
                      setProjectPriorityTouched(true);
                      setDraft({ ...draft, urgent: event.target.checked });
                    }}
                  />
                  Urgent
                </label>
                <label className="priority-toggle tempo-priority-toggle">
                  <input
                    type="checkbox"
                    checked={draft.important}
                    onChange={(event) => {
                      setProjectPriorityTouched(true);
                      setDraft({ ...draft, important: event.target.checked });
                    }}
                  />
                  Important
                </label>
              </div>
            </div>
          </div>
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
                  if (!canConfigureRepeatFromCurrentTask) {
                    event.preventDefault();
                    setRepeatScheduleNoticeOpen(true);
                    return;
                  }
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
                    requestSaveFlow(pendingSavePatch, 'save-single');
                  }}
                >
                  Update this task
                </button>
                <button
                  className="success"
                  onClick={() => {
                    requestSaveFlow(pendingSavePatch, 'save-future');
                  }}
                >
                  Update this and future tasks
                </button>
              </div>
            </section>
          </div>
        )}

        {projectDeadlineConfirmation && (
          <div className="modal-overlay scope-choice-overlay" onClick={() => setProjectDeadlineConfirmation(null)}>
            <section
              className="scope-choice-modal project-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm project deadline update"
              onClick={(event) => event.stopPropagation()}
            >
              <h4>Update project deadline?</h4>
              <p className="scope-choice-copy">
                You&apos;re changing the <strong>{projectDeadlineConfirmation.projectName}</strong> project deadline.
              </p>
              {projectDeadlineConfirmation.projectDeadline ? (
                <p className="scope-choice-copy">
                  <strong>{getActiveProjectTaskCount(projectDeadlineConfirmation.savePatch)}</strong>{' '}
                  {getActiveProjectTaskCount(projectDeadlineConfirmation.savePatch) === 1 ? 'task' : 'tasks'} connected
                  to this project will now use{' '}
                  <strong>{formatProjectDeadline(projectDeadlineConfirmation.projectDeadline)}</strong> as their
                  deadline.
                </p>
              ) : (
                <p className="scope-choice-copy">
                  <strong>{getActiveProjectTaskCount(projectDeadlineConfirmation.savePatch)}</strong>{' '}
                  {getActiveProjectTaskCount(projectDeadlineConfirmation.savePatch) === 1 ? 'task' : 'tasks'} connected
                  to this project will now use <strong>no deadline</strong> as their deadline.
                </p>
              )}
              <div className="scope-choice-actions scope-choice-actions-inline">
                <button onClick={() => setProjectDeadlineConfirmation(null)}>Cancel</button>
                <button
                  className="success"
                  onClick={() => continueSaveFlow(projectDeadlineConfirmation)}
                >
                  Update project
                </button>
              </div>
            </section>
          </div>
        )}

        {projectValueConfirmation && (
          <div className="modal-overlay scope-choice-overlay" onClick={() => setProjectValueConfirmation(null)}>
            <section
              className="scope-choice-modal project-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm project value update"
              onClick={(event) => event.stopPropagation()}
            >
              <h4>Update project value?</h4>
              <p className="scope-choice-copy">
                You&apos;re changing the <strong>{projectValueConfirmation.projectName}</strong> project.
              </p>
              <p className="scope-choice-copy">
                <strong>{getActiveProjectTaskCount(projectValueConfirmation.savePatch)}</strong>{' '}
                {getActiveProjectTaskCount(projectValueConfirmation.savePatch) === 1 ? 'task' : 'tasks'} connected to
                this project will now display <strong>{formatProjectValue(projectValueConfirmation.projectValue)}</strong>{' '}
                as the project value.
              </p>
              <div className="scope-choice-actions scope-choice-actions-inline">
                <button onClick={() => setProjectValueConfirmation(null)}>Cancel</button>
                <button
                  className="success"
                  onClick={() => continueProjectValueSaveFlow(projectValueConfirmation)}
                >
                  Update project
                </button>
              </div>
            </section>
          </div>
        )}

        {projectPriorityConfirmation && (
          <div className="modal-overlay scope-choice-overlay" onClick={() => setProjectPriorityConfirmation(null)}>
            <section
              className="scope-choice-modal project-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm project priority update"
              onClick={(event) => event.stopPropagation()}
            >
              <h4>Update project priority?</h4>
              <p className="scope-choice-copy">
                You&apos;re changing priority signals for <strong>{projectPriorityConfirmation.projectName}</strong>.
              </p>
              <p className="scope-choice-copy">
                <strong>{getActiveProjectTaskCount(projectPriorityConfirmation.savePatch)}</strong>{' '}
                {getActiveProjectTaskCount(projectPriorityConfirmation.savePatch) === 1 ? 'task' : 'tasks'} connected to
                this project will now use{' '}
                <strong>
                  {formatProjectPrioritySignals(
                    projectPriorityConfirmation.urgent,
                    projectPriorityConfirmation.important,
                  )}
                </strong>
                .
              </p>
              <div className="scope-choice-actions scope-choice-actions-inline">
                <button onClick={() => setProjectPriorityConfirmation(null)}>Cancel</button>
                <button
                  className="success"
                  onClick={() => continueProjectPrioritySaveFlow(projectPriorityConfirmation)}
                >
                  Update project
                </button>
              </div>
            </section>
          </div>
        )}

        {repeatScheduleNoticeOpen && (
          <div className="modal-overlay scope-choice-overlay" onClick={() => setRepeatScheduleNoticeOpen(false)}>
            <section
              className="scope-choice-modal project-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Schedule first repeat instance"
              onClick={(event) => event.stopPropagation()}
            >
              <h4>Schedule the first instance first</h4>
              <p className="scope-choice-copy">
                Please move this task onto the timeline first to schedule the first instance. After that, open the
                task again and turn on repeat settings.
              </p>
              <div className="scope-choice-actions scope-choice-actions-inline">
                <button
                  className="success"
                  onClick={() => setRepeatScheduleNoticeOpen(false)}
                >
                  Okay
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
