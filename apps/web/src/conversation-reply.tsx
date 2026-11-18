import { useEffect, useState } from 'react';
import type { ConversationReplies } from '../../server/src/projects/conversation-replies.js';
import { api } from './api.js';
import { loadDraft, saveDraft } from './drafts.js';

type Thread = Awaited<ReturnType<ConversationReplies['view']>>;
type Draft = { key: string; text: string };
type SavedMessage = { role: string; text: string; recordedAt: string | null };
const emptyDraft: Draft = { key: '', text: '' };
const statusText: Record<Thread['state'], string> = {
  ready: '',
  working: 'Waiting for a reply…',
  paused: 'Work on this PC is paused. Your draft stays here.',
  unavailable: 'This conversation can’t accept replies right now. Its provider or the original session is unavailable.',
  offline: 'cestOn can’t reach the provider on your PC.',
  uncertain: 'cestOn is checking whether your last message reached the provider.',
};

function present(turn: Thread['turns'][number], messages: SavedMessage[]) {
  const started = Date.parse(turn.createdAt) - 1000;
  const prompt = messages.findIndex(message => message.role === 'user' && message.text === turn.prompt.trim() &&
    message.recordedAt !== null && Date.parse(message.recordedAt) >= started);
  if (prompt === -1) return {prompt:false,answer:false};
  for (const message of messages.slice(prompt+1)) {
    if (message.role === 'user') break;
    if (message.text === turn.answer?.trim()) return {prompt:true,answer:true};
  }
  return {prompt:true,answer:false};
}

export function ConversationReply({ id, provider, online, owner, savedMessages = [] }: { id: string; provider: string; online: boolean; owner: string; savedMessages?: SavedMessage[] | undefined }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sendError, setSendError] = useState('');
  const [readError, setReadError] = useState(false);
  const path = '/managed-conversations/' + id;
  const draftPath = 'reply:' + id;

  useEffect(() => {
    let current = true;
    void loadDraft(owner, draftPath).then(value => {
      if (!current || !value) return;
      const saved = JSON.parse(value) as Draft;
      if (typeof saved.key === 'string' && typeof saved.text === 'string') setDraft(saved);
    }).catch(() => { if (current) setSendError('Couldn’t open your saved draft.'); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [owner, draftPath]);

  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      let interval = 4000;
      void api<Thread>(path, { signal: abort.signal }).then(value => {
        if (abort.signal.aborted) return;
        setThread(value); setReadError(false);
        if (value.state === 'working' || value.state === 'uncertain') interval = 900;
      }).catch(() => { if (!abort.signal.aborted) setReadError(true); }).finally(() => {
        if (!abort.signal.aborted) timer = setTimeout(read, interval);
      });
    };
    read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [online, path, refresh]);

  useEffect(() => {
    if (!draft.key || !thread?.turns.some(turn => turn.clientKey === draft.key)) return;
    setDraft(emptyDraft);
    setSendError('');
    void saveDraft(owner, draftPath, '').catch(() => setSendError('Couldn’t update the saved draft.'));
  }, [draft.key, thread, owner, draftPath]);

  const canSend = online && !readError && thread?.state === 'ready';
  const send = async () => {
    if (!canSend || sending || !draft.text.trim()) return;
    setSending(true); setSendError('');
    try {
      await api(path + '/replies', { method: 'POST', key: draft.key, body: { text: draft.text } });
      setThread(current => current && { ...current, state: 'working' });
    } catch { setSendError('Couldn’t confirm that your reply was sent. Your draft is still here.'); }
    finally { setSending(false); setRefresh(value => value + 1); }
  };

  return <>
    {thread?.opening && <article className="phase"><strong>You</strong><p className="prose">{thread.opening}</p></article>}
    <div className="conversation" aria-live="polite">{thread?.turns.map(turn => {
      const stored = present(turn,savedMessages);
      const answer = stored.answer ? null : turn.answer ?? turn.preview;
      if (stored.prompt && !answer && turn.state !== 'failed') return null;
      return <article className="phase" key={turn.id}>
      {!stored.prompt && <><strong>You</strong><p className="prose">{turn.prompt}</p></>}
      {answer && <><strong>{provider}</strong><p className="prose">{answer}</p></>}
      {turn.state === 'failed' && <p>{turn.error === 'history_session_open'
        ? 'This conversation is open in the provider app. Close that conversation there, then try again.'
        : turn.error === 'history_provider_unavailable'
          ? 'Check that the provider is installed and signed in on your PC.'
          : 'cestOn couldn’t get a reply for this message.'}</p>}
    </article>;})}</div>
    <p role="status">{!online ? 'You’re offline. Your reply stays in this browser until you send it.' : readError ? 'Couldn’t check this conversation. Trying again…' : thread ? statusText[thread.state] : 'Checking this conversation…'}</p>
    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label>Your reply<textarea value={draft.text} disabled={!loaded || sending} maxLength={8000} rows={3} onChange={event => {
        const next = { key: crypto.randomUUID(), text: event.target.value };
        setDraft(next);
        void saveDraft(owner, draftPath, next.text.trim() ? JSON.stringify(next) : '').catch(() => setSendError('Couldn’t save your draft. Keep this page open.'));
      }}/></label>
      <button className="primary" disabled={!canSend || sending || !draft.text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      <small>Use Work to request file changes.</small>
      {sendError && <p role="alert">{sendError}</p>}
    </form>
  </>;
}
