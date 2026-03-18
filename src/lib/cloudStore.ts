import { nowWeekStartKey } from './dateTime';
import { supabase } from './supabase';
import { localTimezone, type Task, type TaskRepeat, type WorkBlock } from '../types';

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  client: string | null;
  activity: Task['activity'] | 'Meet' | null;
  planning_source: Task['planningSource'] | null;
  project_value: string | null;
  completed: boolean;
  duration: number;
  due_date: string | null;
  project_deadline: string | null;
  urgent: boolean;
  important: boolean;
  notes: string;
  links: string[] | null;
  attachments: Task['attachments'] | null;
  status: Task['status'];
  scheduled: Task['scheduled'] | null;
  repeat_config: Task['repeat'] | null;
  repeat_parent_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  user_id: string;
  selected_week_start: string;
  backlog_order?: string[] | null;
  kanban_order?: string[] | null;
  timezone?: string | null;
  work_blocks?: WorkBlock[] | null;
};

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

function isMissingRepeatColumns(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === '42703' ||
    message.includes('repeat_config') ||
    message.includes('repeat_parent_id')
  );
}

function buildMissingRepeatColumnsError() {
  return new Error(
    'Recurring tasks need the `repeat_config` and `repeat_parent_id` columns in Supabase. Run the tasks migration SQL, then try again.',
  );
}

function stripMissingRepeatColumns<T extends Record<string, unknown>>(
  payload: T,
  error: { code?: string; message?: string } | null | undefined,
): T {
  if (!error || !isMissingRepeatColumns(error)) return payload;
  const message = (error.message ?? '').toLowerCase();
  const nextPayload = { ...payload };
  const stripAll = error.code === '42703' && !message.includes('repeat_config') && !message.includes('repeat_parent_id');
  if (stripAll || message.includes('repeat_config')) delete nextPayload.repeat_config;
  if (stripAll || message.includes('repeat_parent_id')) delete nextPayload.repeat_parent_id;
  return nextPayload;
}

type MissingTaskDetailColumns = {
  client: boolean;
  activity: boolean;
  planningSource: boolean;
  projectDeadline: boolean;
  projectValue: boolean;
};

function getMissingTaskDetailColumns(error: { code?: string; message?: string } | null | undefined): MissingTaskDetailColumns | null {
  if (!error) return null;
  const message = (error.message ?? '').toLowerCase();
  const matched = {
    client: message.includes('client'),
    activity: message.includes('activity'),
    planningSource: message.includes('planning_source'),
    projectDeadline: message.includes('project_deadline'),
    projectValue: message.includes('project_value'),
  };

  if (Object.values(matched).some(Boolean)) return matched;
  if (error.code !== '42703') return null;

  return {
    client: true,
    activity: true,
    planningSource: true,
    projectDeadline: true,
    projectValue: true,
  };
}

function isMissingTaskDetailColumns(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(getMissingTaskDetailColumns(error));
}

function isMissingProfileSettingsColumns(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return error.code === '42703' || message.includes('timezone') || message.includes('work_blocks');
}

function normalizeWorkBlocks(value: unknown): WorkBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { start?: unknown; end?: unknown } => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      start: typeof entry.start === 'string' ? entry.start : '',
      end: typeof entry.end === 'string' ? entry.end : '',
    }))
    .filter((block) => block.start && block.end);
}

function rowToTask(row: TaskRow): Task {
  const normalizedActivity = row.activity === 'Meet' ? 'Outreach' : (row.activity ?? '');
  return {
    id: row.id,
    title: row.title,
    client: row.client ?? '',
    activity: normalizedActivity,
    planningSource: row.planning_source ?? undefined,
    projectValue: row.project_value ?? '',
    completed: row.completed,
    duration: row.duration as Task['duration'],
    dueDate: row.due_date ?? '',
    projectDeadline: row.project_deadline ?? '',
    urgent: row.urgent,
    important: row.important,
    notes: row.notes,
    links: row.links ?? [],
    attachments: row.attachments ?? [],
    status: row.status,
    scheduled: row.scheduled ?? undefined,
    repeat: row.repeat_config ?? undefined,
    repeatParentId: row.repeat_parent_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applyTaskDetailFallback(
  task: Task,
  fallback: {
    client?: string | null;
    activity?: Task['activity'] | null;
    planningSource?: Task['planningSource'] | null;
    projectDeadline?: string | null;
    projectValue?: string | null;
  },
): Task {
  const nextTask = { ...task };
  if ('client' in fallback) nextTask.client = fallback.client ?? '';
  if ('activity' in fallback) nextTask.activity = fallback.activity ?? '';
  if ('planningSource' in fallback) nextTask.planningSource = fallback.planningSource ?? undefined;
  if ('projectDeadline' in fallback) nextTask.projectDeadline = fallback.projectDeadline ?? '';
  if ('projectValue' in fallback) nextTask.projectValue = fallback.projectValue ?? '';
  return nextTask;
}

function stripMissingTaskDetailColumns<T extends Record<string, unknown>>(
  payload: T,
  missingColumns: MissingTaskDetailColumns | null,
): T {
  if (!missingColumns) return payload;
  const nextPayload = { ...payload };
  if (missingColumns.client) delete nextPayload.client;
  if (missingColumns.activity) delete nextPayload.activity;
  if (missingColumns.planningSource) delete nextPayload.planning_source;
  if (missingColumns.projectDeadline) delete nextPayload.project_deadline;
  if (missingColumns.projectValue) delete nextPayload.project_value;
  return nextPayload;
}

function pickStrippedTaskDetailFallback(
  missingColumns: MissingTaskDetailColumns | null,
  values: {
    client?: string | null;
    activity?: Task['activity'] | null;
    planningSource?: Task['planningSource'] | null;
    projectDeadline?: string | null;
    projectValue?: string | null;
  },
) {
  const fallback: {
    client?: string | null;
    activity?: Task['activity'] | null;
    planningSource?: Task['planningSource'] | null;
    projectDeadline?: string | null;
    projectValue?: string | null;
  } = {};

  if (missingColumns?.client) fallback.client = values.client ?? null;
  if (missingColumns?.activity) fallback.activity = values.activity ?? null;
  if (missingColumns?.planningSource) fallback.planningSource = values.planningSource ?? null;
  if (missingColumns?.projectDeadline) fallback.projectDeadline = values.projectDeadline ?? null;
  if (missingColumns?.projectValue) fallback.projectValue = values.projectValue ?? null;

  return fallback;
}

function taskPatchToRowPatch(patch: Partial<Task>) {
  const rowPatch: Record<string, unknown> = {};

  if (patch.title !== undefined) rowPatch.title = patch.title;
  if (patch.client !== undefined) rowPatch.client = patch.client;
  if (patch.activity !== undefined) rowPatch.activity = patch.activity;
  if ('planningSource' in patch) rowPatch.planning_source = patch.planningSource ?? null;
  if (patch.projectValue !== undefined) rowPatch.project_value = patch.projectValue || null;
  if (patch.completed !== undefined) rowPatch.completed = patch.completed;
  if (patch.duration !== undefined) rowPatch.duration = patch.duration;
  if (patch.dueDate !== undefined) rowPatch.due_date = patch.dueDate || null;
  if (patch.projectDeadline !== undefined) rowPatch.project_deadline = patch.projectDeadline || null;
  if (patch.urgent !== undefined) rowPatch.urgent = patch.urgent;
  if (patch.important !== undefined) rowPatch.important = patch.important;
  if (patch.notes !== undefined) rowPatch.notes = patch.notes;
  if (patch.links !== undefined) rowPatch.links = patch.links;
  if (patch.attachments !== undefined) rowPatch.attachments = patch.attachments;
  if (patch.status !== undefined) rowPatch.status = patch.status;
  if ('scheduled' in patch) rowPatch.scheduled = patch.scheduled ?? null;
  if ('repeat' in patch) rowPatch.repeat_config = patch.repeat ?? null;
  if ('repeatParentId' in patch) rowPatch.repeat_parent_id = patch.repeatParentId ?? null;

  return rowPatch;
}

function randomUuidFallback() {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function getSessionUser() {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('auth session missing')) {
      return null;
    }
    throw error;
  }
  return data.user;
}

export function onAuthStateChange(callback: (event: string) => void) {
  const client = requireClient();
  const { data } = client.auth.onAuthStateChange((event) => callback(event));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const client = requireClient();
  const { error } = await client.auth.signUp({ email, password });
  if (error) throw error;
}

export async function resendConfirmationEmail(email: string) {
  const client = requireClient();
  const { error } = await client.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
    },
  });
  if (error) throw error;
}

export async function signInWithOAuth(provider: 'google' | 'facebook') {
  const client = requireClient();
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function changePassword(password: string) {
  const client = requireClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function deleteAccount() {
  const client = requireClient();
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) {
    throw new Error('No active session found.');
  }

  const response = await fetch('/api/delete-account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Failed to delete account.');
  }

  await client.auth.signOut().catch(() => undefined);
}

export async function loadPlannerData(userId: string) {
  const client = requireClient();

  const { data: profileData, error: profileError } = await client
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

  const selectedWeekStart = profileData?.selected_week_start ?? nowWeekStartKey();
  const backlogOrder = Array.isArray(profileData?.backlog_order) ? profileData.backlog_order : [];
  const kanbanOrder = Array.isArray(profileData?.kanban_order) ? profileData.kanban_order : [];
  const timezone =
    typeof profileData?.timezone === 'string' && profileData.timezone.trim()
      ? profileData.timezone
      : localTimezone();
  const workBlocks = normalizeWorkBlocks(profileData?.work_blocks);

  if (!profileData) {
    const payload = {
      user_id: userId,
      selected_week_start: selectedWeekStart,
    } satisfies Pick<ProfileRow, 'user_id' | 'selected_week_start'>;

    const { error: upsertError } = await client.from('profiles').upsert(payload);

    if (upsertError) throw upsertError;
  }

  const { data: taskRows, error: taskError } = await client
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (taskError) throw taskError;

  const tasks = ((taskRows ?? []) as TaskRow[]).map(rowToTask);

  return { selectedWeekStart, backlogOrder, kanbanOrder, timezone, workBlocks, tasks };
}

export async function updateSelectedWeekStart(userId: string, selectedWeekStart: string, backlogOrder: string[]) {
  const client = requireClient();

  const { error } = await client.from('profiles').upsert({
    user_id: userId,
    selected_week_start: selectedWeekStart,
  } satisfies ProfileRow);

  if (error) throw error;
}

export async function updateBacklogOrder(userId: string, backlogOrder: string[], selectedWeekStart: string) {
  const client = requireClient();
  const { error } = await client.from('profiles').upsert({
    user_id: userId,
    selected_week_start: selectedWeekStart,
    backlog_order: backlogOrder,
  } satisfies ProfileRow);

  if (error) {
    const missingColumn = error.code === '42703' || error.message.toLowerCase().includes('backlog_order');
    if (missingColumn) return;
    throw error;
  }
}

export async function updateKanbanOrder(userId: string, kanbanOrder: string[], selectedWeekStart: string) {
  const client = requireClient();
  const { error } = await client.from('profiles').upsert({
    user_id: userId,
    selected_week_start: selectedWeekStart,
    kanban_order: kanbanOrder,
  } satisfies ProfileRow);

  if (error) {
    const missingColumn = error.code === '42703' || error.message.toLowerCase().includes('kanban_order');
    if (missingColumn) return;
    throw error;
  }
}

export async function updateUserSettings(
  userId: string,
  settings: { timezone: string; workBlocks: WorkBlock[] },
  selectedWeekStart: string,
) {
  const client = requireClient();
  const payload = {
    user_id: userId,
    selected_week_start: selectedWeekStart,
    timezone: settings.timezone,
    work_blocks: settings.workBlocks,
  } satisfies ProfileRow;

  let { error } = await client.from('profiles').upsert(payload);

  if (error && isMissingProfileSettingsColumns(error)) {
    const message = error.message.toLowerCase();
    const retryPayload: Record<string, unknown> = {
      user_id: userId,
      selected_week_start: selectedWeekStart,
    };

    if (!message.includes('timezone')) retryPayload.timezone = settings.timezone;
    if (!message.includes('work_blocks')) retryPayload.work_blocks = settings.workBlocks;

    const retry = await client.from('profiles').upsert(retryPayload);
    error = retry.error;
  }

  if (error) throw error;
}

export async function createTask(userId: string, title: string): Promise<Task> {
  const client = requireClient();

  const now = new Date().toISOString();
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomUuidFallback();

  const baseRow = {
    id,
    user_id: userId,
    title,
    client: '',
    activity: '' as Task['activity'],
    planning_source: null as Task['planningSource'] | null,
    project_value: null,
    completed: false,
    duration: 60,
    due_date: null,
    project_deadline: null,
    urgent: false,
    important: false,
    notes: '',
    links: [],
    attachments: [],
    status: 'Not Started',
    scheduled: null,
    created_at: now,
    updated_at: now,
  };

  const insertRow = {
    ...baseRow,
    repeat_config: null,
    repeat_parent_id: null,
  };

  let { data, error } = await client
    .from('tasks')
    .insert(insertRow)
    .select('*')
    .single();

  // Backward-compatible path: allow task creation before repeat columns are migrated.
  if (error && (isMissingRepeatColumns(error) || isMissingTaskDetailColumns(error))) {
    const missingTaskDetailColumns = getMissingTaskDetailColumns(error);
    let retryRow: Record<string, unknown> = stripMissingTaskDetailColumns(insertRow, missingTaskDetailColumns);
    if (isMissingRepeatColumns(error)) {
      const { repeat_config: _repeatConfig, repeat_parent_id: _repeatParentId, ...legacyRetryRow } = retryRow;
      retryRow = legacyRetryRow;
    }
    const retry = await client.from('tasks').insert(retryRow).select('*').single();
    data = retry.data;
    error = retry.error;
    if (!error) {
      const task = rowToTask(data as TaskRow);
      return missingTaskDetailColumns
        ? applyTaskDetailFallback(
            task,
            pickStrippedTaskDetailFallback(missingTaskDetailColumns, {
              client: insertRow.client,
              activity: insertRow.activity,
              planningSource: insertRow.planning_source,
              projectDeadline: insertRow.project_deadline,
              projectValue: insertRow.project_value,
            }),
          )
        : task;
    }
  }

  if (error) throw error;
  return rowToTask(data as TaskRow);
}

export async function updateTask(userId: string, taskId: string, patch: Partial<Task>): Promise<Task> {
  const client = requireClient();
  const rowPatch: Record<string, unknown> = { ...taskPatchToRowPatch(patch), updated_at: new Date().toISOString() };
  const touchesRepeatColumns =
    Object.prototype.hasOwnProperty.call(patch, 'repeat') || Object.prototype.hasOwnProperty.call(patch, 'repeatParentId');

  let { data, error } = await client
    .from('tasks')
    .update(rowPatch)
    .eq('user_id', userId)
    .eq('id', taskId)
    .select('*')
    .single();

  if (error && (isMissingTaskDetailColumns(error) || isMissingRepeatColumns(error))) {
    if (touchesRepeatColumns && isMissingRepeatColumns(error)) {
      throw buildMissingRepeatColumnsError();
    }
    const missingTaskDetailColumns = getMissingTaskDetailColumns(error);
    const legacyRowPatch = stripMissingRepeatColumns(
      stripMissingTaskDetailColumns(rowPatch, missingTaskDetailColumns),
      error,
    );
    const retry = await client
      .from('tasks')
      .update(legacyRowPatch)
      .eq('user_id', userId)
      .eq('id', taskId)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
    if (!error) {
      return applyTaskDetailFallback(
        rowToTask(data as TaskRow),
        pickStrippedTaskDetailFallback(missingTaskDetailColumns, {
          client: patch.client,
          activity: patch.activity,
          planningSource: 'planningSource' in patch ? (patch.planningSource ?? null) : undefined,
          projectDeadline: patch.projectDeadline,
          projectValue: patch.projectValue,
        }),
      );
    }
  }

  if (error) throw error;
  return rowToTask(data as TaskRow);
}

export async function createRepeatTemplate(userId: string, source: Task, repeat: TaskRepeat): Promise<Task> {
  const client = requireClient();
  const now = new Date().toISOString();
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomUuidFallback();

  const insertRow = {
    id,
    user_id: userId,
    title: source.title,
    client: source.client,
    activity: source.activity,
    planning_source: null,
    project_value: source.projectValue || null,
    completed: false,
    duration: source.duration,
    due_date: source.dueDate || null,
    project_deadline: source.projectDeadline || null,
    urgent: source.urgent,
    important: source.important,
    notes: source.notes,
    links: source.links,
    attachments: source.attachments,
    status: source.status === 'Done' ? 'Not Started' : source.status,
    scheduled: null,
    repeat_config: repeat,
    repeat_parent_id: null,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await client
    .from('tasks')
    .insert(insertRow)
    .select('*')
    .single();

  if (error && isMissingRepeatColumns(error)) {
    throw buildMissingRepeatColumnsError();
  }

  if (error && isMissingTaskDetailColumns(error)) {
    const missingTaskDetailColumns = getMissingTaskDetailColumns(error);
    let retryRow: Record<string, unknown> = stripMissingTaskDetailColumns(insertRow, missingTaskDetailColumns);
    const retry = await client
      .from('tasks')
      .insert(retryRow)
      .select('*')
      .single();
    if (retry.error) throw retry.error;
    const task = rowToTask(retry.data as TaskRow);
    return missingTaskDetailColumns
      ? applyTaskDetailFallback(
          task,
          pickStrippedTaskDetailFallback(missingTaskDetailColumns, {
            client: insertRow.client,
            activity: insertRow.activity,
            planningSource: insertRow.planning_source,
            projectDeadline: insertRow.project_deadline,
            projectValue: insertRow.project_value,
          }),
        )
      : task;
  }
  if (error) throw error;
  return rowToTask(data as TaskRow);
}

export async function ensureRepeatingTasksForWeek(userId: string, weekKey: string, tasks: Task[]): Promise<Task[]> {
  const client = requireClient();

  const templates = tasks.filter((task) => task.repeat?.enabled && !task.repeatParentId);
  if (templates.length === 0) return [];

  const now = new Date().toISOString();
  const createdTasks: Task[] = [];

  for (const template of templates) {
    const repeat = template.repeat;
    if (!repeat || !repeat.enabled || repeat.days.length === 0) continue;

    const existingInstances = tasks.filter(
      (task) => task.repeatParentId === template.id && task.scheduled?.weekKey === weekKey,
    );

    const compareRepeatPosition = (leftDayIndex: number, rightWeekKey: string, rightDayIndex: number) => {
      if (weekKey !== rightWeekKey) return weekKey.localeCompare(rightWeekKey);
      return leftDayIndex - rightDayIndex;
    };
    const eligibleDays = repeat.days
      .filter((day) => day >= 0 && day <= 6)
      .filter((day) => {
        if (repeat.startWeekKey && Number.isFinite(repeat.startDayIndex)) {
          return compareRepeatPosition(day, repeat.startWeekKey, repeat.startDayIndex as number) >= 0;
        }
        return true;
      })
      .filter((day) => {
        if (repeat.endWeekKey && Number.isFinite(repeat.endDayIndex)) {
          return compareRepeatPosition(day, repeat.endWeekKey, repeat.endDayIndex as number) < 0;
        }
        return true;
      });

    const targetCount = eligibleDays.length;
    if (existingInstances.length >= targetCount) continue;

    const existingDaySet = new Set(existingInstances.map((task) => task.scheduled?.dayIndex).filter(Number.isFinite));
    const daysToCreate = eligibleDays
      .filter((day) => !existingDaySet.has(day))
      .slice(0, targetCount - existingInstances.length);

    if (daysToCreate.length === 0) continue;

    const rowsToInsert = daysToCreate.map((day) => {
      const perDaySlot = repeat.sameTimeEveryDay === false ? repeat.daySlots?.[day] : undefined;
      const slot = Number.isFinite(perDaySlot as number) ? (perDaySlot as number) : repeat.slot;
      return {
        user_id: userId,
        title: template.title,
        client: template.client,
        activity: template.activity,
        planning_source: null,
        project_value: template.projectValue || null,
        completed: false,
        duration: template.duration,
        due_date: template.dueDate || null,
        project_deadline: template.projectDeadline || null,
        urgent: template.urgent,
        important: template.important,
        notes: template.notes,
        links: template.links,
        attachments: template.attachments,
        status: template.status === 'Done' ? 'Not Started' : template.status,
        scheduled: {
          weekKey,
          dayIndex: day,
          slot,
          timezone: repeat.timezone || localTimezone(),
        },
        repeat_config: null,
        repeat_parent_id: template.id,
        created_at: now,
        updated_at: now,
      };
    });

    let usedLegacyRows = false;
    let missingTaskDetailColumns: MissingTaskDetailColumns | null = null;
    let { data, error } = await client.from('tasks').insert(rowsToInsert).select('*');
    if (error && isMissingRepeatColumns(error)) {
      throw buildMissingRepeatColumnsError();
    }
    if (error && isMissingTaskDetailColumns(error)) {
      missingTaskDetailColumns = getMissingTaskDetailColumns(error);
      let legacyRows: Record<string, unknown>[] = rowsToInsert.map((row) =>
        stripMissingTaskDetailColumns(row, missingTaskDetailColumns),
      );
      const retry = await client.from('tasks').insert(legacyRows).select('*');
      data = retry.data;
      error = retry.error;
      usedLegacyRows = !retry.error;
    }
    if (error) throw error;
    const nextTasks = ((data ?? []) as TaskRow[]).map((row, index) =>
      usedLegacyRows
        ? applyTaskDetailFallback(
            rowToTask(row),
            pickStrippedTaskDetailFallback(missingTaskDetailColumns, {
              client: rowsToInsert[index].client,
              activity: rowsToInsert[index].activity,
              planningSource: rowsToInsert[index].planning_source,
              projectDeadline: rowsToInsert[index].project_deadline,
              projectValue: rowsToInsert[index].project_value,
            }),
          )
        : rowToTask(row),
    );
    createdTasks.push(...nextTasks);
  }

  return createdTasks;
}

export async function deleteTask(userId: string, taskId: string) {
  const client = requireClient();
  const { error } = await client.from('tasks').delete().eq('user_id', userId).eq('id', taskId);
  if (error) throw error;
}

export function makeScheduled(weekKey: string, dayIndex: number, slot: number): NonNullable<Task['scheduled']> {
  return {
    weekKey,
    dayIndex,
    slot,
    timezone: localTimezone(),
  };
}
