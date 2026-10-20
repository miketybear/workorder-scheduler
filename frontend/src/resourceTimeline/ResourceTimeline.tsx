import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AssignmentError, deleteAssignment, getLatestPlanUploadBatch, getAssignmentRevision, getResourceTimeline, getWorkOrderTasks, lookupAssignmentRequest, lookupTaskAllocationRequest, lookupTaskPlanBatchRequest, lookupAssignmentPlanMoveRequest, previewAssignmentPlanMove, moveAssignmentPlan, lookupAssignmentUploadSubmission, reconcileAssignmentUpload, saveAssignment, saveTaskAllocations, saveTaskPlanBatch, updateAssignment, uploadAssignment, type Assignment, type AssignmentInput, type AssignmentWorkOrder, type AffectedCapacityDay, type CapacityDay, type PlanningSummary, type ResourcePerson, type ResourceTimeline as TimelineData, type TaskAllocationInput, type TaskPlanBatchInput, type TaskPlanBatchResult, type WorkOrderTasks, type AssignmentUploadResult, type AssignmentPlanMovePreview, type AssignmentPlanMoveRequest, type AssignmentPlanMoveInput, type AssignmentPlanMoveResult } from '../api/assignments';
import { startOfDay, zonedDateTime } from '../api/dates';
import { getConnectionSettings } from '../api/settings';
import { listResourcePools, type ResourcePool } from '../api/rotaImports';
import { effectiveAllocationSummary, RetrievalError, retrieveWorkOrderPage, type WorkOrder, type WorkOrderPage } from '../api/workOrders';
import { activeGrant } from '../auth/activeGrant';
import { wouldExceedCapacity } from '../assignments/capacity';
import { PlanUpload } from './PlanUpload';
import { PlanUploadBatch } from './PlanUploadBatch';
import { AssignmentCard } from './AssignmentCard';
import { PlanMoveDialog } from './PlanMoveDialog';
import { RoleDonut } from './RoleDonut';
import { StatusIcon } from './StatusIcons';
import { restoreFocus } from './focusRestore';
import { DateTimeInput, MonthInput } from '../components/DateTimeInput';
import { picLabel } from '../scheduling/presentation';
import type { PicSuggestion } from '../picSuggestion';
import { dayNames, monthOf, addMonth, monthDates, addCalendarDays, calendarRange, displayHours, displayDate, formatMaximoDateTime, expectedFinish, parseHours, displayRole, capacityFor, scheduleRange, subMonth, suggestedPic, suggestTaskPlans, todayIn, woWarnings, type AssignedPerson, type ScheduleInfo, type WoWarnings } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';

type PointerDrag = { payload: string; label: string; startX: number; startY: number; moved: boolean; context: string };
type Cell = { person: ResourcePerson; date: string };
type TimelinePerson = ResourcePerson & { dayMetadata: Record<string, string[]> };
type Proposal = { item?: Assignment; workOrder?: AssignmentWorkOrder; cell: Cell; minutes: number; hours: string };
type MutationContext = { principal: string; connectionId: string; discipline: string; poolId: string; month: string };
class MutationContextError extends Error {}
type Pending = { requestId: string; kind: 'create' | 'update' | 'delete' | 'task-batch' | 'task-plan-batch'; assignmentId?: string; input?: AssignmentInput; taskInput?: TaskAllocationInput; planBatchInput?:TaskPlanBatchInput; version?: number; item?: Assignment; context: MutationContext };
type PlanMoveState={planId:string;item:Assignment;knownItems:Assignment[];targetPersonId:string;targetDate:string;mode:'shift'|'reallocate';preview:AssignmentPlanMovePreview|null;loading:boolean;error:string;canReallocate:boolean;request?:AssignmentPlanMoveInput;unknown:boolean;reconciling:boolean};
type LoadedWorkOrderPage=WorkOrderPage&{requestContext:string};
function timelineRoleOf(person: TimelinePerson, snapshot: TimelineData | null) { const roles = [...new Set(snapshot?.rows.filter(row => row.person_id === person.person_id).map(row => row.role))]; return roles.length > 1 ? 'ROLE_CHANGE' : person.role; }
const primaryLaborRoles=['TECH','SUP','ASST_SUP'] as const;
const newId = () => crypto.randomUUID();
function workOrderLabel(item: AssignmentWorkOrder | Assignment, snapshot: TimelineData) {
  const wo = 'wonum' in item ? item : snapshot.work_orders.find(order => order.site_id === item.site_id && order.workorder_id === item.workorder_id);
  return wo ? `${wo.wonum} · ${wo.description || wo.status}` : 'WO không còn trong phạm vi được cấp quyền';
}
function matchesOperation(operation: Pending, result: Assignment, poolId: string, connectionId: string) {
  if (result.pool_id !== poolId || result.connection_id !== connectionId || !Number.isInteger(result.version) || result.version < 1) return false;
  if (operation.kind === 'delete') return result.id === operation.item?.id && result.state === 'released' && result.version === (operation.version ?? 0) + 1;
  const input = operation.input;
  return !!input && result.state === 'reserved' && result.site_id === input.site_id && result.workorder_id === input.workorder_id &&
    result.discipline === input.discipline && result.person_id === input.person_id && result.date === input.date && result.minutes === input.minutes &&
    (operation.kind === 'create' && result.version === 1 || result.id === operation.assignmentId && result.version === (operation.version ?? 0) + 1);
}
function matchesUpload(result:AssignmentUploadResult,requestId:string,allocationId:string){return result.request_id===requestId&&result.allocation_id===allocationId;}
function matchesTaskBatch(operation: Pending, result: {request_id:string;items:Assignment[]}, poolId:string, connectionId:string) {
  const input=operation.taskInput;
  if (!input || result.request_id!==operation.requestId || result.items.length!==input.tasks.length) return false;
  return result.items.every(item=>item.pool_id===poolId && item.connection_id===connectionId && item.site_id===input.site_id && item.workorder_id===input.workorder_id && item.discipline===input.discipline && item.person_id===input.person_id && item.date===input.date && item.state==='reserved' && Number.isInteger(item.version) && item.version>=1) &&
    input.tasks.every(task=>result.items.some(item=>item.task_workorder_id===task.task_workorder_id && item.task_id===task.task_id && (item.assignment_id ?? null)===task.assignment_id && item.minutes===task.minutes));
}
function matchesTaskPlanBatch(operation:Pending,result:TaskPlanBatchResult,poolId:string,connectionId:string){
  const input=operation.planBatchInput;if(!input||result.request_id!==operation.requestId||result.plans.length!==input.tasks.length)return false;
  return result.plans.every(plan=>{const task=input.tasks.find(value=>value.task_workorder_id===plan.task_workorder_id&&value.task_id===plan.task_id&&value.assignment_id===plan.assignment_id);if(!task||task.total_minutes!==plan.total_minutes)return false;const segments=[...task.segments].sort((a,b)=>a.date.localeCompare(b.date));const items=[...plan.items].sort((a,b)=>a.date.localeCompare(b.date));return items.length===segments.length&&items.every((item,index)=>item.pool_id===poolId&&item.connection_id===connectionId&&item.site_id===input.site_id&&item.workorder_id===input.workorder_id&&item.discipline===input.discipline&&item.person_id===input.person_id&&item.task_workorder_id===task.task_workorder_id&&item.task_id===task.task_id&&item.assignment_id===task.assignment_id&&item.plan_id===plan.plan_id&&item.plan_total_minutes===task.total_minutes&&item.state==='reserved'&&item.date===segments[index]?.date&&item.minutes===segments[index]?.minutes);});
}

export function ResourceTimeline({ active = true, onPendingChange, onSuggestPic }: { active?: boolean; onPendingChange?: (pending: boolean) => void; onSuggestPic?: (suggestion: Omit<PicSuggestion, 'id'>) => void }) {
  const previousActive = useRef(active);
  const activationEpoch = useRef(0);
  // Keep an activation nonce synchronous so cached scope data is hidden on the first render after reactivation.
  if (active && !previousActive.current) activationEpoch.current += 1;
  previousActive.current = active;
  const [pool, setPool] = useState<ResourcePool | null>(null);
  const [poolRevision, setPoolRevision] = useState(-1);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [planRecovery,setPlanRecovery]=useState<{key:string;items:Assignment[]}|null>(null);
  const [snapshotContext, setSnapshotContext] = useState('');
  const [workOrderPage,setWorkOrderPage]=useState<LoadedWorkOrderPage|null>(null);
  const [workOrderPageLoading,setWorkOrderPageLoading]=useState(false);
  const [workOrderPageError,setWorkOrderPageError]=useState('');
  const [workOrderPageNotice,setWorkOrderPageNotice]=useState('');
  const [month, setMonth] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [taskData,setTaskData] = useState<WorkOrderTasks|null>(null);
  const [taskLoading,setTaskLoading]=useState(false);
  const [taskError,setTaskError]=useState('');
  const [selectedTasks,setSelectedTasks]=useState<Record<string,boolean>>({});
  const [taskMinutes,setTaskMinutes]=useState<Record<string,string>>({});
  const [taskAssignments,setTaskAssignments]=useState<Record<string,string>>({});
  const [taskPlanMode,setTaskPlanMode]=useState(false);
  const [taskPlanStart,setTaskPlanStart]=useState('');
  const [taskPlanSegments,setTaskPlanSegments]=useState<Record<string,Record<string,number>>>({});
  const [taskPlanCapacity,setTaskPlanCapacity]=useState<{key:string;state:'loading'|'ready'|'error';days?:CapacityDay[];error?:string}>();
  const [uploadWall,setUploadWall]=useState('');
  const [uploadResult,setUploadResult]=useState<AssignmentUploadResult|null>(null);
  const [uploadUnknownRequest,setUploadUnknownRequest]=useState('');
  const [uploading,setUploading]=useState(false);
  const [planUploadLocked,setPlanUploadLocked]=useState(false);
  const [planUploadCloseLocked,setPlanUploadCloseLocked]=useState(false);
  const [bulkUploadOpen,setBulkUploadOpen]=useState(false);
  const [bulkUploadLocked,setBulkUploadLocked]=useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [planMove,setPlanMove]=useState<PlanMoveState|null>(null);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [backlogView,setBacklogView]=useState<'backlog'|'completed'|'all'>('backlog');
  const [backlogCursorState,setBacklogCursorState]=useState<{context:string;cursors:Array<string|null>;index:number}>({context:'',cursors:[null],index:0});
  const [backlogWidth,setBacklogWidth]=useState(300);
  const workspaceRef=useRef<HTMLDivElement>(null);
  const splitterDrag=useRef<{startX:number;startWidth:number}|null>(null);
  const [revisionNotice,setRevisionNotice]=useState(false);
  const [summaryNow,setSummaryNow]=useState(Date.now());
  const [summaryLoadState,setSummaryLoadState]=useState<Record<string,{scope:string;state:'loading'|'error';message?:string}>>({});
  const [documentVisible,setDocumentVisible]=useState(document.visibilityState==='visible');
  const backlogListRef=useRef<HTMLDivElement>(null);
  const backlogCardNodes=useRef(new Map<string,HTMLButtonElement>());
  const backlogCardRefCallbacks=useRef(new Map<string,(node:HTMLButtonElement|null)=>void>());
  const backlogSummaryScheduler=useRef<((key:string,force?:boolean)=>void)|null>(null);
  const backlogSummaryCancel=useRef<((key:string)=>void)|null>(null);
  const backlogSummaryObserver=useRef<IntersectionObserver|null>(null);
  const assignmentRevision=useRef('');
  const [reload, setReload] = useState(0);
  const forceMetadataRefresh=useRef(false);
  function refreshTimeline(){forceMetadataRefresh.current=true;setReload(value=>value+1);}
  const [discipline, setDiscipline] = useState('');
  const [principal, setPrincipal] = useState('');
  const planRecoveryKey=[principal,discipline,month,pool?.id,pool?.connection_id].join('|');
  const [grantCanWrite, setGrantCanWrite] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [peopleSearch, setPeopleSearch] = useState('');
  const [latestBatch, setLatestBatch] = useState<{ key: string; state: string; done: number; total: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrolledMonth = useRef('');
  const [search, setSearch] = useState('');
  const [pagedSearch,setPagedSearch]=useState('');
  const pointerDrag = useRef<PointerDrag | null>(null);
  const taskPlanCapacityController=useRef<AbortController|null>(null);
  const planMoveController=useRef<AbortController|null>(null);
  const taskPlanCapacityGeneration=useRef(0);
  const [suppressClick,setSuppressClick]=useState(false);
  const [dragPreview, setDragPreview] = useState<{label:string;x:number;y:number} | null>(null);
  const [selectedWoKey, setSelectedWoKey] = useState('');
  const [selectedWorkOrder,setSelectedWorkOrder]=useState<WorkOrder|null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const wasActive = useRef(false);

  useEffect(()=>{
    const updateVisibility=()=>setDocumentVisible(document.visibilityState==='visible');
    document.addEventListener('visibilitychange',updateVisibility);
    return()=>document.removeEventListener('visibilitychange',updateVisibility);
  },[]);

  useEffect(()=>{
    const clampWidth=()=>{const maxWidth=Math.max(220,(workspaceRef.current?.clientWidth??window.innerWidth)-460);setBacklogWidth(width=>Math.min(width,maxWidth));};
    window.addEventListener('resize',clampWidth);
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(clampWidth);
    if(workspaceRef.current)observer?.observe(workspaceRef.current);
    return()=>{window.removeEventListener('resize',clampWidth);observer?.disconnect();};
  },[]);

  useEffect(()=>{
    taskPlanCapacityGeneration.current+=1;
    taskPlanCapacityController.current?.abort();
    return ()=>{taskPlanCapacityGeneration.current+=1;taskPlanCapacityController.current?.abort();};
  },[active,proposal?.cell.person.person_id,proposal?.cell.date,proposal?.workOrder?.workorder_id,principal,discipline,pool?.id,pool?.connection_id,reload,month]);

  useEffect(() => {
    if (active && wasActive.current) queueMicrotask(() => setReload(value => value + 1));
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!pending && !uploadUnknownRequest && !planMove?.request && !planMove?.unknown) return;
    const protectPending = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectPending);
    return () => window.removeEventListener('beforeunload', protectPending);
  }, [pending,uploadUnknownRequest,planMove?.request,planMove?.unknown]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let valid = true;
    void (async () => {
      try {
        const { session } = await getConnectionSettings(controller.signal);
        if (!valid) return;
        const grant = activeGrant(session);
        if (!grant) throw new Error('Không xác định được một phạm vi hệ thống và discipline duy nhất. Mở Settings để chọn kết nối được cấp quyền.');
        setDiscipline(grant.discipline);
        setPrincipal(session.user.id);
        setGrantCanWrite(grant.capability === 'write');
        if (!month) setMonth(monthOf(new Date(), grant.timezone));
        const pools = await listResourcePools(controller.signal);
        const selected = pools.filter(item => item.connection_id === grant.connection_id);
        if (!selected.length) throw new Error('Không có roster được cấp quyền cho kết nối đang chọn.');
        if (selected.length > 1) throw new Error('Kết nối có nhiều roster; cần backend cung cấp lựa chọn pool theo phạm vi được cấp quyền.');
        if (!valid) return;
        setPool(selected[0]);
        setPoolRevision(reload); setCheckingSession(false); setError('');
      } catch (reason) {
        if (valid && !controller.signal.aborted) {
          setTimeline(null); setSnapshotContext(''); setWorkOrderPage(null); setSelectedWorkOrder(null); setSelectedWoKey(''); setPool(null); setPoolRevision(-1); setProposal(null);
          setError(reason instanceof Error ? reason.message : 'Không kiểm tra được quyền truy cập.');
        }
      }
    })();
    return () => { valid = false; controller.abort(); };
  }, [active, reload, month]);

  useEffect(() => {
    if (!active || !pool || !month) return;
    const controller = new AbortController();
    let valid = true;
    const first = `${month}-01`, before = `${addMonth(month)}-01`;
    void (async () => {
      try {
        const { session } = await getConnectionSettings(controller.signal);
        if (!valid) return;
        const grant = activeGrant(session);
        if (!session || !grant || grant.connection_id !== pool.connection_id || grant.discipline !== discipline || session.user.id !== principal) throw new Error('Phiên hoặc quyền đã thay đổi. Tải lại trang để xác minh lại phạm vi.');
        const scope = { connection_id: grant.connection_id, discipline: grant.discipline, date_from: first, date_before: before };
        const snapshot = await getResourceTimeline(pool.id, scope, controller.signal);
        if (!valid) return;
        const validKeys = new Set(snapshot.work_orders.map(item => `${item.site_id}:${item.workorder_id}`));
        if (snapshot.items.some(item => !validKeys.has(`${item.site_id}:${item.workorder_id}`))) throw new Error('Phân công hiện có thiếu WO tương ứng trong phạm vi được cấp quyền.');
        setTimeline(snapshot);
        setSummaryNow(Date.now());
        if(snapshot.assignment_revision){assignmentRevision.current=snapshot.assignment_revision;setRevisionNotice(false);}
        setSnapshotContext(JSON.stringify([activationEpoch.current, reload, pool.id, grant.connection_id, grant.discipline, session.user.id, month]));
      } catch (reason) {
        if (valid && !controller.signal.aborted) {
          setTimeline(null); setSnapshotContext(''); setWorkOrderPage(null); setSelectedWorkOrder(null); setSelectedWoKey(''); setPool(null); setPoolRevision(-1); setProposal(null);
          setError(reason instanceof Error ? reason.message : 'Không tải được resource timeline.');
        }
      }
    })();
    return () => { valid = false; controller.abort(); };
  }, [active, pool, month, reload, discipline, principal]);

  useEffect(()=>{
    if(!active||!pool||!principal)return;
    let current=true;let revisionController:AbortController|null=null;
    const timer=window.setInterval(()=>{
      setSummaryNow(Date.now());
      if(document.visibilityState!=='visible'||proposal||planMove||busy||pending||uploading||uploadUnknownRequest)return;
      if(revisionController)return;
      const controller=new AbortController();revisionController=controller;
      void getAssignmentRevision(pool.id,pool.connection_id,discipline,controller.signal).then(result=>{
        if(!current)return;
        if(assignmentRevision.current&&result.revision!==assignmentRevision.current)setRevisionNotice(true);
        else if(!assignmentRevision.current)assignmentRevision.current=result.revision;
      }).catch(reason=>{
        if(!current||controller.signal.aborted)return;
        if(reason instanceof RetrievalError&&[401,403,404].includes(reason.status))clearWorkspaceAfterAuthorizationFailure(reason);
      }).finally(()=>{if(revisionController===controller)revisionController=null;});
    },30_000);
    return()=>{current=false;window.clearInterval(timer);revisionController?.abort();};
  },[active,pool,principal,discipline,proposal,planMove,busy,pending,uploading,uploadUnknownRequest]);

  useEffect(() => {
    if (!active || busy || pending || planMove || !pool || !principal) return;
    const controller = new AbortController();
    let current = true;
    let wasHidden = document.visibilityState === 'hidden';
    const verifyOnReturn = () => {
      if (document.visibilityState !== 'visible') { wasHidden = true; return; }
      if (!wasHidden) return;
      wasHidden = false;
      setCheckingSession(true);
      void getConnectionSettings(controller.signal).then(({session}) => {
        if (!current) return;
        const grant = activeGrant(session);
        if (session.user.id !== principal || !grant || grant.connection_id !== pool.connection_id || grant.discipline !== discipline) throw new Error('Phiên hoặc phạm vi đã thay đổi. Kiểm tra lại quyền trước khi tiếp tục.');
        setGrantCanWrite(grant.capability === 'write');
        if (grant.capability !== 'write') setProposal(null);
      }).catch(reason => {
        if (!current || controller.signal.aborted) return;
        setCheckingSession(false);
        setTimeline(null); setSnapshotContext(''); setWorkOrderPage(null); setSelectedWorkOrder(null); setSelectedWoKey(''); setPool(null); setPoolRevision(-1); setProposal(null);
        setError(reason instanceof Error ? reason.message : 'Không kiểm tra được phiên.');
      }).finally(() => { if (current) setCheckingSession(false); });
    };
    document.addEventListener('visibilitychange', verifyOnReturn);
    return () => { current = false; controller.abort(); document.removeEventListener('visibilitychange', verifyOnReturn); };
  }, [active, busy, pending, planMove, pool, principal, discipline]);

  useEffect(() => { onPendingChange?.(busy || !!pending || !!planMove || uploading || !!uploadUnknownRequest || planUploadCloseLocked || bulkUploadLocked); }, [busy, pending, planMove, uploading, uploadUnknownRequest, planUploadCloseLocked, bulkUploadLocked, onPendingChange]);

  useEffect(() => {
    if (!proposal || !active || !timeline) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('select:not(:disabled), input:not(:disabled), button:not(:disabled)')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const elements = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) restoreFocus(previous); };
    // Rebind only when dialog opens/closes or mutation locks change, not on hour input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!proposal, active, busy, pending,uploading,uploadUnknownRequest,planUploadCloseLocked]);

  useEffect(() => { pointerDrag.current = null; queueMicrotask(() => setDragPreview(null)); }, [active, month, principal, discipline, pool?.id, reload]);

  const dates = useMemo(() => month ? monthDates(month) : [], [month]);
  const currentContext = JSON.stringify([activationEpoch.current, reload, pool?.id, pool?.connection_id, discipline, principal, month]);
  const shownPool = active && !checkingSession && poolRevision === reload ? pool : null;
  const shownTimeline = active && !checkingSession && snapshotContext === currentContext ? timeline : null;
  useEffect(()=>{
    if(!planMove||planMove.unknown||!pool||!timeline)return;
    const request:AssignmentPlanMoveRequest={connection_id:pool.connection_id,discipline,expected_plan_version:planMove.item.plan_version??0,anchor_allocation_id:planMove.item.id,target_person_id:planMove.targetPersonId,target_date:planMove.targetDate,mode:planMove.mode};
    const context:MutationContext={principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month};
    const controller=new AbortController();planMoveController.current?.abort();planMoveController.current=controller;
    const contextKey=[planMove.planId,planMove.item.id,planMove.targetPersonId,planMove.targetDate,planMove.mode,pool.id,pool.connection_id,discipline,principal,month,reload].join('|');
    setPlanMove(current=>current&&current.planId===planMove.planId?{...current,loading:true,error:'',preview:null,canReallocate:false}:current);
    void (async()=>{
      try{
        if(request.expected_plan_version<1)throw new Error('Không có plan_version hiện tại để xác minh; hãy làm mới timeline trước khi chuyển task.');
        await verifyMutationContext(context);
        const preview=await previewAssignmentPlanMove(pool.id,planMove.planId,request,planMove.knownItems,controller.signal);
        if(controller.signal.aborted)return;
        await verifyMutationContext(context);
        setPlanMove(current=>current&&[current.planId,current.item.id,current.targetPersonId,current.targetDate,current.mode,pool.id,pool.connection_id,discipline,principal,month,reload].join('|')===contextKey?{...current,loading:false,preview,error:'',canReallocate:false}:current);
      }catch(reason){
        if(controller.signal.aborted)return;
        if(clearWorkspaceAfterAuthorizationFailure(reason))return;
        const canReallocate=reason instanceof AssignmentError&&reason.status===409&&reason.code==='plan_move_conflict'&&planMove.mode==='shift';
        setPlanMove(current=>current&&[current.planId,current.item.id,current.targetPersonId,current.targetDate,current.mode,pool.id,pool.connection_id,discipline,principal,month,reload].join('|')===contextKey?{...current,loading:false,preview:null,error:reason instanceof Error?reason.message:'Không thể tạo preview chuyển task.',canReallocate}:current);
      }
    })();
    return()=>controller.abort();
  // Keep this request keyed to the move's identity and target fields; depending on the whole state object would abort and restart when loading/error/preview changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[planMove?.planId,planMove?.item.id,planMove?.targetPersonId,planMove?.targetDate,planMove?.mode,planMove?.unknown,pool?.id,pool?.connection_id,discipline,principal,month,reload,timeline]);
  const confirmedReadOnly=!!proposal?.item?.plan_id&&(proposal.item.plan_sync_state??proposal.item.sync_state)==='synced';
  const confirmedPlanItem=confirmedReadOnly?proposal?.item:null;
  const confirmedPlanItems=useMemo(()=>{
    if(!confirmedPlanItem?.plan_id)return [];
    const samePlan=(item:Assignment)=>item.plan_id===confirmedPlanItem.plan_id&&item.pool_id===confirmedPlanItem.pool_id&&item.connection_id===confirmedPlanItem.connection_id&&item.site_id===confirmedPlanItem.site_id&&item.workorder_id===confirmedPlanItem.workorder_id&&item.person_id===confirmedPlanItem.person_id&&item.task_workorder_id===confirmedPlanItem.task_workorder_id&&item.task_id===confirmedPlanItem.task_id&&item.assignment_id===confirmedPlanItem.assignment_id&&item.state==='reserved';
    const items=new Map<string,Assignment>();
    for(const item of shownTimeline?.items??[])if(samePlan(item))items.set(item.id,item);
    if(planRecovery?.key===planRecoveryKey)for(const item of planRecovery.items)if(samePlan(item))items.set(item.id,item);
    return [...items.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  },[confirmedPlanItem,shownTimeline,planRecovery,planRecoveryKey]);
  const confirmedTask=confirmedPlanItem&&taskData?.connection_id===confirmedPlanItem.connection_id&&taskData.site_id===confirmedPlanItem.site_id&&taskData.workorder_id===confirmedPlanItem.workorder_id?taskData.tasks.find(task=>task.task_workorder_id===confirmedPlanItem.task_workorder_id&&task.task_id===confirmedPlanItem.task_id):undefined;
  const confirmedRemoteAssignments=confirmedTask?.assignments.filter(remote=>confirmedPlanItems.some(segment=>segment.remote_assignment_id===remote.assignment_id))??[];
  const confirmedCoverageMinutes=confirmedPlanItems.reduce((sum,segment)=>sum+segment.minutes,0);
  const confirmedCoverageComplete=confirmedCoverageMinutes===(confirmedPlanItem?.plan_total_minutes??-1);
  const [pageRefresh,setPageRefresh]=useState(0);
  const backlogPageContext=JSON.stringify([currentContext,backlogView,pagedSearch]);
  const visibleBacklogPage=backlogCursorState.context===backlogPageContext?backlogCursorState.index:0;
  const pageCursor=backlogCursorState.context===backlogPageContext?backlogCursorState.cursors[visibleBacklogPage]:null;
  const pageRequestContext=JSON.stringify([backlogPageContext,pageCursor,pageRefresh]);
  const shownWorkOrderPage=shownPool&&workOrderPage?.requestContext===pageRequestContext?workOrderPage:null;
  const workOrders=useMemo(()=>shownWorkOrderPage?.items??[],[shownWorkOrderPage]);
  const dialogWorkOrders=selectedWorkOrder&&!workOrders.some(o=>o.siteid===selectedWorkOrder.siteid&&o.workorderid===selectedWorkOrder.workorderid)?[selectedWorkOrder,...workOrders]:workOrders;
  function setWorkOrders(update:(previous:WorkOrder[])=>WorkOrder[]){setWorkOrderPage(previous=>previous?{...previous,items:update(previous.items)}:previous);}
  useEffect(()=>{const timer=window.setTimeout(()=>setPagedSearch(search.trim()),300);return()=>window.clearTimeout(timer);},[search]);
  useEffect(()=>{queueMicrotask(()=>{setSelectedWorkOrder(null);setSelectedWoKey('');});},[currentContext]);
  useEffect(()=>{
    if(!active||!pool||poolRevision!==reload||!month||!principal)return;
    const controller=new AbortController();let current=true;
    const first=`${month}-01`,before=`${addMonth(month)}-01`;
    void (async()=>{
      setWorkOrderPageLoading(true);setWorkOrderPageError('');
      try{
        const {session}=await getConnectionSettings(controller.signal);const grant=activeGrant(session);
        if(!current||controller.signal.aborted)return;
        if(session.user.id!==principal||!grant||grant.connection_id!==pool.connection_id||grant.discipline!==discipline)throw new MutationContextError('Phiên hoặc quyền đã thay đổi.');
        const refresh=forceMetadataRefresh.current&&!pageCursor;
        if(refresh)forceMetadataRefresh.current=false;
        const result=await retrieveWorkOrderPage({connection_id:grant.connection_id,discipline,target_from:startOfDay(first,grant.timezone),target_before:startOfDay(before,grant.timezone),view:backlogView,search:pagedSearch,...(pageCursor?{cursor:pageCursor}:{}),...(refresh?{refresh:true}:{})},controller.signal);
        if(!current)return;setWorkOrderPage({...result,requestContext:pageRequestContext});
      }catch(reason){
        if(!current||controller.signal.aborted)return;
        if(clearWorkspaceAfterAuthorizationFailure(reason))return;
        if(reason instanceof RetrievalError&&reason.status===409&&pageCursor){setBacklogCursorState({context:backlogPageContext,cursors:[null],index:0});setWorkOrderPageNotice('Danh sách đã thay đổi; trở về trang đầu.');}
        else setWorkOrderPageError(reason instanceof Error?reason.message:'Không tải được trang WO.');
      }finally{if(current)setWorkOrderPageLoading(false);}
    })();
    return()=>{current=false;controller.abort();};
  },[active,pool,poolRevision,reload,month,principal,discipline,backlogView,pagedSearch,pageCursor,pageRequestContext,backlogPageContext]);
  useEffect(()=>{
    if(backlogView==='all'||!shownWorkOrderPage)return;
    let current=true;
    if(workOrders.some(order=>(effectiveAllocationSummary(order,summaryNow).state==='completed')!==(backlogView==='completed')))queueMicrotask(()=>{if(current)setPageRefresh(value=>value+1);});
    return()=>{current=false;};
  },[backlogView,shownWorkOrderPage,workOrders,summaryNow]);
  // Scope-keyed plan capacity is hidden synchronously when identity, activation, rota or person changes.
  const taskPlanContextKey=JSON.stringify([activationEpoch.current,active,principal,discipline,pool?.id,pool?.connection_id,month,reload,timeline?.pool_version,proposal?.cell.person.person_id,proposal?.cell.person.craft,proposal?.cell.person.laborcode,proposal?.cell.date,proposal?.workOrder?.site_id,proposal?.workOrder?.workorder_id]);
  const taskOrder=proposal ? proposal.workOrder ?? (proposal.item ? timeline?.work_orders.find(order=>order.site_id===proposal.item?.site_id&&order.workorder_id===proposal.item?.workorder_id) : undefined) : undefined;
  useEffect(()=>{
    if(!taskOrder || !shownPool)return;
    const controller=new AbortController();let current=true;
    void getWorkOrderTasks(taskOrder.connection_id,taskOrder.site_id,taskOrder.workorder_id,discipline,controller.signal).then(data=>{
      if(!current)return;
      if(data.planning_summary){setSummaryNow(Date.now());setWorkOrders(previous=>previous.map(order=>order.siteid===taskOrder.site_id&&order.workorderid===taskOrder.workorder_id?{...order,allocation_summary:{...data.planning_summary!}}:order));}
      const assignmentsInUse=new Set(timeline?.items.filter(item=>item.state==='reserved'&&item.workorder_id===taskOrder.workorder_id&&item.site_id===taskOrder.site_id).map(item=>item.assignment_id).filter((id):id is string=>!!id));
      const selected:Record<string,boolean>={},minutes:Record<string,string>={},choices:Record<string,string>={};
      for(const task of data.tasks){const key=`${task.task_workorder_id}:${task.task_id}`;const planned=task.planned_labor.filter(labor=>labor.craft===discipline);const available=task.assignments.filter(item=>item.craft===discipline&&item.status.toUpperCase()==='WAITASGN'&&!item.laborcode&&!item.scheduledate&&!assignmentsInUse.has(item.assignment_id));const plannedMinutes=Math.round(planned.reduce((sum,labor)=>sum+labor.labor_hours*labor.quantity,0)*60);selected[key]=available.length>0;minutes[key]=String(available.length===1&&available[0].labor_hours!==null?Math.round(available[0].labor_hours*60):plannedMinutes);if(available.length===1)choices[key]=available[0].assignment_id;}
      setTaskData(data);setSelectedTasks(selected);setTaskMinutes(minutes);setTaskAssignments(choices);setTaskPlanMode(data.tasks.length>0);setTaskPlanSegments({});setTaskError('');
    }).catch(reason=>{if(current&&!controller.signal.aborted)setTaskError(reason instanceof Error?reason.message:'Không tải được task của WO.');}).finally(()=>{if(current)setTaskLoading(false);});
    return()=>{current=false;controller.abort();};
  },[taskOrder,shownPool,discipline,timeline]);

  const backlogSummaryScope=JSON.stringify([activationEpoch.current,active,principal,discipline,pool?.id,pool?.connection_id,month,reload,snapshotContext,pageRequestContext]);
  const backlogSummaryLatest=useRef({scope:backlogSummaryScope,orders:workOrders,summaryNow,active,documentVisible,checkingSession,proposal:!!proposal,busy,pending:!!pending,uploading,uploadUnknown:!!uploadUnknownRequest});
  backlogSummaryLatest.current={scope:backlogSummaryScope,orders:workOrders,summaryNow,active,documentVisible,checkingSession,proposal:!!proposal,busy,pending:!!pending,uploading,uploadUnknown:!!uploadUnknownRequest};
  const backlogSummaryAttempted=useRef(new Set<string>());
  useEffect(()=>{
    const paused=!active||!documentVisible||checkingSession||!shownTimeline||!!proposal||busy||!!pending||uploading||!!uploadUnknownRequest;
    if(paused){backlogSummaryScheduler.current=null;return;}
    const scope=backlogSummaryScope;
    const controllers=new Map<string,AbortController>();
    const queue:string[]=[];
    const visible=new Set<string>();
    const attempted=backlogSummaryAttempted.current;
    let activeCount=0;
    let disposed=false;
    const eligible=(key:string)=>{
      const order=backlogSummaryLatest.current.orders.find(item=>`${item.siteid}|${item.workorderid}`===key);
      if(!order||!backlogCardNodes.current.has(key)||!visible.has(key))return false;
      const summary=effectiveAllocationSummary(order,backlogSummaryLatest.current.summaryNow);
      return summary.state==='unverified';
    };
    const pump=()=>{
      while(!disposed&&activeCount<2&&queue.length){
        const key=queue.shift()!;
        const token=`${scope}|${key}`;
        if(controllers.has(key)||attempted.has(token)||!eligible(key))continue;
        const order=backlogSummaryLatest.current.orders.find(item=>`${item.siteid}|${item.workorderid}`===key);
        if(!order)continue;
        const capturedSummary=order.allocation_summary;
        const controller=new AbortController();
        controllers.set(key,controller);activeCount++;
        attempted.add(token);
        setSummaryLoadState(value=>({...value,[key]:{scope,state:'loading'}}));
        void getWorkOrderTasks(pool!.connection_id,order.siteid,order.workorderid,discipline,controller.signal).then(data=>{
          if(disposed||controller.signal.aborted||backlogSummaryLatest.current.scope!==scope)return;
          if(data.connection_id!==pool!.connection_id||data.site_id!==order.siteid||data.workorder_id!==order.workorderid||data.discipline!==undefined&&data.discipline!==discipline)throw new Error('Phản hồi task không thuộc WO hoặc discipline đang chọn.');
          const current=backlogSummaryLatest.current.orders.find(item=>item.siteid===order.siteid&&item.workorderid===order.workorderid);
          if(data.planning_summary&&current?.allocation_summary===capturedSummary){
            setSummaryNow(Date.now());
            setWorkOrders(previous=>previous.map(item=>item.siteid===order.siteid&&item.workorderid===order.workorderid&&item.allocation_summary===capturedSummary?{...item,allocation_summary:{...data.planning_summary!}}:item));
          }
          setSummaryLoadState(value=>{const currentState=value[key];if(currentState?.scope!==scope)return value;const next={...value};delete next[key];return next;});
        }).catch(reason=>{
          if(disposed||controller.signal.aborted||backlogSummaryLatest.current.scope!==scope)return;
          if(reason instanceof RetrievalError&&[401,403,404].includes(reason.status)){disposed=true;queue.length=0;for(const [otherKey,other] of controllers)if(otherKey!==key)other.abort();clearWorkspaceAfterAuthorizationFailure(reason);return;}
          setSummaryLoadState(value=>({...value,[key]:{scope,state:'error',message:'Không tải được task. Bấm “Thử tải lại task” để kiểm tra lại.'}}));
        }).finally(()=>{
          controllers.delete(key);activeCount--;
          if(!disposed&&backlogSummaryLatest.current.scope===scope)pump();
        });
      }
    };
    const schedule=(key:string,force=false)=>{
      if(disposed||backlogSummaryLatest.current.scope!==scope)return;
      if(force)visible.add(key);
      const token=`${scope}|${key}`;
      if(force){attempted.delete(token);setSummaryLoadState(value=>{const next={...value};delete next[key];return next;});}
      if(controllers.has(key)||attempted.has(token)||!eligible(key))return;
      if(!queue.includes(key))queue.push(key);
      pump();
    };
    const cancel=(key:string)=>{
      visible.delete(key);
      const queued=queue.indexOf(key);if(queued>=0)queue.splice(queued,1);
      if(controllers.has(key)){controllers.get(key)?.abort();attempted.delete(`${scope}|${key}`);setSummaryLoadState(value=>{const current=value[key];if(current?.scope!==scope||current.state!=='loading')return value;const next={...value};delete next[key];return next;});}
    };
    backlogSummaryScheduler.current=schedule;
    backlogSummaryCancel.current=cancel;
    if(typeof IntersectionObserver==='undefined')return()=>{disposed=true;backlogSummaryScheduler.current=null;backlogSummaryCancel.current=null;};
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const key=(entry.target as HTMLElement).dataset.summaryKey;if(!key)continue;if(entry.isIntersecting){visible.add(key);schedule(key);}else cancel(key);}
    },{root:backlogListRef.current,rootMargin:'0px'});
    backlogSummaryObserver.current=observer;
    for(const node of backlogCardNodes.current.values())observer.observe(node);
    return()=>{
      disposed=true;observer.disconnect();if(backlogSummaryObserver.current===observer)backlogSummaryObserver.current=null;
      for(const [key,controller] of controllers){controller.abort();attempted.delete(`${scope}|${key}`);}
      if(backlogSummaryLatest.current.scope!==scope){for(const token of attempted)if(token.startsWith(`${scope}|`))attempted.delete(token);}
      setSummaryLoadState(value=>Object.fromEntries(Object.entries(value).filter(([,status])=>status.scope!==scope||status.state!=='loading')));
      controllers.clear();queue.length=0;backlogSummaryScheduler.current=null;backlogSummaryCancel.current=null;
    };
  },[backlogSummaryScope,active,documentVisible,checkingSession,shownTimeline,proposal,busy,pending,uploading,uploadUnknownRequest,pool,discipline]);
  const roster = useMemo(() => {
    const grouped = new Map<string, TimelinePerson>();
    for (const row of shownTimeline?.rows ?? []) {
      let person = grouped.get(row.person_id);
      if (!person) {
        person = { ...row, days: [], dayMetadata: {} };
        grouped.set(row.person_id, person);
      }
      for (const day of row.days) {
        const old = person.days.find(item => item.date === day.date);
        if (!old) person.days.push(day);
        else {
          const capacity = Math.max(old.capacity_minutes, day.capacity_minutes);
          const allocated = Math.max(old.allocated_minutes, day.allocated_minutes);
          const selected = day.capacity_minutes > old.capacity_minutes ? day : old;
          Object.assign(old, selected, { capacity_minutes: capacity, allocated_minutes: allocated, remaining_minutes: capacity - allocated });
        }
        const metadata = `${row.craft} · ${displayRole(row.role)}`;
        const list = person.dayMetadata[day.date] ?? [];
        if (!list.includes(metadata)) person.dayMetadata[day.date] = [...list, metadata];
      }
    }
    return [...grouped.values()];
  }, [shownTimeline]);
  const confirmedLaborcode=confirmedRemoteAssignments.find(remote=>remote.laborcode)?.laborcode??roster.find(person=>person.person_id===confirmedPlanItem?.person_id)?.laborcode??'—';
  const backlog = workOrders;
  const backlogPageOrders=workOrders;
  useEffect(()=>{if(backlogListRef.current)backlogListRef.current.scrollTop=0;},[backlogPageContext,visibleBacklogPage]);
  function changeBacklogPage(page:number){
    if(workOrderPageLoading||page<0)return;
    const cursors=backlogCursorState.context===backlogPageContext?[...backlogCursorState.cursors]:[null];
    if(page>visibleBacklogPage){if(!shownWorkOrderPage?.next_cursor)return;cursors[page]=shownWorkOrderPage.next_cursor;}
    if(page>=cursors.length)return;
    setBacklogCursorState({context:backlogPageContext,cursors:[...cursors],index:page});
  }
  function maxBacklogWidth(){return Math.max(220,(workspaceRef.current?.clientWidth??window.innerWidth)-460);}
  function resizeBacklog(width:number){setBacklogWidth(Math.min(maxBacklogWidth(),Math.max(220,width)));}
  function beginSplitterDrag(event:React.PointerEvent<HTMLDivElement>){if(event.button!==0)return;splitterDrag.current={startX:event.clientX,startWidth:backlogWidth};event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault();}
  function moveSplitterDrag(event:React.PointerEvent<HTMLDivElement>){if(!splitterDrag.current)return;resizeBacklog(splitterDrag.current.startWidth+event.clientX-splitterDrag.current.startX);}
  function endSplitterDrag(){splitterDrag.current=null;}
  function adjustSplitter(event:React.KeyboardEvent<HTMLDivElement>){if(event.key==='ArrowLeft'){event.preventDefault();resizeBacklog(backlogWidth-20);}else if(event.key==='ArrowRight'){event.preventDefault();resizeBacklog(backlogWidth+20);}else if(event.key==='Home'){event.preventDefault();resizeBacklog(220);}else if(event.key==='End'){event.preventDefault();resizeBacklog(maxBacklogWidth());}}
  function backlogCardRefFor(key:string){
    let callback=backlogCardRefCallbacks.current.get(key);
    if(!callback){callback=node=>{const previous=backlogCardNodes.current.get(key);if(previous&&previous!==node){backlogSummaryObserver.current?.unobserve(previous);backlogSummaryCancel.current?.(key);backlogCardNodes.current.delete(key);}if(node){node.dataset.summaryKey=key;backlogCardNodes.current.set(key,node);backlogSummaryObserver.current?.observe(node);}else backlogCardNodes.current.delete(key);};backlogCardRefCallbacks.current.set(key,callback);}
    return callback;
  }
  const allRoles=[...new Set(roster.map(person=>timelineRoleOf(person,shownTimeline)))];
  const roleGroups=[...new Set([...primaryLaborRoles,'CONTROL_RM_ENGINEER','ROLE_CHANGE',...allRoles])].filter(role=>allRoles.includes(role));
  const roleTitle = (role: string) => role === 'ROLE_CHANGE' ? 'Chức danh thay đổi trong tháng' : displayRole(role);
  const totalMinutes = (people: TimelinePerson[], field: 'capacity_minutes' | 'allocated_minutes', date?: string) => people.reduce((sum, person) => sum + person.days.filter(day => !date || day.date === date).reduce((n, day) => n + day[field], 0), 0);
  const donutSummary=primaryLaborRoles.map(role=>{const members=roster.filter(person=>timelineRoleOf(person,shownTimeline)===role);return {role,members,load:totalMinutes(members,'allocated_minutes'),capacity:totalMinutes(members,'capacity_minutes'),verified:members.length>0&&members.every(person=>person.days.length>0&&person.days.every(day=>day.load_complete===true))};});
  const otherRoleGroups=roleGroups.filter(role=>!primaryLaborRoles.includes(role as typeof primaryLaborRoles[number])).map(role=>{const members=roster.filter(person=>timelineRoleOf(person,shownTimeline)===role);return {role,members,load:totalMinutes(members,'allocated_minutes'),capacity:totalMinutes(members,'capacity_minutes'),verified:members.length>0&&members.every(person=>person.days.length>0&&person.days.every(day=>day.load_complete===true))};});
  const canWrite = grantCanWrite && shownPool?.capability === 'write' && !!shownTimeline && !busy && !pending && !uploading && !uploadUnknownRequest;
  const assignableTasks=taskData?.tasks.filter(task=>!(task.has_out_of_scope_demand===true&&task.planned_labor.length===0&&task.assignments.length===0))??[];
  const foreignOnlyTasks=taskData?.tasks.filter(task=>task.has_out_of_scope_demand===true&&task.planned_labor.length===0&&task.assignments.length===0)??[];
  const chosenTaskKeys=Object.keys(selectedTasks).filter(key=>selectedTasks[key]&&assignableTasks.some(task=>`${task.task_workorder_id}:${task.task_id}`===key));
  const selectedTaskTotal=chosenTaskKeys.reduce((sum,key)=>sum+Number(taskMinutes[key]??0),0);
  const taskPlanContextValid=active&&!checkingSession&&!!shownPool&&!!shownTimeline;
  const taskPlanCapacityMatches=taskPlanCapacity?.key===taskPlanContextKey;
  const refreshedProposalPerson=proposal?roster.find(person=>person.person_id===proposal.cell.person.person_id&&person.craft===proposal.cell.person.craft&&person.laborcode===proposal.cell.person.laborcode):undefined;
  const taskPlanCapacityDays=taskPlanContextValid?(taskPlanCapacityMatches?taskPlanCapacity?.days??[]:refreshedProposalPerson?.days??[]):[];
  const taskPlanCapacityReady=taskPlanContextValid&&(taskPlanCapacityMatches?taskPlanCapacity?.state==='ready':!!refreshedProposalPerson);
  const taskPlanCapacityLoading=taskPlanContextValid&&taskPlanCapacityMatches&&taskPlanCapacity?.state==='loading';
  const taskPlanDates=taskPlanStart?taskPlanCapacityDays.filter(day=>day.date>=taskPlanStart).map(day=>day.date):[];
  const taskPlanRangeValid=taskPlanDates.length>0&&taskPlanDates.length<=366&&taskPlanDates[0]===taskPlanStart&&taskPlanDates.every((date,index)=>index===0||date===addCalendarDays(taskPlanDates[index-1],1));
  const planTasks=assignableTasks.filter(task=>chosenTaskKeys.includes(`${task.task_workorder_id}:${task.task_id}`)).map(task=>({key:`${task.task_workorder_id}:${task.task_id}`,taskId:task.task_id,minutes:Number(taskMinutes[`${task.task_workorder_id}:${task.task_id}`]??0)}));
  const automaticPlans=proposal&&taskPlanCapacityReady?suggestTaskPlans(planTasks,taskPlanCapacityDays,taskPlanStart):{plans:{},blocked:false,unplaced:selectedTaskTotal,end:taskPlanStart};
  const lastPlannedIndex=taskPlanDates.reduce((last,date,index)=>Object.values(automaticPlans.plans).some(segments=>(segments[date]??0)>0)?index:last,-1);
  const shownPlanDateCount=automaticPlans.unplaced>0?taskPlanDates.length:Math.min(taskPlanDates.length,Math.max(2,lastPlannedIndex+2));
  const planDates=taskPlanDates.slice(0,shownPlanDateCount);
  const availableByDate=new Map(taskPlanCapacityDays.filter(day=>day.date>=taskPlanStart).map(day=>[day.date,day.load_complete===true?Math.max(0,Math.min(630,day.capacity_minutes)-day.allocated_minutes):0]));
  const visibleTaskPlans=Object.fromEntries(planTasks.map(task=>[task.key,Object.fromEntries(planDates.map(date=>[date,taskPlanSegments[task.key]?.[date]??automaticPlans.plans[task.key]?.[date]??0]))]));
  const planPlaced=Object.values(visibleTaskPlans).flatMap(Object.values).reduce((sum,minutes)=>sum+minutes,0);
  const planUnplaced=Math.max(0,selectedTaskTotal-planPlaced);
  const planOverallocated=Math.max(0,planPlaced-selectedTaskTotal);
  const planDayTotals=Object.fromEntries(planDates.map(date=>[date,Object.values(visibleTaskPlans).reduce((sum,segments)=>sum+(segments[date]??0),0)]));
  const planTaskTotals=Object.fromEntries(planTasks.map(task=>[task.key,Object.values(visibleTaskPlans[task.key]??{}).reduce((sum,minutes)=>sum+minutes,0)]));
  const planCellsValid=Object.values(visibleTaskPlans).every(segments=>Object.values(segments).every(minutes=>Number.isInteger(minutes)&&minutes>=0));
  const planValid=!!taskPlanMode&&taskPlanRangeValid&&!!planTasks.length&&planTasks.length<=50&&planTasks.every(task=>Number.isInteger(task.minutes)&&task.minutes>0&&!!taskAssignments[task.key])&&taskPlanCapacityReady&&taskPlanDates.every(date=>taskPlanCapacityDays.find(day=>day.date===date)?.load_complete===true)&&planCellsValid&&planTasks.every(task=>planTaskTotals[task.key]===task.minutes)&&planPlaced===selectedTaskTotal&&planUnplaced===0&&planOverallocated===0&&planDates.every(date=>(planDayTotals[date]??0)<=(availableByDate.get(date)??0)&&(planDayTotals[date]??0)<=630)&&planPlaced>0;
  const proposalDay=proposal?capacityFor(proposal.cell.person,proposal.cell.date):undefined;
  const proposalDirty=!!proposal?.item&&(proposal.minutes!==proposal.item.minutes||proposal.cell.date!==proposal.item.date||proposal.cell.person.person_id!==proposal.item.person_id);
  const planOtherMinutes=proposal?.item?.plan_id?timeline?.items.filter(item=>item.state==='reserved'&&item.plan_id===proposal.item?.plan_id&&item.id!==proposal.item?.id).reduce((sum,item)=>sum+item.minutes,0)??0:0;
  const planEditLimit=proposal?.item?.plan_id?Math.max(0,(proposal.item.plan_total_minutes??0)-planOtherMinutes):630;
  const displayedProposalDate=!proposal?.item&&taskPlanMode?taskPlanStart:proposal?.cell.date;
  const displayedProposalDay=!proposal?.item&&taskPlanMode?taskPlanCapacityDays.find(day=>day.date===taskPlanStart):proposalDay;

  async function verifyMutationContext(context: MutationContext) {
    const settings = await getConnectionSettings(new AbortController().signal, { fresh: true });
    const grant = activeGrant(settings.session);
    if (settings.session.user.id !== context.principal || !grant || grant.connection_id !== context.connectionId ||
        grant.discipline !== context.discipline || grant.capability !== 'write' || context.poolId !== pool?.id || context.month !== month || pool.capability !== 'write') {
      throw new MutationContextError('Phiên, quyền hoặc phạm vi timeline đã thay đổi. Tải lại quyền trước khi tiếp tục.');
    }
  }

  function clearWorkspaceAfterAuthorizationFailure(reason: unknown): boolean {
    const denied = reason instanceof MutationContextError || reason instanceof RetrievalError && [401,403,404].includes(reason.status);
    if(!denied)return false;
    taskPlanCapacityController.current?.abort();planMoveController.current?.abort();taskPlanCapacityGeneration.current+=1;
    assignmentRevision.current='';setRevisionNotice(false);setCheckingSession(false);setGrantCanWrite(false);setTimeline(null);setSnapshotContext('');setWorkOrderPage(null);setSelectedWorkOrder(null);setSelectedWoKey('');setPool(null);setPoolRevision(-1);setProposal(null);setPlanMove(null);
    setTaskData(null);setTaskLoading(false);setSelectedTasks({});setTaskMinutes({});setTaskAssignments({});setTaskPlanCapacity(undefined);
    setError(reason instanceof Error?reason.message:'Phiên hoặc quyền đã thay đổi. Kiểm tra lại quyền trước khi tiếp tục.');
    return true;
  }
  function hideWorkspaceAfterFailedProof(reason:unknown){
    if(clearWorkspaceAfterAuthorizationFailure(reason))return;
    taskPlanCapacityController.current?.abort();planMoveController.current?.abort();taskPlanCapacityGeneration.current+=1;assignmentRevision.current='';setRevisionNotice(false);
    setCheckingSession(false);setGrantCanWrite(false);setTimeline(null);setSnapshotContext('');setWorkOrderPage(null);setSelectedWorkOrder(null);setSelectedWoKey('');setPool(null);setPoolRevision(-1);setProposal(null);setPlanMove(null);
    setTaskData(null);setTaskLoading(false);setSelectedTasks({});setTaskMinutes({});setTaskAssignments({});setTaskPlanCapacity(undefined);
    setError(reason instanceof Error?reason.message:'Không xác minh được phạm vi sau khi lưu; dữ liệu đã được ẩn cho đến khi tải lại.');
  }

  function beginCreate(person: ResourcePerson, date: string, selected?: AssignmentWorkOrder) {
    if (!canWrite || !timeline) return;
    const capacity = capacityFor(person, date);
    if (!capacity || capacity.capacity_minutes < 1) return;
    const chosen = selectedWorkOrder ?? workOrders.find(order => `${order.siteid}|${order.workorderid}` === selectedWoKey);
    const candidate = selected ?? (chosen ? { connection_id: pool!.connection_id, site_id: chosen.siteid, workorder_id: chosen.workorderid, wonum: chosen.wonum, description: chosen.description ?? '', status: chosen.status, eligible: true } : undefined);
    resetProposalDetails(!!candidate);
    setTaskPlanStart(date);
    const minutes = Math.min(60, capacity.remaining_minutes) || 60;
    setProposal({ cell: { person, date }, workOrder: candidate, minutes, hours: String(minutes / 60) });
  }
  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, payload: string, label: string) {
    if (!canWrite || event.button !== 0 || event.isPrimary === false) return;
    pointerDrag.current = {payload,label,startX:event.clientX,startY:event.clientY,moved:false,context:currentContext};
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag) return;
    if (!canWrite || drag.context !== currentContext) { cancelDrag(); return; }
    if (Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY) < 6 && !drag.moved) return;
    drag.moved = true;
    setDragPreview({label:drag.label,x:event.clientX,y:event.clientY});
  }
  function cancelDrag() { pointerDrag.current = null; setDragPreview(null); }
  function finishDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    cancelDrag();
    if (!drag?.moved || !canWrite || drag.context !== currentContext) return;
    setSuppressClick(true); window.setTimeout(()=>setSuppressClick(false),300);
    const cell = document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLTableCellElement>('td[data-person-id][data-date]');
    const person = roster.find(row => row.person_id === cell?.dataset.personId);
    const date = cell?.dataset.date;
    if (!person || !date) return;
    if (!(capacityFor(person,date)?.capacity_minutes ?? 0)) { setError('Ngày này không có giờ làm việc theo rota.'); return; }
    dropPayload(drag.payload,person,date);
  }
  function beginPlanMove(item:Assignment,person:ResourcePerson,date:string,wholeTask=false){
    if(!canWrite||!pool||!timeline||!item.plan_id||item.state!=='reserved'||(item.plan_sync_state??item.sync_state??'local')!=='local'||item.remote_assignment_id){setError('Chỉ có thể chuyển kế hoạch nội bộ chưa gửi lên Maximo.');return;}
    const samePlan=(candidate:Assignment)=>candidate.plan_id===item.plan_id&&candidate.pool_id===item.pool_id&&candidate.connection_id===item.connection_id&&candidate.site_id===item.site_id&&candidate.workorder_id===item.workorder_id&&candidate.person_id===item.person_id&&candidate.task_workorder_id===item.task_workorder_id&&candidate.task_id===item.task_id&&candidate.assignment_id===item.assignment_id&&candidate.state==='reserved';
    const all=[...timeline.items,...(planRecovery?.key===planRecoveryKey?planRecovery.items:[])];
    const knownById=new Map<string,Assignment>();
    for(const candidate of all.filter(candidate=>samePlan(candidate)&&(candidate.plan_sync_state??candidate.sync_state??'local')==='local'&&!candidate.remote_assignment_id)){const previous=knownById.get(candidate.id);if(!previous||candidate.version>previous.version||candidate.version===previous.version&&(candidate.plan_version??0)>(previous.plan_version??0))knownById.set(candidate.id,candidate);}
    const knownItems=[...knownById.values()];
    if(!knownItems.some(candidate=>candidate.id===item.id)){setError('Không thể xác minh phân đoạn neo trong kế hoạch hiện tại. Làm mới timeline trước khi chuyển.');return;}
    const multiDay=(item.plan_total_minutes??item.minutes)>item.minutes;
    if(multiDay&&person.person_id===item.person_id&&!wholeTask){
      resetProposalDetails(true);setTaskPlanStart(date);setProposal({item,cell:{person,date},minutes:item.minutes,hours:String(item.minutes/60)});return;
    }
    if(person.person_id===item.person_id&&date===item.date&&!wholeTask)return;
    if(!item.plan_version){setError('Kế hoạch chưa có phiên bản để chuyển an toàn. Làm mới timeline trước khi thử lại.');return;}
    resetProposalDetails(false);setProposal(null);setError('');setPlanMove({planId:item.plan_id,item,knownItems,targetPersonId:person.person_id,targetDate:date,mode:'shift',preview:null,loading:true,error:'',canReallocate:false,unknown:false,reconciling:false});
  }
  function dropPayload(payload: string, person: ResourcePerson, date: string) {
    if (!canWrite || !timeline) return;
    const cell = { person, date };
    const item = timeline.items.find(candidate => candidate.id === payload && candidate.state === 'reserved');
    if(item?.plan_id&&canEditItem(item)){beginPlanMove(item,person,date);return;}
    if (item && canEditItem(item)) {resetProposalDetails(item.task_id!==null&&item.task_id!==undefined);setProposal({ item, cell, minutes: item.minutes, hours: String(item.minutes / 60) });}
    else {
    const [siteid, workorderid] = payload.split('|');
    const order = dialogWorkOrders.find(candidate => candidate.siteid === siteid && candidate.workorderid === workorderid);
      if (order) {
        const existing = timeline.items.find(item => item.state === 'reserved' && item.site_id === siteid && item.workorder_id === workorderid && item.person_id === person.person_id && item.date === date);
        if (existing) edit(existing);
        else beginCreate(person, date, { connection_id: pool!.connection_id, site_id: order.siteid, workorder_id: order.workorderid,
          wonum: order.wonum, description: order.description ?? '', status: order.status, eligible: true });
      }
    }
  }
  function edit(item: Assignment) {
    if (!canWrite&&item.sync_state!=='synced'&&item.plan_sync_state!=='synced') return;
    const person = roster.find(row => row.person_id === item.person_id);
    if (person) { resetProposalDetails(item.task_id!==null&&item.task_id!==undefined);setTaskPlanStart(item.date); setProposal({ item, cell: { person, date: item.date }, minutes: item.minutes, hours: String(item.minutes / 60) }); }
  }
  function clickWorkOrder(event:React.MouseEvent<HTMLButtonElement>,order:WorkOrder){if(event.detail&&suppressClick){setSuppressClick(false);return;}const key=`${order.siteid}|${order.workorderid}`;setSelectedWoKey(key);setSelectedWorkOrder(order);resetProposalDetails(false);setMessage(`${order.wonum}: chọn ô roster đang làm việc để phân công.`);}
  function clickAssignment(event:React.MouseEvent<HTMLButtonElement>,item:Assignment){if(event.detail&&suppressClick){setSuppressClick(false);return;}edit(item);}
  function resetProposalDetails(loading:boolean){setTaskData(null);setTaskError('');setTaskLoading(loading);setSelectedTasks({});setTaskMinutes({});setTaskAssignments({});setTaskPlanMode(false);setTaskPlanStart('');setTaskPlanSegments({});setTaskPlanCapacity(undefined);setUploadWall('');setUploadResult(null);setUploadUnknownRequest('');}
  async function finishPlanMove(result:AssignmentPlanMoveResult,move:PlanMoveState){
    setPlanRecovery({key:planRecoveryKey,items:result.items.filter(item=>item.state==='reserved')});
    await applyConfirmedMutation(result.items,move.preview?.old_items??move.knownItems,result.affected_days,result.planning_summary,result.assignment_revision,result.allocation_updates,result.previous_assignment_revision,result.work_order);
    setPlanMove(null);setMessage('Task đã được chuyển trong kế hoạch nội bộ; Maximo chưa được thay đổi.');
  }
  async function submitPlanMove(){
    if(!planMove?.preview||!pool||busy||planMove.request)return;
    const move=planMove;const preview=move.preview as AssignmentPlanMovePreview;const input:AssignmentPlanMoveInput={connection_id:pool.connection_id,discipline,expected_plan_version:preview.plan_version,anchor_allocation_id:move.item.id,target_person_id:move.targetPersonId,target_date:move.targetDate,mode:move.mode,request_id:newId(),segments:preview.segments};
    const context:MutationContext={principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month};
    setBusy(true);setError('');setPlanMove(current=>current?{...current,request:input}:current);
    try{
      await verifyMutationContext(context);
      const result=await moveAssignmentPlan(pool.id,move.planId,input,preview,new AbortController().signal);
      await finishPlanMove(result,move);
    }catch(reason){
      if(reason instanceof AssignmentError&&reason.status===409){
        if(reason.code==='plan_move_conflict'&&move.mode==='shift')setPlanMove(current=>current?{...current,loading:false,preview:null,error:reason.message,canReallocate:true,request:undefined}:current);
        else setPlanMove(current=>current?{...current,loading:false,preview:null,error:reason.message,canReallocate:false,request:undefined}:current);
      }else if(reason instanceof AssignmentError&&([401,403,404,422].includes(reason.status)||reason.outcome==='not_sent')){
        if(!clearWorkspaceAfterAuthorizationFailure(reason))setPlanMove(current=>current?{...current,error:reason.message,request:undefined}:current);
      }else{
        const inputForLookup=input;
        try{
          const receipt=await lookupAssignmentPlanMoveRequest(input.request_id,pool.id,move.planId,input,preview,new AbortController().signal);
          if(receipt){await finishPlanMove(receipt,move);return;}
          setPlanMove(current=>current?{...current,unknown:true,reconciling:false,error:'Chưa tìm thấy biên nhận. Giữ nguyên mã yêu cầu và đối soát lại; không gửi POST lần nữa.',request:inputForLookup}:current);
        }catch(lookupError){
          if(!clearWorkspaceAfterAuthorizationFailure(lookupError))setPlanMove(current=>current?{...current,unknown:true,reconciling:false,error:`Không đọc được biên nhận chuyển. Đối soát lại bằng cùng mã yêu cầu. ${lookupError instanceof Error?lookupError.message:''}`,request:inputForLookup}:current);
        }
      }
    }finally{setBusy(false);}
  }
  async function reconcilePlanMove(){
    if(!planMove?.request||!planMove.preview||!pool||planMove.reconciling)return;
    const move=planMove;const request=move.request as AssignmentPlanMoveInput;const preview=move.preview as AssignmentPlanMovePreview;setPlanMove(current=>current?{...current,reconciling:true,error:''}:current);
    try{
      const receipt=await lookupAssignmentPlanMoveRequest(request.request_id,pool.id,move.planId,request,preview,new AbortController().signal);
      if(receipt){await finishPlanMove(receipt,move);return;}
      setPlanMove(current=>current?{...current,reconciling:false,error:'Biên nhận chưa khả dụng. Giữ nguyên yêu cầu; không gửi lại thao tác chuyển.'}:current);
    }catch(reason){
      if(!clearWorkspaceAfterAuthorizationFailure(reason))setPlanMove(current=>current?{...current,reconciling:false,error:reason instanceof Error?reason.message:'Không thể đọc biên nhận.'}:current);
    }
  }
  async function loadTaskPlanCapacity(){
    if(!taskPlanMode||!proposal||!pool||!taskPlanCapacityReady||taskPlanCapacityLoading)return;
    const priorDays=taskPlanCapacityDays.filter(day=>day.date>=taskPlanStart).sort((a,b)=>a.date.localeCompare(b.date));
    const dateCount=priorDays.length;if(dateCount>=366)return;
    const context:MutationContext={principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month};
    if(!canWrite){setError('Phiên hoặc quyền đã thay đổi; tải lại trước khi đề xuất kế hoạch.');return;}
    taskPlanCapacityController.current?.abort();const controller=new AbortController();taskPlanCapacityController.current=controller;
    const generation=++taskPlanCapacityGeneration.current;
    setTaskPlanCapacity({key:taskPlanContextKey,state:'loading',days:taskPlanCapacityDays});setError('');
    try{
      await verifyMutationContext(context);
      const chunkStart=priorDays.length?addCalendarDays(priorDays[priorDays.length-1].date,1):taskPlanStart;const chunkEnd=addCalendarDays(chunkStart,Math.min(30,365-dateCount));
      const snapshot=await getResourceTimeline(pool.id,{connection_id:pool.connection_id,discipline,date_from:chunkStart,date_before:addCalendarDays(chunkEnd,1)},controller.signal);
      if(controller.signal.aborted||generation!==taskPlanCapacityGeneration.current)return;
      if(snapshot.pool_id!==pool.id||timeline&&snapshot.pool_version!==timeline.pool_version)throw new Error('Pool hoặc phiên bản rota thay đổi giữa các khoảng tải. Tải lại trước khi tiếp tục.');
      const rows=snapshot.rows.filter(row=>row.person_id===proposal.cell.person.person_id);
      if(!rows.length||rows.some(row=>row.craft!==proposal.cell.person.craft||row.laborcode!==proposal.cell.person.laborcode))throw new Error('Không xác minh được cùng nhân lực/discipline trong toàn bộ khoảng ngày.');
      const newDays=rows.flatMap(row=>row.days).filter(day=>day.date>=chunkStart&&day.date<=chunkEnd);
      const chunkDates=calendarRange(chunkStart,chunkEnd,31);if(chunkDates.length!==newDays.length||chunkDates.some(date=>!newDays.some(day=>day.date===date&&day.load_complete===true)))throw new Error(`Thiếu rota hoặc tải Maximo chưa hoàn chỉnh của ${proposal.cell.person.name} trong ${chunkStart} đến ${chunkEnd}.`);
      const days=[...taskPlanCapacityDays,...newDays].sort((a,b)=>a.date.localeCompare(b.date));
      if(controller.signal.aborted||generation!==taskPlanCapacityGeneration.current)return;
      await verifyMutationContext(context);
      if(controller.signal.aborted||generation!==taskPlanCapacityGeneration.current)return;
      setTaskPlanCapacity({key:taskPlanContextKey,state:'ready',days});
    }catch(reason){
      if(controller.signal.aborted||generation!==taskPlanCapacityGeneration.current)return;
      if(!clearWorkspaceAfterAuthorizationFailure(reason))setTaskPlanCapacity({key:taskPlanContextKey,state:'error',days:taskPlanCapacityDays,error:reason instanceof Error?reason.message:'Không tải được capacity cho kế hoạch nhiều ngày.'});
    }
  }
  useEffect(()=>{
    if(taskPlanMode&&taskPlanCapacityReady&&!automaticPlans.blocked&&automaticPlans.unplaced>0&&!taskPlanCapacityLoading&&taskPlanDates.length<366)queueMicrotask(()=>void loadTaskPlanCapacity());
    // Capacity is extended one bounded request at a time until all selected demand is placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[taskPlanContextKey,taskPlanMode,taskPlanCapacityReady,taskPlanCapacityLoading,taskPlanDates.length,automaticPlans.unplaced,automaticPlans.blocked]);
  function canEditItem(item: Assignment) {
    if(item.plan_id&&(item.plan_sync_state??item.sync_state??'local')!=='local') return false;
    if(item.task_id!==null&&item.task_id!==undefined && (item.sync_state??'local')!=='local') return false;
    return timeline?.work_orders.some(order => order.site_id === item.site_id && order.workorder_id === item.workorder_id && order.eligible) ?? false;
  }
  async function refreshAfterMutation(saved: Assignment, previous?:Assignment) {
    await applyConfirmedMutation([saved],previous?[previous]:[],saved.affected_days,saved.planning_summary,saved.assignment_revision,saved.allocation_updates,saved.previous_assignment_revision,saved.work_order);
    setProposal(null); setMessage('Phân công đã lưu vào kế hoạch nội bộ; Maximo chưa được thay đổi.');
  }
  async function refreshTaskBatch(items:Assignment[],affectedDays?:AffectedCapacityDay[],summary?:PlanningSummary,revision?:string,allocationUpdates?:Assignment[],previousRevision?:string,workOrder?:AssignmentWorkOrder) {
    await applyConfirmedMutation(items,[],affectedDays,summary,revision,allocationUpdates,previousRevision,workOrder);
    setProposal(null); setMessage(`${items.length} phân công task đã lưu vào kế hoạch nội bộ; Maximo chưa được thay đổi.`);
  }
  async function refreshTaskPlan(items:Assignment[],affectedDays?:AffectedCapacityDay[],summary?:PlanningSummary,revision?:string,allocationUpdates?:Assignment[],previousRevision?:string,workOrder?:AssignmentWorkOrder) {
    await applyConfirmedMutation(items,[],affectedDays,summary,revision,allocationUpdates,previousRevision,workOrder);
    setProposal(null);setMessage(`${items.length} phân đoạn của kế hoạch nhiều ngày đã lưu nội bộ; Maximo chưa được thay đổi.`);
  }
  async function refreshTaskPlanBatch(result:TaskPlanBatchResult){const items=result.plans.flatMap(plan=>plan.items);await refreshTaskPlan(items,result.affected_days,result.planning_summary,result.assignment_revision,result.allocation_updates,result.previous_assignment_revision,result.work_order);setMessage(`${result.plans.length} task đã được xếp tự động thành ${items.length} phân đoạn theo rota; Maximo chưa được thay đổi.`);}

  async function applyConfirmedMutation(items:Assignment[],previous:Assignment[],affectedDays?:AffectedCapacityDay[],summary?:PlanningSummary,revision?:string,allocationUpdates?:Assignment[],previousRevision?:string,workOrder?:AssignmentWorkOrder){
    setError('');
    if(!pool){hideWorkspaceAfterFailedProof(new MutationContextError('Không còn resource pool đang được xác minh.'));return;}
    try{await verifyMutationContext({principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month});}
    catch(reason){hideWorkspaceAfterFailedProof(reason);return;}
    const scopedItems=[...items,...(allocationUpdates??[])];
    if(scopedItems.some(item=>item.pool_id!==pool.id||item.connection_id!==pool.connection_id||item.discipline!==discipline||item.site_id!==(items[0]?.site_id??previous[0]?.site_id)||item.workorder_id!==(items[0]?.workorder_id??previous[0]?.workorder_id))){hideWorkspaceAfterFailedProof(new MutationContextError('Biên nhận cập nhật assignment vượt ngoài WO hoặc phạm vi đã chọn.'));return;}
    const latestById=new Map(items.map(item=>[item.id,item]));
    for(const update of allocationUpdates??[]){const prior=latestById.get(update.id);if(!prior||update.version>=prior.version)latestById.set(update.id,update);}
    const currentItems=[...latestById.values()];
    const changed=[...previous,...currentItems];
    const datesChanged=[...new Set(changed.map(item=>item.date).filter(date=>date>=`${month}-01`&&date<`${addMonth(month)}-01`))].sort();
    const metadataScopeValid=!!affectedDays&&!!pool&&affectedDays.every(day=>day.pool_id===pool.id&&timeline?.rows.some(row=>row.person_id===day.person_id&&row.craft===day.craft&&row.laborcode===day.laborcode));
    const metadataCoversChanges=metadataScopeValid&&changed.filter(item=>dates.includes(item.date)).every(item=>affectedDays!.some(day=>day.person_id===item.person_id&&day.date===item.date));
    const dayUpdates=metadataCoversChanges?affectedDays!.filter(day=>dates.includes(day.date)):undefined;
    const refreshedRanges:TimelineData[]=[];
    if(!dayUpdates?.length&&datesChanged.length&&pool){
      try{
        const context:MutationContext={principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month};
        await verifyMutationContext(context);
        const runs:string[][]=[];
        for(const date of datesChanged){const run=runs.at(-1);if(run&&run.length<31&&date===addCalendarDays(run.at(-1)!,1))run.push(date);else runs.push([date]);}
        for(const run of runs)refreshedRanges.push(await getResourceTimeline(pool.id,{connection_id:pool.connection_id,discipline,date_from:run[0],date_before:addCalendarDays(run.at(-1)!,1)},new AbortController().signal));
        await verifyMutationContext(context);
      }catch(reason){
        if(clearWorkspaceAfterAuthorizationFailure(reason))return;
        setError('Phân công đã được xác nhận nhưng chưa thể làm mới capacity của các ngày bị ảnh hưởng. Các ô đó được đánh dấu chưa xác minh; hãy bấm Làm mới timeline.');
      }
    }
    const finalSummary:PlanningSummary=summary??{state:'unverified',remaining_minutes:null,remaining_tasks:null,total_tasks:null,verified_at:null};
    setTimeline(current=>{
      if(!current)return current;
      let rows=current.rows.map(row=>({...row,days:row.days.map(day=>({...day}))}));
      if(dayUpdates?.length){
        for(const update of dayUpdates){
          const found=rows.some(row=>row.person_id===update.person_id&&row.craft===update.craft&&row.laborcode===update.laborcode&&row.days.some(day=>day.date===update.date));
          if(found)rows=rows.map(row=>row.person_id===update.person_id&&row.craft===update.craft&&row.laborcode===update.laborcode?{...row,days:row.days.map(day=>day.date===update.date?{date:update.date,code:update.code,capacity_minutes:update.capacity_minutes,allocated_minutes:update.allocated_minutes,remaining_minutes:update.remaining_minutes,local_minutes:update.local_minutes,external_minutes:update.external_minutes,synced_minutes:update.synced_minutes,load_complete:update.load_complete}:day)}:row);
        }
      }
      for(const snapshot of refreshedRanges){
        rows=rows.map(row=>{const replacements=snapshot.rows.flatMap(source=>source.person_id===row.person_id&&source.craft===row.craft&&source.laborcode===row.laborcode?source.days:[]);if(!replacements.length)return row;const byDate=new Map(replacements.map(day=>[day.date,day]));return {...row,days:[...row.days.filter(day=>!byDate.has(day.date)),...replacements].sort((a,b)=>a.date.localeCompare(b.date))};});
      }
      const newIds=new Set(currentItems.map(item=>item.id));
      let nextItems=current.items.filter(item=>!newIds.has(item.id)&&!previous.some(old=>old.id===item.id));
      nextItems=[...nextItems,...currentItems.filter(item=>item.state==='reserved'&&dates.includes(item.date))];
      for(const snapshot of refreshedRanges){const rangeDates=new Set(snapshot.rows.flatMap(row=>row.days.map(day=>day.date)));nextItems=[...nextItems.filter(item=>!rangeDates.has(item.date)),...snapshot.items.filter(item=>item.state==='reserved')];}
      // Header versions are shared by every segment, even when PATCH returns one row.
      const planVersions=new Map<string,number>();
      for(const item of [...nextItems,...currentItems])if(item.plan_id&&item.plan_version)planVersions.set(item.plan_id,Math.max(planVersions.get(item.plan_id)??0,item.plan_version));
      nextItems=nextItems.map(item=>item.plan_id&&(planVersions.get(item.plan_id)??0)>(item.plan_version??0)?{...item,plan_version:planVersions.get(item.plan_id)}:item);
      if(!dayUpdates?.length&&datesChanged.length&&!refreshedRanges.length){
        const affectedPairs=new Set(changed.map(item=>`${item.person_id}:${item.date}`));
        rows=rows.map(row=>({...row,days:row.days.map(day=>affectedPairs.has(`${row.person_id}:${day.date}`)?{...day,load_complete:false}:day)}));
      }
      const wo=workOrder??(proposal?.workOrder??undefined);
      const work_orders=wo?current.work_orders.some(order=>order.site_id===wo.site_id&&order.workorder_id===wo.workorder_id)?current.work_orders.map(order=>order.site_id===wo.site_id&&order.workorder_id===wo.workorder_id?wo:order):[...current.work_orders,wo]:current.work_orders;
      return {...current,rows,items:nextItems,work_orders};
    });
    setSummaryNow(Date.now());
    const siteId=currentItems[0]?.site_id??previous[0]?.site_id;const workOrderId=currentItems[0]?.workorder_id??previous[0]?.workorder_id;
    if(siteId&&workOrderId)setWorkOrders(current=>current.map(order=>order.siteid===siteId&&order.workorderid===workOrderId?{...order,allocation_summary:{state:finalSummary.state,remaining_minutes:finalSummary.remaining_minutes,remaining_tasks:finalSummary.remaining_tasks,total_tasks:finalSummary.total_tasks??order.allocation_summary?.total_tasks??null,verified_at:finalSummary.verified_at}}:order));
    if(revision&&previousRevision&&previousRevision===assignmentRevision.current&&!revisionNotice){assignmentRevision.current=revision;setRevisionNotice(false);}
    else if(revision)setRevisionNotice(true);
  }
  async function submit(kind: Pending['kind']) {
    if (!proposal || !pool || !timeline || busy) return;
    const { item, workOrder, cell, minutes } = proposal;
    if (kind !== 'delete' && kind!=='task-plan-batch' && (!workOrder && !item || !Number.isInteger(minutes) || minutes < 1)) return;
    const targetDay = capacityFor(cell.person, cell.date);
    const replacing = item && item.person_id === cell.person.person_id && item.date === cell.date ? item.minutes : 0;
    const requestedMinutes=kind==='task-batch'||kind==='task-plan-batch'?selectedTaskTotal:minutes;
    if(kind==='task-plan-batch'&&(!planValid||!workOrder)){setError('Bảng phân bổ chưa khớp tổng giờ từng task hoặc capacity rota/tải Maximo chưa đủ.');return;}
    if (kind !== 'delete' && kind!=='task-plan-batch' && (!targetDay || targetDay.load_complete!==true || wouldExceedCapacity(targetDay, requestedMinutes, replacing))) { setError(targetDay?.load_complete!==true?'Tải Maximo người/ngày chưa đầy đủ; chưa thể lưu an toàn.':'Tổng phân công sẽ vượt capacity của người trong ngày này (tối đa 10,5 giờ).'); return; }
    if (kind === 'delete' && !item) return;
    const scope = workOrder;
    const input: AssignmentInput | undefined = kind === 'delete' || kind === 'task-batch' || kind === 'task-plan-batch' ? undefined : {
      connection_id: pool.connection_id, site_id: scope?.site_id ?? item!.site_id,
      workorder_id: scope?.workorder_id ?? item!.workorder_id, discipline,
      person_id: cell.person.person_id, date: cell.date, minutes, request_id: newId(),
    };
    if (kind !== 'delete' && !discipline) { setError('Không xác minh được discipline hiện tại. Tải lại quyền trước khi lưu.'); return; }
    const context: MutationContext = { principal, connectionId: pool.connection_id, discipline, poolId: pool.id, month };
    const taskInput:TaskAllocationInput|undefined=kind==='task-batch' && workOrder ? {connection_id:pool.connection_id,site_id:workOrder.site_id,workorder_id:workOrder.workorder_id,discipline,person_id:cell.person.person_id,date:cell.date,request_id:newId(),tasks:chosenTaskKeys.map(key=>{const [task_workorder_id,taskId]=key.split(':'); const task_id=Number(taskId); return {task_workorder_id,task_id,assignment_id:taskAssignments[key]||null,minutes:Number(taskMinutes[key]??0)};})} : undefined;
    const planBatchInput:TaskPlanBatchInput|undefined=kind==='task-plan-batch'&&workOrder?{connection_id:pool.connection_id,site_id:workOrder.site_id,workorder_id:workOrder.workorder_id,discipline,person_id:cell.person.person_id,request_id:newId(),tasks:planTasks.map(task=>({task_workorder_id:task.key.split(':')[0],task_id:task.taskId,assignment_id:taskAssignments[task.key]??'',total_minutes:task.minutes,segments:planDates.map(date=>({date,minutes:visibleTaskPlans[task.key]?.[date]??0})).filter(segment=>segment.minutes>0)}))}:undefined;
    const operation: Pending = { requestId: input?.request_id ?? taskInput?.request_id ?? planBatchInput?.request_id ?? newId(), kind, assignmentId: item?.id, input: input ? { ...input, request_id: input.request_id } : undefined, taskInput,planBatchInput,
      version: item?.version, item, context };
    setPending(operation); setBusy(true); setUnknown(false); setError(''); setMessage('');
    await execute(operation);
  }
  async function submitUpload(item:Assignment){
    if(!taskData?.upload_enabled || item.plan_id || !canWrite || !pool || proposalDirty || uploading || uploadUnknownRequest || (uploadResult?.state==='confirmed'||uploadResult?.state==='unknown') || (item.sync_state??'local')!=='local' || item.task_id===null || item.task_id===undefined || !item.assignment_id) return;
    let scheduled_start:string;
    try{scheduled_start=zonedDateTime(uploadWall,pool.timezone);}catch(reason){setError(reason instanceof Error?reason.message:'Chọn ngày giờ bắt đầu hợp lệ.');return;}
    setUploading(true);setError('');setUploadResult(null);
    try{
      const context:MutationContext={principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month}; await verifyMutationContext(context);
      const requestId=newId();setUploadUnknownRequest(requestId);
      let result:AssignmentUploadResult;
      try{result=await uploadAssignment(item,requestId,scheduled_start,new AbortController().signal);}
      catch(reason){if(reason instanceof AssignmentError && reason.outcome==='not_sent'){setUploadUnknownRequest('');setError(reason.message);return;}const receipt=await lookupAssignmentUploadSubmission(requestId,new AbortController().signal);if(!receipt){setError(`Upload chưa có kết quả xác nhận. Giữ mã ${requestId} và đối soát; không gửi lại.`);return;}result=receipt;}
      if(!matchesUpload(result,requestId,item.id)){setError("Biên nhận không khớp request hoặc assignment; hãy đối soát trước khi thử lại.");return;}
      setUploadResult(result);setUploadUnknownRequest(result.state==='unknown'?requestId:'');
      if(result.state==='confirmed'){setMessage('Assignment đã được xác nhận trên Maximo.');setProposal(null);setReload(value=>value+1);}
      else if(result.state==='unknown')setError('Kết quả upload chưa rõ; không gửi lại. Hãy đối soát biên nhận.');
      else setError(result.detail??(result.state==='conflict'?'Assignment trên Maximo đã thay đổi.':'Maximo từ chối cập nhật assignment.'));
    }catch(reason){setError(reason instanceof Error?reason.message:'Không xác định được kết quả upload. Hãy đối soát trước khi thử lại.');}
    finally{setUploading(false);}
  }
  async function reconcileUpload(){
    if(uploading || !uploadUnknownRequest&&(!uploadResult||uploadResult.state!=='unknown'))return;
    setUploading(true);
    try{
      const prior=uploadResult; const expectedRequest=uploadUnknownRequest||prior?.request_id||''; const expectedAllocation=prior?.allocation_id||proposal?.item?.id||'';
      const result=prior?.state==='unknown'?await reconcileAssignmentUpload(prior.attempt_id,new AbortController().signal):await lookupAssignmentUploadSubmission(expectedRequest,new AbortController().signal);
      if(!result){setError(`Chưa có biên nhận cho ${expectedRequest}. Không gửi lại request.`);return;}
      if(!matchesUpload(result,expectedRequest,expectedAllocation)){setError('Biên nhận không khớp assignment/request; giữ trạng thái chưa rõ và không gửi lại.');return;}
      setUploadResult(result);setUploadUnknownRequest(result.state==='unknown'?expectedRequest:'');if(result.state==='confirmed'){setMessage('Assignment đã được xác nhận trên Maximo.');setProposal(null);setReload(value=>value+1);}else if(result.state!=='unknown')setError(result.detail??`Kết quả upload: ${result.state}.`);
    }catch(reason){setError(reason instanceof Error?reason.message:'Chưa thể đối soát upload.');}
    finally{setUploading(false);}
  }
  async function execute(operation: Pending) {
    const retryingUnknown = unknown;
    setBusy(true); setPending(operation); setUnknown(false);
    try { await verifyMutationContext(operation.context); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không xác minh được quyền hiện tại.');
      setTimeline(null); setPool(null);
      if (retryingUnknown) { setUnknown(true); setPending(operation); }
      else setPending(null);
      setBusy(false); return;
    }
    const controller = new AbortController();
    try {
      if (retryingUnknown) {
        if(operation.kind==='task-plan-batch'){
          const input={...operation.planBatchInput!};delete (input as Partial<TaskPlanBatchInput>).request_id;
          const receipt=await lookupTaskPlanBatchRequest(operation.requestId,input,controller.signal);
          if(receipt){if(!matchesTaskPlanBatch(operation,receipt,operation.context.poolId,operation.context.connectionId))throw new Error('Biên nhận batch phân bổ task nhiều ngày không khớp.');await refreshTaskPlanBatch(receipt);setPending(null);return;}
        } else if(operation.kind==='task-batch') {
          const receipt=await lookupTaskAllocationRequest(operation.requestId,controller.signal);
          if(receipt){ if(!matchesTaskBatch(operation,receipt,operation.context.poolId,operation.context.connectionId)) throw new Error('Biên nhận batch task không khớp.'); await refreshTaskBatch(receipt.items,receipt.affected_days,receipt.planning_summary,receipt.assignment_revision,receipt.allocation_updates,receipt.previous_assignment_revision,receipt.work_order); setPending(null); return; }
        } else {
        const receipt = await lookupAssignmentRequest(operation.requestId, controller.signal);
        if (receipt) {
          if (!matchesOperation(operation, receipt, operation.context.poolId, operation.context.connectionId)) throw new Error('Biên nhận không khớp yêu cầu.');
          await refreshAfterMutation(receipt); setPending(null); return;
        }
        }
      }
      let saved: Assignment;
      if(operation.kind==='task-batch') {
        const batch=await saveTaskAllocations(pool!.id,operation.taskInput!,controller.signal);
        if(!matchesTaskBatch(operation,batch,pool!.id,pool!.connection_id)) throw new Error('Kết quả batch task không khớp chính xác yêu cầu; giữ nguyên để đối soát.');
        await refreshTaskBatch(batch.items,batch.affected_days,batch.planning_summary,batch.assignment_revision,batch.allocation_updates,batch.previous_assignment_revision,batch.work_order);
        setPending(null); return;
      }
      if(operation.kind==='task-plan-batch'){
        const batch=await saveTaskPlanBatch(pool!.id,operation.planBatchInput!,controller.signal);
        if(!matchesTaskPlanBatch(operation,batch,pool!.id,pool!.connection_id))throw new Error('Kết quả batch phân bổ task không khớp chính xác; giữ nguyên để đối soát.');
        await refreshTaskPlanBatch(batch);setPending(null);return;
      }
      if (operation.kind === 'create') saved = await saveAssignment(pool!.id, operation.input!, controller.signal);
      else if (operation.kind === 'update') saved = await updateAssignment(operation.assignmentId!, { ...operation.input!, version: operation.version! }, controller.signal);
      else saved = await deleteAssignment(operation.item!, operation.requestId, controller.signal);
      if (!matchesOperation(operation, saved, pool!.id, pool!.connection_id)) throw new Error('Kết quả lưu không khớp yêu cầu; cần đối soát trước khi tiếp tục.');
      await refreshAfterMutation(saved,operation.item); setPending(null);
    } catch (reason) {
      if (reason instanceof AssignmentError && [400, 401, 403, 404, 409, 422].includes(reason.status)) {
        setError(reason.message); setPending(null); setProposal(null);
        if([401,403,404,409].includes(reason.status))setReload(value => value + 1);
      } else {
        try {
          await verifyMutationContext(operation.context);
          if(operation.kind==='task-plan-batch'){
            const input={...operation.planBatchInput!};delete (input as Partial<TaskPlanBatchInput>).request_id;
            const receipt=await lookupTaskPlanBatchRequest(operation.requestId,input,controller.signal);
            if(receipt&&matchesTaskPlanBatch(operation,receipt,pool!.id,pool!.connection_id)){await refreshTaskPlanBatch(receipt);setPending(null);}
            else if(receipt){setUnknown(true);setError('Biên nhận batch phân bổ task không khớp nội dung đã gửi; giữ mã yêu cầu để đối soát.');}
            else {setUnknown(true);setError('Chưa xác định được kết quả phân bổ. Có thể đối soát hoặc gửi lại đúng batch với cùng mã yêu cầu.');}
          } else if(operation.kind==='task-batch'){ 
            const receipt=await lookupTaskAllocationRequest(operation.requestId,controller.signal);
            if(receipt && matchesTaskBatch(operation,receipt,pool!.id,pool!.connection_id)){await refreshTaskBatch(receipt.items,receipt.affected_days,receipt.planning_summary,receipt.assignment_revision,receipt.allocation_updates,receipt.previous_assignment_revision,receipt.work_order);setPending(null);}
            else if(receipt){setUnknown(true);setError('Biên nhận batch task không khớp chính xác người, WO, ngày, task hoặc giờ. Giữ nguyên mã để đối soát.');}
            else {setUnknown(true);setError('Chưa xác định được kết quả batch task. Có thể đối soát lại hoặc gửi lại cùng mã yêu cầu.');}
          } else {
          const receipt = await lookupAssignmentRequest(operation.requestId, controller.signal);
          if (receipt && matchesOperation(operation, receipt, pool!.id, pool!.connection_id)) { await refreshAfterMutation(receipt,operation.item); setPending(null); }
          else if (receipt) { setUnknown(true); setError('Biên nhận không khớp chính xác người, WO, ngày, giờ hoặc phiên bản yêu cầu. Hãy giữ mã này để đối soát.'); }
          else { setUnknown(true); setError('Chưa xác định được kết quả. Có thể đối soát lại hoặc gửi lại đúng yêu cầu với cùng mã.'); }
          }
        } catch { setUnknown(true); setError('Mạng hoặc phiên phản hồi không rõ kết quả. Đang khóa thay đổi cho đến khi đối soát hoặc gửi lại cùng mã yêu cầu.'); }
      }
    } finally { setBusy(false); }
  }

  const today = todayIn(shownPool?.timezone ?? 'UTC');
  const scrollToToday = (behavior: ScrollBehavior = 'smooth') => {
    const wrap = gridRef.current; const header = wrap?.querySelector<HTMLElement>(`[data-day-header="${today}"]`);
    if (!wrap || !header) return false;
    // Table cells are not offset parents, so measure against the scroll container; keep the sticky person column clear.
    const left = header.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft - 200;
    wrap.scrollTo?.({ left: Math.max(0, left), behavior });
    return true;
  };
  useEffect(() => {
    const key = `${shownPool?.id ?? ''}|${month}`;
    if (!shownTimeline || scrolledMonth.current === key || !dates.includes(today)) return;
    if (scrollToToday('auto')) scrolledMonth.current = key;
  });
  // Saved-to-plan notices are confirmations, not state: let them go away instead of pinning above the grid.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 10000);
    return () => window.clearTimeout(timer);
  }, [message]);
  // Count plans still only stored here so the planner knows before opening the batch dialog.
  const unsentPlans = useMemo(() => new Set((shownTimeline?.items ?? [])
    .filter(item => item.state === 'reserved' && item.plan_id && (item.plan_sync_state ?? item.sync_state ?? 'local') === 'local')
    .map(item => item.plan_id)).size, [shownTimeline]);
  const batchKey = `${shownPool?.id ?? ''}|${discipline}|${month}`;
  const bulkAllowed = grantCanWrite && shownPool?.capability === 'write' && !!shownTimeline;
  // Key on ids, not the pool object: the object is replaced on every session recheck and would refetch each time.
  const batchPoolId = shownPool?.id; const batchConnectionId = shownPool?.connection_id;
  useEffect(() => {
    if (!bulkAllowed || !batchPoolId || !batchConnectionId || !month) return;
    let live = true; const controller = new AbortController();
    Promise.resolve(getLatestPlanUploadBatch(batchPoolId, { connection_id: batchConnectionId, discipline, month }, controller.signal))
      .then(batch => { if (live) setLatestBatch(batch ? { key: batchKey, state: batch.state, done: batch.counts.confirmed, total: batch.counts.total } : null); })
      .catch(() => { if (live) setLatestBatch(null); });
    return () => { live = false; controller.abort(); };
  }, [bulkAllowed, batchPoolId, batchConnectionId, discipline, month, batchKey, bulkUploadOpen]);
  const batchInProgress = latestBatch?.key === batchKey && ['previewing', 'ready', 'running'].includes(latestBatch.state) ? latestBatch : null;
  const bulkBlockedReason = !shownPool || !month ? 'Đang tải dữ liệu tháng'
    : busy || pending ? 'Đang lưu phân công, chờ hoàn tất rồi gửi'
    : uploading || uploadUnknownRequest ? 'Đang chờ kết quả gửi Maximo'
    : bulkUploadLocked ? 'Đang gửi hàng loạt' : planMove ? 'Đang chuyển task, hoàn tất trước khi gửi' : '';
  // WO header (PIC, schedule) from the timeline payload, falling back to the loaded backlog page.
  const businessZone = shownPool?.timezone ?? 'UTC';
  const scheduleByWo = useMemo(() => {
    const map = new Map<string, ScheduleInfo>();
    for (const order of workOrders) map.set(`${order.siteid}|${order.workorderid}`, { schedstart: order.schedstart, schedfinish: order.schedfinish, pic: order.assignedtechname });
    for (const order of shownTimeline?.work_orders ?? []) {
      if (order.schedstart === undefined && order.schedfinish === undefined && order.assignedtechname === undefined) continue;
      map.set(`${order.site_id}|${order.workorder_id}`, { schedstart: order.schedstart ?? null, schedfinish: order.schedfinish ?? null, pic: order.assignedtechname ?? null });
    }
    return map;
  }, [workOrders, shownTimeline]);
  const assignedByWo = useMemo(() => {
    const people = new Map((shownTimeline?.rows ?? []).map(row => [row.person_id, row]));
    const map = new Map<string, AssignedPerson[]>();
    for (const item of shownTimeline?.items ?? []) {
      const person = people.get(item.person_id);
      if (item.state !== 'reserved' || !person) continue;
      const key = `${item.site_id}|${item.workorder_id}`;
      map.set(key, [...(map.get(key) ?? []), { date: item.date, laborcode: person.laborcode, name: person.name }]);
    }
    return map;
  }, [shownTimeline]);
  const nameByCode = useMemo(() => Object.fromEntries((shownTimeline?.rows ?? []).map(row => [row.laborcode, row.name])) as Record<string, string>, [shownTimeline]);
  const warningsByWo = useMemo(() => {
    const map = new Map<string, WoWarnings>();
    for (const [key, assigned] of assignedByWo) map.set(key, woWarnings(scheduleByWo.get(key), assigned, businessZone));
    return map;
  }, [assignedByWo, scheduleByWo, businessZone]);
  const cardWarning = (item: Assignment) => {
    const warn = warningsByWo.get(`${item.site_id}|${item.workorder_id}`);
    if (!warn) return undefined;
    if (warn.outsideDates.includes(item.date)) return 'ngày này nằm ngoài lịch WO';
    return warn.picNotAssigned ? 'PIC của WO chưa nằm trong người được giao' : undefined;
  };
  const monthLocked = busy || !!pending || uploading || !!uploadUnknownRequest || bulkUploadLocked || !!planMove;
  if (error && !shownTimeline && !(pending && unknown)) return <section className={styles.page}><h1>Resource timeline</h1><p role="alert">{error}</p><button onClick={refreshTimeline}>Kiểm tra lại quyền và tải</button></section>;
  return <section className={styles.page}>
    <div className={styles.heading}><h1 className={styles.srOnly}>Resource timeline</h1>
      <div className={styles.roleDonutPanel} aria-label="Tổng giờ phân công theo chức danh trong tháng">{donutSummary.map(group=><RoleDonut key={group.role} role={group.role} people={group.members.length} load={group.load} capacity={group.capacity} verified={group.verified}/>)}
        {!!otherRoleGroups.length&&<p className={styles.otherRoleSummary}>Chức danh khác trong timeline: {otherRoleGroups.map(group=>`${roleTitle(group.role)} · ${group.members.length} người · ${group.verified?`Tải ${displayHours(group.load)} / ${displayHours(group.capacity)} giờ`:'tải chưa xác minh'}`).join(' · ')}</p>}
      </div>
      <div className={styles.headingActions}><div className={styles.monthPicker}><button type="button" aria-label="Tháng trước" disabled={!month || monthLocked} onClick={() => setMonth(subMonth(month))}>‹</button><MonthInput label="Tháng timeline" value={month} onChange={setMonth} disabled={monthLocked} /><button type="button" aria-label="Tháng sau" disabled={!month || monthLocked} onClick={() => setMonth(addMonth(month))}>›</button></div><button type="button" className={styles.refreshButton} disabled={busy || !!pending || uploading || !!uploadUnknownRequest || bulkUploadLocked || !!planMove} onClick={refreshTimeline}>Làm mới timeline</button>{bulkAllowed&&<button type="button" className={styles.bulkSendButton} disabled={!!bulkBlockedReason} title={bulkBlockedReason||(batchInProgress?'Có đợt gửi chưa hoàn tất; mở để tiếp tục':unsentPlans?`${unsentPlans} kế hoạch mới chỉ lưu trong ứng dụng`:'Mở để xem hoặc tạo đợt gửi cho tháng này')} onClick={()=>setBulkUploadOpen(true)}>{batchInProgress?`Tiếp tục gửi kế hoạch (${batchInProgress.done}/${batchInProgress.total})`:'Gửi kế hoạch tháng lên Maximo'}{!batchInProgress&&unsentPlans>0&&<span className={styles.unsentBadge}>{unsentPlans} chưa gửi</span>}</button>}</div>
    </div>
    {message && <div className={styles.toast} role="status"><span>{message}</span><button type="button" aria-label="Đóng thông báo" onClick={() => setMessage('')}>×</button></div>}{error && <p role="alert" className={styles.error}>{error}</p>}
    {bulkUploadOpen&&shownPool&&<PlanUploadBatch key={`${shownPool.id}:${shownPool.connection_id}:${discipline}:${month}`} poolId={shownPool.id} connectionId={shownPool.connection_id} discipline={discipline} month={month} timezone={shownPool.timezone} environment={shownPool.environment==='production'?'production':'test'} connectionLabel={`${shownPool.connection_label} · ${shownPool.environment==='test'?'Test':'Production'}`} writable={canWrite} verify={async()=>{await verifyMutationContext({principal,connectionId:shownPool.connection_id,discipline,poolId:shownPool.id,month});}} onLock={setBulkUploadLocked} onClose={()=>setBulkUploadOpen(false)} onConfirmed={result=>{if(result.items?.length)return applyConfirmedMutation(result.items,[],result.affected_days,result.planning_summary,result.assignment_revision,result.allocation_updates,result.previous_assignment_revision,result.work_order);}} onReconcile={entry=>{if('redacted'in entry)return;const authoritative=entry.receipt?.items?.filter(item=>item.plan_id===entry.plan_id)??[];const chosen=authoritative.find(item=>item.date.startsWith(month))??shownTimeline?.items.find(item=>item.plan_id===entry.plan_id&&item.date.startsWith(month));if(authoritative.length)setPlanRecovery({key:planRecoveryKey,items:authoritative});setBulkUploadOpen(false);if(chosen)edit(chosen);else setError('Không tìm thấy phân đoạn trong tháng để mở đối soát. Hãy làm mới timeline.');}} />}
    {pending && unknown && <div className={styles.unknown} role="alert"><p>{pending.kind==='delete'?'Xóa phân công':pending.kind==='update'?'Sửa phân công':'Lưu phân công'} · Yêu cầu {pending.requestId} chưa có kết quả xác nhận.</p><button disabled={busy} onClick={() => void execute(pending)}>Đối soát / gửi lại cùng mã yêu cầu</button></div>}
    {busy && <p role="status">Đang lưu. Không rời thao tác cho đến khi có kết quả…</p>}
    {!shownTimeline ? <p>Đang tải roster, capacity và WO trong tháng…</p> : <>
      {revisionNotice&&<p className={styles.revisionNotice} role="status">Phân công đã thay đổi kể từ lần tải này. <button type="button" disabled={busy||!!pending||uploading||!!uploadUnknownRequest} onClick={refreshTimeline}>Làm mới dữ liệu</button></p>}
      <div className={styles.workspace} ref={workspaceRef} style={{gridTemplateColumns:`minmax(220px, ${backlogWidth}px) 10px minmax(0,1fr)`}}>
        <aside className={styles.backlog} aria-label="WO backlog">
          <div className={styles.backlogFilters} role="group" aria-label="Lọc danh sách Work Order"><button type="button" aria-pressed={backlogView==='backlog'} onClick={()=>setBacklogView('backlog')}>Backlog</button><button type="button" aria-pressed={backlogView==='completed'} onClick={()=>setBacklogView('completed')}>Completed</button><button type="button" aria-pressed={backlogView==='all'} onClick={()=>setBacklogView('all')}>Tất cả</button></div>
          <label className={styles.search}>Tìm WO, site<input value={search} onChange={event => setSearch(event.target.value)} placeholder="WO, site hoặc mô tả" /></label><p>Completed: đã phân bổ đủ.</p>{workOrderPageNotice&&<p role="status">{workOrderPageNotice}</p>}{workOrderPageLoading&&<p role="status">Đang tải trang WO…</p>}{workOrderPageError&&<p role="alert">{workOrderPageError}<button onClick={()=>setPageRefresh(value=>value+1)}>Thử lại</button></p>}<div className={styles.woList} ref={backlogListRef} aria-label="Danh sách WO hiện tại">{backlog.length ? backlogPageOrders.map(order => {
          const summary=effectiveAllocationSummary(order,summaryNow);
          const key = `${order.siteid}|${order.workorderid}`;
          const counts=order.allocation_summary;
          const status=summaryLoadState[key]?.scope===backlogSummaryScope?summaryLoadState[key]:undefined;
          const warn=warningsByWo.get(key);const warnTexts=[...(warn?.outsideDates.length?[`${warn.outsideDates.length} ngày phân công ngoài lịch WO`]:[]),...(warn?.picNotAssigned?['PIC chưa nằm trong người được giao']:[])];
          const proposedPic=order.assignedtechname?null:suggestedPic(assignedByWo.get(key)??[]);
          const scheduleText=scheduleRange(order.schedstart,order.schedfinish,shownPool?.timezone??'UTC');
          const taskStatus=status?.state==='loading'?'Đang tải số task và giờ…':`Còn ${counts?.remaining_tasks??'—'} task · còn ${counts?.remaining_minutes == null ? '—' : displayHours(counts.remaining_minutes)} giờ`;
          const summaryHint=summary.state==='unverified'?(status?.state==='error'?status.message:counts?.verified_at?'Số liệu lần tải trước đã cũ; đang kiểm tra lại.':'Đang kiểm tra task và giờ phân bổ khi WO xuất hiện trong danh sách.') : undefined;
          return <div key={key} className={styles.woCardGroup}><button ref={backlogCardRefFor(key)} className={styles.woCard} data-priority={order.wopriority ?? 'unknown'} data-allocation-state={summary.state} aria-label={`${order.wonum} · ${order.description || order.status} · ${taskStatus} · ${order.assignedtechname?`PIC ${picLabel(order.assignedtechname,nameByCode)}`:'Chưa có PIC'} · ${scheduleText?`Lịch ${scheduleText}`:'Chưa có lịch'}${warnTexts.length?`. Cảnh báo: ${warnTexts.join('; ')}`:''}`} aria-pressed={selectedWoKey === key} draggable={false} onPointerDown={event => beginDrag(event,key,order.wonum)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onClick={event=>{clickWorkOrder(event,order);if(status?.state==='error')backlogSummaryScheduler.current?.(key,true);}}><div className={styles.woHeading}><strong>{order.wonum}</strong><span className={styles.priorityBadge}>Ưu tiên {order.wopriority ?? '—'}</span></div><span>{discipline} · {order.worktype} · {order.status}</span><small>{order.description}</small><small>Ước tính WO: {order.estdur === null ? '—' : `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 2}).format(Number(order.estdur))} giờ`}</small><small className={styles.woMeta} data-no-pic={!order.assignedtechname||undefined} title={scheduleText?`Lịch WO ${order.schedstart} → ${order.schedfinish}`:undefined}>{order.assignedtechname?`PIC ${picLabel(order.assignedtechname,nameByCode)}`:'Chưa có PIC'} · {scheduleText??'Chưa có lịch'}</small>{warnTexts.length>0&&<small className={styles.woWarn}><StatusIcon kind="warning" /> {warnTexts.join(' · ')}</small>}<small className={styles.allocationSummary} title={summaryHint}>{taskStatus}</small></button>{canWrite&&onSuggestPic&&shownPool&&proposedPic&&<button type="button" className={styles.suggestPic} title="Mở editor ở trang Work orders với PIC điền sẵn; chưa lưu, không ghi Maximo" onClick={()=>onSuggestPic({connection_id:shownPool.connection_id,discipline,site_id:order.siteid,workorder_id:order.workorderid,pic:proposedPic})}>Đặt {picLabel(proposedPic,nameByCode)} làm PIC (tạo nháp)</button>}{status?.state==='error'&&<button type="button" className={styles.retrySummary} title={status.message} onClick={()=>backlogSummaryScheduler.current?.(key,true)}>Thử tải lại task</button>}</div>;
        }) : <span>{shownWorkOrderPage?.has_more?"Chưa có WO phù hợp trong lượt này. Chọn Sau để tìm tiếp.":"Không có WO trong kết quả lọc."}</span>}</div><div className={styles.backlogPagination}><button type="button" aria-label="Trang trước danh sách WO" disabled={workOrderPageLoading||visibleBacklogPage===0} onClick={()=>changeBacklogPage(visibleBacklogPage-1)}>Trước</button><span>Trang {visibleBacklogPage+1} · {backlog.length} WO{shownWorkOrderPage?.total_count!==null&&shownWorkOrderPage?.total_count!==undefined?` / ${shownWorkOrderPage.total_count}`:''}</span><button type="button" aria-label="Trang sau danh sách WO" disabled={workOrderPageLoading||!shownWorkOrderPage?.has_more} onClick={()=>changeBacklogPage(visibleBacklogPage+1)}>Sau</button></div></aside>
        <div className={styles.splitter} role="separator" aria-label="Điều chỉnh độ rộng Backlog" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={maxBacklogWidth()} aria-valuenow={backlogWidth} tabIndex={0} onKeyDown={adjustSplitter} onPointerDown={beginSplitterDrag} onPointerMove={moveSplitterDrag} onPointerUp={endSplitterDrag} onPointerCancel={endSplitterDrag} />
      <section className={styles.timelineSection} aria-label="Resource timeline theo ngày"><div className={styles.panelTitle}><h2>{month ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('vi-VN', {month:'long',year:'numeric',timeZone:'UTC'}) : ''}</h2><span>Ngày làm = 10,5 giờ · rota thật</span>
        <input type="search" className={styles.peopleSearch} aria-label="Tìm nhân sự" placeholder="Tìm nhân sự" value={peopleSearch} onChange={event=>setPeopleSearch(event.target.value)} />
        <button type="button" className={styles.todayButton} disabled={!dates.includes(today)} onClick={() => scrollToToday()}>Hôm nay</button>
        <details className={styles.legendPopover}><summary aria-label="Chú giải">?</summary><div className={styles.legend}><span>Có capacity theo rota</span><span>Ngày nghỉ / trống: 0 giờ</span><span>Tải / capacity từng người</span><span><StatusIcon kind="synced" /> Đã đồng bộ Maximo</span><span><StatusIcon kind="pending" /> Chờ đối soát: chưa chắc Maximo đã nhận</span><span><StatusIcon kind="draft" /> Chưa gửi Maximo: mới lưu trong ứng dụng</span><span><StatusIcon kind="multiday" /> Kế hoạch nhiều ngày</span><span><StatusIcon kind="warning" /> Cảnh báo (không chặn): ngoài lịch WO hoặc PIC chưa được giao</span></div></details></div>
      <div className={styles.gridWrap} ref={gridRef}><table className={styles.grid}><thead><tr><th scope="col">Nhân sự / capacity</th>{dates.map(date => { const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); return <th scope="col" key={date} data-day-header={date} data-today={date===today||undefined}><span>{date.slice(-2)}</span><small>{dayNames[weekday]}</small></th>; })}</tr></thead>
        <tbody><tr className={styles.craftRow}><th className={styles.person}>{discipline}<small>{roster.length} người</small></th>{dates.map(date => <td key={date}>{displayHours(totalMinutes(roster, 'allocated_minutes', date))} / {displayHours(totalMinutes(roster, 'capacity_minutes', date))}h</td>)}</tr>{roleGroups.map(role => { const members = roster.filter(person => timelineRoleOf(person, shownTimeline) === role); return <Fragment key={role}><tr className={styles.roleRow}><th className={styles.person}><button onClick={() => setCollapsed(value => ({...value, [role]: !value[role]}))} aria-expanded={!collapsed[role]}>{collapsed[role] ? '＋' : '−'} {roleTitle(role)} · {members.length} người</button><small>{displayHours(totalMinutes(members, 'allocated_minutes'))} / {displayHours(totalMinutes(members, 'capacity_minutes'))}h</small></th>{dates.map(date => <td key={date}>{displayHours(totalMinutes(members, 'allocated_minutes', date))} / {displayHours(totalMinutes(members, 'capacity_minutes', date))}h</td>)}</tr>{(!collapsed[role] || !!peopleSearch.trim()) && members.filter(person => !peopleSearch.trim() || `${person.name} ${person.laborcode}`.toLowerCase().includes(peopleSearch.trim().toLowerCase())).map(person => <tr key={person.person_id}><th scope="row" className={styles.person}><strong>{person.name}</strong><small>{person.laborcode} · {[...new Set(Object.values(person.dayMetadata).flat())].join(' / ')}</small></th>{dates.map(date => {
          const day = capacityFor(person, date); const items = shownTimeline.items.filter(item => item.state === 'reserved' && item.person_id === person.person_id && item.date === date);
          return <td key={date} className={!day ? styles.off : day.capacity_minutes > 0 ? styles.working : day.code === '' ? styles.blank : styles.off} data-person-id={person.person_id} data-date={date}>
            <div className={styles.capacity} title={person.dayMetadata[date]?.join(' / ')}><b>{day ? `${displayHours(day.allocated_minutes)} / ${displayHours(day.capacity_minutes)}h` : '—'}</b><small data-alert={day?.load_complete===false||(!!day&&day.remaining_minutes<0)||undefined}>{day?.load_complete===false?'Tải chưa xác minh':`${day?.code || (day ? 'Trống' : 'Không có rota')} · ${day&&day.remaining_minutes<0?'vượt '+displayHours(-day.remaining_minutes):'còn '+displayHours(day?.remaining_minutes??0)}h`}</small></div>
            {items.map(item => {const label=workOrderLabel(item,shownTimeline); const taskLabel=item.task_id!==null && item.task_id!==undefined ? `${item.task_description||`Task ${item.task_id}`} · ${label}` : label; return <AssignmentCard key={item.id} item={item} warning={cardWarning(item)} taskLabel={taskLabel} wonum={shownTimeline.work_orders.find(order => order.site_id === item.site_id && order.workorder_id === item.workorder_id)?.wonum} personName={person.name} date={date} hours={displayHours(item.minutes)} onPointerDown={event=>{if(canEditItem(item))beginDrag(event,item.id,taskLabel);}} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onClick={event=>clickAssignment(event,item)} />;})}
            <button className={styles.addCell} aria-label={`Thêm phân công cho ${person.name} ngày ${date}`} disabled={!canWrite || !day || day.capacity_minutes < 1} onClick={() => beginCreate(person, date)}>+ WO</button>
          </td>;
        })}</tr>)}</Fragment>; })}</tbody></table></div></section></div>
    </>}
    {dragPreview && shownTimeline && <div className={styles.dragGhost} style={{left:dragPreview.x+12,top:dragPreview.y+12}}>{dragPreview.label}</div>}
    {planMove&&shownTimeline&&shownPool&&<PlanMoveDialog item={planMove.item} knownItems={planMove.knownItems} people={shownTimeline.rows} visibleMonth={month} workOrderLabel={shownTimeline.work_orders.find(order=>order.connection_id===planMove.item.connection_id&&order.site_id===planMove.item.site_id&&order.workorder_id===planMove.item.workorder_id)?.wonum} connectionLabel={`${shownPool.connection_label} · ${shownPool.environment==='test'?'Test':shownPool.environment}`} targetPersonId={planMove.targetPersonId} targetDate={planMove.targetDate} requestId={planMove.request?.request_id} loading={planMove.loading} busy={busy} error={planMove.error} preview={planMove.preview} canReallocate={planMove.canReallocate} unknown={planMove.unknown} reconciling={planMove.reconciling} onPersonChange={value=>setPlanMove(current=>current?{...current,targetPersonId:value,preview:null,loading:true,error:'',canReallocate:false}:current)} onDateChange={value=>setPlanMove(current=>current?{...current,targetDate:value,preview:null,loading:true,error:'',canReallocate:false}:current)} onReallocate={()=>setPlanMove(current=>current?{...current,mode:'reallocate',preview:null,loading:true,error:'',canReallocate:false}:current)} onConfirm={()=>void submitPlanMove()} onReconcile={()=>void reconcilePlanMove()} onClose={()=>setPlanMove(null)} />}
    {proposal && shownTimeline && <div className={`${styles.overlay} ${styles.drawerOverlay}`}><section ref={dialogRef} className={`${styles.dialog} ${styles.drawer}`} role="dialog" aria-modal="true" aria-labelledby="proposal-title" onKeyDown={event=>{if(event.key==='Escape'&&!busy&&!pending&&!uploading&&!uploadUnknownRequest&&!planUploadCloseLocked){event.preventDefault();event.stopPropagation();setProposal(null);}}}>
      <h2 id="proposal-title">{confirmedReadOnly?'Kế hoạch đã đồng bộ Maximo':proposal.item ? proposal.item.sync_state==='synced'?'Phân công trên Maximo':canEditItem(proposal.item) ? proposal.item.person_id === proposal.cell.person.person_id && proposal.item.date === proposal.cell.date ? 'Sửa phân công' : 'Chuyển phân công' : 'WO không còn đủ điều kiện chỉnh sửa' : 'Phân công WO'}</h2>
      {confirmedReadOnly&&confirmedPlanItem?<section className={styles.syncedDetails} aria-label="Chi tiết kế hoạch đã đồng bộ"><p><strong>{workOrderLabel(confirmedPlanItem,shownTimeline)}</strong> · Task {confirmedPlanItem.task_id}: {confirmedTask?.description||confirmedPlanItem.task_description||'—'}</p><dl><div><dt>Nhân lực</dt><dd>{roster.find(person=>person.person_id===confirmedPlanItem.person_id)?.name||'—'} · {confirmedLaborcode}</dd></div><div><dt>Site / WO status</dt><dd>{confirmedPlanItem.site_id} · {shownTimeline?.work_orders.find(order=>order.site_id===confirmedPlanItem.site_id&&order.workorder_id===confirmedPlanItem.workorder_id)?.status||'—'}</dd></div><div><dt>Kết nối</dt><dd>{shownPool?`${shownPool.connection_label} · ${shownPool.environment==='test'?'Test':shownPool.environment}`:'—'}</dd></div><div><dt>Trạng thái</dt><dd>Đã đồng bộ Maximo</dd></div></dl>{taskLoading&&<p role="status">Đang tải assignments Maximo mới nhất…</p>}{taskError&&<p role="status">Không tải được assignments Maximo mới nhất; giờ bắt đầu hiển thị —.</p>}<p>{confirmedCoverageComplete?`Đủ ${confirmedPlanItems.length} phân đoạn cho tổng ${displayHours(confirmedPlanItem.plan_total_minutes??0)} giờ.`:`Đang hiển thị ${confirmedPlanItems.length} phân đoạn có ${displayHours(confirmedCoverageMinutes)} / ${displayHours(confirmedPlanItem.plan_total_minutes??0)} giờ; biên nhận đầy đủ chưa khả dụng nên danh sách có thể thiếu ngày.`}</p><div className={styles.syncedTableWrap}><table className={styles.syncedTable} aria-label="Các ngày Maximo đã đồng bộ"><thead><tr><th>Ngày kế hoạch</th><th>Giờ</th><th>Bắt đầu Maximo</th><th>Kết thúc dự kiến (tính theo giờ)</th><th>Assignment Maximo</th><th>Trạng thái</th></tr></thead><tbody>{confirmedPlanItems.map(segment=>{const remote=segment.remote_assignment_id?confirmedTask?.assignments.find(candidate=>candidate.assignment_id===segment.remote_assignment_id):undefined;const scheduledStart=remote?.scheduledate??null;const segmentHours=remote?.labor_hours??segment.minutes/60;return <tr key={segment.id}><td>{displayDate(segment.date)}</td><td>{displayHours(Math.round(segmentHours*60))} giờ</td><td>{formatMaximoDateTime(scheduledStart,shownPool?.timezone??'UTC')}</td><td>{expectedFinish(scheduledStart,segmentHours,shownPool?.timezone??'UTC')}</td><td>{segment.remote_assignment_id||'—'}</td><td>{remote?.status||'—'}</td></tr>;})}</tbody></table></div></section>:<p><strong>{proposal.item?.task_id ? `${proposal.item.task_description||`Task ${proposal.item.task_id}`} · ` : ''}{proposal.item ? workOrderLabel(proposal.item, shownTimeline) : proposal.workOrder ? workOrderLabel(proposal.workOrder, shownTimeline) : 'WO cần phân công'}</strong>{proposal.item && (proposal.item.person_id !== proposal.cell.person.person_id || proposal.item.date !== proposal.cell.date) && <> · từ {roster.find(person => person.person_id === proposal.item?.person_id)?.name} / {displayDate(proposal.item.date)}</>} → {proposal.cell.person.name} / {displayDate(displayedProposalDate??'')} · {displayHours(!proposal.item&&taskData?.tasks.length?selectedTaskTotal:proposal.minutes)} giờ</p>}
      {!proposal.item && <label>Work Order<select aria-label="Work Order" disabled={busy || !!pending || uploading || !!uploadUnknownRequest} value={proposal.workOrder ? `${proposal.workOrder.site_id}|${proposal.workOrder.workorder_id}` : ''} onChange={event => { const order = dialogWorkOrders.find(item => `${item.siteid}|${item.workorderid}` === event.target.value); if (order) {resetProposalDetails(true);setTaskPlanStart(proposal.cell.date);setProposal({ ...proposal, workOrder: { connection_id: shownPool!.connection_id, site_id: order.siteid, workorder_id: order.workorderid, wonum: order.wonum, description: order.description ?? '', status: order.status, eligible: true } });} }}><option value="">Chọn WO…</option>{dialogWorkOrders.map(item => <option key={`${item.siteid}:${item.workorderid}`} value={`${item.siteid}|${item.workorderid}`}>{item.wonum} · {item.description || item.status}</option>)}</select></label>}
      {!confirmedReadOnly&&<div className={styles.personDateRow}><label>Nhân lực<select aria-label="Nhân lực phân công" value={proposal.cell.person.person_id} disabled={busy || !!pending || planUploadLocked || !!proposal.item?.plan_id || !!proposal.item && !canEditItem(proposal.item)} onChange={event => { const person = roster.find(row => row.person_id === event.target.value); if (person) {setProposal({...proposal, cell:{person, date:proposal.cell.date}});if(!taskPlanMode)setTaskPlanStart(proposal.cell.date);setTaskPlanSegments({});} }}>{roster.map(person => <option key={person.person_id} value={person.person_id}>{person.name}</option>)}</select></label>
      {!proposal.item&&taskPlanMode?<div className={styles.field}><span>Ngày bắt đầu</span><DateTimeInput dateOnly label="Ngày bắt đầu" value={taskPlanStart} min={proposal.cell.date} max={addCalendarDays(proposal.cell.date,365)} disabled={busy||!!pending||taskPlanCapacityLoading} onChange={value=>{setTaskPlanStart(value);setTaskPlanSegments({});}}/></div>:<label>Ngày rota<select aria-label="Ngày phân công" value={proposal.cell.date} disabled={busy || !!pending || !!proposal.item && !canEditItem(proposal.item)} onChange={event => {setProposal({...proposal, cell:{...proposal.cell, date:event.target.value}});setTaskPlanStart(event.target.value);setTaskPlanSegments({});}}>{dates.filter(date => date === proposal.cell.date || (capacityFor(proposal.cell.person,date)?.capacity_minutes ?? 0) > 0).map(date => <option key={date} value={date}>{date} · còn {displayHours(capacityFor(proposal.cell.person,date)?.remaining_minutes ?? 0)} giờ</option>)}</select></label>}</div>}
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
      {proposal.item&&!confirmedReadOnly&&<label>Giờ phân công <input aria-label="Giờ phân công" type="number" min="0.01" max={Math.min(630,planEditLimit)/60} step="any" value={proposal.hours} disabled={busy || !!pending || planUploadLocked || !canEditItem(proposal.item)} onChange={event => setProposal({ ...proposal, hours: event.target.value, minutes: parseHours(event.target.value) })} /></label>}
      {!confirmedReadOnly&&<p>Rota: {displayHours(displayedProposalDay?.capacity_minutes ?? 0)} giờ · đã dùng {displayHours(displayedProposalDay?.allocated_minutes ?? 0)} giờ · tải Maximo {displayHours(displayedProposalDay?.external_minutes??0)}h · tối đa 10,5 giờ.{displayedProposalDay?.load_complete!==true?' Tải Maximo chưa đầy đủ; lưu bị khóa.':''}</p>}
      {!proposal.item&&taskData?.tasks.length===0&&<p>Upload Maximo bị khóa đến khi xác minh object, quyền, cập nhật có điều kiện và đối chiếu kết quả.</p>}
      {!confirmedReadOnly&&proposal.item?.task_id!==null&&proposal.item?.task_id!==undefined&&<><p>Trạng thái Maximo: {({local:'Chưa gửi',synced:'Đã xác nhận',unknown:'Chờ đối soát'} as Record<string,string>)[proposal.item.sync_state??'local']??'Chờ kiểm tra'}.</p>{proposalDirty&&!proposal.item.plan_id&&<p>Lưu thay đổi phân công trước khi gửi lên Maximo.</p>}{taskData?.upload_enabled&&!proposal.item.plan_id&&<><p>Maximo sẽ cập nhật lịch task theo phân công. Phân công đã gửi cần xử lý sửa/xóa trên Maximo.</p><div className={styles.field}><span>Ngày giờ bắt đầu ({shownPool?.timezone})</span><DateTimeInput label="Ngày giờ bắt đầu Maximo" value={uploadWall} defaultTime="06:30" disabled={uploading||busy||!!pending||!!uploadUnknownRequest||uploadResult?.state==='unknown'} onChange={setUploadWall}/></div><button type="button" disabled={proposalDirty||(proposal.item.sync_state??'local')!=='local'||!uploadWall||uploading||!canWrite||!!uploadUnknownRequest||uploadResult?.state==='confirmed'||uploadResult?.state==='unknown'} onClick={()=>void submitUpload(proposal.item!)}>{uploading?'Đang đối soát…':'Upload assignment lên Maximo'}</button>{uploadResult&&<p role="status">Maximo: {uploadResult.state} · {uploadResult.detail??uploadResult.attempt_id}</p>}{(uploadResult?.state==='unknown'||uploadUnknownRequest)&&<><p>Giữ mã yêu cầu {uploadUnknownRequest} để đối soát. Không gửi lại khi chưa rõ kết quả.</p><button type="button" disabled={uploading} onClick={()=>void reconcileUpload()}>Đối soát upload (không gửi lại)</button></>}</>}{taskData?.upload_enabled===false&&<p>Upload Maximo đang khóa: backend chưa xác nhận write contract cho object này.</p>}</>}
      {proposal.item?.plan_id&&<>{!confirmedReadOnly&&<p>Kế hoạch theo ngày đang lưu nội bộ. Tổng ban đầu: {displayHours(proposal.item.plan_total_minutes??0)} giờ.</p>}{!confirmedReadOnly&&(proposal.item.plan_sync_state??proposal.item.sync_state??'local')==='local'&&<button type="button" disabled={busy||!!pending||planUploadLocked} onClick={()=>beginPlanMove(proposal.item!,proposal.cell.person,proposal.cell.date,true)}>Chuyển task</button>}{!confirmedReadOnly&&(proposal.item.plan_sync_state??proposal.item.sync_state??'local')==='local'&&(proposal.item.plan_total_minutes??proposal.item.minutes)>proposal.item.minutes&&proposalDirty&&<button type="button" disabled={busy||!!pending||planUploadLocked} onClick={()=>beginPlanMove(proposal.item!,proposal.cell.person,proposal.cell.date,true)}>Dời toàn task</button>}<PlanUpload connectionLabel={pool ? `${pool.connection_label} · ${pool.environment === 'test' ? 'Test' : pool.environment}` : undefined} items={confirmedReadOnly?confirmedPlanItems:[...new Map([...shownTimeline.items.filter(item=>item.plan_id===proposal.item!.plan_id&&item.state==='reserved'),...(planRecovery?.key===planRecoveryKey?planRecovery.items:[]).filter(item=>item.plan_id===proposal.item!.plan_id&&item.state==='reserved')].map(item=>[item.id,item])).values()]} supported={taskData?.daily_plan_upload_supported===true} writable={canWrite} timezone={shownPool?.timezone??'UTC'} taskLabel={taskData?.tasks.find(task=>task.task_workorder_id===proposal.item!.task_workorder_id&&task.task_id===proposal.item!.task_id)?.description??proposal.item.task_description??'Task'} personLabel={shownTimeline.rows.find(row=>row.person_id===proposal.item!.person_id)?.name??'Nhân lực đã phân công'} confirmedReadOnly={confirmedReadOnly} verify={async()=>{if(!pool)throw new Error('Không còn resource pool đang xác minh.');await verifyMutationContext({principal,connectionId:pool.connection_id,discipline,poolId:pool.id,month});}} onLock={setPlanUploadLocked} onCloseLock={setPlanUploadCloseLocked} onConfirmed={result=>{if(result.items?.length)setPlanRecovery({key:planRecoveryKey,items:result.items});setProposal(current=>{if(!current?.item||current.item.plan_id!==result.plan_id)return current;const mapped=result.mapping?.find(row=>row.allocation_id===current.item!.id);const latest=result.items?.find(item=>item.id===current.item!.id);const syncState=result.state==='confirmed'?'synced':result.state==='unknown'?'unknown':current.item.sync_state??'local';return {...current,item:latest??{...current.item,...(mapped?{remote_assignment_id:mapped.assignment_id}:{}),sync_state:syncState,plan_sync_state:syncState==='local'?'local':syncState as 'unknown'|'synced'} };});if(result.items?.length)return applyConfirmedMutation(result.items,[],result.affected_days,result.planning_summary,result.assignment_revision,result.allocation_updates,result.previous_assignment_revision,result.work_order);else{const planSegments=shownTimeline.items.filter(item=>item.plan_id===proposal.item!.plan_id&&item.state==='reserved');void applyConfirmedMutation([],planSegments);setError(`Trạng thái ${result.state} đã được xác nhận; mapping Maximo đã lưu. Đang làm mới capacity của các ngày hiển thị.`);}setMessage(result.state==='confirmed'?'Kế hoạch theo ngày đã được xác nhận trên Maximo.':`Maximo trả trạng thái ${result.state}; các segment được làm mới.`);}} /></>}
      {proposal.item&&!confirmedReadOnly&&<button className={styles.delete} disabled={!canWrite||!canEditItem(proposal.item)||planUploadLocked} onClick={() => void submit('delete')}>Xóa phân công</button>}
      <div className={styles.actions}>{pending&&unknown&&<button disabled={busy} onClick={()=>setProposal(null)}>Đóng hộp thoại để đối soát</button>}<button onClick={() => setProposal(null)} disabled={busy || uploading || !!pending || !!uploadUnknownRequest || !confirmedReadOnly&&planUploadCloseLocked}>{confirmedReadOnly?'Đóng':'Hủy'}</button>{!confirmedReadOnly&&<button disabled={!canWrite || planUploadLocked || (!!proposal.item && !canEditItem(proposal.item)) || (!proposal.item && (!proposal.workOrder||taskLoading||!!taskError||!taskData)) || (!proposal.item&&!taskPlanMode&&proposalDay?.load_complete!==true) || (proposal.item ? !Number.isInteger(proposal.minutes)||proposal.minutes<1||proposal.minutes>630||proposal.minutes>planEditLimit : taskPlanMode ? !planValid : taskData?.tasks.length ? !chosenTaskKeys.length||chosenTaskKeys.length>50||chosenTaskKeys.some(key=>Number(taskMinutes[key]??0)<1||!taskAssignments[key])||selectedTaskTotal>(proposalDay?.remaining_minutes??0) : !Number.isInteger(proposal.minutes)||proposal.minutes<1||proposal.minutes>630)} onClick={() => void submit(proposal.item ? 'update' : taskPlanMode ? 'task-plan-batch' : taskData?.tasks.length ? 'task-batch':'create')}>Xác nhận lưu</button>}</div>
    </section></div>}
  </section>;
}
