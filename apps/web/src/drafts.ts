const database = 'ceston-drafts-v1';
type Draft = { id: string; value: string; expiresAt: number };
async function open() { return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(database, 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
export async function saveDraft(owner: string, route: string, value: string) {
  const db = await open(); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ id: `${owner}:${route}`, value, expiresAt: Date.now() + 86400000 } satisfies Draft); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
export async function loadDraft(owner: string, route: string) {
  const db = await open(); try { return await new Promise<string>((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(`${owner}:${route}`); request.onsuccess = () => { const draft = request.result as Draft | undefined; resolve(draft && draft.expiresAt > Date.now() ? draft.value : ''); }; request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function clearDrafts() { const db = await open(); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); } }
