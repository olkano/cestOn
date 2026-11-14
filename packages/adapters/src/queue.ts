import { CapabilityError } from './types.js';
export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []; private waiters: ((value: IteratorResult<T>) => void)[] = []; private ended = false;
  push(value: T) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else { if (this.values.length >= 2000) throw new CapabilityError('provider_stream_overflow'); this.values.push(value); }
  }
  end() { this.ended = true; for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined }); }
  async *[Symbol.asyncIterator]() { while (true) { const value = this.values.shift(); if (value !== undefined) yield value; else if (this.ended) return; else { const next = await new Promise<IteratorResult<T>>(resolve => this.waiters.push(resolve)); if (next.done) return; yield next.value; } } }
}
