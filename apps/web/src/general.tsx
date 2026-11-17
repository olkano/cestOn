import { useEffect, useState } from 'react';
import type { Assistant, AssistantResponse } from '../../server/src/intents/assistant.js';
import { api } from './api.js';

type Threads = ReturnType<Assistant['generalThreads']>;
type Messages = ReturnType<Assistant['generalMessages']>;

export function GeneralThreads({ open, online, cursor }: { open: (id: string) => void; online: boolean; cursor: number }) {
  const [threads, setThreads] = useState<Threads>([]);
  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    void api<Threads>('/general', { signal: abort.signal }).then(setThreads).catch(() => {});
    return () => abort.abort();
  }, [online, cursor]);
  if (!threads.length) return null;
  return <details className="card"><summary>General conversations ({threads.length})</summary>
    <ul className="daily-folders">{threads.map(thread => <li key={thread.id}><button onClick={() => open(thread.id)}>
      General · {new Date(thread.createdAt).toLocaleString()}
    </button></li>)}</ul>
  </details>;
}

function responseText(response?: AssistantResponse) {
  if (!response) return '';
  if (response.kind === 'clarify') return response.question;
  if (response.kind === 'propose_command') return response.interpretation;
  return response.text;
}

export function GeneralMessages({ id, online, cursor, received }: { id: string; online: boolean; cursor: number; received: number }) {
  const [history, setHistory] = useState<Messages>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    void api<Messages>('/general/' + id, { signal: abort.signal }).then(next => {
      if (!abort.signal.aborted) { setHistory(next); setError(''); }
    }).catch(() => {
      if (!abort.signal.aborted) setError('Could not load this conversation. Reconnect to try again.');
    });
    return () => abort.abort();
  }, [id, online, cursor, received]);
  return <div className="conversation" aria-live="polite">
    {error && <p role="alert">{error}</p>}
    {history.map((message, index) => <article className="phase" key={index}>
      <strong>{message.type === 'conversation.user' ? 'You' : 'cestOn'}</strong>
      <p className="prose">{message.content.text ?? responseText(message.content.response)}</p>
    </article>)}
  </div>;
}
