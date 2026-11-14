import { it, expect } from 'vitest';
import { SpeechService, FixtureSpeechAdapter } from '../../apps/server/src/voice/index.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
function wav(seconds: number) { const data = Buffer.alloc(Math.ceil(seconds * 32000)); const bytes = Buffer.alloc(44 + data.length); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(data.length, 40); return bytes; }
it('T22 audio is independently duration-checked, transcription stays text, and missing speech leaves a typed fallback', async () => {
  const t = createTestRoot();
  try { const adapter = new FixtureSpeechAdapter(t.root); const speech = new SpeechService(adapter); expect(await speech.transcribe(wav(1), 'audio/wav')).toEqual({ transcript: 'Synthetic voice instruction. Review this text before sending.', durationSeconds: 1 });
    expect(adapter.calls).toBe(1); await expect(speech.transcribe(wav(61), 'audio/wav')).rejects.toThrow('recording_too_long'); await expect(speech.transcribe(Buffer.from('not audio'), 'audio/wav')).rejects.toThrow('unsupported_audio_format');
    await expect(new SpeechService(null).transcribe(wav(1), 'audio/wav')).rejects.toThrow('speech_unavailable'); expect(adapter.calls).toBe(1);
  } finally { cleanupTestRoot(t.root, t.runId); }
});
