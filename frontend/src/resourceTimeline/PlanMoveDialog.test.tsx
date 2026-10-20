import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getDate } from '../testDateTime';
import type { Assignment, AssignmentPlanMovePreview, ResourcePerson } from '../api/assignments';
import { PlanMoveDialog } from './PlanMoveDialog';

const item={id:'a-1',pool_id:'pool',connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',person_id:'p1',date:'2026-10-04',minutes:60,version:1,state:'reserved',plan_id:'plan-1',plan_total_minutes:120,plan_version:3,task_id:10,task_workorder_id:'task-10',task_description:'Inspect pump',assignment_id:'source-10',sync_state:'local',plan_sync_state:'local'} as Assignment;
const second={...item,id:'a-2',date:'2026-10-05',minutes:60};
const people=[{person_id:'p1',name:'Nguyen A',craft:'E&I',role:'TECH',laborcode:'L1',days:[]},{person_id:'p2',name:'Nguyen B',craft:'E&I',role:'TECH',laborcode:'L2',days:[]}] as ResourcePerson[];
function props(overrides:Partial<React.ComponentProps<typeof PlanMoveDialog>>={}){return {item,knownItems:[item,second],people,visibleMonth:'2026-10',connectionLabel:'Onshore test · Test',targetPersonId:'p2',targetDate:'2026-10-06',loading:false,busy:false,error:'',preview:null,canReallocate:false,unknown:false,reconciling:false,onPersonChange:vi.fn(),onDateChange:vi.fn(),onReallocate:vi.fn(),onConfirm:vi.fn(),onReconcile:vi.fn(),onClose:vi.fn(),...overrides};}

describe('PlanMoveDialog',()=>{
  it('contains focus while busy or unresolved and restores scrolling on close',()=>{
    const onClose=vi.fn();
    const priorBody=document.body.style.overflow,priorRoot=document.documentElement.style.overflow;
    const view=render(<PlanMoveDialog {...props({busy:true,onClose})}/>);
    const dialog=screen.getByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog,{key:'Tab'});
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog,{key:'Escape'});
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<PlanMoveDialog {...props({unknown:true,requestId:'move-request',onClose})}/>);
    const reconcile=screen.getByRole('button',{name:'Đối soát trạng thái chuyển'});
    expect(reconcile).toHaveFocus();
    fireEvent.keyDown(reconcile,{key:'Tab'});
    expect(reconcile).toHaveFocus();
    fireEvent.keyDown(reconcile,{key:'Escape'});
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('move-request')).toBeInTheDocument();
    view.unmount();
    expect(document.body.style.overflow).toBe(priorBody);
    expect(document.documentElement.style.overflow).toBe(priorRoot);
  });
  it('shows a full before/after shift and explains the selected-date offset',()=>{
    const preview={plan_id:'plan-1',plan_version:3,pool_id:'pool',connection_id:'conn',discipline:'E&I',task_workorder_id:'task-10',task_id:10,assignment_id:'source-10',source_person_id:'p1',target_person_id:'p2',source_laborcode:'L1',target_laborcode:'L2',original_demand_minutes:120,total_minutes:120,mode:'shift',old_items:[item,second],segments:[{date:'2026-10-06',minutes:60},{date:'2026-10-07',minutes:60}],capacity:[{person_id:'p2',date:'2026-10-06',laborcode:'L2',capacity_minutes:630,allocated_minutes:60,remaining_minutes:570,proposed_minutes:60,remaining_after_minutes:510},{person_id:'p2',date:'2026-10-07',laborcode:'L2',capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,proposed_minutes:60,remaining_after_minutes:570}],anchor_allocation_id:item.id,target_date:'2026-10-06'} as AssignmentPlanMovePreview;
    const view=render(<PlanMoveDialog {...props({preview,workOrderLabel:'WO-1'})}/>);
    expect(getDate(screen.getByLabelText('Ngày chuyển đến'))).toBe('2026-10-06');
    expect([...view.container.querySelectorAll('p')].some(node=>node.textContent?.includes('Ngày đang kéo: 04/10/2026')&&node.textContent.includes('dịch thêm'))).toBe(true);
    expect(screen.getByText(/WO-1/)).toBeInTheDocument();
    expect(screen.getByRole('table',{name:'Đối chiếu lịch trước và sau chuyển'}).querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByRole('heading',{name:/Giữ nguyên giờ và độ lệch ngày/})).toBeInTheDocument();
    expect(screen.getByText(/sau chuyển 8,5h/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Xác nhận chuyển'})).toBeEnabled();
  });

  it('offers a separate reallocation preview on conflict and preserves unknown outcomes without retry',()=>{
    const onReallocate=vi.fn(),onConfirm=vi.fn(),onReconcile=vi.fn();
    const {rerender}=render(<PlanMoveDialog {...props({error:'Capacity không đủ',canReallocate:true,onReallocate,onConfirm})}/>);
    fireEvent.click(screen.getByRole('button',{name:'Phân bổ lại từ ngày thả'}));
    expect(onReallocate).toHaveBeenCalledOnce();
    rerender(<PlanMoveDialog {...props({unknown:true,error:'Biên nhận chưa đọc được',onConfirm,onReconcile})}/>);
    expect(screen.getByText(/Không gửi lại thao tác chuyển/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Đối soát trạng thái chuyển'}));
    expect(onReconcile).toHaveBeenCalledOnce();
    expect(screen.getByRole('button',{name:'Xác nhận chuyển'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Hủy'})).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('discloses incomplete known segments until the server returns the complete plan',()=>{
    render(<PlanMoveDialog {...props({knownItems:[item]})}/>);
    expect(screen.getByRole('status')).toHaveTextContent(/chưa tải đủ các ngày của task/i);
    expect(screen.getByRole('button',{name:'Xác nhận chuyển'})).toBeDisabled();
  });
});
