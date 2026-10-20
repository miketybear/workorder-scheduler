import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Assignment } from '../api/assignments';
import { StatusIcon } from './StatusIcons';
import { isRestoringFocus } from './focusRestore';
import styles from './ResourceTimeline.module.css';

type Props = {
  item: Assignment;
  taskLabel: string;
  wonum: string | undefined;
  personName: string;
  date: string;
  hours: string;
  warning?: string;
  hue?: number;
  emphasis?: 'on' | 'dim';
  locked?: boolean;
  onPlanHover?: (hovered: boolean) => void;
  segment?: 'single' | 'start' | 'middle' | 'end';
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function AssignmentCard({ item, taskLabel, wonum, personName, date, hours, warning, segment = 'single', hue = 1, emphasis, locked, onPlanHover, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const pointerInteraction = useRef(false);
  const contextKey = `${item.id}|${taskLabel}|${date}`;
  const [tooltip, setTooltip] = useState<{ top: number; left: number; contextKey: string } | null>(null);
  const tooltipVisible = tooltip?.contextKey === contextKey;
  const [engaged, setEngaged] = useState(false);
  const [hiddenUntilLeave, setHiddenUntilLeave] = useState(false);
  const state = item.plan_sync_state ?? item.sync_state;
  const multiDay = !!item.plan_id && (item.plan_total_minutes ?? item.minutes) > item.minutes;
  const mark = state === 'unknown' ? 'pending' : state === 'synced' ? 'synced' : item.plan_id ? 'draft' : null;
  const status = state === 'unknown' ? 'Chờ đối soát Maximo' : state === 'synced' ? 'Đã đồng bộ Maximo' : item.plan_id ? multiDay ? 'Kế hoạch nhiều ngày, chưa gửi Maximo' : 'Đã xếp, chưa gửi Maximo' : item.state === 'reserved' ? 'Đã xếp, chưa gửi Maximo' : 'Chỉ xem';
  const ariaState = `${status}${multiDay ? ', nhiều ngày' : ''}${warning ? `. Cảnh báo: ${warning}` : ''}`;

  function hide() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setTooltip(null);
  }
  function show() {
    timerRef.current = null;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + 8 + 160 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 168);
    setTooltip({ top, left, contextKey });
  }
  function onPointerEnter() {
    onPlanHover?.(true);
    if (hiddenUntilLeave) return;
    setEngaged(true);
    timerRef.current = window.setTimeout(show, 2000);
  }
  function onFocus() {
    if (pointerInteraction.current || isRestoringFocus()) return;
    setHiddenUntilLeave(false);
    setEngaged(true);
    show();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
      setEngaged(false);
      setHiddenUntilLeave(true);
    }
  }
  function leave() {
    onPlanHover?.(false);
    hide();
    setEngaged(false);
    setHiddenUntilLeave(false);
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    pointerInteraction.current = true;
    hide();
    setEngaged(false);
    onPointerDown(event);
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    onPointerUp(event);
    pointerInteraction.current = false;
  }
  function pointerCancel(event: PointerEvent<HTMLButtonElement>) {
    onPointerCancel(event);
    pointerInteraction.current = false;
  }
  useEffect(() => {
    if (!engaged) return;
    const close = () => { hide(); setEngaged(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [engaged]);
  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, [contextKey]);
  useLayoutEffect(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    const bubble = tooltipRef.current;
    if (!tooltipVisible || !rect || !bubble) return;
    const height = bubble.getBoundingClientRect().height;
    const top = rect.bottom + 8 + height <= window.innerHeight - 8 ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
    if (tooltip.top !== top) setTooltip({ ...tooltip, top });
  }, [tooltip, tooltipVisible]);

  return <>
    <button ref={buttonRef} type="button" data-segment={segment} data-hue={hue} data-emphasis={emphasis} data-locked={locked || undefined} className={`${styles.assignment} ${state === 'unknown' ? styles.assignmentUnknown : ''} ${state === 'synced' ? styles.assignmentSynced : ''}`} draggable={false} onPointerEnter={onPointerEnter} onPointerLeave={leave} onFocus={onFocus} onBlur={leave} onKeyDown={onKeyDown} onPointerDown={pointerDown} onPointerMove={onPointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onClick={event=>{hide();setEngaged(false);onClick(event);}} aria-label={`Phân công ${taskLabel}, ${hours} giờ, ${personName} ngày ${date}. Trạng thái: ${ariaState}.`} aria-describedby={tooltipVisible ? `assignment-tooltip-${item.id}` : undefined}>
      <span className={styles.assignmentLine}>{segment === 'middle' || segment === 'end' ? `${hours}h` : `${item.task_id !== null && item.task_id !== undefined ? `T${item.task_id} · ` : ''}${wonum || 'WO'} · ${hours}h`}</span>
      {(segment === 'single' || segment === 'start') && <span className={styles.assignmentMarks} aria-hidden="true">{mark && <StatusIcon kind={mark} />}{warning && <StatusIcon kind="warning" />}</span>}
    </button>
    {tooltipVisible&&createPortal(<div ref={tooltipRef} id={`assignment-tooltip-${item.id}`} role="tooltip" className={styles.assignmentTooltip} style={{ top: tooltip!.top, left: tooltip!.left }}><strong>{taskLabel}</strong><span>{personName} · {date} · {hours} giờ</span><span>{status}{multiDay ? ' · Kế hoạch nhiều ngày' : ''}</span>{warning && <span className={styles.tooltipWarning}>Cảnh báo: {warning}</span>}</div>, document.body)}
  </>;
}
