export type SavedMessage = { role: string; text: string; recordedAt: string | null };
type Turn = { createdAt: string; prompt: string; answer?: string | null | undefined };

// Which parts of a phone reply the chat's saved file already shows, so cestOn's own copy is not repeated.
// A saved answer means the question is saved before it, even when it is above the messages read so far.
export function savedParts(turn: Turn, messages: SavedMessage[]) {
  const started = Date.parse(turn.createdAt) - 1000;
  const since = (message: SavedMessage) => message.recordedAt !== null && Date.parse(message.recordedAt) >= started;
  const prompt = messages.findIndex(message => message.role === 'user' && message.text === turn.prompt.trim() && since(message));
  const reply = turn.answer?.trim();
  const answer = Boolean(reply) && messages.some((message, index) => index > prompt && message.role === 'assistant' && message.text === reply && since(message));
  return { prompt: prompt !== -1 || answer, answer };
}
