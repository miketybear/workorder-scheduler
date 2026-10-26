import type { WorkOrder } from '../api/workOrders';
import { dataColumns, fieldValue, picLabel } from './presentation';
import styles from '../App.module.css';

export function WorkOrderFacts({ row, timezone, datesOnly, picNames }: { row: WorkOrder; timezone: string; datesOnly?: boolean; picNames?: Record<string, string> }) {
  const fields = datesOnly === undefined ? dataColumns : dataColumns.filter(([field]) =>
    ['schedstart', 'schedfinish', 'actstart', 'actfinish', 'targstartdate', 'targcompdate'].includes(field) === datesOnly);
  return <dl className={styles.detailFacts}>{fields.map(([field, label]) =>
    <div key={field}><dt>{label}</dt><dd>{field === 'assignedto' || field === 'lead' ? picLabel(row[field], picNames) || fieldValue(row, field, timezone) : fieldValue(row, field, timezone)}</dd></div>)}</dl>;
}
