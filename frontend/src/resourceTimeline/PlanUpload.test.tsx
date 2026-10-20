import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlanUpload } from './PlanUpload';
import type { Assignment } from '../api/assignments';
import { groupControl } from '../testDateTime';

const api=vi.hoisted(()=>({preview:vi.fn(),upload:vi.fn(),lookup:vi.fn(),reconcile:vi.fn(),status:vi.fn()}));
vi.mock('../api/assignments',async importOriginal=>{const actual=await importOriginal<typeof import('../api/assignments')>();return {...actual,previewAssignmentPlan:api.preview,uploadAssignmentPlan:api.upload,lookupAssignmentPlanUpload:api.lookup,reconcileAssignmentPlanUpload:api.reconcile,getAssignmentPlanUploadStatus:api.status};});
const base:Assignment={id:'a1',pool_id:'pool',connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',date:'2026-10-05',minutes:60,version:1,state:'reserved',plan_id:'plan',plan_total_minutes:60,task_workorder_id:'task-wo',task_id:10,assignment_id:'source'};
const preview={plan_id:'plan',plan_version:2,preview_token:'token',expires_at:'2099-10-05T12:02:00Z',timezone:'UTC',source_assignment_id:'source',connection_id:'conn',site_id:'SITE',workorder_id:'123',task_workorder_id:'task-wo',task_id:10,person_id:'person',laborcode:'L1',segments:[{allocation_id:'a1',version:1,date:'2026-10-05',minutes:60,scheduled_start:'2026-10-05T06:30:00Z',scheduled_finish:'2026-10-05T07:30:00Z',remote_assignment_id:null}],total_minutes:60,can_upload:true,reason:null};
const props={items:[base],supported:true,writable:true,timezone:'UTC',taskLabel:'Pump repair',personLabel:'Linh Nguyen',verify:vi.fn().mockResolvedValue(undefined),onLock:vi.fn(),onConfirmed:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();api.preview.mockResolvedValue(preview);api.status.mockResolvedValue(null);});

it('keeps a sent plan locked after a lost response and a missing receipt without resending',async()=>{
  api.upload.mockRejectedValue(new TypeError('network lost'));api.lookup.mockResolvedValue(null);
  render(<PlanUpload {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Xem trước đồng bộ'}));
  await screen.findByText(/1 ngày · tổng 1 giờ/);
  fireEvent.click(screen.getByRole('button',{name:'Gửi kế hoạch lên Maximo'}));
  await screen.findByText(/không gửi lại kế hoạch/);
  fireEvent.click(screen.getByRole('button',{name:'Đối soát (không gửi lại)'}));
  await screen.findByText(/tiếp tục đối soát, không gửi lại/);
  expect(api.upload).toHaveBeenCalledTimes(1);
  expect(groupControl(screen.getByLabelText('Giờ bắt đầu kế hoạch'))).toBeDisabled();
});

it('rediscovers an unknown receipt when reopening a plan',async()=>{
  api.status.mockResolvedValue({attempt_id:'attempt',request_id:'req',plan_id:'plan',state:'unknown',mapping:null});
  api.lookup.mockResolvedValue({attempt_id:'attempt',request_id:'req',plan_id:'plan',state:'unknown',mapping:null});
  api.reconcile.mockResolvedValue({attempt_id:'attempt',request_id:'req',plan_id:'plan',state:'unknown',mapping:null});
  render(<PlanUpload {...props} items={[{...base,plan_sync_state:'unknown'}]}/>);
  await screen.findByText(/Kết quả chưa rõ/);
  fireEvent.click(screen.getByRole('button',{name:'Đối soát (không gửi lại)'}));
  await waitFor(()=>expect(api.reconcile).toHaveBeenCalledWith('attempt','req','plan',undefined,expect.any(AbortSignal)));
  expect(api.upload).not.toHaveBeenCalled();
});

it('requires a fresh preview after its token expires',async()=>{
  api.preview.mockResolvedValue({...preview,expires_at:'2000-01-01T00:00:00Z'});
  render(<PlanUpload {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Xem trước đồng bộ'}));
  await waitFor(()=>expect(api.preview).toHaveBeenCalled());
  expect(await screen.findByText(/Preview đã hết hạn/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Gửi kế hoạch lên Maximo'})).toBeDisabled();
});

it('shows the complete cross-month plan returned by server preview',async()=>{
  api.preview.mockResolvedValue({...preview,total_minutes:120,segments:[...preview.segments,{allocation_id:'a2',version:1,date:'2026-11-01',minutes:60,scheduled_start:'2026-11-01T06:30:00Z',scheduled_finish:'2026-11-01T07:30:00Z',remote_assignment_id:null}]});
  render(<PlanUpload {...props} items={[{...base,plan_total_minutes:120}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Xem trước đồng bộ'}));
  await screen.findByText(/2 ngày · tổng 2 giờ/);
  expect(screen.getByText(/01\/11\/2026/)).toBeInTheDocument();
});
