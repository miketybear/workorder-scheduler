import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getAuthSummary } from '../api/client';
import { cancelRotaImport, getRotaImport, listResourcePools, listRotaImports, refreshRotaLabor, RotaImportError, uploadRotaImport, type RotaPreview } from '../api/rotaImports';
import { RotaImports } from './RotaImports';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn(), loginUrl:'/api/auth/login' }));
vi.mock('../api/rotaImports', () => ({
  cancelRotaImport: vi.fn(), getRotaImport: vi.fn(), listResourcePools: vi.fn(), listRotaImports: vi.fn(),
  refreshRotaLabor: vi.fn(), uploadRotaImport: vi.fn(), RotaImportError: class extends Error {
    status: number; constructor(status: number, message: string) { super(message); this.status = status; }
  },
}));
afterEach(() => { vi.resetAllMocks(); });

const session = { user:{ id:'person-1', name:'Planner', is_admin:false }, grants:[] };
const pool = { id:'pool-1', label:'Rota pool', connection_id:'conn-1', connection_label:'Onshore Test', environment:'test', orgid:'BDPOC', timezone:'Asia/Ho_Chi_Minh', capability:'write' as const };
const labor = { labor_key:'conn-1/BDPOC/LAB1', connection_id:'conn-1', orgid:'BDPOC', laborcode:'LAB1', personid:'P1', displayname:'Nguyen Van A', default_crafts:['E&I'] };
const stage = {
  id:'stage-1', pool_id:'pool-1', version:1, status:'staged', file_name:'rota.xlsx', sheet:'ROTA_2026', created_at:'2026-10-11T00:00:00Z', coverage_from:'2026-11-01', coverage_before:'2026-12-01',
  policy_version:'policy-1', labor_snapshot_at:'2026-10-11T00:00:00Z', labor_error:null, source_errors:[], excluded_labor_count:1,
  rows:[{ source_row:10, name:'Nguyen Van A', position:'E&I Technician', craft:'E&I', role:'TECH', days:[{ date:'2026-11-01', code:'W', capacity_hours:10.5 }], mapping:labor, candidates:[labor], issues:[]}],
  summary:{ rota_people:1, mapped_people:1, blocking_count:0, capacity_hours:10.5 },
};
function authorize(capability: 'read' | 'write' = 'write') {
  vi.mocked(getAuthSummary).mockResolvedValue({ available:true, session });
  vi.mocked(listResourcePools).mockResolvedValue([{ ...pool, capability }]);
  vi.mocked(listRotaImports).mockResolvedValue([]);
}
const issue = (kind: string, message: string, source_row: number) => ({ kind, message, source_row, date:null, cell:null });
function blockedStage() {
  const other = { ...labor, labor_key:'conn-1/BDPOC/LAB2', laborcode:'LAB2', personid:'P2', default_crafts:['MECH'] };
  const rows = [
    { ...stage.rows[0], mapping:null, candidates:[], issues:[issue('mapping', 'Select a verified LABOR identity', 10)] },
    { ...stage.rows[0], source_row:11, mapping:null, candidates:[labor, other], issues:[issue('mapping', 'Select a verified LABOR identity', 11)] },
    { ...stage.rows[0], source_row:12, mapping:null, candidates:[other], issues:[issue('mapping', 'LABOR identity/craft conflicts with rota', 12)] },
    { ...stage.rows[0], source_row:13, mapping:null, candidates:[{ ...labor, default_crafts:[] }], issues:[issue('mapping', 'LABOR identity/craft conflicts with rota', 13)] },
  ];
  return { ...stage, rows, summary:{ rota_people:4, mapped_people:0, blocking_count:4, capacity_hours:42 } };
}

it('shows excluded Material Controller separately and does not report title-resolved names as ambiguous', async () => {
  authorize();
  const titleMatch = { ...labor, title: 'E&I Technician' };
  const other = { ...labor, labor_key: 'different', personid: 'P2', title: 'Production Technician' };
  vi.mocked(listRotaImports).mockResolvedValue([stage]);
  vi.mocked(getRotaImport).mockResolvedValue({ ...stage, excluded_position_count: 1,
    excluded_positions: [{ source_row: 96, name: 'Nguyen Manh Hung', position: 'Material controller' }],
    rows: [{ ...stage.rows[0], mapping: titleMatch, candidates: [titleMatch, other] }],
  } as never);
  render(<RotaImports />);
  await screen.findByText('Không tính Labor / capacity · 1 dòng');
  expect(screen.getByRole('region', { name: 'Chức danh không tính Labor' })).toHaveTextContent('Dòng 96 · Nguyen Manh Hung · Material controller');
  expect(screen.getByText('Person P1 · Position: E&I Technician')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Báo cáo lỗi LABOR/ })).not.toBeInTheDocument();
});

it('shows each duplicate-name candidate title in the blocker report', async () => {
  authorize();
  vi.mocked(listRotaImports).mockResolvedValue([stage]);
  vi.mocked(getRotaImport).mockResolvedValue({ ...stage, rows: [{ ...stage.rows[0], mapping: null,
    candidates: [{ ...labor, title: 'Field Supervisor' }, { ...labor, labor_key: 'other', personid: 'P2', title: 'Production Technician' }],
    issues: [issue('mapping', 'Ambiguous title', 10)],
  }], summary: { ...stage.summary, mapped_people: 0, blocking_count: 1 } } as never);
  render(<RotaImports />);
  await screen.findByRole('heading', { name: /Báo cáo lỗi LABOR/ });
  expect(screen.getByText(/Position: Field Supervisor/)).toBeInTheDocument();
  expect(screen.getByText(/Position: Production Technician/)).toBeInTheDocument();
});

it('does not query roster pools or saved imports before login', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue({ available:true, session:null });
  render(<RotaImports />);
  expect(await screen.findByText('Đăng nhập để xem các resource pool được cấp quyền.')).toBeInTheDocument();
  expect(listResourcePools).not.toHaveBeenCalled(); expect(listRotaImports).not.toHaveBeenCalled();
});

it('keeps a read-only pool usable for restores but disables upload, refresh and cancel', async () => {
  authorize('read');
  vi.mocked(listRotaImports).mockResolvedValue([{ ...stage }]);
  vi.mocked(getRotaImport).mockResolvedValue(stage as never);
  render(<RotaImports />);
  expect(await screen.findByText('Preview đã lưu · rota.xlsx')).toBeInTheDocument();
  expect(screen.getByRole('button', { name:'Làm mới LABOR' })).toBeDisabled();
  expect(screen.getByRole('button', { name:'Hủy phiên staging' })).toBeDisabled();
  expect(screen.getByLabelText(/File rota/)).toBeDisabled();
});

it('stores the upload and reports all matching LABOR details and Maximo fixes without an edit control', async () => {
  authorize(); vi.mocked(uploadRotaImport).mockResolvedValue(blockedStage() as never);
  render(<RotaImports />);
  const file = new File(['rota'], 'rota.xlsx');
  fireEvent.change(await screen.findByLabelText(/File rota/), { target:{ files:[file] } });
  fireEvent.click(screen.getByRole('button', { name:'Upload và tạo staging' }));
  await screen.findByText('Preview đã lưu · rota.xlsx');
  expect(uploadRotaImport).toHaveBeenCalledWith('pool-1', file, 'ROTA_2026', expect.any(AbortSignal));
  expect(await screen.findByRole('heading', { name:'Báo cáo lỗi LABOR / craft · 4 dòng' })).toBeInTheDocument();
  expect(screen.getByText(/Không tìm thấy LABOR có tên khớp chính xác/)).toBeInTheDocument();
  expect(screen.getAllByText('LAB2')).toHaveLength(2);
  expect(screen.getByText(/Có 2 LABOR cùng tên/)).toBeInTheDocument();
  expect(screen.getByText(/Craft Maximo “MECH” không khớp craft rota “E&I”/)).toBeInTheDocument();
  expect(screen.getByText(/chưa có default craft/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Maximo admin xử lý trên Maximo/).length).toBeGreaterThan(1);
  expect(screen.queryByRole('combobox', { name:/LABOR mapping/ })).not.toBeInTheDocument();
  expect(refreshRotaLabor).not.toHaveBeenCalled(); expect(cancelRotaImport).not.toHaveBeenCalled();
});

it('refreshes after Maximo fixes and installs the server-calculated preview', async () => {
  authorize(); vi.mocked(uploadRotaImport).mockResolvedValue(blockedStage() as never);
  const corrected = { ...stage, version:2 };
  vi.mocked(refreshRotaLabor).mockResolvedValue(corrected as never);
  render(<RotaImports />);
  fireEvent.change(await screen.findByLabelText(/File rota/), { target:{ files:[new File(['rota'], 'rota.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name:'Upload và tạo staging' }));
  await screen.findByRole('heading', { name:'Báo cáo lỗi LABOR / craft · 4 dòng' });
  fireEvent.click(screen.getByRole('button', { name:'Làm mới LABOR' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã cập nhật snapshot LABOR và tính lại preview.');
  expect(refreshRotaLabor).toHaveBeenCalledWith(blockedStage(), expect.any(AbortSignal));
  expect(screen.queryByRole('heading', { name:'Báo cáo lỗi LABOR / craft · 4 dòng' })).not.toBeInTheDocument();
});

it('keeps the staged upload after LABOR REST failure and hides outdated error rows when refresh also fails', async () => {
  authorize();
  const restFailed = { ...blockedStage(), labor_snapshot_at:null, labor_error:'Maximo REST timeout', rows:blockedStage().rows.map(row => ({ ...row, candidates:[], mapping:null })) };
  vi.mocked(uploadRotaImport).mockResolvedValue(restFailed as never);
  vi.mocked(refreshRotaLabor).mockRejectedValue(new Error('Maximo REST vẫn không phản hồi'));
  render(<RotaImports />);
  const input = await screen.findByLabelText(/File rota/);
  const file = new File(['rota'], 'rota.xlsx');
  fireEvent.change(input, { target:{ files:[file] } });
  fireEvent.click(screen.getByRole('button', { name:'Upload và tạo staging' }));
  expect(await screen.findByText('Preview đã lưu · rota.xlsx')).toBeInTheDocument();
  expect(screen.getByText(/Chưa có snapshot LABOR cho phiên này\. Maximo REST timeout/)).toBeInTheDocument();
  expect(screen.getAllByText('LABOR chưa đối chiếu').length).toBeGreaterThan(0);
  expect(screen.queryByRole('heading', { name:/Báo cáo lỗi LABOR/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name:'Làm mới LABOR' }));
  expect(await screen.findByText(/Không làm mới được LABOR: Maximo REST vẫn không phản hồi/)).toBeInTheDocument();
  expect(screen.getByText('Preview đã lưu · rota.xlsx')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name:/Báo cáo lỗi LABOR/ })).not.toBeInTheDocument();
  expect(uploadRotaImport).toHaveBeenCalledTimes(1);
  expect(refreshRotaLabor).toHaveBeenCalledTimes(1);
});

it('does not claim a new snapshot when refresh returns the retained old snapshot with a LABOR error', async () => {
  authorize();
  const blocked = blockedStage();
  const retained = { ...blocked, version:2, labor_error:'Maximo REST timeout' };
  vi.mocked(uploadRotaImport).mockResolvedValue(blocked as never);
  vi.mocked(refreshRotaLabor).mockResolvedValue(retained as never);
  render(<RotaImports />);
  fireEvent.change(await screen.findByLabelText(/File rota/), { target:{ files:[new File(['rota'], 'rota.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name:'Upload và tạo staging' }));
  await screen.findByRole('heading', { name:'Báo cáo lỗi LABOR / craft · 4 dòng' });
  fireEvent.click(screen.getByRole('button', { name:'Làm mới LABOR' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu kết quả kiểm tra; chưa lấy được snapshot LABOR mới.');
  expect(screen.queryByRole('heading', { name:/Báo cáo lỗi LABOR/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Snapshot LABOR cũ vẫn được giữ/)).toBeInTheDocument();
  expect(refreshRotaLabor).toHaveBeenCalledTimes(1);
});

it('reloads the latest saved version after refresh conflict and never retries upload automatically', async () => {
  authorize();
  const blocked = blockedStage();
  const latest = { ...blocked, version:2 };
  vi.mocked(uploadRotaImport).mockResolvedValue(blocked as never);
  vi.mocked(refreshRotaLabor)
    .mockRejectedValueOnce(new RotaImportError(409, 'Preview đã được cập nhật ở nơi khác. Tải lại phiên đã lưu trước khi sửa tiếp.'))
    .mockResolvedValueOnce({ ...stage, version:3 } as never);
  vi.mocked(getRotaImport).mockResolvedValue(latest as never);
  render(<RotaImports />);
  fireEvent.change(await screen.findByLabelText(/File rota/), { target:{ files:[new File(['rota'], 'rota.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name:'Upload và tạo staging' }));
  await screen.findByRole('heading', { name:'Báo cáo lỗi LABOR / craft · 4 dòng' });
  fireEvent.click(screen.getByRole('button', { name:'Làm mới LABOR' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Preview đã được cập nhật ở nơi khác/);
  fireEvent.click(screen.getByRole('button', { name:'Tải lại phiên đã lưu' }));
  await screen.findByText('Preview đã lưu · rota.xlsx');
  expect(getRotaImport).toHaveBeenCalledWith('stage-1', 'pool-1', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name:'Làm mới LABOR' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã cập nhật snapshot LABOR và tính lại preview.');
  expect(refreshRotaLabor).toHaveBeenLastCalledWith(latest, expect.any(AbortSignal));
  expect(uploadRotaImport).toHaveBeenCalledTimes(1);
});

it('does not refresh a cancelled staging session', async () => {
  authorize();
  const cancelled = { ...stage, status:'cancelled' };
  vi.mocked(listRotaImports).mockResolvedValue([cancelled]); vi.mocked(getRotaImport).mockResolvedValue(cancelled as never);
  render(<RotaImports />);
  expect(await screen.findByText('Preview đã lưu · rota.xlsx')).toBeInTheDocument();
  expect(screen.getByRole('button', { name:'Làm mới LABOR' })).toBeDisabled();
});

it('reloads a retained import when its version/status changed while the timeline route was away', async () => {
  authorize();
  const activated = { ...stage, version:2, status:'activated' };
  vi.mocked(listRotaImports)
    .mockResolvedValueOnce([{ ...stage }])
    .mockResolvedValueOnce([{ ...activated }]);
  vi.mocked(getRotaImport).mockResolvedValueOnce(stage as never).mockResolvedValueOnce(activated as never);
  const view = render(<RotaImports />);
  expect(await screen.findByText('Preview đã lưu · rota.xlsx')).toBeInTheDocument();
  view.rerender(<RotaImports active={false} />);
  view.rerender(<RotaImports active />);
  expect(await screen.findByText('Roster đã kích hoạt')).toBeInTheDocument();
  expect(getRotaImport).toHaveBeenCalledTimes(2);
  expect(getRotaImport).toHaveBeenLastCalledWith(stage.id, pool.id, expect.any(AbortSignal));
  expect(screen.getByRole('button', { name:'Làm mới LABOR' })).toBeDisabled();
  expect(screen.getByRole('button', { name:'Phiên không còn ở staging' })).toBeDisabled();
});

it('ignores a late refresh result after switching A to B and back to A', async () => {
  const poolB = { ...pool, id:'pool-2', label:'Other pool' };
  vi.mocked(getAuthSummary).mockResolvedValue({ available:true, session });
  vi.mocked(listResourcePools).mockResolvedValue([pool, poolB]);
  vi.mocked(listRotaImports).mockImplementation(async poolId => poolId === pool.id ? [stage] : []);
  vi.mocked(getRotaImport).mockResolvedValueOnce(stage as never).mockResolvedValueOnce({ ...stage, version:3, file_name:'latest-v3.xlsx' } as never);
  let finishStale!: (value: RotaPreview) => void;
  const staleRefresh = new Promise<RotaPreview>(resolve => { finishStale = resolve; });
  const savedVersion4 = { ...stage, version:4, file_name:'saved-v4.xlsx' };
  vi.mocked(refreshRotaLabor).mockReturnValueOnce(staleRefresh).mockResolvedValueOnce(savedVersion4 as never);
  render(<RotaImports />);
  fireEvent.click(await screen.findByRole('button', { name:'Làm mới LABOR' }));
  await waitFor(() => expect(refreshRotaLabor).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Resource pool'), { target:{ value:poolB.id } });
  await waitFor(() => expect(listRotaImports).toHaveBeenCalledWith(poolB.id, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText('Resource pool'), { target:{ value:pool.id } });
  await screen.findByText('Preview đã lưu · latest-v3.xlsx');
  fireEvent.click(screen.getByRole('button', { name:'Làm mới LABOR' }));
  await screen.findByText('Preview đã lưu · saved-v4.xlsx');
  finishStale({ ...stage, version:2, file_name:'stale-v2.xlsx' } as RotaPreview);
  await waitFor(() => expect(screen.getByText('Preview đã lưu · saved-v4.xlsx')).toBeInTheDocument());
});
