// Owns the AssignmentDrawer presentation; state and operations remain in ResourceTimeline.
import { type AssignmentInput, type TaskAllocationInput, type TaskPlanBatchInput, type WorkOrderTask, type PlanSegmentsInput, type PlanReleaseInput, type Assignment, type AssignmentWorkOrder, type CapacityDay, type ResourcePerson, type ResourceTimeline as TimelineData, type WorkOrderTasks, type AssignmentUploadResult } from '../api/assignments';
import { type ResourcePool } from '../api/rotaImports';
import { type WorkOrder } from '../api/workOrders';
import { PlanUpload } from './PlanUpload';
import { DateTimeInput } from '../components/DateTimeInput';
import { taskHue, dayNames, addCalendarDays, displayHours, displayDate, formatMaximoDateTime, expectedFinish, parseHours, capacityFor } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';
import type { Dispatch, SetStateAction, RefObject } from 'react';
type TimelinePerson = ResourcePerson & { dayMetadata: Record<string, string[]> };
type Cell = { person: ResourcePerson; date: string };
type Proposal = { item?: Assignment; workOrder?: AssignmentWorkOrder; cell: Cell; minutes: number; hours: string };
type Pending = { requestId: string; kind: 'create' | 'update' | 'delete' | 'task-batch' | 'task-plan-batch'; assignmentId?: string; input?: AssignmentInput; taskInput?: TaskAllocationInput; planBatchInput?:TaskPlanBatchInput; version?: number; item?: Assignment; context: { principal: string; connectionId: string; discipline: string; poolId: string; month: string } };

type Props = {
  verifyPlan: React.ComponentProps<typeof PlanUpload>["verify"];
  onPlanConfirmed: React.ComponentProps<typeof PlanUpload>["onConfirmed"];
  dialogRef: RefObject<HTMLElement | null>;
  busy: boolean;
  pending: Pending | null;
  uploading: boolean;
  uploadUnknownRequest: string;
  planUploadCloseLocked: boolean;
  setProposal: Dispatch<SetStateAction<Proposal | null>>;
  confirmedReadOnly: boolean;
  proposal: Proposal;
  canEditItem: (item: Assignment) => boolean;
  planItem: Assignment | null;
  workOrderLabel: (item: AssignmentWorkOrder | Assignment, snapshot: TimelineData) => string;
  shownTimeline: TimelineData;
  planMenu: boolean;
  setPlanMenu: Dispatch<SetStateAction<boolean>>;
  planUploadLocked: boolean;
  beginPlanMove: (item: Assignment, person: ResourcePerson, date: string, wholeTask?: boolean) => void;
  canWrite: boolean;
  setConfirmRelease: Dispatch<SetStateAction<boolean>>;
  roster: TimelinePerson[];
  planDaysOfItem: Assignment[];
  planDaysChanged: boolean;
  planDayMinutes: (day: Assignment) => number;
  planDayLoad: (day: Assignment) => { capacity: number; others: number; };
  planDayRoom: (day: Assignment) => number;
  dayHours: Record<string, string>;
  daysUnknown: PlanSegmentsInput | null;
  setDayHours: Dispatch<SetStateAction<Record<string, string>>>;
  planDaysTotal: number;
  reconcilePlanDays: () => Promise<void>;
  confirmRelease: boolean;
  releaseUnknown: PlanReleaseInput | null;
  reconcilePlanRelease: () => Promise<void>;
  releaseWholePlan: () => Promise<void>;
  confirmedPlanItem: Assignment | null | undefined;
  confirmedTask: WorkOrderTask | undefined;
  confirmedLaborcode: string;
  shownPool: ResourcePool | null;
  taskLoading: boolean;
  taskError: string;
  confirmedPlanItems: Assignment[];
  confirmedCoverageComplete: boolean;
  confirmedCoverageMinutes: number;
  displayedProposalDate: string | undefined;
  taskData: WorkOrderTasks | null;
  selectedTaskTotal: number;
  dialogWorkOrders: WorkOrder[];
  resetProposalDetails: (loading: boolean) => void;
  setTaskPlanStart: Dispatch<SetStateAction<string>>;
  taskPlanMode: boolean;
  setTaskPlanSegments: Dispatch<SetStateAction<Record<string, Record<string, number>>>>;
  taskPlanStart: string;
  taskPlanCapacityLoading: boolean;
  dates: string[];
  taskOrder: AssignmentWorkOrder | undefined;
  foreignOnlyTasks: WorkOrderTask[];
  discipline: string;
  selectedTasks: Record<string, boolean>;
  setSelectedTasks: Dispatch<SetStateAction<Record<string, boolean>>>;
  taskMinutes: Record<string, string>;
  setTaskMinutes: Dispatch<SetStateAction<Record<string, string>>>;
  taskAssignments: Record<string, string>;
  setTaskAssignments: Dispatch<SetStateAction<Record<string, string>>>;
  assignableTasks: WorkOrderTask[];
  planDates: string[];
  planTasks: { key: string; taskId: number; minutes: number; }[];
  planTaskTotals: { [k: string]: number; };
  visibleTaskPlans: { [k: string]: { [k: string]: number; }; };
  availableByDate: Map<string, number>;
  taskPlanCapacityDays: CapacityDay[];
  planDayTotals: { [k: string]: number; };
  taskPlanCapacityMatches: boolean;
  taskPlanCapacity: { key: string; state: "loading" | "ready" | "error"; days?: CapacityDay[]; error?: string; } | undefined;
  setTaskPlanCapacity: Dispatch<SetStateAction<{ key: string; state: "loading" | "ready" | "error"; days?: CapacityDay[]; error?: string; } | undefined>>;
  taskPlanContextKey: string;
  planPlaced: number;
  planUnplaced: number;
  taskPlanDates: string[];
  automaticPlans: { plans: Record<string, Record<string, number>>; blocked: boolean; unplaced: number; end: string; };
  planOverallocated: number;
  planValid: boolean;
  planEditLimit: number;
  displayedProposalDay: CapacityDay | undefined;
  proposalDirty: boolean;
  uploadWall: string;
  uploadResult: AssignmentUploadResult | null;
  setUploadWall: Dispatch<SetStateAction<string>>;
  submitUpload: (item: Assignment) => Promise<void>;
  reconcileUpload: () => Promise<void>;
  pool: ResourcePool | null;
  planRecovery: { key: string; items: Assignment[]; } | null;
  planRecoveryKey: string;
  setPlanUploadLocked: Dispatch<SetStateAction<boolean>>;
  setPlanUploadCloseLocked: Dispatch<SetStateAction<boolean>>;
  submit: (kind: Pending["kind"]) => Promise<void>;
  unknown: boolean;
  planDaysValid: boolean;
  savePlanDays: () => Promise<void>;
  proposalDay: CapacityDay | undefined;
  chosenTaskKeys: string[];
};

export function AssignmentDrawer({ verifyPlan, onPlanConfirmed, dialogRef, busy, pending, uploading, uploadUnknownRequest, planUploadCloseLocked, setProposal, confirmedReadOnly, proposal, canEditItem, planItem, workOrderLabel, shownTimeline, planMenu, setPlanMenu, planUploadLocked, beginPlanMove, canWrite, setConfirmRelease, roster, planDaysOfItem, planDaysChanged, planDayMinutes, planDayLoad, planDayRoom, dayHours, daysUnknown, setDayHours, planDaysTotal, reconcilePlanDays, confirmRelease, releaseUnknown, reconcilePlanRelease, releaseWholePlan, confirmedPlanItem, confirmedTask, confirmedLaborcode, shownPool, taskLoading, taskError, confirmedPlanItems, confirmedCoverageComplete, confirmedCoverageMinutes, displayedProposalDate, taskData, selectedTaskTotal, dialogWorkOrders, resetProposalDetails, setTaskPlanStart, taskPlanMode, setTaskPlanSegments, taskPlanStart, taskPlanCapacityLoading, dates, taskOrder, foreignOnlyTasks, discipline, selectedTasks, setSelectedTasks, taskMinutes, setTaskMinutes, taskAssignments, setTaskAssignments, assignableTasks, planDates, planTasks, planTaskTotals, visibleTaskPlans, availableByDate, taskPlanCapacityDays, planDayTotals, taskPlanCapacityMatches, taskPlanCapacity, setTaskPlanCapacity, taskPlanContextKey, planPlaced, planUnplaced, taskPlanDates, automaticPlans, planOverallocated, planValid, planEditLimit, displayedProposalDay, proposalDirty, uploadWall, uploadResult, setUploadWall, submitUpload, reconcileUpload, pool, planRecovery, planRecoveryKey, setPlanUploadLocked, setPlanUploadCloseLocked, submit, unknown, planDaysValid, savePlanDays, proposalDay, chosenTaskKeys }: Props) {
  return <div className={`${styles.overlay} ${styles.drawerOverlay}`}><section ref={dialogRef} className={`${styles.dialog} ${styles.drawer}`} role="dialog" aria-modal="true" aria-labelledby="proposal-title" onKeyDown={event=>{if(event.key==='Escape'&&!busy&&!pending&&!uploading&&!uploadUnknownRequest&&!planUploadCloseLocked){event.preventDefault();event.stopPropagation();setProposal(null);}}}>
      <h2 id="proposal-title">{confirmedReadOnly?'Kế hoạch đã đồng bộ Maximo':proposal.item ? proposal.item.sync_state==='synced'?'Phân công trên Maximo':canEditItem(proposal.item) ? planItem ? 'Kế hoạch task' : proposal.item.person_id === proposal.cell.person.person_id && proposal.item.date === proposal.cell.date ? 'Sửa phân công' : 'Chuyển phân công' : 'WO không còn đủ điều kiện chỉnh sửa' : 'Phân công WO'}</h2>
      {planItem&&<section className={styles.planPanel} aria-label="Tóm tắt kế hoạch task">
        <header className={styles.planHead} data-hue={taskHue(planItem.task_id)}>
          <div><strong title={workOrderLabel(planItem,shownTimeline)}>{workOrderLabel(planItem,shownTimeline)}</strong><small>{planItem.task_id!==null&&planItem.task_id!==undefined?`Task ${planItem.task_id}`:'Phân công'}{planItem.task_description&&planItem.task_description!==workOrderLabel(planItem,shownTimeline)?` · ${planItem.task_description}`:''}</small></div>
          <span className={styles.statusChip} data-state={planItem.plan_sync_state??planItem.sync_state??'local'}>{({local:'Chưa gửi Maximo',unknown:'Chờ đối soát Maximo'} as Record<string,string>)[planItem.plan_sync_state??planItem.sync_state??'local']??'Đã đồng bộ'}</span>
          <div className={styles.moreMenu}>
            <button type="button" className={styles.iconButton} aria-label="Thao tác khác" aria-haspopup="menu" aria-expanded={planMenu} onClick={()=>setPlanMenu(open=>!open)}>⋯</button>
            {planMenu&&<div role="menu" className={styles.menuList}>
              {(planItem.plan_sync_state??planItem.sync_state??'local')==='local'&&<button type="button" role="menuitem" disabled={busy||!!pending||planUploadLocked} onClick={()=>{setPlanMenu(false);beginPlanMove(planItem,proposal.cell.person,proposal.cell.date,true);}}>Đổi người / ngày bắt đầu…</button>}
              <button type="button" role="menuitem" data-danger disabled={!canWrite||!canEditItem(planItem)||planUploadLocked||busy||(planItem.plan_sync_state??planItem.sync_state??'local')!=='local'} onClick={()=>{setPlanMenu(false);setConfirmRelease(true);}}>Xóa cả kế hoạch…</button>
            </div>}
          </div>
        </header>
        <dl className={styles.planFacts}>
          <div><dt>Nhân lực</dt><dd>{roster.find(person=>person.person_id===planItem.person_id)?.name??'—'}</dd></div>
          <div><dt>Khoảng ngày</dt><dd><span className={styles.nowrap}>{planDaysOfItem.length?`${displayDate(planDaysOfItem[0].date)} → ${displayDate(planDaysOfItem[planDaysOfItem.length-1].date)}`:'—'}</span> <small>{planDaysOfItem.length} ngày</small></dd></div>
          <div><dt>Tổng giờ</dt><dd>{displayHours(planItem.plan_total_minutes??planItem.minutes)} giờ</dd></div>
        </dl>
        <div className={styles.sectionHead}><h3>Giờ theo ngày</h3>{planDaysChanged&&<span className={styles.dirtyBadge}>Chưa lưu</span>}</div>
        <ul className={styles.dayLegend} aria-label="Chú giải màu thanh giờ"><li><i data-kind="plan" />Task này</li><li><i data-kind="others" />Task khác</li><li><i data-kind="over" />Vượt rota</li><li>Cả thanh = rota của ngày · hàng tô nền = ngày bạn bấm</li></ul>
        <ul className={styles.dayRows} aria-label="Giờ theo ngày của kế hoạch">
          {planDaysOfItem.map(day=>{const minutes=planDayMinutes(day);const load=planDayLoad(day);const room=planDayRoom(day);return <li key={day.id} data-current={day.id===planItem.id||undefined}>
            <span className={styles.dayName}>{dayNames[new Date(`${day.date}T00:00:00Z`).getUTCDay()]} · {displayDate(day.date)}</span>
            <span className={styles.dayBar} aria-hidden="true" data-over={room<0||undefined}><i data-kind="others" title={`Task khác trong ngày: ${displayHours(load.others)}h`} style={{width:`${Math.min(100,load.others/Math.max(load.capacity,1)*100)}%`}} /><i data-kind="plan" style={{width:`${Math.min(100,minutes/Math.max(load.capacity,1)*100)}%`}} /></span>
            <label className={styles.dayInput}><input aria-label={`Giờ ngày ${displayDate(day.date)}`} type="number" min="0" max="10.5" step="any" value={day.id in dayHours?dayHours[day.id]:String(day.minutes/60)} disabled={busy||!!pending||planUploadLocked||!canEditItem(day)||!!daysUnknown} onChange={event=>setDayHours(current=>({...current,[day.id]:event.target.value}))} /><span>h</span></label>
            <small className={styles.dayRoom} data-over={room<0||undefined}>{load.capacity<=0?'Không có rota':room<0?`vượt ${displayHours(-room)}h`:room===0?'hết rota':`còn ${displayHours(room)}h`}</small>
          </li>;})}
        </ul>
        <p className={styles.planTotal} data-state={planDaysTotal===(planItem.plan_total_minutes??planItem.minutes)?'ok':'diff'}><span>Tổng giờ task</span><span>{displayHours(planDaysTotal)} / {displayHours(planItem.plan_total_minutes??planItem.minutes)}h{planDaysTotal===(planItem.plan_total_minutes??planItem.minutes)?' · đủ':` · ${planDaysTotal>(planItem.plan_total_minutes??planItem.minutes)?'thừa':'thiếu'} ${displayHours(Math.abs(planDaysTotal-(planItem.plan_total_minutes??planItem.minutes)))}h`}</span></p>
        {planDaysChanged&&planDaysTotal!==(planItem.plan_total_minutes??planItem.minutes)&&<p role="alert">Tổng giờ các ngày phải bằng {displayHours(planItem.plan_total_minutes??planItem.minutes)} giờ của task (hiện {displayHours(planDaysTotal)} giờ). Để 0 để bỏ một ngày.</p>}
        {planDaysOfItem.some(day=>planDayMinutes(day)!==day.minutes&&planDayRoom(day)<0)&&<p role="alert">Có ngày vượt rota còn lại; giảm giờ ngày đó hoặc chuyển bớt sang ngày khác.</p>}
        {daysUnknown&&<div className={styles.planMore}><button type="button" disabled={busy} onClick={()=>void reconcilePlanDays()}>Kiểm tra kết quả</button></div>}
        {(confirmRelease||releaseUnknown)&&<div role="alertdialog" aria-label="Xác nhận xóa cả kế hoạch" className={styles.releaseConfirm}>
          <p><strong>Xóa cả kế hoạch này?</strong> {planDaysOfItem.length} ngày, {displayHours(planItem.plan_total_minutes??planItem.minutes)} giờ sẽ được trả lại rota của {roster.find(person=>person.person_id===planItem.person_id)?.name??'nhân lực'}. Maximo không bị thay đổi.</p>
          <div>{releaseUnknown?<button type="button" disabled={busy} onClick={()=>void reconcilePlanRelease()}>Kiểm tra kết quả</button>:<><button type="button" disabled={busy} onClick={()=>setConfirmRelease(false)}>Giữ lại</button><button type="button" data-danger disabled={busy} onClick={()=>void releaseWholePlan()}>Xóa cả kế hoạch</button></>}</div>
        </div>}
      </section>}
      {confirmedReadOnly&&confirmedPlanItem?<section className={styles.planPanel} aria-label="Chi tiết kế hoạch đã đồng bộ">
        <header className={styles.planHead} data-hue={taskHue(confirmedPlanItem.task_id)}>
          <div><strong>{workOrderLabel(confirmedPlanItem,shownTimeline)}</strong><small>Task {confirmedPlanItem.task_id}: {confirmedTask?.description||confirmedPlanItem.task_description||'—'}</small></div>
          <span className={styles.statusChip} data-state="synced">Đã đồng bộ Maximo</span>
        </header>
        <dl className={styles.planFacts}>
          <div><dt>Nhân lực</dt><dd>{roster.find(person=>person.person_id===confirmedPlanItem.person_id)?.name||'—'} · {confirmedLaborcode}</dd></div>
          <div><dt>Site · WO status</dt><dd>{confirmedPlanItem.site_id} · {shownTimeline?.work_orders.find(order=>order.site_id===confirmedPlanItem.site_id&&order.workorder_id===confirmedPlanItem.workorder_id)?.status||'—'}</dd></div>
          <div><dt>Kết nối</dt><dd>{shownPool?`${shownPool.connection_label} · ${shownPool.environment==='test'?'Test':shownPool.environment}`:'—'}</dd></div>
        </dl>
        {taskLoading&&<p role="status">Đang tải assignments Maximo mới nhất…</p>}{taskError&&<p role="status">Không tải được assignments Maximo mới nhất; giờ bắt đầu hiển thị —.</p>}
        <h3>Các ngày đã đồng bộ</h3>
        <table className={styles.syncedGrid} aria-label="Các ngày Maximo đã đồng bộ"><thead><tr><th scope="col">Ngày</th><th scope="col">Giờ</th><th scope="col">Lịch Maximo</th><th scope="col">Trạng thái</th></tr></thead><tbody>{confirmedPlanItems.map(segment=>{const remote=segment.remote_assignment_id?confirmedTask?.assignments.find(candidate=>candidate.assignment_id===segment.remote_assignment_id):undefined;const scheduledStart=remote?.scheduledate??null;const segmentHours=remote?.labor_hours??segment.minutes/60;const zone=shownPool?.timezone??'UTC';return <tr key={segment.id}><th scope="row">{dayNames[new Date(`${segment.date}T00:00:00Z`).getUTCDay()]} · {displayDate(segment.date)}</th><td>{displayHours(Math.round(segmentHours*60))}h</td><td>{formatMaximoDateTime(scheduledStart,zone)} → {expectedFinish(scheduledStart,segmentHours,zone)}</td><td>{remote?.status||'—'}</td></tr>;})}</tbody></table>
        <p className={styles.planTotal} data-state={confirmedCoverageComplete?'ok':'diff'}>{confirmedCoverageComplete?`Đã khớp ${confirmedPlanItems.length} ngày với Maximo · tổng ${displayHours(confirmedPlanItem.plan_total_minutes??0)} giờ.`:`Mới thấy ${confirmedPlanItems.length} ngày (${displayHours(confirmedCoverageMinutes)} / ${displayHours(confirmedPlanItem.plan_total_minutes??0)} giờ); danh sách có thể thiếu ngày.`}</p>
      </section>:planItem?null:<p><strong>{proposal.item?.task_id ? `${proposal.item.task_description||`Task ${proposal.item.task_id}`} · ` : ''}{proposal.item ? workOrderLabel(proposal.item, shownTimeline) : proposal.workOrder ? workOrderLabel(proposal.workOrder, shownTimeline) : 'WO cần phân công'}</strong>{proposal.item && (proposal.item.person_id !== proposal.cell.person.person_id || proposal.item.date !== proposal.cell.date) && <> · từ {roster.find(person => person.person_id === proposal.item?.person_id)?.name} / {displayDate(proposal.item.date)}</>} → {proposal.cell.person.name} / {displayDate(displayedProposalDate??'')} · {displayHours(!proposal.item&&taskData?.tasks.length?selectedTaskTotal:proposal.minutes)} giờ</p>}
      {!proposal.item && <label>Work Order<select aria-label="Work Order" disabled={busy || !!pending || uploading || !!uploadUnknownRequest} value={proposal.workOrder ? `${proposal.workOrder.site_id}|${proposal.workOrder.workorder_id}` : ''} onChange={event => { const order = dialogWorkOrders.find(item => `${item.siteid}|${item.workorderid}` === event.target.value); if (order) {resetProposalDetails(true);setTaskPlanStart(proposal.cell.date);setProposal({ ...proposal, workOrder: { connection_id: shownPool!.connection_id, site_id: order.siteid, workorder_id: order.workorderid, wonum: order.wonum, description: order.description ?? '', status: order.status, eligible: true } });} }}><option value="">Chọn WO…</option>{dialogWorkOrders.map(item => <option key={`${item.siteid}:${item.workorderid}`} value={`${item.siteid}|${item.workorderid}`}>{item.wonum} · {item.description || item.status}</option>)}</select></label>}
      {!confirmedReadOnly&&!planItem&&<div className={styles.personDateRow}><label>Nhân lực<select aria-label="Nhân lực phân công" value={proposal.cell.person.person_id} disabled={busy || !!pending || planUploadLocked || !!proposal.item?.plan_id || !!proposal.item && !canEditItem(proposal.item)} onChange={event => { const person = roster.find(row => row.person_id === event.target.value); if (person) {setProposal({...proposal, cell:{person, date:proposal.cell.date}});if(!taskPlanMode)setTaskPlanStart(proposal.cell.date);setTaskPlanSegments({});} }}>{roster.map(person => <option key={person.person_id} value={person.person_id}>{person.name}</option>)}</select></label>
      {!proposal.item&&taskPlanMode?<div className={styles.field}><span>Ngày bắt đầu</span><DateTimeInput dateOnly label="Ngày bắt đầu" value={taskPlanStart} min={proposal.cell.date} max={addCalendarDays(proposal.cell.date,365)} disabled={busy||!!pending||taskPlanCapacityLoading} onChange={value=>{setTaskPlanStart(value);setTaskPlanSegments({});}}/></div>:<div className={styles.field}><span>Ngày rota</span><DateTimeInput dateOnly label="Ngày phân công" value={proposal.cell.date} min={dates[0]} max={dates[dates.length-1]} isDayDisabled={date => date !== proposal.cell.date && (capacityFor(proposal.cell.person,date)?.capacity_minutes ?? 0) <= 0} disabled={busy || !!pending || !!proposal.item && !canEditItem(proposal.item)} onChange={date => {if(!date)return;setProposal({...proposal, cell:{...proposal.cell, date}});setTaskPlanStart(date);setTaskPlanSegments({});}}/><small>Còn {displayHours(capacityFor(proposal.cell.person,proposal.cell.date)?.remaining_minutes ?? 0)} giờ trong ngày này</small></div>}</div>}
      {taskOrder && taskLoading && <p role="status">Đang tải task và assignment Maximo…</p>}
      {taskOrder && taskError && <p role="alert">{taskError}</p>}
      {!proposal.item && taskData?.tasks.length ? <div className={styles.taskWorkspace} aria-label="Phân bổ task theo ngày">
        <section className={styles.taskPicker} aria-label="Task cần phân công">
        <strong>Chọn task để phân công</strong>
        <p>Tự động chia giờ theo rota, tối đa 10,5 giờ/ngày.</p>
        {!!foreignOnlyTasks.length&&<p className={styles.foreignTaskNote} role="note">Task {foreignOnlyTasks.map(task=>task.task_id).join(', ')} thuộc nhóm khác; không phân công trong {discipline}.</p>}
        <div className={styles.taskCards}>{taskData.tasks.map(task=>{
          const key=`${task.task_workorder_id}:${task.task_id}`;
          const foreignOnly=task.has_out_of_scope_demand===true&&task.planned_labor.length===0&&task.assignments.length===0;
          if(foreignOnly)return <article key={key} className={`${styles.taskCard} ${styles.foreignTaskCard}`}><div><b>Task {task.task_id}</b><span>{task.description||'Không có mô tả'}</span><strong>Ngoài nhóm {discipline} · Không thể phân công</strong></div></article>;
          const labor=task.planned_labor.filter(entry=>entry.craft===discipline);
          const planned=Math.round(labor.reduce((sum,entry)=>sum+entry.labor_hours*entry.quantity,0)*60);
          const candidates=task.assignments.filter(entry=>entry.craft===discipline&&entry.status.toUpperCase()==='WAITASGN'&&!entry.laborcode&&!entry.scheduledate&&!shownTimeline.items.some(item=>item.state==='reserved'&&item.assignment_id===entry.assignment_id));
          return <article key={key} className={`${styles.taskCard} ${selectedTasks[key]?styles.taskCardSelected:''}`}>
            <label className={styles.taskCheck}><input type="checkbox" checked={!!selectedTasks[key]} disabled={busy||!!pending||uploading||!!uploadUnknownRequest||!candidates.length} onChange={event=>{setSelectedTasks(value=>({...value,[key]:event.target.checked}));setTaskPlanSegments(value=>{const next={...value};delete next[key];return next;});}}/><span className={styles.taskCheckContent}><b>Task {task.task_id}</b><span className={styles.taskDescription}>{task.description||'Không có mô tả'}</span>{task.has_out_of_scope_demand===true&&<small>Chỉ phân công labor {discipline}; có nhu cầu nhóm khác</small>}{!candidates.length&&<small>Không có assignment WAITASGN khả dụng</small>}</span></label>
            {selectedTasks[key]&&<div className={styles.taskControls}>
              <label className={styles.taskHoursLabel}><span>Giờ phân công</span><span className={styles.hoursField}><input aria-label={`Giờ Task ${task.task_id}`} type="number" min="0.01" max="3843" step="any" value={taskMinutes[key]?String(Number(taskMinutes[key])/60):''} disabled={busy||!!pending||uploading||!!uploadUnknownRequest||taskPlanCapacityLoading} onChange={event=>{setTaskMinutes(value=>({...value,[key]:String(parseHours(event.target.value))}));setTaskPlanSegments(value=>{const next={...value};delete next[key];return next;});}}/><span>giờ</span></span></label>
              {candidates.length===1?<div className={styles.taskAssignmentStatic} aria-label={`Assignment Maximo Task ${task.task_id}`}><span>Assignment Maximo</span><strong>WAITASGN · {candidates[0].craft}{candidates[0].labor_hours===null?'':` · ${displayHours(Math.round(candidates[0].labor_hours*60))}h`}</strong></div>:<label>Assignment Maximo<select aria-label={`Assignment Task ${task.task_id}`} value={taskAssignments[key]??''} disabled={busy||!!pending||uploading||!!uploadUnknownRequest||taskPlanCapacityLoading} onChange={event=>{const assignment=candidates.find(candidate=>candidate.assignment_id===event.target.value);setTaskAssignments(value=>({...value,[key]:event.target.value}));if(assignment?.labor_hours!==null&&assignment?.labor_hours!==undefined){setTaskMinutes(value=>({...value,[key]:String(Math.round(assignment.labor_hours!*60))}));setTaskPlanSegments(value=>{const next={...value};delete next[key];return next;});}else if(assignment){setTaskMinutes(value=>({...value,[key]:String(planned)}));setTaskPlanSegments(value=>{const next={...value};delete next[key];return next;});}}}><option value="">Chọn assignment WAITASGN…</option>{candidates.map((candidate,index)=><option key={candidate.assignment_id} value={candidate.assignment_id}>WAITASGN · {candidate.craft}{candidates.length>1?` · ${index+1}`:''}{candidate.labor_hours===null?'':` · ${displayHours(Math.round(candidate.labor_hours*60))}h`}</option>)}</select></label>}
            </div>}
            {candidates.length>1&&!taskAssignments[key]&&selectedTasks[key]&&<small role="status">Chọn đúng dòng assignment WAITASGN trước khi lưu.</small>}
          </article>;
        })}{!assignableTasks.length&&<p>Không có task thuộc nhóm {discipline} để phân công.</p>}</div>
        </section>
        <section className={styles.dayPlanPanel} aria-label="Bảng phân bổ theo ngày">
        <div className={styles.planGridWrap}><table className={styles.planGrid} aria-label="Bảng phân bổ task theo ngày"><thead><tr><th>Task / giờ cần xếp</th>{planDates.map(date=><th key={date}>{displayDate(date)}</th>)}</tr></thead><tbody>
          {planTasks.map(task=><tr key={task.key}><th scope="row">Task {task.taskId}<small>{displayHours(task.minutes)}h cần xếp · {displayHours(planTaskTotals[task.key]??0)}h đã xếp</small></th>{planDates.map(date=>{const other=Object.entries(visibleTaskPlans).filter(([otherKey])=>otherKey!==task.key).reduce((sum,[,segments])=>sum+(segments[date]??0),0);const remaining=Math.max(0,(availableByDate.get(date)??0)-other);const value=visibleTaskPlans[task.key]?.[date]??0;return <td key={date}><input aria-label={`Task ${task.taskId} giờ ngày ${date}`} type="number" min="0" max={remaining/60} step="any" value={value?String(value/60):''} disabled={busy||!!pending||taskPlanCapacityLoading||!taskPlanCapacityDays.find(day=>day.date===date)?.load_complete||remaining===0} onChange={event=>setTaskPlanSegments(current=>({...current,[task.key]:{...(current[task.key]??{}),[date]:parseHours(event.target.value)}}))}/></td>;})}</tr>)}
          <tr className={styles.planTotals}><th scope="row">Phân bổ / giờ còn trống</th>{planDates.map(date=><td key={date}><b>{displayHours(planDayTotals[date]??0)} / {displayHours(availableByDate.get(date)??0)}h</b><small>{taskPlanCapacityDays.find(day=>day.date===date)?.load_complete===true?'Đã xác minh':'Chưa xác minh'}</small></td>)}</tr>
        </tbody></table></div>
        {taskPlanCapacityLoading&&<p role="status">Đang tải rota và tải Maximo cho các ngày kế tiếp…</p>}
        {taskPlanCapacityMatches&&taskPlanCapacity?.state==='error'&&<><p role="alert">{taskPlanCapacity.error} Giữ nguyên lựa chọn; có thể thử tải lại sau.</p><button type="button" disabled={busy||!!pending||uploading} onClick={()=>setTaskPlanCapacity({key:taskPlanContextKey,state:'ready',days:taskPlanCapacityDays})}>Tiếp tục tìm ngày còn capacity</button></>}
        <p>Tổng task đã chọn: {displayHours(selectedTaskTotal)}h · đã xếp {displayHours(planPlaced)}h · còn chưa xếp {displayHours(planUnplaced)}h.</p>
        {planUnplaced>0&&taskPlanDates.length>=366&&<p role="alert">Đã đạt giới hạn tìm kiếm 366 ngày; còn {displayHours(planUnplaced)}h chưa xếp. Giảm giờ hoặc chọn thêm nhân lực/ngày bắt đầu khác.</p>}
        {automaticPlans.blocked&&<p role="alert">Thiếu tải rota/Maximo hoặc ngày chưa xác minh đủ. Hệ thống đã dừng xếp lịch tại ngày chưa rõ và không tính ngày đó là còn trống.</p>}
        {planOverallocated>0&&<p role="alert">Tổng giờ trong bảng vượt nhu cầu {displayHours(planOverallocated)}h.</p>}
        {!planValid&&planUnplaced===0&&selectedTaskTotal>0&&<p role="alert">Kiểm tra tổng giờ từng task, assignment WAITASGN và capacity từng ngày trước khi lưu.</p>}
        </section>
      </div> : !proposal.item && taskData && taskData.tasks.length===0 && <><p>WO chưa có task. Chọn phân công WO tổng quát theo giờ; không suy giờ từ estdur.</p><label>Giờ phân công <input aria-label="Giờ phân công" type="number" min="0.01" max="10.5" step="any" value={proposal.hours} disabled={busy || !!pending || uploading || !!uploadUnknownRequest} onChange={event => setProposal({ ...proposal, hours: event.target.value, minutes: parseHours(event.target.value) })} /></label></>}
      {proposal.item&&!confirmedReadOnly&&!planItem&&<label>Giờ phân công <input aria-label="Giờ phân công" type="number" min="0.01" max={Math.min(630,planEditLimit)/60} step="any" value={proposal.hours} disabled={busy || !!pending || planUploadLocked || !canEditItem(proposal.item)} onChange={event => setProposal({ ...proposal, hours: event.target.value, minutes: parseHours(event.target.value) })} /></label>}
      {!confirmedReadOnly&&!planItem&&<p>Rota: {displayHours(displayedProposalDay?.capacity_minutes ?? 0)} giờ · đã dùng {displayHours(displayedProposalDay?.allocated_minutes ?? 0)} giờ · tải Maximo {displayHours(displayedProposalDay?.external_minutes??0)}h · tối đa 10,5 giờ.{displayedProposalDay?.load_complete!==true?' Tải Maximo chưa đầy đủ; lưu bị khóa.':''}</p>}
      {!proposal.item&&taskData?.tasks.length===0&&<p>Upload Maximo bị khóa đến khi xác minh object, quyền, cập nhật có điều kiện và đối chiếu kết quả.</p>}
      {!confirmedReadOnly&&!planItem&&proposal.item?.task_id!==null&&proposal.item?.task_id!==undefined&&<><p>Trạng thái Maximo: {({local:'Chưa gửi',synced:'Đã xác nhận',unknown:'Chờ đối soát'} as Record<string,string>)[proposal.item.sync_state??'local']??'Chờ kiểm tra'}.</p>{proposalDirty&&!proposal.item.plan_id&&<p>Lưu thay đổi phân công trước khi gửi lên Maximo.</p>}{taskData?.upload_enabled&&!proposal.item.plan_id&&<><p>Maximo sẽ cập nhật lịch task theo phân công. Phân công đã gửi cần xử lý sửa/xóa trên Maximo.</p><div className={styles.field}><span>Ngày giờ bắt đầu ({shownPool?.timezone})</span><DateTimeInput label="Ngày giờ bắt đầu Maximo" value={uploadWall} defaultTime="06:30" disabled={uploading||busy||!!pending||!!uploadUnknownRequest||uploadResult?.state==='unknown'} onChange={setUploadWall}/></div><button type="button" disabled={proposalDirty||(proposal.item.sync_state??'local')!=='local'||!uploadWall||uploading||!canWrite||!!uploadUnknownRequest||uploadResult?.state==='confirmed'||uploadResult?.state==='unknown'} onClick={()=>void submitUpload(proposal.item!)}>{uploading?'Đang đối soát…':'Upload assignment lên Maximo'}</button>{uploadResult&&<p role="status">Maximo: {uploadResult.state} · {uploadResult.detail??uploadResult.attempt_id}</p>}{(uploadResult?.state==='unknown'||uploadUnknownRequest)&&<><p>Giữ mã yêu cầu {uploadUnknownRequest} để đối soát. Không gửi lại khi chưa rõ kết quả.</p><button type="button" disabled={uploading} onClick={()=>void reconcileUpload()}>Đối soát upload (không gửi lại)</button></>}</>}{taskData?.upload_enabled===false&&<p>Upload Maximo đang khóa: backend chưa xác nhận write contract cho object này.</p>}</>}
      {proposal.item?.plan_id&&<>{!confirmedReadOnly&&!planItem&&<p>Kế hoạch theo ngày đang lưu nội bộ. Tổng ban đầu: {displayHours(proposal.item.plan_total_minutes??0)} giờ.</p>}{!confirmedReadOnly&&(proposal.item.plan_sync_state??proposal.item.sync_state??'local')==='local'&&(proposal.item.plan_total_minutes??proposal.item.minutes)>proposal.item.minutes&&proposalDirty&&<button type="button" disabled={busy||!!pending||planUploadLocked} onClick={()=>beginPlanMove(proposal.item!,proposal.cell.person,proposal.cell.date,true)}>Dời toàn task</button>}{(proposal.item.plan_sync_state??proposal.item.sync_state??'local')!=='local'&&<div className={styles.syncStep} hidden={confirmedReadOnly||undefined}><PlanUpload connectionLabel={pool ? `${pool.connection_label} · ${pool.environment === 'test' ? 'Test' : pool.environment}` : undefined} items={confirmedReadOnly?confirmedPlanItems:[...new Map([...shownTimeline.items.filter(item=>item.plan_id===proposal.item!.plan_id&&item.state==='reserved'),...(planRecovery?.key===planRecoveryKey?planRecovery.items:[]).filter(item=>item.plan_id===proposal.item!.plan_id&&item.state==='reserved')].map(item=>[item.id,item])).values()]} supported={taskData?.daily_plan_upload_supported===true} writable={canWrite} timezone={shownPool?.timezone??'UTC'} taskLabel={taskData?.tasks.find(task=>task.task_workorder_id===proposal.item!.task_workorder_id&&task.task_id===proposal.item!.task_id)?.description??proposal.item.task_description??'Task'} personLabel={shownTimeline.rows.find(row=>row.person_id===proposal.item!.person_id)?.name??'Nhân lực đã phân công'} confirmedReadOnly={confirmedReadOnly} verify={verifyPlan} onLock={setPlanUploadLocked} onCloseLock={setPlanUploadCloseLocked} onConfirmed={onPlanConfirmed} /></div>}</>}
      {proposal.item&&!confirmedReadOnly&&!planItem&&<button className={styles.delete} disabled={!canWrite||!canEditItem(proposal.item)||planUploadLocked} onClick={() => void submit('delete')}>Xóa phân công</button>}
      <div className={styles.actions}>{pending&&unknown&&<button disabled={busy} onClick={()=>setProposal(null)}>Đóng hộp thoại để đối soát</button>}<button onClick={() => setProposal(null)} disabled={busy || uploading || !!pending || !!uploadUnknownRequest || !confirmedReadOnly&&planUploadCloseLocked}>{confirmedReadOnly?'Đóng':planItem?(planDaysChanged?'Hủy thay đổi':'Đóng'):'Hủy'}</button>{planItem&&<button disabled={!planDaysValid||busy||!!pending||planUploadLocked||!canWrite||!!daysUnknown} onClick={()=>void savePlanDays()}>Lưu thay đổi</button>}{!confirmedReadOnly&&!planItem&&<button disabled={!canWrite || planUploadLocked || (!!proposal.item && !canEditItem(proposal.item)) || (!proposal.item && (!proposal.workOrder||taskLoading||!!taskError||!taskData)) || (!proposal.item&&!taskPlanMode&&proposalDay?.load_complete!==true) || (proposal.item ? !Number.isInteger(proposal.minutes)||proposal.minutes<1||proposal.minutes>630||proposal.minutes>planEditLimit : taskPlanMode ? !planValid : taskData?.tasks.length ? !chosenTaskKeys.length||chosenTaskKeys.length>50||chosenTaskKeys.some(key=>Number(taskMinutes[key]??0)<1||!taskAssignments[key])||selectedTaskTotal>(proposalDay?.remaining_minutes??0) : !Number.isInteger(proposal.minutes)||proposal.minutes<1||proposal.minutes>630)} onClick={() => void submit(proposal.item ? 'update' : taskPlanMode ? 'task-plan-batch' : taskData?.tasks.length ? 'task-batch':'create')}>Xác nhận lưu</button>}</div>
    </section></div>;
}
