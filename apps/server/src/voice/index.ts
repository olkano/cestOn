import { z } from 'zod';
import type { Config } from '../../../../packages/contracts/src/config.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import { assertTestRoot } from '../../../../packages/test-support/src/index.js';
export interface SpeechAdapter { transcribe(wav: Buffer): Promise<string>; }
export class FixtureSpeechAdapter implements SpeechAdapter {
  calls = 0; constructor(root: string) { assertTestRoot(root); }
  async transcribe() { this.calls++; return 'Synthetic voice instruction. Review this text before sending.'; }
}
export class HttpSpeechAdapter implements SpeechAdapter {
  constructor(private config: Config['voice']) { if (!config.endpoint || new URL(config.endpoint).protocol !== 'https:' || !config.model) throw new DomainError('speech_configuration_required', 422); }
  async transcribe(wav: Buffer) {
    const key = this.config.credentialEnv ? process.env[this.config.credentialEnv] : undefined;
    if (this.config.credentialEnv && !key) throw new DomainError('speech_credential_unavailable', 503);
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'recording.wav'); form.append('model', this.config.model!);
    const response = await fetch(this.config.endpoint!, { method: 'POST', body: form, headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(45000), redirect: 'error' });
    if (!response.ok) throw new DomainError(response.status === 401 ? 'speech_authentication_expired' : 'speech_provider_unavailable', 503);
    const reader = response.body?.getReader(); if (!reader) throw new DomainError('speech_response_invalid', 503); let text = '';
    for (;;) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); if (Buffer.byteLength(text) > 65536) { await reader.cancel(); throw new DomainError('speech_response_invalid', 503); } }
    try { return z.object({ text: z.string().max(32768) }).parse(JSON.parse(text)).text; } catch { throw new DomainError('speech_response_invalid', 503); }
  }
}
export class SpeechService {
  constructor(private adapter: SpeechAdapter | null) {}
  get available() { return this.adapter !== null; }
  async transcribe(bytes: Buffer, mime: string) {
    if (!this.adapter) throw new DomainError('speech_unavailable', 422);
    if (bytes.length > 10485760) throw new DomainError('audio_too_large', 413);
    if (mime !== 'audio/wav' || bytes.length < 46 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 16000 || bytes.readUInt32LE(28) !== 32000 || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 2 !== 0) throw new DomainError('unsupported_audio_format', 422);
    const durationSeconds = (bytes.length - 44) / 32000; if (durationSeconds > 60) throw new DomainError('recording_too_long', 413);
    try { const transcript = redactText(await this.adapter.transcribe(bytes)); return { transcript, durationSeconds }; } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('speech_provider_unavailable', 503); } finally { bytes.fill(0); }
  }
}
