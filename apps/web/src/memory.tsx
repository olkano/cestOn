import { useCallback, useEffect, useState } from 'react';
import type { MemoryEntry, MemoryNote, MemoryWrite } from '../../../packages/contracts/src/memory.js';
import { api, ApiError } from './api.js';

type Project = { id: string; displayName: string };
type Page = { entries: MemoryEntry[]; nextOffset: number | null };
const blankNote: MemoryNote = { text: '', projectId: null, relatedProjectId: null, importance: null, dueAt: null, reviewAt: null };

function localDate(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function isoDate(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function MemoryPanel({ projects, online, cursor, initialProject }: {
  projects: Project[]; online: boolean; cursor: number; initialProject?: string;
}) {
  const [draft, setDraft] = useState<MemoryWrite>(() => ({
    ...blankNote, projectId: initialProject ?? null, id: crypto.randomUUID(), revision: 0,
  }));
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(initialProject ?? '');
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [focus, setFocus] = useState<'all' | 'attention'>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [forgetting, setForgetting] = useState<MemoryEntry | null>(null);
  const [excluded, setExcluded] = useState<boolean | null>(null);
  const [folders, setFolders] = useState(projects);
  const [newFolder, setNewFolder] = useState('');
  useEffect(() => {
    if (!online) return;
    const control = new AbortController();
    void api<Project[]>('/memory/folders', { signal: control.signal }).then(setFolders).catch(() => {});
    return () => control.abort();
  }, [online, cursor]);
  const reset = () => setDraft({ ...blankNote, projectId: initialProject ?? null, id: crypto.randomUUID(), revision: 0 });
  const load = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ search, offset: String(offset), focus });
    if (filter) query.set('projectId', filter);
    const options = signal ? { signal } : {};
    const [next, scope] = await Promise.all([
      api<Page>('/memory?' + query, options),
      filter ? api<{ excluded: boolean }>('/memory/projects/' + filter, options) : null,
    ]);
    if (signal?.aborted) return;
    setPage(next);
    setExcluded(scope?.excluded ?? null);
  }, [filter, offset, search, focus]);
  useEffect(() => {
    const control = new AbortController();
    if (online) void load(control.signal).catch(() => {
      if (!control.signal.aborted) {
        setPage(null);
        setError('Could not load your notes. Try again when the PC is reachable.');
      }
    });
    return () => control.abort();
  }, [load, online, cursor]);
  async function change(action: () => Promise<unknown>, success: () => void, label: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      success();
      setMessage(label);
      await load();
    } catch (problem) {
      setError(problem instanceof ApiError && problem.status === 409
        ? 'This note or project changed. Reopen the latest note before editing.'
        : 'Could not finish. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  const labels = new Map(folders.map(project => [project.id, project.displayName]));
  const projectOptions = folders.map(project => <option key={project.id} value={project.id}>{project.displayName}</option>);
  const disabled = !online || busy;
  const results = page?.entries ?? [];
  const toReview = results.filter(note => note.needsReview);
  const important = results.filter(note => note.importance === 'high' && !note.needsReview);
  const urgent = results.filter(note => ['overdue', 'soon'].includes(note.urgency ?? '') && !note.needsReview);
  return <>
    <section className="card">
      <h2>{draft.revision ? 'Edit note' : 'Remember something'}</h2>
      <p>Save a decision, a connection between projects, or anything you want to pick up later.</p>
      <form className="composer" onSubmit={event => {
        event.preventDefault();
        if (disabled || !draft.text.trim()) return;
        void change(() => api('/memory', { method: 'POST', body: draft }), reset, 'Note saved.');
      }}>
        <label>Your note<textarea rows={3} maxLength={4000} required value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })}/></label>
        <details open={draft.revision ? true : undefined}>
          <summary>Project, connection or deadline (optional)</summary>
          <label>Project<select value={draft.projectId ?? ''} onChange={event => setDraft({ ...draft, projectId: event.target.value || null, relatedProjectId: null })}><option value="">No project yet</option>{projectOptions}</select></label>
          {draft.projectId && <label>Related project<select value={draft.relatedProjectId ?? ''} onChange={event => setDraft({ ...draft, relatedProjectId: event.target.value || null })}>
            <option value="">None</option>{folders.filter(project => project.id !== draft.projectId).map(project => <option key={project.id} value={project.id}>{project.displayName}</option>)}
          </select></label>}
          <label>Importance<select value={draft.importance ?? ''} onChange={event => setDraft({ ...draft, importance: (event.target.value || null) as MemoryNote['importance'] })}><option value="">Not set</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
          <label>Due<input type="datetime-local" value={localDate(draft.dueAt)} onChange={event => setDraft({ ...draft, dueAt: isoDate(event.target.value) })}/></label>
          <label>Review after<input type="datetime-local" value={localDate(draft.reviewAt)} onChange={event => setDraft({ ...draft, reviewAt: isoDate(event.target.value) })}/></label>
        </details>
        <div className="row"><button className="primary" disabled={disabled || !draft.text.trim()}>Save note</button>{draft.revision > 0 && <button type="button" onClick={reset}>Cancel edit</button>}</div>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="card">
      <h2>What cestOn remembers</h2>
      <div className="row">
        <button aria-pressed={focus === 'all'} onClick={() => { setOffset(0); setFocus('all'); }}>All notes</button>
        <button aria-pressed={focus === 'attention'} onClick={() => { setOffset(0); setFocus('attention'); }}>What needs attention?</button>
      </div>
      {focus === 'attention' && <p className="muted">Shows notes marked important, due within a day, overdue or ready to check again.</p>}
      <div className="row">
        <label>Search notes<input type="search" maxLength={200} value={search} onChange={event => { setOffset(0); setSearch(event.target.value); }}/></label>
        <label>Filter by project<select value={filter} onChange={event => { setOffset(0); setFilter(event.target.value); setExcluded(null); setNewFolder(''); }}><option value="">All projects and general notes</option>{projectOptions}</select></label>
      </div>
      {!online && <p role="status">Can’t reach your PC. Notes shown here may have changed.</p>}
      {filter && excluded !== null && <button disabled={disabled} onClick={() => {
        void change(() => api('/memory/projects/' + filter, { method: 'POST', body: { excluded: !excluded } }), () => {}, excluded ? 'Project notes are visible again.' : 'Project notes are hidden from memory searches.');
      }}>{excluded ? 'Show project notes again' : 'Hide this project from memory searches'}</button>}
      {filter && !projects.some(project => project.id === filter) && <details>
        <summary>This discovered folder moved</summary>
        <p>Choose its new folder to keep these notes and connections together.</p>
        <label>New folder<select value={newFolder} onChange={event => setNewFolder(event.target.value)}>
          <option value="">Choose the new folder</option>
          {folders.filter(folder => folder.id !== filter && !projects.some(project => project.id === folder.id)).map(folder => <option key={folder.id} value={folder.id}>{folder.displayName}</option>)}
        </select></label>
        <button disabled={disabled || !newFolder} onClick={() => {
          void change(() => api('/memory/folders/move', { method: 'POST', body: { from: filter, to: newFolder } }), () => setNewFolder(''), 'Folder updated. Your notes and connections are kept.');
        }}>Confirm folder move</button>
      </details>}
      {page && !results.length && <p>No notes match. Save something you want to remember above.</p>}
      {Boolean(important.length || urgent.length || toReview.length) && <p className="muted">On this page: {important.length} marked important, {urgent.length} due within a day or overdue, {toReview.length} to check again.</p>}
      {results.map(entry => <article className="phase" key={entry.id}>
        <p className="prose">{entry.text}</p>
        <p className="muted">{[entry.projectId ? labels.get(entry.projectId) : 'General', entry.relatedProjectId ? 'Linked to ' + labels.get(entry.relatedProjectId) : null, entry.source === 'you' ? 'Saved by you' : entry.source === 'observation' ? 'From verified work' : 'Suggested', new Date(entry.updatedAt).toLocaleString()].filter(Boolean).join(' · ')}</p>
        {entry.sourceTaskId && <p><a href={'/tasks/' + entry.sourceTaskId}>See the verified task</a></p>}
        <p>{[entry.importance === 'high' ? 'Marked important' : null, entry.dueAt ? 'Due ' + new Date(entry.dueAt).toLocaleString() : null, entry.needsReview ? 'Check again before relying on this' : entry.urgency === 'overdue' ? 'Overdue' : entry.urgency === 'soon' ? 'Due soon' : null].filter(Boolean).join(' · ')}</p>
        <div className="row">
          <button disabled={disabled} onClick={() => {
            const { id, revision, text, projectId, relatedProjectId, importance, dueAt, reviewAt } = entry;
            setDraft({ id, revision, text, projectId, relatedProjectId, importance, dueAt, reviewAt });
            document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
          }}>Edit note</button>
          <button disabled={disabled} onClick={() => setForgetting(entry)}>Forget note</button>
        </div>
        {forgetting?.id === entry.id && <div className="banner">
          <p>Remove this note and its edits from cestOn memory? Original conversations and existing backup files keep their own copies.</p>
          <button disabled={disabled} onClick={() => {
            void change(() => api('/memory/' + entry.id + '/forget', { method: 'POST', body: { revision: forgetting.revision } }), () => { setForgetting(null); if (draft.id === entry.id) reset(); }, 'Note forgotten.');
          }}>Remove from memory</button>
          <button onClick={() => setForgetting(null)}>Keep note</button>
        </div>}
      </article>)}
      <div className="row">
        {offset > 0 && <button disabled={!online} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous notes</button>}
        {page?.nextOffset != null && <button disabled={!online} onClick={() => setOffset(page.nextOffset!)}>More notes</button>}
      </div>
    </section>
  </>;
}
