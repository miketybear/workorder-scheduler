// Owns the Backlog presentation; state and operations remain in ResourceTimeline.
import { type ResourcePool } from '../api/rotaImports';
import { effectiveAllocationSummary, type BacklogReadiness, type WorkOrder, type WorkOrderPage } from '../api/workOrders';
import { BacklogFilters } from './BacklogFilters';
import { StatusIcon } from './StatusIcons';
import { picLabel } from '../scheduling/presentation';
import { displayHours, missingForAssign, scheduleRange, type WoWarnings } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';
import type { Dispatch, SetStateAction, RefObject } from 'react';
type LoadedWorkOrderPage=WorkOrderPage&{requestContext:string};

type Props = {
  backlogView: "backlog" | "completed" | "all";
  setBacklogView: Dispatch<SetStateAction<"backlog" | "completed" | "all">>;
  backlogReadiness: BacklogReadiness;
  setBacklogReadiness: Dispatch<SetStateAction<BacklogReadiness>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  workOrderPageNotice: string;
  workOrderPageLoading: boolean;
  workOrderPageError: string;
  setPageRefresh: Dispatch<SetStateAction<number>>;
  backlogListRef: RefObject<HTMLDivElement | null>;
  backlog: WorkOrder[];
  backlogPageOrders: WorkOrder[];
  summaryNow: number;
  summaryLoadState: Record<string, { scope: string; state: "loading" | "error"; message?: string; }>;
  backlogSummaryScope: string;
  warningsByWo: Map<string, WoWarnings>;
  shownPool: ResourcePool | null;
  backlogCardRefFor: (key: string) => (node: HTMLButtonElement | null) => void;
  nameByCode: Record<string, string>;
  selectedWoKey: string;
  beginDrag: (event: React.PointerEvent<HTMLButtonElement>, payload: string, label: string) => void;
  moveDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  finishDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  cancelDrag: () => void;
  clickWorkOrder: (event: React.MouseEvent<HTMLButtonElement>, order: WorkOrder) => void;
  backlogSummaryScheduler: RefObject<((key: string, force?: boolean) => void) | null>;
  discipline: string;
  shownWorkOrderPage: LoadedWorkOrderPage | null;
  visibleBacklogPage: number;
  changeBacklogPage: (page: number) => void;
};

export function Backlog({ backlogView, setBacklogView, backlogReadiness, setBacklogReadiness, search, setSearch, workOrderPageNotice, workOrderPageLoading, workOrderPageError, setPageRefresh, backlogListRef, backlog, backlogPageOrders, summaryNow, summaryLoadState, backlogSummaryScope, warningsByWo, shownPool, backlogCardRefFor, nameByCode, selectedWoKey, beginDrag, moveDrag, finishDrag, cancelDrag, clickWorkOrder, backlogSummaryScheduler, discipline, shownWorkOrderPage, visibleBacklogPage, changeBacklogPage }: Props) {
  return <aside className={styles.backlog} aria-label="WO backlog">
          <BacklogFilters view={backlogView} onChange={setBacklogView} readiness={backlogReadiness} onReadinessChange={setBacklogReadiness} counts={shownWorkOrderPage?.counts} />
          <label className={styles.search}>Tìm WO, site<input value={search} onChange={event => setSearch(event.target.value)} placeholder="WO, site hoặc mô tả" /></label>{workOrderPageNotice&&<p role="status">{workOrderPageNotice}</p>}{workOrderPageLoading&&<p role="status">Đang tải trang WO…</p>}{workOrderPageError&&<p role="alert">{workOrderPageError}<button onClick={()=>setPageRefresh(value=>value+1)}>Thử lại</button></p>}<div className={styles.woList} ref={backlogListRef} aria-label="Danh sách WO hiện tại">{backlog.length ? backlogPageOrders.map(order => {
          const summary=effectiveAllocationSummary(order,summaryNow);
          const key = `${order.siteid}|${order.workorderid}`;
          const counts=order.allocation_summary;
          const status=summaryLoadState[key]?.scope===backlogSummaryScope?summaryLoadState[key]:undefined;
          const warn=warningsByWo.get(key);const warnTexts=[...(warn?.outsideDates.length?[`${warn.outsideDates.length} ngày phân công ngoài lịch WO`]:[]),...(warn?.picNotAssigned?['PIC chưa nằm trong người được giao']:[])];
          const blocked=missingForAssign({schedstart:order.schedstart,schedfinish:order.schedfinish,pic:order.assignedto});
          const scheduleText=scheduleRange(order.schedstart,order.schedfinish,shownPool?.timezone??'UTC');
          const taskStatus=status?.state==='loading'?'Đang tải số task và giờ…':`Còn ${counts?.remaining_tasks??'—'} task · còn ${counts?.remaining_minutes == null ? '—' : displayHours(counts.remaining_minutes)} giờ`;
          const summaryHint=summary.state==='unverified'?(status?.state==='error'?status.message:counts?.verified_at?'Số liệu lần tải trước đã cũ; đang kiểm tra lại.':'Đang kiểm tra task và giờ phân bổ khi WO xuất hiện trong danh sách.') : undefined;
          return <div key={key} className={styles.woCardGroup}><button ref={backlogCardRefFor(key)} className={styles.woCard} data-priority={order.wopriority ?? 'unknown'} data-allocation-state={summary.state} aria-label={`${order.wonum} · ${order.description || order.status} · ${taskStatus}${order.assignedto?` · PIC ${picLabel(order.assignedto,nameByCode)}`:''}${scheduleText?` · Lịch ${scheduleText}`:''}${blocked?`. ${blocked}, chưa thể phân công`:''}${warnTexts.length?`. Cảnh báo: ${warnTexts.join('; ')}`:''}`} data-blocked={blocked?'true':undefined} aria-pressed={selectedWoKey === key} draggable={false} onPointerDown={event => {if(!blocked)beginDrag(event,key,order.wonum);}} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onClick={event=>{clickWorkOrder(event,order);if(status?.state==='error')backlogSummaryScheduler.current?.(key,true);}}><div className={styles.woHeading}><strong>{order.wonum}</strong><span className={styles.priorityBadge}>Ưu tiên {order.wopriority ?? '—'}</span></div><span>{discipline} · {order.worktype} · {order.status}</span><small>{order.description}</small><small>Ước tính WO: {order.estdur === null ? '—' : `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 2}).format(Number(order.estdur))} giờ`}</small>{(order.assignedto||scheduleText)&&<small className={styles.woMeta} title={scheduleText?`Lịch WO ${order.schedstart} → ${order.schedfinish}`:undefined}>{[order.assignedto&&`PIC ${picLabel(order.assignedto,nameByCode)}`,scheduleText].filter(Boolean).join(' · ')}</small>}{blocked&&<small className={styles.woBlocked}>{blocked}, chưa thể phân công</small>}{warnTexts.length>0&&<small className={styles.woWarn}><StatusIcon kind="warning" /> {warnTexts.join(' · ')}</small>}<small className={styles.allocationSummary} title={summaryHint}>{taskStatus}</small></button>{status?.state==='error'&&<button type="button" className={styles.retrySummary} title={status.message} onClick={()=>backlogSummaryScheduler.current?.(key,true)}>Thử tải lại task</button>}</div>;
        }) : <span>{shownWorkOrderPage?.has_more?"Chưa có WO phù hợp trong lượt này. Chọn Sau để tìm tiếp.":"Không có WO trong kết quả lọc."}</span>}</div><div className={styles.backlogPagination}><button type="button" aria-label="Trang trước danh sách WO" disabled={workOrderPageLoading||visibleBacklogPage===0} onClick={()=>changeBacklogPage(visibleBacklogPage-1)}>Trước</button><span>Trang {visibleBacklogPage+1} · {backlog.length} WO{shownWorkOrderPage?.total_count!==null&&shownWorkOrderPage?.total_count!==undefined?` / ${shownWorkOrderPage.total_count}`:''}</span><button type="button" aria-label="Trang sau danh sách WO" disabled={workOrderPageLoading||!shownWorkOrderPage?.has_more} onClick={()=>changeBacklogPage(visibleBacklogPage+1)}>Sau</button></div></aside>;
}
