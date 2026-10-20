import { isAwareDate } from '../api/dates';
import styles from '../App.module.css';
import { nearestShiftStart, shiftPosition } from './workShift';

export function opensAt(start: string, timezone: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(nearestShiftStart(start, timezone)));
}

export function outsideShift(start: string | null | undefined, timezone: string): start is string {
  return !!start && isAwareDate(start) && shiftPosition(start, timezone) !== 'inside';
}

/** Warns that a chosen start is outside the 06:30-18:30 shift; the planner keeps it or moves it to the nearest opening. */
export function ShiftNotice({ start, timezone, keptStart, onKeep, onMove }:
  { start: string | null | undefined; timezone: string; keptStart: string | null; onKeep: () => void; onMove: (opening: string) => void }) {
  if (!outsideShift(start, timezone) || keptStart === start) return null;
  const opening = nearestShiftStart(start, timezone);
  return <div role="status" className={styles.shiftNotice}>
    <p>Giờ bắt đầu nằm ngoài ca làm việc (06:30–18:30). Nếu giữ nguyên, giờ làm việc được tính từ {opensAt(start, timezone)}.</p>
    <div>
      <button type="button" className={styles.tertiary} onClick={onKeep}>Giữ nguyên giờ đã chọn</button>
      <button type="button" className={styles.tertiary} onClick={() => onMove(opening)}>Dời sang {opensAt(start, timezone)}</button>
    </div>
  </div>;
}
