import { useEffect, useId, useRef, useState } from 'react';
import { CheckmarkFilledIcon, RouteIcon, WarningFilledIcon } from '../components/RouteIcon';
import styles from '../App.module.css';

export type RouteActionKind = 'ready' | 'blocked' | 'attention' | 'done' | 'stranded' | 'unknown';

/**
 * The Action cell of one WO: an icon only, so the row keeps its height. The reason (or outcome) is a tip that opens on
 * hover, keyboard focus or tap; it is also the accessible description, and on phone cards it is printed inline.
 * A blocked button stays focusable (aria-disabled) so the reason is reachable without a mouse.
 */
export function RouteAction({ kind, label, text, onRoute }: { kind: RouteActionKind; label: string; text: string; onRoute: () => void }) {
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tipId = useId();
  const open = anchor !== null;
  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (box) setAnchor({ top: box.bottom + 6, right: Math.max(8, window.innerWidth - box.right) });
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setAnchor(null);
    // A fixed tip would drift away from its row while the table scrolls, so it closes instead.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  const routable = kind === 'ready';
  const statusIcon = kind === 'done' ? <CheckmarkFilledIcon /> : kind === 'stranded' || kind === 'unknown' ? <WarningFilledIcon /> : null;
  const className = [styles.routeIconButton, routable ? styles.routeIconReady : '', statusIcon ? styles.routeStatusIcon : '',
    kind === 'done' ? styles.routeDone : '', kind === 'stranded' ? styles.routeStranded : '', kind === 'unknown' || kind === 'attention' ? styles.routeAttention : ''].filter(Boolean).join(' ');
  return <div className={styles.routeCell}>
    <button ref={button} type="button" className={className} aria-label={label} aria-describedby={tipId} aria-disabled={routable ? undefined : true}
      onClick={() => { if (routable) { setAnchor(null); onRoute(); } else if (open) setAnchor(null); else show(); }}
      onMouseEnter={show} onMouseLeave={() => setAnchor(null)} onFocus={show} onBlur={() => setAnchor(null)}
      onKeyDown={(event) => { if (event.key === 'Escape') setAnchor(null); }}>
      {statusIcon ?? <RouteIcon />}
      {!statusIcon && <span className={styles.routeLabel}>Route</span>}
      {(routable || kind === 'attention') && <span className={styles.routeDot} data-tone={routable ? 'ready' : 'attention'} aria-hidden="true" />}
    </button>
    <small id={tipId} className={styles.routeInline}>{text}</small>
    {open && <span className={styles.routeTip} style={{ top: anchor.top, right: anchor.right }} aria-hidden="true">{text}</span>}
  </div>;
}
