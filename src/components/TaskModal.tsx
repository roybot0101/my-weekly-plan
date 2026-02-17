import { useState } from 'react';
import { DURATIONS, STATUS_ORDER, type Task, type TaskStatus, uid } from '../types';

type TaskModalProps = {
  task: Task;
  onClose: () => void;
  onSave: (patch: Partial<Task>) => void;
  onDelete: () => void;
};

export function TaskModal({ task, onClose, onSave, onDelete }: TaskModalProps) {
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
        <select value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) as Task['duration'] })}>
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
