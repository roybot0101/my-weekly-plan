import { type MouseEvent, useEffect, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { type Task } from '../types';

type TaskCardProps = {
  task: Task;
  isTitleEditing: boolean;
  compact?: boolean;
  resizable?: boolean;
  onTitleEditToggle: (editing: boolean) => void;
  onTitleSave: (title: string) => void;
  onToggleComplete: () => void;
  onOpenDetails: () => void;
  onHandleMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onResizeMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  isDragging?: boolean;
};

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes / 60}h`;
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
  isTitleEditing,
  compact,
  resizable,
  onTitleEditToggle,
  onTitleSave,
  onToggleComplete,
  onOpenDetails,
  onHandleMouseDown,
  onResizeMouseDown,
  isDragging,
}: TaskCardProps) {
  const [draft, setDraft] = useState(task.title);

  useEffect(() => {
    setDraft(task.title);
  }, [task.title]);

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
          {isTitleEditing ? (
            <input
              className="task-title-input"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                const next = draft.trim() || task.title;
                onTitleSave(next);
                onTitleEditToggle(false);
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  const next = draft.trim() || task.title;
                  onTitleSave(next);
                  onTitleEditToggle(false);
                }
                if (event.key === 'Escape') {
                  setDraft(task.title);
                  onTitleEditToggle(false);
                }
              }}
            />
          ) : (
            <h4
              className="task-title"
              onClick={(event) => {
                event.stopPropagation();
                onTitleEditToggle(true);
              }}
            >
              {task.title}
            </h4>
          )}

          <div className="task-meta">
            {task.dueDate && <span>Due {task.dueDate}</span>}
            {task.urgent && <span className="flag urgent">Urgent</span>}
            {task.important && <span className="flag important">Important</span>}
          </div>
        </div>
      </div>

      <div
        className="drag-handle"
        role="button"
        tabIndex={0}
        aria-label={`Drag ${task.title}`}
        onMouseDown={(event) => {
          event.stopPropagation();
          onHandleMouseDown(event);
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="drag-duration-pill">{durationLabel(task.duration)}</span>
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
