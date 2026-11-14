import { useState, useRef, useEffect } from 'react';
import { api } from './api.js';
let active = false;
export const voiceActive = () => active;
function wav(samples: Float32Array) {
  const bytes = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(bytes); const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i]!)); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return new Blob([bytes], { type: 'audio/wav' });
}
export function VoiceCapture({ target, disabled, transcribed }: { target: string; disabled: boolean; transcribed: (text: string) => void }) {
  const [status, setStatus] = useState<'idle' | 'permission' | 'recording' | 'transcribing'>('idle'); const [elapsed, setElapsed] = useState(0); const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const cancelled = useRef(false); const request = useRef<AbortController | null>(null); const timer = useRef<ReturnType<typeof setInterval> | null>(null); const mounted = useRef(true);
  const stopTracks = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (timer.current) clearInterval(timer.current); active = false; };
  const cancel = () => { cancelled.current = true; request.current?.abort(); if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); setStatus('idle'); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelled.current = true; request.current?.abort(); if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); }; }, []);
  const start = async () => {
    if (active) return; active = true; setStatus('permission'); setError(''); cancelled.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder || !globalThis.AudioContext) throw new Error('Recording is unavailable in this browser. Use text.');
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true }); if (!mounted.current || cancelled.current) { audio.getTracks().forEach(track => track.stop()); return; } stream.current = audio;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(audio, mime ? { mimeType: mime } : {}); recorder.current = media; const chunks: Blob[] = []; let size = 0;
      media.ondataavailable = event => { size += event.data.size; if (size > 10485760) { cancelled.current = true; if (mounted.current) { setError('The recording reached its size limit. Use a shorter message.'); setStatus('idle'); } if (media.state === 'recording') media.stop(); stopTracks(); } else chunks.push(event.data); };
      media.onstop = () => { stopTracks(); if (cancelled.current || !mounted.current) return; setStatus('transcribing'); active = true; void (async () => {
        const context = new AudioContext(); let decoded: AudioBuffer; try { decoded = await context.decodeAudioData(await new Blob(chunks, { type: media.mimeType }).arrayBuffer()); } finally { await context.close(); }
        if (!decoded.duration || decoded.duration > 60) throw new Error('Record a message shorter than sixty seconds.');
        const converted = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000); const source = converted.createBufferSource(); source.buffer = decoded; source.connect(converted.destination); source.start(); const buffer = await converted.startRendering();
        if (cancelled.current || !mounted.current) return; const form = new FormData(); form.append('file', wav(buffer.getChannelData(0)), 'recording.wav'); request.current = new AbortController();
        const response = await api<{ transcript: string }>('/voice/transcribe', { method: 'POST', body: form, signal: request.current.signal }); if (!cancelled.current && mounted.current) transcribed(response.transcript);
      })().catch(error => { if (!cancelled.current && mounted.current) setError(error instanceof Error ? error.message : 'Transcription failed. Use text.'); }).finally(() => { active = false; if (mounted.current) setStatus('idle'); }); };
      media.start(1000); active = true; setElapsed(0); setStatus('recording'); const began = performance.now(); timer.current = setInterval(() => { const seconds = Math.floor((performance.now() - began) / 1000); setElapsed(seconds); if (seconds >= 59 && media.state === 'recording') media.stop(); }, 200);
    } catch (error) { stopTracks(); setError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone permission was denied. Text remains available.' : error instanceof Error ? error.message : 'Recording is unavailable. Use text.'); setStatus('idle'); }
  };
  return <div className="voice"><p className="muted">Voice target: {target}. A transcript stays editable and unsent.</p><div className="row">{status === 'idle' ? <button type="button" disabled={disabled} onClick={() => { void start(); }}>Record message</button> : <><span role="status">{status === 'recording' ? `Recording 0:${String(elapsed).padStart(2, '0')}` : status === 'permission' ? 'Allow the microphone to start…' : 'Transcribing…'}</span>{status === 'recording' && <button type="button" onClick={() => recorder.current?.stop()}>Stop recording</button>}<button type="button" onClick={cancel}>Cancel voice</button></>}</div>{error && <p role="alert">{error}</p>}</div>;
}
export function ReadAloud({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false); const [error, setError] = useState('');
  useEffect(() => () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); }, []);
  return <div className="row"><button type="button" onClick={() => { if (!('speechSynthesis' in window)) { setError('Read aloud is unavailable. The transcript remains visible.'); return; } speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text.slice(0, 32768)); utterance.onend = () => setSpeaking(false); utterance.onerror = () => { setSpeaking(false); setError('Playback stopped. You can replay the visible transcript.'); }; setSpeaking(true); speechSynthesis.speak(utterance); }}>{speaking ? 'Replay briefing' : 'Read briefing aloud'}</button>{speaking && <button type="button" onClick={() => { speechSynthesis.cancel(); setSpeaking(false); }}>Stop playback</button>}{error && <p role="status">{error}</p>}</div>;
}
