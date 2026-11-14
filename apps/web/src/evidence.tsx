import { useState } from 'react';
import { api } from './api.js';
export function EvidencePreview({ id }: { id: string }) {
  const [preview, setPreview] = useState<{ path: string; before: string; after: string; truncated: boolean } | null>(null); const [error, setError] = useState(''); const [open, setOpen] = useState(false);
  return <div><button aria-expanded={open} onClick={() => { setOpen(!open); if (!preview) void api<NonNullable<typeof preview>>(`/evidence/${id}/preview`).then(setPreview).catch(error => setError(error.message)); }}>{open ? 'Hide changes' : 'Inspect changes'}</button>{open && preview && <div><h3>{preview.path}</h3><div className="diff"><section><h4>Before</h4><pre>{preview.before}</pre></section><section><h4>Verified result</h4><pre>{preview.after}</pre></section></div>{preview.truncated && <p>Preview limited to 32 KiB. Download the artifact to inspect all bytes.</p>}</div>}{error && <p role="alert">{error}</p>}</div>;
}
