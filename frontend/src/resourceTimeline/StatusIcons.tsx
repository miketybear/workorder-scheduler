import type { ReactElement } from 'react';
import styles from './ResourceTimeline.module.css';

// Shared marks for assignment state, used on cards and in the legend. Decorative: the state is also in text.
type Kind = 'synced' | 'pending' | 'draft' | 'multiday' | 'warning';

const shapes: Record<Kind, ReactElement> = {
  synced: <><circle cx="8" cy="8" r="6.5" /><path d="M5 8.3l2.1 2.1 3.9-4.3" /></>,
  pending: <><circle cx="8" cy="8" r="6.5" /><path d="M8 4.6V8l2.3 1.5" /></>,
  draft: <><circle cx="8" cy="8" r="6.5" strokeDasharray="2.4 2.2" /><path d="M8 10.6V5.6M5.8 7.8L8 5.6l2.2 2.2" /></>,
  warning: <><path d="M8 1.8L14.6 13.4H1.4Z" /><path d="M8 6.4v3.2M8 11.4v.2" /></>,
  multiday: <><rect x="1.8" y="3" width="12.4" height="10.6" rx="1.6" /><path d="M1.8 6.4h12.4M5.2 1.8v2.6M10.8 1.8v2.6M5 10h6M9.4 8.5L11 10l-1.6 1.5" /></>,
};

export function StatusIcon({ kind }: { kind: Kind }) {
  return <svg className={`${styles.statusIcon} ${styles[`icon_${kind}`]}`} viewBox="0 0 16 16" aria-hidden="true">{shapes[kind]}</svg>;
}
