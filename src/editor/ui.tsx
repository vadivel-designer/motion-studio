import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { beginTx, endTx } from './store';

/** Number input: edits a local draft, commits on Enter / blur / arrow keys (one undo step each). */
export function NumberField({
  value, onCommit, step = 1, min, max, decimals = 2, title, disabled, testId, width,
}: {
  value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number;
  decimals?: number; title?: string; disabled?: boolean; testId?: string; width?: number;
}) {
  const fmt = (v: number) => String(Number.isFinite(v) ? Number(v.toFixed(decimals)) : 0);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? fmt(value);
  const clampV = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (text: string) => {
    setDraft(null);
    const v = parseFloat(text);
    if (Number.isFinite(v) && clampV(v) !== value) onCommit(clampV(v));
  };
  return (
    <input
      className="num"
      type="text"
      inputMode="decimal"
      data-testid={testId}
      title={title}
      disabled={disabled}
      style={width ? { width } : undefined}
      value={shown}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== null && commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(shown); (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const mult = e.shiftKey ? 10 : 1;
          const base = Number.isFinite(parseFloat(shown)) ? parseFloat(shown) : value;
          const v = clampV(base + (e.key === 'ArrowUp' ? step : -step) * mult);
          setDraft(null);
          onCommit(Number(v.toFixed(decimals)));
        }
      }}
    />
  );
}

/** Color swatch + hex text. Dragging inside the picker is ONE undo step. */
export function ColorField({ value, onChange, title, disabled, testId }: { value: string; onChange: (v: string) => void; title?: string; disabled?: boolean; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const end = () => endTx();
    el.addEventListener('change', end);
    el.addEventListener('blur', end);
    return () => { el.removeEventListener('change', end); el.removeEventListener('blur', end); };
  }, []);
  const six = value.slice(0, 7);
  return (
    <span className="colorfield">
      <input
        ref={ref}
        type="color"
        title={title}
        data-testid={testId}
        disabled={disabled}
        value={six}
        onChange={(e) => { beginTx(); onChange(e.target.value); }}
      />
      <input
        className="hex"
        type="text"
        title={`${title ?? 'Color'} (hex)`}
        disabled={disabled}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(draft)) onChange(draft.toLowerCase());
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

export function TextField({ value, onCommit, title, placeholder, className, testId, disabled }: {
  value: string; onCommit: (v: string) => void; title?: string; placeholder?: string; className?: string; testId?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      type="text"
      title={title}
      data-testid={testId}
      placeholder={placeholder}
      disabled={disabled}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

export function IconButton({ children, title, onClick, disabled, active, testId, className }: {
  children: ReactNode; title: string; onClick?: (e: React.MouseEvent) => void; disabled?: boolean; active?: boolean; testId?: string; className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon ${active ? 'active' : ''} ${className ?? ''}`}
      title={title}
      aria-label={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, tip, right }: { title: string; children: ReactNode; tip?: string; right?: ReactNode }) {
  return (
    <section className="section">
      <header title={tip}>
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Row({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="row" title={tip}>
      <label>{label}</label>
      <div className="ctl">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, testId, wide }: { title: string; onClose: () => void; children: ReactNode; testId?: string; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} data-testid={testId}>
        <header>
          <h2>{title}</h2>
          <button className="icon" title="Close" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
