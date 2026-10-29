// Owns backlog view filter controls; selection remains with the timeline.
import styles from './ResourceTimeline.module.css';

type BacklogView = 'backlog' | 'completed' | 'all';

export function BacklogFilters({ view, onChange }: { view: BacklogView; onChange: (view: BacklogView) => void }) {
  return <div className={styles.backlogFilters} role="group" aria-label="Lọc danh sách Work Order"><button type="button" aria-pressed={view==='backlog'} onClick={()=>onChange('backlog')}>Backlog</button><button type="button" aria-pressed={view==='completed'} onClick={()=>onChange('completed')}>Completed</button><button type="button" aria-pressed={view==='all'} onClick={()=>onChange('all')}>Tất cả</button></div>;
}
