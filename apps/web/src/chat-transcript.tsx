import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const ChatMessage = memo(function ChatMessage({ text }: { text: string }) {
  return <div className="chat-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    img: ({ alt }) => alt ? <span>{alt}</span> : null,
    a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    table: ({ children }) => <div className="chat-table"><table>{children}</table></div>,
  }} urlTransform={url => /^(https?:\/\/|mailto:)/i.test(url) ? url : ''}>{text}</Markdown></div>;
});

export function ChatTranscript({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const panel = viewport.current!;
    const resize = new ResizeObserver(() => { if (follow.current) panel.scrollTop = panel.scrollHeight; });
    resize.observe(content.current!);
    resize.observe(panel);
    return () => resize.disconnect();
  }, []);
  return <div className="chat-transcript-frame">
    <div ref={viewport} className="chat-transcript" role="log" aria-label="Conversation messages" tabIndex={0} onScroll={event => {
      const panel = event.currentTarget;
      follow.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 24;
      setAway(!follow.current);
    }}><div ref={content}>{children}</div></div>
    {away && <button type="button" className="chat-latest" onClick={() => {
      follow.current = true;
      viewport.current!.scrollTop = viewport.current!.scrollHeight;
      viewport.current!.focus({ preventScroll:true });
    }}>Jump to latest ↓</button>}
  </div>;
}
