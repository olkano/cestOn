import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setTheme } from './theme.js';
import './styles/tokens.css';

function App() {
  const [theme, updateTheme] = useState(localStorage.getItem('ceston.theme') ?? 'system');
  return <div className="shell"><header><a className="brand" href="/today"><img src="/cestOn-icon.svg" alt=""/>cestOn</a><label>Appearance <select aria-label="Appearance" value={theme} onChange={event => { updateTheme(event.target.value); setTheme(event.target.value); }}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label></header><main><p className="eyebrow">Your work, connected</p><h1>A clear place to direct your agents.</h1><p className="muted">Tasks, decisions, and verified outcomes from your own host.</p><section className="card" aria-labelledby="setup-title"><div className="row"><h2 id="setup-title">Local setup</h2><span className="badge">Development scaffold</span></div><p>Managed work is not enabled yet. Project registration and device pairing will be available after the authenticated service is implemented.</p><p className="muted">The host needs to stay awake and connected. Closing your phone will not stop managed work.</p></section></main><footer>Self-hosted · No provider connected · Text remains available</footer></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
