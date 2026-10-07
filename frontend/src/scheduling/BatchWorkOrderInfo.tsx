import type { WorkOrder } from '../api/workOrders';
import { fieldValue } from './presentation';
import styles from '../App.module.css';

// The editable row already shows identity, work description and planned scheduling fields.
const groups = [
  { title: 'Thông tin bổ sung', fields: [['wopriority_description', 'Priority'], ['lead', 'Onshore PIC'], ['wolo10', '% Complete']] },
  { title: 'Ngày mục tiêu', fields: [['targstartdate', 'Target Start'], ['targcompdate', 'Target Finish']] },
  { title: 'Thực tế', fields: [['actstart', 'Actual Start'], ['actfinish', 'Actual Finish']] },
] as const;

export function BatchWorkOrderInfo({ row, timezone, id }: { row: WorkOrder; timezone: string; id: string }) {
  return <div id={id} role="region" aria-label={`Thông tin bổ sung ${row.wonum}`} className={styles.batchInfo}>
    {groups.map(({ title, fields }) => <section key={title}>
      <h3>{title}</h3>
      <dl className={styles.detailFacts}>{fields.map(([field, label]) => <div key={field}>
        <dt>{label}</dt><dd>{fieldValue(row, field, timezone)}</dd>
      </div>)}</dl>
    </section>)}
  </div>;
}
