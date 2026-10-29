// Owns the Grid presentation; state and operations remain in ResourceTimeline.
import { Fragment } from 'react';
import { type Assignment, type AssignmentWorkOrder, type ResourcePerson, type ResourceTimeline as TimelineData } from '../api/assignments';
import { AssignmentCard } from './AssignmentCard';
import { StatusIcon } from './StatusIcons';
import { taskHue, dayNames, displayHours, capacityFor } from './timelineHelpers';
import type { Lanes } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';
import type { Dispatch, SetStateAction, RefObject } from 'react';
type TimelinePerson = ResourcePerson & { dayMetadata: Record<string, string[]> };

type Props = {
  month: string;
  peopleSearch: string;
  setPeopleSearch: Dispatch<SetStateAction<string>>;
  dates: string[];
  today: string;
  scrollToToday: (behavior?: ScrollBehavior) => boolean;
  gridRef: RefObject<HTMLDivElement | null>;
  discipline: string;
  roster: TimelinePerson[];
  totalMinutes: (people: TimelinePerson[], field: "capacity_minutes" | "allocated_minutes", date?: string) => number;
  roleGroups: string[];
  timelineRoleOf: (person: TimelinePerson, snapshot: TimelineData | null) => string;
  shownTimeline: TimelineData;
  setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
  collapsed: Record<string, boolean>;
  roleTitle: (role: string) => string;
  rotaLeftText: (person: ResourcePerson) => string;
  lanes: Lanes;
  workOrderLabel: (item: AssignmentWorkOrder | Assignment, snapshot: TimelineData) => string;
  segmentOf: (item: Assignment) => "single" | "start" | "middle" | "end";
  hoverPlan: string | null;
  canEditItem: (item: Assignment) => boolean;
  setHoverPlan: Dispatch<SetStateAction<string | null>>;
  cardWarning: (item: Assignment) => "ngày này nằm ngoài lịch WO" | "PIC của WO chưa nằm trong người được giao" | undefined;
  beginDrag: (event: React.PointerEvent<HTMLButtonElement>, payload: string, label: string) => void;
  planDayCount: (item: Assignment) => number;
  moveDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  finishDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  cancelDrag: () => void;
  clickAssignment: (event: React.MouseEvent<HTMLButtonElement>, item: Assignment) => void;
  taskOfPlan: Map<string, number | null | undefined>;
  canWrite: boolean;
  beginCreate: (person: ResourcePerson, date: string, selected?: AssignmentWorkOrder) => void;
};

export function Grid({ month, peopleSearch, setPeopleSearch, dates, today, scrollToToday, gridRef, discipline, roster, totalMinutes, roleGroups, timelineRoleOf, shownTimeline, setCollapsed, collapsed, roleTitle, rotaLeftText, lanes, workOrderLabel, segmentOf, hoverPlan, canEditItem, setHoverPlan, cardWarning, beginDrag, planDayCount, moveDrag, finishDrag, cancelDrag, clickAssignment, taskOfPlan, canWrite, beginCreate }: Props) {
  return <section className={styles.timelineSection} aria-label="Resource timeline theo ngày"><div className={styles.panelTitle}><h2>{month ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('vi-VN', {month:'long',year:'numeric',timeZone:'UTC'}) : ''}</h2><span>Ngày làm = 10,5 giờ · rota thật</span>
        <input type="search" className={styles.peopleSearch} aria-label="Tìm nhân sự" placeholder="Tìm nhân sự" value={peopleSearch} onChange={event=>setPeopleSearch(event.target.value)} />
        <button type="button" className={styles.todayButton} disabled={!dates.includes(today)} onClick={() => scrollToToday()}>Hôm nay</button>
        <details className={styles.legendPopover}><summary aria-label="Chú giải">?</summary><div className={styles.legend}><span>Có capacity theo rota</span><span>Ngày nghỉ / trống: 0 giờ</span><span>Tải / capacity từng người</span><span><StatusIcon kind="synced" /> Đã đồng bộ Maximo</span><span><StatusIcon kind="pending" /> Chờ đối soát: chưa chắc Maximo đã nhận</span><span><StatusIcon kind="draft" /> Chưa gửi Maximo: mới lưu trong ứng dụng</span><span><i className={styles.legendBar} aria-hidden="true" /> Kế hoạch nhiều ngày: một thanh nối các ngày liền nhau</span><span className={styles.legendTasks}>Màu theo task: {[[10,4],[20,2],[30,3],[40,1],[50,5]].map(([task,hue])=><span key={task}><i data-hue={hue} />T{task}</span>)}<span><i data-hue={0} />T60+ và khác</span></span><span><StatusIcon kind="warning" /> Cảnh báo (không chặn): ngoài lịch WO hoặc PIC chưa được giao</span></div></details></div>
      <div className={styles.gridWrap} ref={gridRef}><table className={styles.grid}><thead><tr><th scope="col">Nhân sự / capacity</th>{dates.map(date => { const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); return <th scope="col" key={date} data-day-header={date} data-today={date===today||undefined}><span>{date.slice(-2)}</span><small>{dayNames[weekday]}</small></th>; })}</tr></thead>
        <tbody><tr className={styles.craftRow}><th className={styles.person}>{discipline}<small>{roster.length} người</small></th>{dates.map(date => <td key={date}>{displayHours(totalMinutes(roster, 'allocated_minutes', date))} / {displayHours(totalMinutes(roster, 'capacity_minutes', date))}h</td>)}</tr>{roleGroups.map(role => { const members = roster.filter(person => timelineRoleOf(person, shownTimeline) === role); return <Fragment key={role}><tr className={styles.roleRow}><th className={styles.person}><button onClick={() => setCollapsed(value => ({...value, [role]: !value[role]}))} aria-expanded={!collapsed[role]}>{collapsed[role] ? '＋' : '−'} {roleTitle(role)} · {members.length} người</button><small>{displayHours(totalMinutes(members, 'allocated_minutes'))} / {displayHours(totalMinutes(members, 'capacity_minutes'))}h</small></th>{dates.map(date => <td key={date}>{displayHours(totalMinutes(members, 'allocated_minutes', date))} / {displayHours(totalMinutes(members, 'capacity_minutes', date))}h</td>)}</tr>{(!collapsed[role] || !!peopleSearch.trim()) && members.filter(person => !peopleSearch.trim() || `${person.name} ${person.laborcode}`.toLowerCase().includes(peopleSearch.trim().toLowerCase())).map(person => <tr key={person.person_id}><th scope="row" className={styles.person}><strong>{person.name}</strong><small>{person.laborcode} · {[...new Set(Object.values(person.dayMetadata).flat())].join(' / ')}</small><small className={styles.rotaLeft}>{rotaLeftText(person)}</small></th>{dates.map(date => {
          const day = capacityFor(person, date); const items = shownTimeline.items.filter(item => item.state === 'reserved' && item.person_id === person.person_id && item.date === date);
          return <td key={date} className={!day ? styles.off : day.capacity_minutes > 0 ? styles.working : day.code === '' ? styles.blank : styles.off} data-person-id={person.person_id} data-date={date}>
            {(() => {
              // Hatched or missing days show nothing; the shift code and remaining hours live in the tooltip. The row keeps its height so bars align across days.
              const unverified = day?.load_complete === false, over = !!day && day.remaining_minutes < 0;
              if (!unverified && !over && !(day && day.capacity_minutes > 0)) return <div className={styles.capacity} aria-hidden="true" />;
              const note = unverified ? 'Tải chưa xác minh' : over ? `vượt ${displayHours(-day!.remaining_minutes)}h` : '';
              const tooltip = [day?.code && `Ca ${day.code}`, day && `còn ${displayHours(day.remaining_minutes)}h`, note, ...(person.dayMetadata[date] ?? [])].filter(Boolean).join(' · ');
              return <div className={styles.capacity} title={tooltip}><b>{day ? `${displayHours(day.allocated_minutes)} / ${displayHours(day.capacity_minutes)}h` : '—'}</b>{note && <small data-alert><StatusIcon kind="warning" /><span className={styles.srOnly}>{note}</span></small>}</div>;
            })()}
            {(() => {
              const bridges = lanes.bridges.get(`${person.person_id}|${date}`) ?? [];
              const top = Math.max(-1, ...items.map(item => lanes.lane.get(item.id) ?? 0), ...bridges.map(bridge => bridge.lane));
              return Array.from({ length: top + 1 }, (_, lane) => {
                const item = items.find(entry => (lanes.lane.get(entry.id) ?? 0) === lane);
                if (item) { const label=workOrderLabel(item,shownTimeline); const taskLabel=item.task_id!==null && item.task_id!==undefined ? `${item.task_description||`Task ${item.task_id}`} · ${label}` : label; return <AssignmentCard key={item.id} item={item} segment={segmentOf(item)} hue={taskHue(item.task_id)} emphasis={hoverPlan && item.plan_id ? (item.plan_id === hoverPlan ? 'on' : 'dim') : hoverPlan ? 'dim' : undefined} locked={!canEditItem(item)} onPlanHover={hovered => setHoverPlan(hovered ? item.plan_id ?? null : null)} warning={cardWarning(item)} taskLabel={taskLabel} wonum={shownTimeline.work_orders.find(order => order.site_id === item.site_id && order.workorder_id === item.workorder_id)?.wonum} personName={person.name} date={date} hours={displayHours(item.minutes)} onPointerDown={event=>{if(canEditItem(item))beginDrag(event,item.id,item.plan_id&&planDayCount(item)>1?`Chuyển cả task (${planDayCount(item)} ngày) · ${taskLabel}`:taskLabel);}} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onClick={event=>clickAssignment(event,item)} />;}
                const bridge = bridges.find(entry => entry.lane === lane);
                return bridge ? <div key={`bridge-${lane}`} className={styles.bridge} data-hue={taskHue(taskOfPlan.get(bridge.plan))} aria-hidden="true" /> : <div key={`gap-${lane}`} className={styles.laneGap} aria-hidden="true" />;
              });
            })()}
            <button className={styles.addCell} aria-label={`Thêm phân công cho ${person.name} ngày ${date}`} disabled={!canWrite || !day || day.capacity_minutes < 1} onClick={() => beginCreate(person, date)}>+ WO</button>
          </td>;
        })}</tr>)}</Fragment>; })}</tbody></table></div></section>;
}


