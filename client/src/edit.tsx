import { useRef } from 'react';

export function EditField({ value, label, onCommit, onCancel }: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);
  const focused = useRef(false);
  return (
    <input
      className="rename"
      defaultValue={value}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          done.current = true;
          onCommit(event.currentTarget.value);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(event) => {
        if (!done.current) onCommit(event.currentTarget.value);
      }}
      ref={(element) => {
        if (!element || focused.current) return;
        focused.current = true;
        requestAnimationFrame(() => {
          if (!element.isConnected) return;
          element.focus();
          element.select();
          element.scrollIntoView({ block: 'nearest' });
        });
      }}
    />
  );
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
