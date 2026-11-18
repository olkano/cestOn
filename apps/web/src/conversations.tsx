import { useEffect, useRef, useState } from 'react';
import type { LocalHistory } from '../../server/src/projects/history.js';
import { api } from './api.js';
import { ConversationReply } from './conversation-reply.js';
import { chatRecency } from './chat-recency.js';

type Inventory = Awaited<ReturnType<LocalHistory['list']>>;
type Messages = Awaited<ReturnType<LocalHistory['read']>>;
type Conversation = Inventory['conversations'][number];

function poll(read: (signal: AbortSignal) => Promise<void>, interval: number, initialDelay = 0) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const run = () => {
    void read(abort.signal).finally(() => {
      if (!abort.signal.aborted) timer = setTimeout(run,interval);
    });
  };
  timer = setTimeout(run,initialDelay);
  return () => { clearTimeout(timer); abort.abort(); };
}

function mergeMessages(previous: Messages['messages'], next: Messages['messages']) {
  const messages = new Map(previous.map(item => [item.position,item]));
  for (const item of next) messages.set(item.position,item);
  return [...messages.values()].sort((a,b) => a.position - b.position);
}

const activityLabels: Partial<Record<Conversation['status'],string>> = {
  working:'Working', likely_working:'Likely working', waiting:'Needs input', unknown:'Activity unconfirmed',
};

function Activity({ status, detail = false }: { status: Conversation['status']; detail?: boolean }) {
  const label = activityLabels[status];
  if (!label || status === 'unknown' && !detail) return null;
  return <span className="chat-activity" data-activity={status}><i aria-hidden="true"/>{label}</span>;
}

function Recency({ iso, now, caption }: { iso: string; now: number; caption: string }) {
  const {tier,label} = chatRecency(iso,now);
  return <time className="chat-recency" data-age={tier} dateTime={iso} title={new Date(iso).toLocaleString()}>
    <i className="chat-clock" aria-hidden="true"/>{caption} {label}
  </time>;
}

function timeFor(conversation: Conversation) {
  if (conversation.endedAt && conversation.endedAt >= conversation.activityAt) {
    const ongoing = conversation.status === 'working' || conversation.status === 'likely_working' || conversation.status === 'waiting';
    return {iso:conversation.endedAt,caption:ongoing ? 'Last finished' : 'Finished'};
  }
  return {iso:conversation.activityAt,caption:conversation.approximate ? 'Estimated' : 'Last activity'};
}

export function Conversations({ online, owner, startGeneral }: { online: boolean; owner: string; startGeneral: () => void }) {
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
  const [visible, setVisible] = useState(() => !document.hidden);
  const [now, setNow] = useState(Date.now);
  const previousRead = useRef<AbortController | null>(null);
  const latestPage = useRef<Messages | null>(null);
  const selectedId = selected?.id;
  const selectedManaged = selected?.managed;

  useEffect(() => {
    const update = () => { setVisible(!document.hidden); setNow(Date.now()); };
    const timer = setInterval(update,15000);
    document.addEventListener('visibilitychange',update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange',update); previousRead.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!online || !visible) return;
    const query = new URLSearchParams({ search, offset: String(offset) });
    if (folder) query.set('folderId', folder);
    return poll(async signal => {
      try {
        const next = await api<Inventory>('/history?' + query, { signal });
        if (signal.aborted) return;
        setInventory(next); setError(''); setNow(Date.now());
      } catch { if (!signal.aborted) setError('Could not check conversation history. Trying again…'); }
    },5000,160);
  }, [search, offset, folder, online, loadKey, visible]);
  useEffect(() => {
    if (!online || !visible || !selectedId || selectedManaged) return;
    return poll(async signal => {
      try {
        const path = '/history/' + selectedId;
        const next = await api<Messages>(path, { signal });
        const previous = latestPage.current;
        const compatible = previous?.conversation.id === selectedId && previous.revision === next.revision && previous.end <= next.end;
        let cursor = next.older;
        let fresh = next.messages;
        let gap = false;
        if (compatible && previous) {
          for (let pages = 0; pages < 8 && cursor !== null && cursor > previous.end; pages++) {
            const page = await api<Messages>(path + '?before=' + cursor,{signal});
            if (page.revision !== next.revision || page.older === cursor) break;
            fresh = mergeMessages(page.messages,fresh);
            cursor = page.older;
          }
          gap = cursor !== null && cursor > previous.end;
        }
        if (signal.aborted) return;
        latestPage.current = next;
        setHistory(current => {
          if (!current || current.conversation.id !== selectedId || current.revision !== next.revision || next.end < current.end) return next;
          return { ...next, messages:mergeMessages(current.messages,fresh), older:gap ? cursor : current.older };
        });
        setHistoryError(''); setNow(Date.now());
      } catch {
        if (!signal.aborted) setHistoryError('Could not check for new messages. Trying again…');
      }
    },1800);
  }, [selectedId, selectedManaged, online, loadKey, visible]);

  const back = () => {
    previousRead.current?.abort(); setBusy(false);
    latestPage.current = null;
    setSelected(null); setHistory(null); setHistoryError('');
  };
  const shown = history?.conversation ?? inventory?.conversations.find(item=>item.id===selectedId) ?? selected;
  const active = (status: Conversation['status'], stale: string) => online && !stale ? status : 'unknown';

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
          {inventory?.folders.map(item => <li key={item.id}><button data-age={chatRecency(item.activityAt,now).tier} aria-pressed={folder === item.id} onClick={() => {
            back(); setFolder(item.id); setOffset(0);
          }}><span>{item.name} <small>({item.count})</small></span>
            <span className="chat-row-meta"><Recency iso={item.activityAt} now={now} caption={item.approximate ? 'Estimated' : 'Latest chat'}/></span>
          </button></li>)}
        </ul>
        <h2>Conversations</h2>
        {!inventory && !error && <p>Checking the PC for conversations…</p>}
        {inventory && !inventory.conversations.length && <p>No matching conversations.</p>}
        <ul className="daily-folders">{inventory?.conversations.map(item => {
          const updated = shown?.id === item.id ? shown : item;
          const time = timeFor(updated);
          return <li key={item.id}>
            <button data-age={chatRecency(time.iso,now).tier} aria-pressed={selectedId === item.id} onClick={() => {
              if (selectedId !== item.id) { back(); setSelected(item); }
            }}>
              <strong>{updated.title}</strong><br/><small>{updated.folder} · {updated.provider}</small>
              <span className="chat-row-meta"><Activity status={active(updated.status,shown?.id === item.id && history ? historyError : error)}/><Recency now={now} {...time}/></span>
            </button>
          </li>;
        })}</ul>
        <div className="row">
          {offset > 0 && <button disabled={!online} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous conversations</button>}
          {inventory?.nextOffset != null && <button disabled={!online} onClick={() => setOffset(inventory.nextOffset!)}>More conversations</button>}
        </div>
      </section>
      <section className="card daily-thread">
        {shown ? <>
          <button className="daily-back" onClick={back}>Back to conversations</button>
          <h2>{shown.title}</h2>
          <p className="muted">{shown.folder} · {shown.provider}</p>
          <div className="chat-row-meta chat-thread-meta" aria-live="polite">
            <Activity detail={online} status={active(shown.status,shown.managed ? error : historyError)}/><Recency now={now} {...timeFor(shown)}/>
          </div>
          {shown.managed ? <ConversationReply key={shown.id} id={shown.id} provider={shown.provider} online={online} owner={owner}/> : <>
          {!shown.canReply && <p>Can’t reply to this conversation from cestOn. This is saved history. Open it in {shown.provider} to continue there.</p>}
          {historyError && <p role="alert">{historyError}</p>}
          {!history && !historyError && online && <p>Opening messages…</p>}
          {history && history.older !== null && <button disabled={!online || busy} onClick={() => {
            const abort = new AbortController();
            previousRead.current = abort;
            setBusy(true);
            void api<Messages>('/history/' + shown.id + '?before=' + history.older, {signal:abort.signal}).then(previous => {
              if (abort.signal.aborted) return;
              setHistory(current => current?.conversation.id === shown.id && current.revision === previous.revision
                ? { ...current, messages:mergeMessages(previous.messages,current.messages), older:previous.older } : current);
            }).catch(() => { if (!abort.signal.aborted) setHistoryError('Could not read earlier messages.'); }).finally(() => {
              if (!abort.signal.aborted) setBusy(false);
            });
          }}>Earlier messages</button>}
          {history && !history.messages.length && <p>No text messages in this part of the conversation.</p>}
          <div role="log" aria-label="Conversation messages" aria-live="polite">
            {history?.messages.map(message => <article className="phase" key={message.position}><strong>{message.role === 'user' ? 'You' : shown.provider}</strong><p className="prose">{message.text}</p></article>)}
          </div>
          {shown.canReply && <ConversationReply key={shown.id} id={shown.id} provider={shown.provider} online={online && !historyError} owner={owner} savedMessages={history?.messages}/>}
          </>}
        </> : <><h2>Pick a conversation</h2><p>Open a folder or search across recent work. Select a conversation to read its messages.</p></>}
      </section>
    </div>
  </>;
}
