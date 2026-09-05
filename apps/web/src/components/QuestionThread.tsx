import { useEffect, useRef } from "react";
import type { QuestionAnswer } from "@artlyrics/shared";

interface Props {
  items: QuestionAnswer[];
  pending?: string | null;
}

export default function QuestionThread({ items, pending }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [items.length, pending]);

  if (items.length === 0 && !pending) {
    return <p className="muted text-sm italic">No questions yet. Ask anything about the artwork.</p>;
  }

  return (
    <ol className="space-y-5" aria-live="polite">
      {items.map((q) => (
        <li key={q.id} className="space-y-2">
          <div className="flex gap-3">
            <span className="chip shrink-0">Q{q.position}</span>
            <p className="text-sm font-medium">{q.question}</p>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap pl-12">{q.answer}</p>
        </li>
      ))}
      {pending && (
        <li className="space-y-2">
          <div className="flex gap-3">
            <span className="chip shrink-0">Q{items.length + 1}</span>
            <p className="text-sm font-medium">{pending}</p>
          </div>
          <p className="muted text-sm pl-12 animate-pulse">Looking closely…</p>
        </li>
      )}
      <div ref={endRef} />
    </ol>
  );
}
