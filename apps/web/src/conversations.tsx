import { useEffect, useState } from 'react';
import type { LocalHistory } from '../../server/src/projects/history.js';
import { api } from './api.js';

type Inventory = Awaited<ReturnType<LocalHistory['list']>>;
type Messages = Awaited<ReturnType<LocalHistory['read']>>;
type Conversation = Inventory['conversations'][number];

export function Conversations({ online, startGeneral }: { online: boolean; startGeneral: () => void }) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [folder, setFolder] = useState('');
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [history, setHistory] = useState<Messages | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ search, offset: String(offset) });
    if (folder) query.set('folderId', folder);
    const timer = setTimeout(() => {
      setError('');
      void api<Inventory>('/history?' + query, { signal: abort.signal }).then(next => {
        if (!abort.signal.aborted) setInventory(next);
      }).catch(() => {
        if (!abort.signal.aborted) setError('Could not check conversation history. Try refreshing.');
      });
    }, 160);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [search, offset, folder, online, loadKey]);
  useEffect(() => {
    if (!online || !selected) return;
    const abort = new AbortController();
    void api<Messages>('/history/' + selected.id, { signal: abort.signal }).then(next => {
      if (!abort.signal.aborted) setHistory(next);
    }).catch(() => {
      if (!abort.signal.aborted) setHistoryError('This conversation’s messages are unavailable. Its history may have moved or been removed.');
    });
    return () => abort.abort();
  }, [selected, online, loadKey]);
  const back = () => { setSelected(null); setHistory(null); setHistoryError(''); };
  return <>
    <div className="row">
      <button className="primary" onClick={startGeneral}>New conversation</button>
      <button disabled={!online} onClick={() => setLoadKey(value => value + 1)}>Refresh history</button>
      <a href="/install">Use cestOn on another device</a>
    </div>
    {!online && <p role="status">Can’t reach your PC. Any history on screen may be out of date.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="daily-columns" data-show-conversation={Boolean(selected)}>
      <section className="card daily-list">
        <h2>Your folders</h2>
        <label>Find a folder or conversation<input type="search" maxLength={200} value={search} onChange={event => { back(); setSearch(event.target.value); setOffset(0); setFolder(''); }}/></label>
        {inventory && !inventory.coverage.length && <p>Connect local history from the PC to find your existing Codex and Claude work here. You can start a general conversation or save a note now.</p>}
        {inventory && inventory.coverage.length > 0 && <details>
          <summary>History sources</summary>
          {inventory.coverage.map(source => <p key={source.provider}>{source.provider} · {source.status === 'ready' ? 'Checked' : source.status === 'partial' ? 'Partially checked' : 'Unavailable'}. {source.inspected} files checked, {source.skipped} skipped.</p>)}
          <p className="muted">Last checked {new Date(inventory.capturedAt).toLocaleString()}.</p>
        </details>}
        <ul className="daily-folders">
          {Boolean(inventory?.folders.length) && <li><button aria-pressed={!folder} onClick={() => { back(); setFolder(''); setOffset(0); }}>All folders</button></li>}
          {inventory?.folders.map(item => <li key={item.id}><button aria-pressed={folder === item.id} onClick={() => {
            back(); setFolder(item.id); setOffset(0);
          }}>{item.name} <small>({item.count})</small></button></li>)}
        </ul>
        <h2>Conversations</h2>
        {!inventory && !error && <p>Checking the PC for conversations…</p>}
        {inventory && !inventory.conversations.length && <p>No matching conversations.</p>}
        <ul className="daily-folders">{inventory?.conversations.map(item => <li key={item.id}>
          <button aria-pressed={selected?.id === item.id} onClick={() => { back(); setSelected(item); }}>
            <strong>{item.title}</strong><br/><small>{item.folder} · {item.provider} · {item.approximate ? 'Approx. ' : ''}{new Date(item.activityAt).toLocaleString()}</small>
          </button>
        </li>)}</ul>
        <div className="row">
          {offset > 0 && <button disabled={!online} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous conversations</button>}
          {inventory?.nextOffset != null && <button disabled={!online} onClick={() => setOffset(inventory.nextOffset!)}>More conversations</button>}
        </div>
      </section>
      <section className="card daily-thread">
        {selected ? <>
          <button className="daily-back" onClick={back}>Back to conversations</button>
          <h2>{selected.title}</h2>
          <p className="muted">{selected.folder} · {selected.provider}</p>
          <p>Can’t reply to this conversation from cestOn. Open it in {selected.provider} to continue there.</p>
          {historyError && <p role="alert">{historyError}</p>}
          {!history && !historyError && online && <p>Opening messages…</p>}
          {history && history.older !== null && <button disabled={!online || busy} onClick={() => {
            setBusy(true);
            void api<Messages>('/history/' + selected.id + '?before=' + history.older).then(previous => {
              setHistory(current => current === history ? { messages: [...previous.messages, ...history.messages], older: previous.older } : current);
            }).catch(() => setHistoryError('Could not read earlier messages.')).finally(() => setBusy(false));
          }}>Earlier messages</button>}
          {history && !history.messages.length && <p>No text messages in this part of the conversation.</p>}
          {history?.messages.map((message, index) => <article className="phase" key={index}><strong>{message.role === 'user' ? 'You' : selected.provider}</strong><p className="prose">{message.text}</p></article>)}
        </> : <><h2>Pick a conversation</h2><p>Open a folder or search across recent work. Select a conversation to read its messages.</p></>}
      </section>
    </div>
  </>;
}
