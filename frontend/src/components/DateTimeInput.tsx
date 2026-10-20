import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from '../App.module.css';
import { WEEKDAYS, formatWall, minuteOptions, monthGrid, parseWall, shiftMonth } from './calendar';

// Native datetime-local and time inputs follow the browser locale (12 h with am/pm in some), while the rest of the
// scheduling window shows 24 h. These controls keep one standard: dd/MM/yyyy HH:mm, typed or picked from one popup.
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

type TimeProps = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean };

/** 24 h time of day as two selects (5-minute steps, plus the current minute). `value` is "HH:mm" or "". */
export function TimeInput24({ label, value, onChange, disabled }: TimeProps) {
  const [hour = '', minute = ''] = value ? value.split(':') : [];
  return <div role="group" aria-label={label} className={styles.dateTime}>
    <select aria-label={`${label} (giờ)`} value={hour} disabled={disabled} onChange={(event) => onChange(`${event.target.value}:${minute || '00'}`)}>
      {!hour && <option value="">--</option>}{hours.map((item) => <option key={item}>{item}</option>)}
    </select>
    <span aria-hidden="true">:</span>
    <select aria-label={`${label} (phút)`} value={minute} disabled={disabled} onChange={(event) => onChange(`${hour || '00'}:${event.target.value}`)}>
      {!minute && <option value="">--</option>}{minuteOptions(minute).map((item) => <option key={item}>{item}</option>)}
    </select>
  </div>;
}

// Roving focus inside a list or grid of buttons: arrows move, the selected (or first) button is the tab stop.
function moveFocus(container: HTMLElement | null, current: HTMLElement, step: number) {
  const items = [...(container?.querySelectorAll<HTMLElement>('button[data-roving]:not(:disabled)') ?? [])];
  items[items.indexOf(current) + step]?.focus();
}

function scrollToSelected(element: HTMLElement | null) {
  const column = element?.parentElement;
  if (element && column) column.scrollTop = element.offsetTop - column.clientHeight / 2 + element.offsetHeight / 2;
}

type DateTimeProps = TimeProps & { defaultTime?: string; today?: string };

/** Date and 24 h time. `value` is "YYYY-MM-DDTHH:mm" (the datetime-local format) or "". */
export function DateTimeInput({ label, value, onChange, disabled, defaultTime = '00:00', today }: DateTimeProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [month, setMonth] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [date = '', time = ''] = value ? value.split('T') : [];
  const [hour = '', minute = ''] = time ? time.split(':') : [];

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapper.current?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); };
  }, [open]);

  function openPopup() {
    if (disabled) return;
    const rect = wrapper.current?.getBoundingClientRect();
    if (rect) {
      const height = 360, width = 372;
      setPosition({ top: rect.bottom + 4 + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
    }
    setMonth((date || today || new Date().toISOString().slice(0, 10)).slice(0, 7));
    setOpen(true);
  }
  function commit(text: string) {
    if (!text.trim()) { setInvalid(false); setDraft(null); if (value) onChange(''); return; }
    const parsed = parseWall(text, defaultTime);
    if (!parsed) { setInvalid(true); return; }
    setInvalid(false); setDraft(null);
    if (parsed !== value) onChange(parsed);
  }
  const pick = (next: string) => { setDraft(null); setInvalid(false); onChange(next); };
  const pickDay = (day: string) => { pick(`${day}T${time || defaultTime}`); setMonth(day.slice(0, 7)); };
  const pickHour = (next: string) => { if (date) pick(`${date}T${next}:${minute || '00'}`); };
  const pickMinute = (next: string) => { if (date) pick(`${date}T${hour || defaultTime.slice(0, 2)}:${next}`); };
  const dayKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    moveFocus(popup.current?.querySelector('[data-days]') ?? null, event.currentTarget, step);
  };
  const columnKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    moveFocus(event.currentTarget.parentElement, event.currentTarget, step);
  };
  const selectedDay = date && monthGrid(month).flat().some((day) => day.date === date) ? date : '';
  const firstOfMonth = `${month}-01`;
  const hourStop = hour || '00';
  const minuteStop = minute || '00';

  return <div role="group" aria-label={label} className={styles.dateTimeField} ref={wrapper}>
    <input ref={input} type="text" inputMode="numeric" placeholder="dd/mm/yyyy hh:mm" autoComplete="off" aria-label={`${label} (nhập)`}
      aria-invalid={invalid || undefined} disabled={disabled} value={draft ?? formatWall(value)}
      onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(event.currentTarget.value); }
        else if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); openPopup(); }
      }} />
    <button type="button" className={styles.dateTimeButton} aria-label={`Chọn ngày giờ ${label}`} aria-expanded={open} disabled={disabled}
      onClick={() => (open ? setOpen(false) : openPopup())}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.8" y="3" width="12.4" height="10.6" rx="1.6" /><path d="M1.8 6.4h12.4M5.2 1.8v2.6M10.8 1.8v2.6" /></svg>
    </button>
    {invalid && <small role="alert" className={styles.dateTimeError}>Nhập dd/mm/yyyy hh:mm (24 giờ).</small>}
    {open && createPortal(<div ref={popup} role="dialog" aria-label={`Chọn ${label}`} className={styles.dtPopover} style={position}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); input.current?.focus(); } }}>
      <div className={styles.dtCalendar}>
        <div className={styles.dtMonth}>
          <button type="button" aria-label="Tháng trước" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <strong>Tháng {month.slice(5)}/{month.slice(0, 4)}</strong>
          <button type="button" aria-label="Tháng sau" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <div className={styles.dtWeek} aria-hidden="true">{WEEKDAYS.map((name) => <span key={name}>{name}</span>)}</div>
        <div data-days>{monthGrid(month).map((week) => <div className={styles.dtWeek} key={week[0].date}>{week.map((day) =>
          <button type="button" key={day.date} data-roving data-outside={!day.inMonth || undefined} data-today={day.date === today || undefined}
            aria-pressed={day.date === date} aria-label={formatWall(`${day.date}T00:00`).slice(0, 10)}
            tabIndex={day.date === (selectedDay || firstOfMonth) ? 0 : -1} onKeyDown={dayKey} onClick={() => pickDay(day.date)}>{Number(day.date.slice(8))}</button>)}</div>)}</div>
      </div>
      <div className={styles.dtTime}>
        <div className={styles.dtColumn} role="group" aria-label="Giờ">{hours.map((item) =>
          <button type="button" key={item} data-roving aria-pressed={item === hour} disabled={!date} aria-label={`${item} giờ`} tabIndex={item === hourStop ? 0 : -1}
            ref={item === hour ? scrollToSelected : undefined} onKeyDown={columnKey} onClick={() => pickHour(item)}>{item}</button>)}</div>
        <div className={styles.dtColumn} role="group" aria-label="Phút">{minuteOptions(minute).map((item) =>
          <button type="button" key={item} data-roving aria-pressed={item === minute} disabled={!date} aria-label={`${item} phút`} tabIndex={item === minuteStop ? 0 : -1}
            ref={item === minute ? scrollToSelected : undefined} onKeyDown={columnKey} onClick={() => pickMinute(item)}>{item}</button>)}</div>
      </div>
      <div className={styles.dtFooter}><button type="button" className={styles.primary} onClick={() => { setOpen(false); input.current?.focus(); }}>Xong</button></div>
    </div>, document.body)}
  </div>;
}
