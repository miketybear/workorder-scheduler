import type { WorkOrder } from '../api/workOrders';
import { dataColumns, fieldValue } from './presentation';
import styles from '../App.module.css';

export function WorkOrderFacts({ row, timezone, datesOnly }: { row: WorkOrder; timezone: string; datesOnly?: boolean }) {
  const fields = datesOnly === undefined ? dataColumns : dataColumns.filter(([field]) =>
    ['schedstart', 'schedfinish', 'actstart', 'actfinish', 'targstartdate', 'targcompdate'].includes(field) === datesOnly);
  return <dl className={styles.detailFacts}>{fields.map(([field, label]) =>
    <div key={field}><dt>{label}</dt><dd>{fieldValue(row, field, timezone)}</dd></div>)}</dl>;
}
