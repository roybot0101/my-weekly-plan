import { useRef, useState } from 'react';
import { Check, Link2, Paperclip, Trash2, X } from 'lucide-react';
import { DURATIONS, STATUS_ORDER, uid, type Duration, type Task, type TaskStatus } from '../types';

type TaskModalProps = {
  task: Task;
  onClose: () => void;
  onSave: (patch: Partial<Task>) => void;
  onDelete: () => void;
};

export function TaskModal({ task, onClose, onSave, onDelete }: TaskModalProps) {
  const [draft, setDraft] = useState<Task>(task);
  const [pendingLink, setPendingLink] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

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

        <label>
          Title
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>

        <div className="modal-grid-2">
          <label>
            Status
            <select
              value={draft.status}
              onChange={(event) => {
                const status = event.target.value as TaskStatus;
                setDraft({ ...draft, status, completed: status === 'Done' });
              }}
            >
              {STATUS_ORDER.map((status) => (
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
              {DURATIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {duration >= 60 ? `${duration / 60} hr` : `${duration} min`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Due Date
          <input
            type="date"
            value={draft.dueDate}
            onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
          />
        </label>

        <div className="modal-grid-2 checks">
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
              <div key={index} className="inline-row">
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
              <div className="link-entry-actions">
                <button
                  className="link-icon-button"
                  aria-label="Confirm link"
                  disabled={!pendingLink.trim()}
                  onClick={confirmPendingLink}
                >
                  <Check size={14} />
                </button>
                <button
                  className="link-icon-button"
                  aria-label="Clear link input"
                  disabled={!pendingLink}
                  onClick={() => setPendingLink('')}
                >
                  <X size={14} />
                </button>
              </div>
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
                <button className="icon-text-button" onClick={() => removeAttachment(attachment.id)}>
                  <X size={14} />
                  <span>Remove</span>
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

        <footer className="task-modal-footer">
          <button className="danger icon-text-button" onClick={onDelete}>
            <Trash2 size={15} />
            <span>Delete Task</span>
          </button>
          <button
            onClick={() => {
              onSave({
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
              });
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
