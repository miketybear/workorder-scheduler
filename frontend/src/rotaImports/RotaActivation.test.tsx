import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RotaActivation } from './RotaActivation';
import type { RotaPreview } from '../api/rotaImports';

const savedDiff = {
  import_id:'import-1', pool_id:'pool-1', import_version:4, pool_version:0, policy_version:'v1', coverage_from:'2026-11-01', coverage_before:'2026-12-01',
  can_activate:true, blocking_reasons:[], diff:{ added_people:1, removed_people:1, changed_people:1, changed_days:3, before_hours:10, after_hours:20 },
  changes:[{ person_key:'person-1', name:'Nguyen Van A', change_type:'changed', before_crafts:['MECH'], after_crafts:['E&I'], before_roles:['TECH'], after_roles:['SUP'], before_hours:10, after_hours:20, changed_days:3,
    day_changes:[{ date:'2026-11-01', before:{ code:'W', capacity_hours:10, craft:'MECH', role:'TECH' }, after:{ code:'W', capacity_hours:10.5, craft:'E&I', role:'SUP' } }], day_changes_truncated:true }], activation_receipt:null,
};
const receipt = { id:'receipt-1', pool_id:'pool-1', import_id:'import-1', import_version:4, pool_version:1, coverage_from:'2026-11-01', coverage_before:'2026-12-01', activated_at:'2026-10-11T08:00:00Z', person_count:1, day_count:31, total_hours:325.5 };
const stage = { id:'import-1', pool_id:'pool-1', version:4, status:'staged', file_name:'rota.ods', sheet:'ROTA_2026', created_at:'2026-10-11T00:00:00Z', coverage_from:'2026-11-01', coverage_before:'2026-12-01' } as RotaPreview;
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers:{ 'Content-Type':'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(document, 'cookie', { configurable:true, value:'' }); });

it('requires full replacement acknowledgment and submits once, then displays the durable receipt', async () => {
  Object.defineProperty(document, 'cookie', { configurable:true, value:'__Host-wos-csrf=token' });
  const fetcher = vi.fn().mockResolvedValueOnce(respond(savedDiff)).mockResolvedValueOnce(respond(receipt)); vi.stubGlobal('fetch', fetcher);
  const activated = vi.fn(); render(<RotaActivation preview={stage} canWrite busy={false} resetToken={0} onActivated={activated} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' }));
  expect(await screen.findByText(/thay roster/i)).toBeInTheDocument();
  expect(screen.getAllByText(/MECH/).length).toBeGreaterThan(0); expect(screen.getAllByText(/E&I/).length).toBeGreaterThan(0);
  const confirm = screen.getByRole('button', { name:'Xác nhận kích hoạt roster' }); expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name:/thay thế toàn bộ roster/i })); expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(await screen.findByText('receipt-1')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(activated).toHaveBeenCalledWith(receipt);
  expect(screen.getAllByText('receipt-1').length).toBeGreaterThan(0);
});

it('shows blockers and never enables activation when the server rejects the diff', async () => {
  const blocked = { ...savedDiff, can_activate:false, blocking_reasons:['LABOR craft mismatch on row 12'] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(blocked)));
  render(<RotaActivation preview={stage} canWrite busy={false} resetToken={0} onActivated={vi.fn()} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' }));
  expect(await screen.findByText('LABOR craft mismatch on row 12')).toBeInTheDocument();
  expect(screen.getByRole('button', { name:'Xác nhận kích hoạt roster' })).toBeDisabled();
});

it('does not retry an unknown activation and reconciles it with GET receipt only', async () => {
  Object.defineProperty(document, 'cookie', { configurable:true, value:'__Host-wos-csrf=token' });
  const fetcher = vi.fn().mockResolvedValueOnce(respond(savedDiff)).mockRejectedValueOnce(new TypeError('network lost')).mockResolvedValueOnce(respond({ ...savedDiff, can_activate:false, activation_receipt:receipt }));
  vi.stubGlobal('fetch', fetcher);
  const activated = vi.fn(); render(<RotaActivation preview={stage} canWrite busy={false} resetToken={0} onActivated={activated} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' })); await screen.findByText(/thay roster/i);
  fireEvent.click(screen.getByRole('checkbox', { name:/thay thế toàn bộ roster/i }));
  fireEvent.click(screen.getByRole('button', { name:'Xác nhận kích hoạt roster' }));
  expect(await screen.findByText(/chưa rõ kết quả gửi yêu cầu/i)).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('checkbox', { name:/thay thế toàn bộ roster/i })).toBeDisabled();
  expect(screen.getByRole('button', { name:'Xác nhận kích hoạt roster' })).toBeDisabled();
  expect(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name:/thay thế toàn bộ roster/i }));
  fireEvent.click(screen.getByRole('button', { name:'Xác nhận kích hoạt roster' }));
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name:'Kiểm tra kết quả kích hoạt' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(await screen.findByText('receipt-1')).toBeInTheDocument(); expect(activated).toHaveBeenCalledWith(receipt);
  expect(fetcher.mock.calls[2][1].method).toBeUndefined();
});

it('notifies parent to reload when an ordinary comparison discovers an existing receipt', async () => {
  const fetcher = vi.fn().mockResolvedValue(respond({ ...savedDiff, can_activate:false, activation_receipt:receipt })); vi.stubGlobal('fetch', fetcher);
  const activated = vi.fn();
  render(<RotaActivation preview={stage} canWrite busy={false} resetToken={0} onActivated={activated} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' }));
  expect(await screen.findByText('receipt-1')).toBeInTheDocument();
  expect(activated).toHaveBeenCalledWith(receipt);
});

it('shows an existing receipt without the "already activated" blocking reason', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...savedDiff, can_activate:false, blocking_reasons:['Import is cancelled or already activated'], activation_receipt:receipt })));
  render(<RotaActivation preview={{ ...stage, status:'activated' }} canWrite busy={false} resetToken={0} onActivated={vi.fn()} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem biên nhận kích hoạt' }));
  expect(await screen.findByText('receipt-1')).toBeInTheDocument();
  expect(screen.queryByText('Chưa thể kích hoạt')).not.toBeInTheDocument();
  expect(screen.queryByText('Import is cancelled or already activated')).not.toBeInTheDocument();
});

it('clears acknowledgment when another parent operation starts', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(savedDiff)));
  const { rerender } = render(<RotaActivation preview={stage} canWrite busy={false} resetToken={0} onActivated={vi.fn()} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' })); await screen.findByText(/thay roster/i);
  const checkbox = screen.getByRole('checkbox', { name:/thay thế toàn bộ roster/i });
  fireEvent.click(checkbox); expect(checkbox).toBeChecked();
  rerender(<RotaActivation preview={stage} canWrite busy={false} resetToken={1} onActivated={vi.fn()} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  expect(checkbox).not.toBeChecked();
});

it('accepts blocked previews with unknown date coverage and explains it without crashing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...savedDiff, coverage_from:null, coverage_before:null, can_activate:false, blocking_reasons:['Invalid source date coverage'] })));
  render(<RotaActivation preview={stage} canWrite busy={false} resetToken={0} onActivated={vi.fn()} onAccessFailure={vi.fn()} onBusyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name:'Xem thay đổi để kích hoạt' }));
  expect(await screen.findByText('Invalid source date coverage')).toBeInTheDocument();
  expect(screen.getByText(/chưa xác định đến trước chưa xác định/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name:/thay thế toàn bộ roster/i })).toBeDisabled();
});
