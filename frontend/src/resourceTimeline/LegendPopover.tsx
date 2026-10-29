import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HelpIcon } from '../components/RouteIcon';
import styles from './ResourceTimeline.module.css';

/** The grid legend behind a help icon; Esc or a click outside closes it. */
export function LegendPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector('summary')?.focus();
    };
    const onPointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onPointer); };
  }, [open]);
  return <details ref={root} className={styles.legendPopover} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary aria-label="Chú giải" title="Chú giải"><HelpIcon size={16} /></summary>
    {children}
  </details>;
}
