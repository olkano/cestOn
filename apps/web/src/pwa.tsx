import { useEffect, useState } from 'react';
import { api } from './api.js';
import { flushDrafts, loadDraft, saveDraft } from './drafts.js';
import { voiceActive } from './voice.js';
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function InstallSupport() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null); const [standalone, setStandalone] = useState(matchMedia('(display-mode: standalone)').matches); const [notice, setNotice] = useState('');
  useEffect(() => { const offered = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); }; const installed = () => { setStandalone(true); setPrompt(null); }; addEventListener('beforeinstallprompt', offered); addEventListener('appinstalled', installed); return () => { removeEventListener('beforeinstallprompt', offered); removeEventListener('appinstalled', installed); }; }, []);
  if (standalone) return <p>cestOn is running in a standalone window.</p>;
  return <section><h2>Install on this device</h2>{prompt && <button className="primary" onClick={() => { void prompt.prompt().then(async () => { const choice = await prompt.userChoice; setNotice(choice.outcome === 'accepted' ? 'Installation requested. Check the new icon.' : 'You can install later from your browser menu.'); setPrompt(null); }); }}>Install cestOn</button>}<p>Android: choose Install app from the browser menu when available. On iPhone, open the dedicated HTTPS origin in Safari, use Share, then Add to Home Screen.</p><p>Allow notifications after opening the installed app if your platform requires it. Installation does not keep a sleeping host online.</p><p role="status">{notice}</p></section>;
}
export function UpdateBanner({ owner }: { owner: string }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null); const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return; let mounted = true;
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => { const offer = () => { if (mounted) setWaiting(registration.waiting); }; offer(); registration.addEventListener('updatefound', () => { registration.installing?.addEventListener('statechange', offer); }); }).catch(() => { if (mounted) setNotice('Offline installation is unavailable. Text still works while connected.'); });
    return () => { mounted = false; };
  }, []);
  if (!waiting) return notice ? <p className="muted">{notice}</p> : null;
  return <aside className="banner"><p>An updated app is ready to check. Drafts remain on this device.</p><button onClick={() => { void (async () => { if (!owner) { setNotice('Reconnect before checking this update.'); return; } if (voiceActive()) { setNotice('Finish voice capture before updating.'); return; } await flushDrafts(); const ready = await api<{ ready: boolean; protocol: number; staticBundle?: string }>('/health/ready'); if (!ready.ready || ready.protocol !== 1) throw new Error('The host is not ready for this app update.'); const manifest = await fetch('/release.json', { cache: 'no-store' }).then(response => response.json()) as { staticBundle: string }; if (!ready.staticBundle || ready.staticBundle !== manifest.staticBundle) throw new Error('The host and app bundle do not match. Reconnect before updating.'); const channel = new MessageChannel(); const version = await new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('The update worker did not respond.')), 3000); channel.port1.onmessage = event => { clearTimeout(timer); resolve(String(event.data.version)); channel.port1.close(); }; waiting.postMessage({ type: 'version' }, [channel.port2]); }); if (version !== manifest.staticBundle) throw new Error('This waiting bundle is stale. Check again after reconnecting.'); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); waiting.postMessage({ type: 'activate', version }); })().catch(error => setNotice(error.message)); }}>Check and refresh app</button>{notice && <p role="status">{notice}</p>}</aside>;
}
export function OfflineDraft({ owner, target }: { owner: string; target: string }) {
  const [value, setValue] = useState(''); useEffect(() => { void loadDraft(owner, target).then(setValue); }, [owner, target]);
  return <section className="card"><h1>Your host is unavailable</h1><p>This is the offline shell. Private task state needs a connected, authenticated host. This device can keep its selected unsent draft for up to 24 hours.</p><label>Unsent offline draft<textarea value={value} rows={6} onChange={event => { setValue(event.target.value); void saveDraft(owner, target, event.target.value); }}/></label><p>Reconnect to revalidate the target before sending. Nothing sends in the background.</p><button onClick={() => location.reload()}>Try reconnecting</button></section>;
}
