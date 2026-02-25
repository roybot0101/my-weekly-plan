import { type MouseEvent, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { type Task } from '../types';

type TaskCardProps = {
  task: Task;
  compact?: boolean;
  showDuration?: boolean;
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

export function TaskCard({
  task,
  compact,
  showDuration = true,
  resizable,
  onToggleComplete,
  onOpenDetails,
  onHandlePointerDown,
  onResizeMouseDown,
  isDragging,
}: TaskCardProps) {
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

          <div className="task-meta">
            {task.dueDate && <span>Due {task.dueDate}</span>}
            {task.urgent && <span className="flag urgent">Urgent</span>}
            {task.important && <span className="flag important">Important</span>}
          </div>
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
