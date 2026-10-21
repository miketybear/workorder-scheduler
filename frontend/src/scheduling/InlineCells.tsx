import { DateTimeInput } from '../components/DateTimeInput';
import { localDateTime, zonedDateTime } from '../api/dates';
import { picLabel } from './presentation';

/** Scheduled Start typed or picked directly in the table row; empty input is ignored (clearing is not supported). */
export function StartInput({ label, value, timezone, disabled, onChange }:
  { label: string; value: string | null; timezone: string; disabled: boolean; onChange: (aware: string) => void }) {
  return <DateTimeInput label={label} value={value ? localDateTime(value, timezone) : ''} defaultTime="06:30" disabled={disabled}
    onChange={(wall) => { if (!wall) return; try { onChange(zonedDateTime(wall, timezone)); } catch { /* a wall time that does not exist in the zone is ignored */ } }} />;
}

export function PicSelect({ label, value, pics, names, disabled, onChange }:
  { label: string; value: string | null; pics: string[]; names: Record<string, string>; disabled: boolean; onChange: (pic: string) => void }) {
  const options = value && !pics.includes(value) ? [value, ...pics] : pics;
  return <select aria-label={label} value={value ?? ''} disabled={disabled || !pics.length} onChange={(event) => { if (event.target.value) onChange(event.target.value); }}>
    {!value && <option value="">Chưa phân công</option>}
    {options.map((pic) => <option key={pic} value={pic}>{picLabel(pic, names)}</option>)}
  </select>;
}

export function DurationInput({ label, value, disabled, onChange }:
  { label: string; value: string; disabled: boolean; onChange: (hours: string) => void }) {
  return <input type="text" inputMode="decimal" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.trim())} />;
}
