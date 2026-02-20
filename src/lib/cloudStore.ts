import { nowWeekStartKey } from './dateTime';
import { supabase } from './supabase';
import { localTimezone, type Task } from '../types';

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  completed: boolean;
  duration: number;
  due_date: string | null;
  urgent: boolean;
  important: boolean;
  notes: string;
  links: string[] | null;
  attachments: Task['attachments'] | null;
  status: Task['status'];
  scheduled: Task['scheduled'] | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  user_id: string;
  selected_week_start: string;
  backlog_order?: string[] | null;
  kanban_order?: string[] | null;
};

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    duration: row.duration as Task['duration'],
    dueDate: row.due_date ?? '',
    urgent: row.urgent,
    important: row.important,
    notes: row.notes,
    links: row.links ?? [],
    attachments: row.attachments ?? [],
    status: row.status,
    scheduled: row.scheduled ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskPatchToRowPatch(patch: Partial<Task>) {
  const rowPatch: Record<string, unknown> = {};

  if (patch.title !== undefined) rowPatch.title = patch.title;
  if (patch.completed !== undefined) rowPatch.completed = patch.completed;
  if (patch.duration !== undefined) rowPatch.duration = patch.duration;
  if (patch.dueDate !== undefined) rowPatch.due_date = patch.dueDate || null;
  if (patch.urgent !== undefined) rowPatch.urgent = patch.urgent;
  if (patch.important !== undefined) rowPatch.important = patch.important;
  if (patch.notes !== undefined) rowPatch.notes = patch.notes;
  if (patch.links !== undefined) rowPatch.links = patch.links;
  if (patch.attachments !== undefined) rowPatch.attachments = patch.attachments;
  if (patch.status !== undefined) rowPatch.status = patch.status;
  if ('scheduled' in patch) rowPatch.scheduled = patch.scheduled ?? null;

  return rowPatch;
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

export function onAuthStateChange(callback: () => void) {
  const client = requireClient();
  const { data } = client.auth.onAuthStateChange(() => callback());
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

export async function loadPlannerData(userId: string) {
  const client = requireClient();

  let profileData: ProfileRow | null = null;
  let supportsBacklogOrder = true;
  let supportsKanbanOrder = true;

  const withOrders = await client
    .from('profiles')
    .select('user_id, selected_week_start, backlog_order, kanban_order')
    .eq('user_id', userId)
    .maybeSingle();

  if (withOrders.error) {
    const missingColumn =
      withOrders.error.code === '42703' ||
      withOrders.error.message.toLowerCase().includes('backlog_order') ||
      withOrders.error.message.toLowerCase().includes('kanban_order');

    if (!missingColumn) throw withOrders.error;

    supportsKanbanOrder = false;
    const fallback = await client
      .from('profiles')
      .select('user_id, selected_week_start, backlog_order')
      .eq('user_id', userId)
      .maybeSingle();

    if (fallback.error) {
      const missingBacklog =
        fallback.error.code === '42703' || fallback.error.message.toLowerCase().includes('backlog_order');

      if (!missingBacklog) throw fallback.error;

      supportsBacklogOrder = false;
      const legacyFallback = await client
        .from('profiles')
        .select('user_id, selected_week_start')
        .eq('user_id', userId)
        .maybeSingle();

      if (legacyFallback.error) throw legacyFallback.error;
      profileData = legacyFallback.data as ProfileRow | null;
    } else {
      profileData = fallback.data as ProfileRow | null;
    }
  } else {
    profileData = withOrders.data as ProfileRow | null;
  }

  const selectedWeekStart = profileData?.selected_week_start ?? nowWeekStartKey();
  const backlogOrder = supportsBacklogOrder ? profileData?.backlog_order ?? [] : [];
  const kanbanOrder = supportsKanbanOrder ? profileData?.kanban_order ?? [] : [];

  if (!profileData) {
    const payload: ProfileRow = {
      user_id: userId,
      selected_week_start: selectedWeekStart,
    };
    if (supportsBacklogOrder) payload.backlog_order = [];
    if (supportsKanbanOrder) payload.kanban_order = [];

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

  return { selectedWeekStart, backlogOrder, kanbanOrder, tasks };
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

export async function createTask(userId: string, title: string): Promise<Task> {
  const client = requireClient();

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const { data, error } = await client
    .from('tasks')
    .insert({
      id,
      user_id: userId,
      title,
      completed: false,
      duration: 30,
      due_date: null,
      urgent: false,
      important: false,
      notes: '',
      links: [],
      attachments: [],
      status: 'Not Started',
      scheduled: null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error) throw error;
  return rowToTask(data as TaskRow);
}

export async function updateTask(userId: string, taskId: string, patch: Partial<Task>): Promise<Task> {
  const client = requireClient();

  const { data, error } = await client
    .from('tasks')
    .update({ ...taskPatchToRowPatch(patch), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', taskId)
    .select('*')
    .single();

  if (error) throw error;
  return rowToTask(data as TaskRow);
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
