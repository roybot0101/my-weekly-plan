import { type DragEvent, useEffect, useState } from 'react';
import { type Task } from '../types';

type TaskCardProps = {
  task: Task;
  isEditing: boolean;
  onEditToggle: (on: boolean) => void;
  onTitleChange: (title: string) => void;
  onToggleComplete: () => void;
  onOpenDetails: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
};

export function TaskCard(props: TaskCardProps) {
  const { task, isEditing, onEditToggle, onTitleChange, onToggleComplete, onOpenDetails, onDragStart, onDragEnd } = props;
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
        onDragEnd={onDragEnd}
      >
        ⋮⋮
      </button>
    </article>
  );
}
