import type { WorkOrder } from '../api/workOrders';
import { columns } from '../api/workOrders';
import { fieldValue, picLabel } from './presentation';
import styles from '../App.module.css';

// The table hides System ID to stay compact; the WO's own facts show it.
const factColumns = columns.filter(([field]) => field !== 'workorderid');

export function WorkOrderFacts({ row, timezone, datesOnly, picNames, omit }: { row: WorkOrder; timezone: string; datesOnly?: boolean; picNames?: Record<string, string>; omit?: string[] }) {
  const fields = datesOnly === undefined ? factColumns : factColumns.filter(([field]) =>
    ['schedstart', 'schedfinish', 'actstart', 'actfinish', 'targstartdate', 'targcompdate'].includes(field) === datesOnly);
  return <dl className={styles.detailFacts}>{fields.filter(([field]) => !omit?.includes(field)).map(([field, label]) =>
    <div key={field}><dt>{label}</dt><dd>{field === 'assignedto' || field === 'lead' ? picLabel(row[field], picNames) || fieldValue(row, field, timezone) : fieldValue(row, field, timezone)}</dd></div>)}</dl>;
}
