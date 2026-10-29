// Owns the Backlog presentation; state and operations remain in ResourceTimeline.
import { type ResourcePool } from '../api/rotaImports';
import { effectiveAllocationSummary, type WorkOrder, type WorkOrderPage } from '../api/workOrders';
import { BacklogFilters } from './BacklogFilters';
import { StatusIcon } from './StatusIcons';
import { picLabel } from '../scheduling/presentation';
import { PicSuggestion } from '../picSuggestion';
import { displayHours, scheduleRange, suggestedPic, type AssignedPerson, type WoWarnings } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';
import type { Dispatch, SetStateAction, RefObject } from 'react';
type LoadedWorkOrderPage=WorkOrderPage&{requestContext:string};

type Props = {
  backlogView: "backlog" | "completed" | "all";
  setBacklogView: Dispatch<SetStateAction<"backlog" | "completed" | "all">>;
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
  assignedByWo: Map<string, AssignedPerson[]>;
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
  canWrite: boolean;
  onSuggestPic: ((suggestion: Omit<PicSuggestion, "id">) => void) | undefined;
  shownWorkOrderPage: LoadedWorkOrderPage | null;
  visibleBacklogPage: number;
  changeBacklogPage: (page: number) => void;
};

export function Backlog({ backlogView, setBacklogView, search, setSearch, workOrderPageNotice, workOrderPageLoading, workOrderPageError, setPageRefresh, backlogListRef, backlog, backlogPageOrders, summaryNow, summaryLoadState, backlogSummaryScope, warningsByWo, assignedByWo, shownPool, backlogCardRefFor, nameByCode, selectedWoKey, beginDrag, moveDrag, finishDrag, cancelDrag, clickWorkOrder, backlogSummaryScheduler, discipline, canWrite, onSuggestPic, shownWorkOrderPage, visibleBacklogPage, changeBacklogPage }: Props) {
  return <aside className={styles.backlog} aria-label="WO backlog">
          <BacklogFilters view={backlogView} onChange={setBacklogView} />
          <label className={styles.search}>Tìm WO, site<input value={search} onChange={event => setSearch(event.target.value)} placeholder="WO, site hoặc mô tả" /></label><p>Completed: đã phân bổ đủ.</p>{workOrderPageNotice&&<p role="status">{workOrderPageNotice}</p>}{workOrderPageLoading&&<p role="status">Đang tải trang WO…</p>}{workOrderPageError&&<p role="alert">{workOrderPageError}<button onClick={()=>setPageRefresh(value=>value+1)}>Thử lại</button></p>}<div className={styles.woList} ref={backlogListRef} aria-label="Danh sách WO hiện tại">{backlog.length ? backlogPageOrders.map(order => {
          const summary=effectiveAllocationSummary(order,summaryNow);
          const key = `${order.siteid}|${order.workorderid}`;
          const counts=order.allocation_summary;
          const status=summaryLoadState[key]?.scope===backlogSummaryScope?summaryLoadState[key]:undefined;
          const warn=warningsByWo.get(key);const warnTexts=[...(warn?.outsideDates.length?[`${warn.outsideDates.length} ngày phân công ngoài lịch WO`]:[]),...(warn?.picNotAssigned?['PIC chưa nằm trong người được giao']:[])];
          const proposedPic=order.assignedto?null:suggestedPic(assignedByWo.get(key)??[]);
          const scheduleText=scheduleRange(order.schedstart,order.schedfinish,shownPool?.timezone??'UTC');
          const taskStatus=status?.state==='loading'?'Đang tải số task và giờ…':`Còn ${counts?.remaining_tasks??'—'} task · còn ${counts?.remaining_minutes == null ? '—' : displayHours(counts.remaining_minutes)} giờ`;
          const summaryHint=summary.state==='unverified'?(status?.state==='error'?status.message:counts?.verified_at?'Số liệu lần tải trước đã cũ; đang kiểm tra lại.':'Đang kiểm tra task và giờ phân bổ khi WO xuất hiện trong danh sách.') : undefined;
          return <div key={key} className={styles.woCardGroup}><button ref={backlogCardRefFor(key)} className={styles.woCard} data-priority={order.wopriority ?? 'unknown'} data-allocation-state={summary.state} aria-label={`${order.wonum} · ${order.description || order.status} · ${taskStatus} · ${order.assignedto?`PIC ${picLabel(order.assignedto,nameByCode)}`:'Chưa có PIC'} · ${scheduleText?`Lịch ${scheduleText}`:'Chưa có lịch'}${warnTexts.length?`. Cảnh báo: ${warnTexts.join('; ')}`:''}`} aria-pressed={selectedWoKey === key} draggable={false} onPointerDown={event => beginDrag(event,key,order.wonum)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onClick={event=>{clickWorkOrder(event,order);if(status?.state==='error')backlogSummaryScheduler.current?.(key,true);}}><div className={styles.woHeading}><strong>{order.wonum}</strong><span className={styles.priorityBadge}>Ưu tiên {order.wopriority ?? '—'}</span></div><span>{discipline} · {order.worktype} · {order.status}</span><small>{order.description}</small><small>Ước tính WO: {order.estdur === null ? '—' : `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 2}).format(Number(order.estdur))} giờ`}</small><small className={styles.woMeta} data-no-pic={!order.assignedto||undefined} title={scheduleText?`Lịch WO ${order.schedstart} → ${order.schedfinish}`:undefined}>{order.assignedto?`PIC ${picLabel(order.assignedto,nameByCode)}`:'Chưa có PIC'} · {scheduleText??'Chưa có lịch'}</small>{warnTexts.length>0&&<small className={styles.woWarn}><StatusIcon kind="warning" /> {warnTexts.join(' · ')}</small>}<small className={styles.allocationSummary} title={summaryHint}>{taskStatus}</small></button>{canWrite&&onSuggestPic&&shownPool&&proposedPic&&<button type="button" className={styles.suggestPic} title="Mở editor ở trang Work orders với PIC điền sẵn; chưa lưu, không ghi Maximo" onClick={()=>onSuggestPic({connection_id:shownPool.connection_id,discipline,site_id:order.siteid,workorder_id:order.workorderid,pic:proposedPic})}>Đặt {picLabel(proposedPic,nameByCode)} làm PIC (tạo nháp)</button>}{status?.state==='error'&&<button type="button" className={styles.retrySummary} title={status.message} onClick={()=>backlogSummaryScheduler.current?.(key,true)}>Thử tải lại task</button>}</div>;
        }) : <span>{shownWorkOrderPage?.has_more?"Chưa có WO phù hợp trong lượt này. Chọn Sau để tìm tiếp.":"Không có WO trong kết quả lọc."}</span>}</div><div className={styles.backlogPagination}><button type="button" aria-label="Trang trước danh sách WO" disabled={workOrderPageLoading||visibleBacklogPage===0} onClick={()=>changeBacklogPage(visibleBacklogPage-1)}>Trước</button><span>Trang {visibleBacklogPage+1} · {backlog.length} WO{shownWorkOrderPage?.total_count!==null&&shownWorkOrderPage?.total_count!==undefined?` / ${shownWorkOrderPage.total_count}`:''}</span><button type="button" aria-label="Trang sau danh sách WO" disabled={workOrderPageLoading||!shownWorkOrderPage?.has_more} onClick={()=>changeBacklogPage(visibleBacklogPage+1)}>Sau</button></div></aside>;
}
