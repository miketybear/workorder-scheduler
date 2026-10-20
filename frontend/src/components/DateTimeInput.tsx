import styles from '../App.module.css';

// Native datetime-local and time inputs follow the browser locale (12 h with am/pm in some), while the rest of the
// scheduling window shows 24 h. These controls keep one standard: a native date picker plus 24 h hour/minute selects.
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

type TimeProps = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean };

function TimeSelects({ label, value, onChange, disabled }: TimeProps) {
  const [hour = '', minute = ''] = value ? value.split(':') : [];
  return <>
    <select aria-label={`${label} (giờ)`} value={hour} disabled={disabled} onChange={(event) => onChange(`${event.target.value}:${minute || '00'}`)}>
      {!hour && <option value="">--</option>}{hours.map((item) => <option key={item}>{item}</option>)}
    </select>
    <span aria-hidden="true">:</span>
    <select aria-label={`${label} (phút)`} value={minute} disabled={disabled} onChange={(event) => onChange(`${hour || '00'}:${event.target.value}`)}>
      {!minute && <option value="">--</option>}{minutes.map((item) => <option key={item}>{item}</option>)}
    </select>
  </>;
}

/** 24 h time of day. `value` is "HH:mm" or "". */
export function TimeInput24(props: TimeProps) {
  return <div role="group" aria-label={props.label} className={styles.dateTime}><TimeSelects {...props} /></div>;
}

/** Date and 24 h time. `value` is "YYYY-MM-DDTHH:mm" (the datetime-local format) or "". */
export function DateTimeInput({ label, value, onChange, disabled, defaultTime = '00:00' }: TimeProps & { defaultTime?: string }) {
  const [date = '', time = ''] = value ? value.split('T') : [];
  return <div role="group" aria-label={label} className={styles.dateTime}>
    <input type="date" aria-label={`${label} (ngày)`} value={date} disabled={disabled}
      onChange={(event) => onChange(event.target.value ? `${event.target.value}T${time || defaultTime}` : '')} />
    <TimeSelects label={label} value={date ? time : ''} disabled={disabled || !date} onChange={(next) => onChange(`${date}T${next}`)} />
  </div>;
}
