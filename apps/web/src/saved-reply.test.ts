import { describe, expect, it } from 'vitest';
import { savedParts, type SavedMessage } from './saved-reply.js';

const turn = { createdAt: '2026-11-23T16:03:13.000Z', prompt: 'Does it work? ', answer: 'Yes, it works.' };
const at = (seconds: number) => new Date(Date.parse(turn.createdAt) + seconds * 1000).toISOString();
const user = (text: string, seconds: number): SavedMessage => ({ role: 'user', text, recordedAt: at(seconds) });
const assistant = (text: string, seconds: number): SavedMessage => ({ role: 'assistant', text, recordedAt: at(seconds) });

describe('Phone reply already in the saved chat', () => {
  it('hides both copies when the question and answer are saved', () => {
    expect(savedParts(turn, [user('Does it work?', 1), assistant('Yes, it works.', 8)])).toEqual({ prompt: true, answer: true });
  });

  it('keeps the answer copy while only the question is saved', () => {
    expect(savedParts(turn, [user('Does it work?', 1)])).toEqual({ prompt: true, answer: false });
    expect(savedParts({ ...turn, answer: null }, [user('Does it work?', 1)])).toEqual({ prompt: true, answer: false });
  });

  it('does not repeat the answer when the saved question is above the messages read so far', () => {
    expect(savedParts(turn, [assistant('Yes, it works.', 8), user('Next question from VS Code', 60)])).toEqual({ prompt: true, answer: true });
  });

  it('shows both copies when neither is saved yet', () => {
    expect(savedParts(turn, [])).toEqual({ prompt: false, answer: false });
  });

  it('ignores identical text saved before the reply was sent, or an identical answer before the question', () => {
    expect(savedParts(turn, [user('Does it work?', -60), assistant('Yes, it works.', -50)])).toEqual({ prompt: false, answer: false });
    expect(savedParts(turn, [assistant('Yes, it works.', 0.5), user('Does it work?', 1)])).toEqual({ prompt: true, answer: false });
    expect(savedParts(turn, [{ ...user('Does it work?', 1), recordedAt: null }])).toEqual({ prompt: false, answer: false });
  });
});
