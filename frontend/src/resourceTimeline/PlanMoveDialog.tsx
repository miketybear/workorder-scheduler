import { useEffect, useRef } from 'react';
import { DateTimeInput } from '../components/DateTimeInput';
import type { Assignment, AssignmentPlanMovePreview, ResourcePerson } from '../api/assignments';
import { restoreFocus } from './focusRestore';
import styles from './ResourceTimeline.module.css';

type Props={
  item:Assignment;knownItems:Assignment[];people:ResourcePerson[];visibleMonth:string;
  connectionLabel:string;workOrderLabel?:string;
  targetPersonId:string;targetDate:string;requestId?:string;loading:boolean;busy:boolean;error:string;
  preview:AssignmentPlanMovePreview|null;canReallocate:boolean;unknown:boolean;reconciling:boolean;
  onPersonChange:(value:string)=>void;onDateChange:(value:string)=>void;onReallocate:()=>void;onShift:()=>void;
  onConfirm:()=>void;onReconcile:()=>void;onClose:()=>void;
  backfillOn:boolean;onBackfillChange:(value:boolean)=>void;
};
const hours=(minutes:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(minutes/60);
const dateLabel=(date:string)=>`${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}`;

export function PlanMoveDialog(props:Props){
  const {item,knownItems,people,visibleMonth,connectionLabel,workOrderLabel,targetPersonId,targetDate,requestId,loading,busy,error,preview,canReallocate,unknown,reconciling,onPersonChange,onDateChange,onReallocate,onShift,onConfirm,onReconcile,onClose,backfillOn,onBackfillChange}=props;
  const dialogRef=useRef<HTMLElement>(null);
  const latest=useRef(props);
  useEffect(()=>{latest.current=props;});
  useEffect(()=>{
    const prior=document.activeElement as HTMLElement|null;
    const focusFirst=()=>{
      const first=dialogRef.current?.querySelector<HTMLElement>('select:not(:disabled),input:not(:disabled),button:not(:disabled)');
      (first??dialogRef.current)?.focus();
    };
    focusFirst();
    const key=(event:globalThis.KeyboardEvent)=>{
      if(event.key==='Escape'&&!latest.current.busy&&!latest.current.unknown){event.preventDefault();event.stopPropagation();latest.current.onClose();return;}
      if(event.key!=='Tab')return;
      const controls=[...dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[]];
      if(!controls.length){event.preventDefault();dialogRef.current?.focus();return;}
      if(!controls.includes(document.activeElement as HTMLElement)){event.preventDefault();(event.shiftKey?controls.at(-1):controls[0])?.focus();return;}
      if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
      else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);if(prior?.isConnected)restoreFocus(prior);};
  },[]);
  useEffect(()=>{
    if(!busy&&!unknown)return;
    const first=dialogRef.current?.querySelector<HTMLElement>('select:not(:disabled),input:not(:disabled),button:not(:disabled)');
    (first??dialogRef.current)?.focus();
  },[busy,unknown]);
  useEffect(()=>{
    const root=document.documentElement,body=document.body;
    const priorRootOverflow=root.style.overflow,priorBodyOverflow=body.style.overflow;
    root.style.overflow='hidden';body.style.overflow='hidden';
    return()=>{root.style.overflow=priorRootOverflow;body.style.overflow=priorBodyOverflow;};
  },[]);
  const existing=preview?.old_items??knownItems;
  const totalMinutes=preview?.total_minutes??existing.reduce((sum,segment)=>sum+segment.minutes,0);
  const targetPerson=people.find(person=>person.person_id===targetPersonId);
  const anchorOffsetDays=Math.round((Date.parse(`${targetDate}T00:00:00Z`)-Date.parse(`${item.date}T00:00:00Z`))/86_400_000);
  const partialCoverage=!preview&&(item.plan_total_minutes??totalMinutes)>totalMinutes;
  return <div className={`${styles.overlay} ${styles.moveOverlay}`}><section ref={dialogRef} tabIndex={-1} className={`${styles.dialog} ${styles.moveDialog}`} role="dialog" aria-modal="true" aria-labelledby="plan-move-title">
    <h2 id="plan-move-title">Xem trước chuyển toàn task</h2>
    <p><strong>{item.task_description||`Task ${item.task_id}`}</strong> · {workOrderLabel??`Task ${item.task_id}`} · {hours(totalMinutes)} giờ đang giữ · {connectionLabel} · {people.find(person=>person.person_id===item.person_id)?.name??'Nhân lực hiện tại'} → {targetPerson?.name??'Nhân lực đích'}.</p>
    {partialCoverage&&<p role="status">Chưa tải đủ các ngày của task; tổng giờ hiển thị chỉ gồm {existing.length} ngày đã biết. Preview máy chủ sẽ trả toàn bộ ngày trước khi xác nhận.</p>}
    <div className={styles.moveTargets}>
      <label>Nhân lực đích<select aria-label="Nhân lực đích" value={targetPersonId} disabled={busy||unknown} onChange={event=>onPersonChange(event.target.value)}>{people.map(person=><option key={person.person_id} value={person.person_id}>{person.name} · {person.laborcode}</option>)}</select></label>
      <div className={styles.field}><span>Ngày chuyển đến</span><DateTimeInput dateOnly label="Ngày chuyển đến" value={targetDate} disabled={busy||unknown} onChange={onDateChange}/></div>
    </div>
    {preview?.mode==='reallocate'?<p>Xếp lại từ {targetDate?dateLabel(targetDate):'ngày đã chọn'} theo capacity đã xác minh: dùng ít ngày nhất có thể, ngày và giờ từng đoạn có thể thay đổi. <button type="button" className={styles.linkButton} disabled={busy||unknown} onClick={onShift}>Giữ nguyên giờ và độ lệch ngày</button></p>:<p>Ngày đang kéo: {dateLabel(item.date)} → {targetDate?dateLabel(targetDate):'—'}; các ngày còn lại {anchorOffsetDays>=0?'dịch thêm':'lùi'} {Math.abs(anchorOffsetDays)} ngày theo cùng độ lệch.</p>}
    <table className={styles.moveComparison} aria-label="Đối chiếu lịch trước và sau chuyển"><thead><tr><th>Ngày cũ</th><th>Giờ</th><th></th><th>Ngày mới</th><th>Giờ</th></tr></thead><tbody>{Array.from({length:Math.max(existing.length,preview?.segments.length??0)},(_,index)=>{const old=existing.slice().sort((a,b)=>a.date.localeCompare(b.date))[index];const next=preview?.segments.slice().sort((a,b)=>a.date.localeCompare(b.date))[index];return <tr key={`${old?.id??'none'}-${next?.date??'pending'}`}><td>{old?`${dateLabel(old.date)}${old.date.slice(0,7)!==visibleMonth?' *':''}`:'—'}</td><td>{old?`${hours(old.minutes)}h`:'—'}</td><td aria-hidden="true">→</td><td>{next?`${dateLabel(next.date)}${next.date.slice(0,7)!==visibleMonth?' *':''}`:'—'}</td><td>{next?`${hours(next.minutes)}h`:'—'}</td></tr>;})}</tbody></table>
    {preview&&<section className={styles.moveCapacity} aria-label="Capacity sau chuyển"><h3>{preview.mode==='reallocate'?'Phân bổ lại từ ngày chuyển đến':'Giữ nguyên giờ và độ lệch ngày'} · capacity theo ngày</h3>{preview.capacity.map(day=><p key={`${day.person_id}|${day.date}`}>{dateLabel(day.date)} · còn {hours(day.remaining_minutes)}h / đề xuất {hours(day.proposed_minutes)}h / sau chuyển {hours(day.remaining_after_minutes)}h{day.date.slice(0,7)!==visibleMonth?' · ngoài tháng đang xem':''}</p>)}</section>}
    {preview?.backfill&&preview.backfill.plans.length>0&&<section className={styles.backfill} aria-label="Dồn lịch các task khác">
      <label className={styles.backfillToggle}><input type="checkbox" checked={backfillOn} disabled={busy||unknown} onChange={event=>onBackfillChange(event.target.checked)} /> Để các task nhiều ngày còn lại của {people.find(person=>person.person_id===item.person_id)?.name??'nhân lực cũ'} lấp chỗ trống vừa trống ra</label>
      <ul>{preview.backfill.plans.map(plan=>{const dates=[...new Set([...plan.before,...plan.after].map(day=>day.date))].sort();const minutesOn=(list:Array<{date:string;minutes:number}>,date:string)=>list.find(day=>day.date===date)?.minutes??0;const changes=dates.filter(date=>minutesOn(plan.before,date)!==minutesOn(plan.after,date));return <li key={plan.plan_id} data-applied={backfillOn||undefined}><strong>Task {plan.task_id}</strong>{plan.task_description&&plan.task_description!==`T${plan.task_id}`?` · ${plan.task_description}`:''} · kết thúc {dateLabel(plan.finish_before)} → {dateLabel(plan.finish_after)}<small>{changes.map(date=>`${dateLabel(date).slice(0,5)}: ${hours(minutesOn(plan.before,date))}h → ${hours(minutesOn(plan.after,date))}h`).join(' · ')}</small></li>;})}</ul>
      {preview.backfill.skipped.length>0&&<p role="status">Không dồn được: {preview.backfill.skipped.map(entry=>`Task ${entry.task_id} (${entry.reason==='load_unverified'?'tải chưa xác minh':'quá xa'})`).join(', ')}.</p>}
      {!backfillOn&&<p role="status">Các task này giữ nguyên lịch; giờ trống ở ô cũ sẽ không được lấp.</p>}
    </section>}
    {loading&&<p role="status">Đang kiểm tra preview và capacity…</p>}
    {error&&<p role="alert">{error}</p>}
    {canReallocate&&<p><button type="button" disabled={busy||unknown} onClick={onReallocate}>Phân bổ lại từ ngày thả</button> sẽ kiểm tra lại bằng preview riêng; giờ được dàn theo capacity khả dụng.</p>}
    {unknown&&<div className={styles.moveUnknown} role="status"><p>Chưa xác nhận được kết quả lưu. Không gửi lại thao tác chuyển.</p>{requestId&&<p>Mã yêu cầu: <code>{requestId}</code></p>}<button type="button" disabled={reconciling} onClick={onReconcile}>{reconciling?'Đang đối soát…':'Đối soát trạng thái chuyển'}</button></div>}
    <div className={styles.actions}><button type="button" onClick={onClose} disabled={busy||unknown}>Hủy</button><button type="button" disabled={!preview||loading||busy||unknown||!!error} onClick={onConfirm}>{busy?'Đang chuyển…':'Xác nhận chuyển'}</button></div>
  </section></div>;
}
