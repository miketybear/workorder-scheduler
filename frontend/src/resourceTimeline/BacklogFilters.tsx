// Owns backlog filter chips; selection remains with the timeline. Choosing an active chip clears it.
import type { BacklogCounts, BacklogReadiness } from '../api/workOrders';
import styles from './ResourceTimeline.module.css';

type BacklogView = 'backlog' | 'completed' | 'all';
type Props = { view: BacklogView; onChange: (view: BacklogView) => void; readiness: BacklogReadiness; onReadinessChange: (readiness: BacklogReadiness) => void; counts?: BacklogCounts };

function Chip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button type="button" className={styles.filterChip} aria-pressed={active} onClick={onClick}>{active&&<span aria-hidden="true">✓</span>}{label}{count!==undefined&&<span className={styles.chipCount}>{count}</span>}</button>;
}

export function BacklogFilters({ view, onChange, readiness, onReadinessChange, counts }: Props) {
  const pickView = (next: BacklogView) => onChange(view === next ? 'all' : next);
  const pickReadiness = (next: BacklogReadiness) => onReadinessChange(readiness === next ? 'all' : next);
  return <div className={styles.backlogFilters} role="group" aria-label="Lọc danh sách Work Order">
    <Chip label="Chưa phân đủ" count={counts?.backlog} active={view==='backlog'} onClick={()=>pickView('backlog')} />
    <Chip label="Đã phân đủ" count={counts?.completed} active={view==='completed'} onClick={()=>pickView('completed')} />
    <Chip label="Sẵn sàng" count={counts?.ready} active={readiness==='ready'} onClick={()=>pickReadiness('ready')} />
    <Chip label="Thiếu lịch/PIC" count={counts?.missing} active={readiness==='missing'} onClick={()=>pickReadiness('missing')} />
  </div>;
}
