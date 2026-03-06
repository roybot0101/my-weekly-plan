import { type MouseEvent, type PointerEvent } from 'react';
import { CalendarCheck, FileText, FolderClock, FolderHeart, GripVertical, Link2, Paperclip, Repeat2 } from 'lucide-react';
import { type Task } from '../types';

type TaskCardProps = {
  task: Task;
  compact?: boolean;
  showDuration?: boolean;
  showMeta?: boolean;
  showIndicators?: boolean;
  scheduleBadge?: string;
  scheduleTooltip?: string;
  resizable?: boolean;
  onToggleComplete: () => void;
  onOpenDetails: () => void;
  onHandlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  isDragging?: boolean;
};

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  const rounded = Number(hours.toFixed(2));
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}h`;
}

function statusClass(status: Task['status']) {
  if (status === 'In Progress') return 'status-in-progress';
  if (status === 'Blocked') return 'status-blocked';
  if (status === 'In Review') return 'status-in-review';
  if (status === 'Done') return 'status-done';
  return 'status-not-started';
}

function duePill(dueDate: string) {
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.round((dueStart.getTime() - todayStart.getTime()) / msPerDay);
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  }).format(dueStart);

  return {
    label: `${days} days`,
    tooltip: `Due on ${formatted}.`,
    isSoon: days <= 2,
  };
}

export function TaskCard({
  task,
  compact,
  showDuration = true,
  showMeta = true,
  showIndicators = false,
  scheduleBadge,
  scheduleTooltip,
  resizable,
  onToggleComplete,
  onOpenDetails,
  onHandlePointerDown,
  onResizeMouseDown,
  isDragging,
}: TaskCardProps) {
  const hasNotes = task.notes.trim().length > 0;
  const hasLinks = task.links.length > 0;
  const hasAttachments = task.attachments.length > 0;
  const isRepeating = Boolean(task.repeat?.enabled || task.repeatParentId);
  const due = task.dueDate ? duePill(task.dueDate) : null;

  return (
    <article
      className={`task-card ${statusClass(task.status)} ${task.completed ? 'done' : ''} ${compact ? 'compact' : ''} ${isDragging ? 'drag-origin' : ''}`}
    >
      <div
        className="task-body"
        role="button"
        tabIndex={0}
        aria-label={`Open details for ${task.title}`}
        onClick={onOpenDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenDetails();
          }
        }}
      >
        <input
          className="task-check"
          type="checkbox"
          checked={task.completed}
          aria-label={`Mark ${task.title} complete`}
          onChange={(event) => {
            event.stopPropagation();
            onToggleComplete();
          }}
          onClick={(event) => event.stopPropagation()}
        />

        <div className="task-content">
          <h4 className="task-title">{task.title}</h4>

          {showIndicators && (hasNotes || hasLinks || hasAttachments || isRepeating) && (
            <div className="task-indicators" aria-label="Task details indicators">
              {hasNotes && (
                <span title="Has notes" aria-label="Has notes">
                  <FileText size={12} />
                </span>
              )}
              {hasLinks && (
                <span title="Has links" aria-label="Has links">
                  <Link2 size={12} />
                </span>
              )}
              {hasAttachments && (
                <span title="Has attachments" aria-label="Has attachments">
                  <Paperclip size={12} />
                </span>
              )}
              {isRepeating && (
                <span title="Repeats" aria-label="Repeats">
                  <Repeat2 size={12} />
                </span>
              )}
            </div>
          )}

          {showMeta && (
            <div className="task-meta">
              {scheduleBadge && (
                <span
                  className="flag schedule"
                  title={scheduleTooltip || `Scheduled ${scheduleBadge}`}
                  aria-label={scheduleTooltip || `Scheduled ${scheduleBadge}`}
                >
                  <CalendarCheck size={12} />
                  {scheduleBadge}
                </span>
              )}
              {due && (
                <span className={due.isSoon ? 'flag due-soon' : ''} title={due.tooltip} aria-label={due.tooltip}>
                  {due.label}
                </span>
              )}
              {task.urgent && (
                <span className="flag urgent meta-icon-pill" title="Urgent" aria-label="Urgent">
                  <FolderClock size={12} />
                </span>
              )}
              {task.important && (
                <span className="flag important meta-icon-pill" title="Important" aria-label="Important">
                  <FolderHeart size={12} />
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className={`drag-handle ${showDuration ? '' : 'no-duration'}`}
        role="button"
        tabIndex={0}
        aria-label={`Drag ${task.title}`}
        onPointerDown={(event) => {
          event.stopPropagation();
          onHandlePointerDown(event);
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {showDuration && <span className="drag-duration-pill">{durationLabel(task.duration)}</span>}
        <span className="drag-grip" aria-hidden="true">
          <GripVertical size={16} strokeWidth={2.2} />
        </span>
      </div>
      {resizable && onResizeMouseDown && (
        <div
          className="resize-handle"
          role="button"
          tabIndex={0}
          aria-label={`Resize ${task.title}`}
          onMouseDown={(event) => {
            event.stopPropagation();
            onResizeMouseDown(event);
          }}
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </article>
  );
}
