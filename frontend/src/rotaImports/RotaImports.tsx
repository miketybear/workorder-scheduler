import { useEffect, useMemo, useRef, useState } from 'react';
import { getAuthSummary, loginUrl, type Session } from '../api/client';
import { cancelRotaImport, getRotaImport, listResourcePools, listRotaImports, refreshRotaLabor, RotaImportError, uploadRotaImport, type ImportSummary, type ResourcePool, type RotaPreview, type RotaRow } from '../api/rotaImports';
import { RotaActivation } from './RotaActivation';
import styles from './RotaImports.module.css';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FILE = /\.(xlsx|ods)$/i;
const dateMonth = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 7) : '';
const monthName = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1)));
};
const roleName: Record<string, string> = {
  TECH: 'Technician', SUP: 'Supervisor', ASST_SUP: 'Assistant supervisor',
  CONTROL_RM_ENGINEER: 'Control RM Engineer', MATERIAL_CONTROLLER: 'Material Controller',
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Yêu cầu chưa hoàn tất. Hãy thử lại.';

function laborProblem(row: RotaRow): { reason: string; action: string } | null {
  const previewIssue = row.issues.find(issue => ['mapping', 'craft', 'duplicate'].includes(issue.kind));
  const legacyMessage = previewIssue?.message === 'Select a verified LABOR identity' || previewIssue?.message === 'LABOR identity/craft conflicts with rota';
  const reportedReason = previewIssue && !legacyMessage ? previewIssue.message : null;
  if (row.mapping && !previewIssue) return null;
  if (row.issues.some(issue => issue.kind === 'duplicate')) return { reason: 'Một LABOR/person đang xuất hiện ở nhiều dòng rota.', action: 'Maximo admin kiểm tra person/LABOR trùng; sau đó làm mới LABOR.' };
  if (row.candidates.length === 0) return { reason: reportedReason ?? 'Không tìm thấy LABOR có tên khớp chính xác trong snapshot Maximo.', action: 'Maximo admin kiểm tra tên/LABOR trên Maximo; sau đó làm mới LABOR.' };
  if (row.candidates.length > 1 && !row.mapping) return { reason: reportedReason ?? `Có ${row.candidates.length} LABOR cùng tên; chưa thể xác định đúng người.`, action: 'Maximo admin kiểm tra Position và chức danh rota của các hồ sơ trùng tên; sau đó làm mới LABOR.' };
  const crafts = (row.mapping ?? row.candidates[0]).default_crafts;
  if (crafts.length === 0) return { reason: reportedReason ?? 'LABOR chưa có default craft trên Maximo.', action: 'Maximo admin bổ sung default craft trên Maximo; sau đó làm mới LABOR.' };
  if (crafts.length > 1) return { reason: reportedReason ?? `LABOR có nhiều default craft trên Maximo: ${crafts.join(', ')}.`, action: 'Maximo admin kiểm tra và chỉnh default craft trên Maximo; sau đó làm mới LABOR.' };
  if (row.craft && crafts[0] !== row.craft) return { reason: reportedReason ?? `Craft Maximo “${crafts[0]}” không khớp craft rota “${row.craft}”.`, action: 'Maximo admin kiểm tra/cập nhật LABOR và craft trên Maximo; sau đó làm mới LABOR.' };
  if (!row.mapping) return { reason: reportedReason ?? 'Chưa có mapping LABOR được xác nhận trong snapshot.', action: 'Maximo admin kiểm tra LABOR và Position trên Maximo; sau đó làm mới LABOR.' };
  return null;
}

export function RotaImports({ active = true }: { active?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pools, setPools] = useState<ResourcePool[]>([]);
  const [poolId, setPoolId] = useState('');
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [preview, setPreview] = useState<RotaPreview | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState('ROTA_2026');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [laborRefreshError, setLaborRefreshError] = useState('');
  const [authError, setAuthError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activationResetToken, setActivationResetToken] = useState(0);
  const poolRef = useRef('');
  const currentUserRef = useRef('');
  const permissionRef = useRef('');
  const restoreControllerRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const selectedPool = pools.find(pool => pool.id === poolId) ?? null;

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let controller = new AbortController();
    const verify = async () => {
      controller.abort(); controller = new AbortController();
      const signal = controller.signal;
      setAuthError('');
      try {
        const auth = await getAuthSummary(signal);
        if (disposed || signal.aborted) return;
        if (!auth.session) {
          operationRef.current += 1; restoreControllerRef.current?.abort(); setBusy('');
          setSession(null); setPools([]); setPoolId(''); setImports([]); setPreview(null); currentUserRef.current = ''; permissionRef.current = '';
          setAuthError('Đăng nhập để xem các resource pool được cấp quyền.'); return;
        }
        const availablePools = await listResourcePools(signal);
        if (disposed || signal.aborted) return;
        const permissions = availablePools.map(pool => `${pool.id}:${pool.capability}`).sort().join('|');
        const identityChanged = currentUserRef.current && currentUserRef.current !== auth.session.user.id;
        const accessChanged = permissionRef.current && permissionRef.current !== permissions;
        if (identityChanged || accessChanged) {
          operationRef.current += 1; restoreControllerRef.current?.abort(); setBusy('');
          setPreview(null); setImports([]); setSelectedMonth(''); setFile(null);
        }
        currentUserRef.current = auth.session.user.id;
        permissionRef.current = permissions;
        setSession(auth.session); setPools(availablePools);
        const stillAllowed = availablePools.some(pool => pool.id === poolRef.current);
        const nextPoolId = stillAllowed && !identityChanged && !accessChanged ? poolRef.current : availablePools[0]?.id ?? '';
        if (nextPoolId !== poolRef.current) {
          poolRef.current = nextPoolId; setPoolId(nextPoolId); setPreview(null); setImports([]); setSelectedMonth('');
        }
        if (availablePools.length === 0) {
          setPoolId(''); poolRef.current = ''; setPreview(null); setImports([]);
        }
      } catch (reason) {
        if (disposed || signal.aborted) return;
        operationRef.current += 1; restoreControllerRef.current?.abort(); setBusy('');
        setSession(null); setPools([]); setPoolId(''); poolRef.current = ''; setImports([]); setPreview(null);
        setAuthError(errorMessage(reason));
      }
    };
    void verify();
    const onVisibility = () => { if (document.visibilityState === 'visible') void verify(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { disposed = true; controller.abort(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [active, reloadKey]);

  useEffect(() => {
    if (!active || !session || !poolId) return;
    const controller = new AbortController();
    void listRotaImports(poolId, controller.signal).then(items => {
      if (controller.signal.aborted) return;
      setImports(items);
      const retained = preview?.pool_id === poolId ? items.find(item => item.id === preview.id) : undefined;
      if (retained && retained.version === preview?.version && retained.status === preview.status) return;
      const restoreItem = retained ?? items[0];
      if (!restoreItem) { setPreview(null); setSelectedMonth(''); return; }
      if (!controller.signal.aborted) setBusy('restore');
      return getRotaImport(restoreItem.id, poolId, controller.signal).then(saved => {
        if (!controller.signal.aborted && poolRef.current === poolId) {
          setPreview(saved); setSelectedMonth(dateMonth(saved.coverage_from ?? '') || dateMonth(saved.rows.flatMap(row => row.days).map(day => day.date).sort()[0] ?? ''));
        }
      });
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setPreview(null); setError(errorMessage(reason));
        if (reason instanceof RotaImportError && [401, 403, 404].includes(reason.status)) setReloadKey(key => key + 1);
      }
    }).finally(() => { if (!controller.signal.aborted) setBusy(''); });
    return () => controller.abort();
    // Preview is intentionally read only to avoid refetching the stage after each mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session?.user.id, poolId]);

  const months = useMemo(() => [...new Set((preview?.rows ?? []).flatMap(row => row.days.map(day => dateMonth(day.date))).filter(Boolean))].sort(), [preview]);
  const daysInMonth = useMemo(() => {
    const days = new Map<string, string>();
    for (const row of preview?.rows ?? []) for (const day of row.days) if (dateMonth(day.date) === selectedMonth) days.set(day.date, day.code);
    return [...days.keys()].sort();
  }, [preview, selectedMonth]);

  const choosePool = (next: string) => {
    operationRef.current += 1;
    restoreControllerRef.current?.abort();
    setBusy('');
    poolRef.current = next; setPoolId(next); setPreview(null); setImports([]); setSelectedMonth(''); setFile(null); setError(''); setStatus(''); setLaborRefreshError('');
  };
  const installPreview = (next: RotaPreview) => {
    if (next.pool_id !== poolRef.current) return;
    setPreview(next); setImports(items => [next, ...items.filter(item => item.id !== next.id)]);
    const firstMonth = dateMonth(next.coverage_from ?? '') || dateMonth(next.rows.flatMap(row => row.days).map(day => day.date).sort()[0] ?? '');
    setSelectedMonth(current => current && next.rows.some(row => row.days.some(day => dateMonth(day.date) === current)) ? current : firstMonth);
  };
  const runMutation = async (label: string, action: (signal: AbortSignal) => Promise<RotaPreview>) => {
    if (!preview || !selectedPool || selectedPool.capability !== 'write') return;
    const operation = ++operationRef.current;
    const targetPool = poolId; const targetUser = session?.user.id; const controller = new AbortController();
    setActivationResetToken(token => token + 1); setBusy(label); setError(''); setStatus('');
    if (label === 'refresh') setLaborRefreshError('');
    try {
      const next = await action(controller.signal);
      if (operationRef.current !== operation || poolRef.current !== targetPool || currentUserRef.current !== targetUser) return;
      if (label === 'refresh') setLaborRefreshError('');
      installPreview(next); setStatus(label === 'refresh'
        ? next.labor_error ? 'Đã lưu kết quả kiểm tra; chưa lấy được snapshot LABOR mới.' : 'Đã cập nhật snapshot LABOR và tính lại preview.'
        : 'Đã hủy phiên staging.');
    } catch (reason) {
      if (operationRef.current !== operation || poolRef.current !== targetPool || currentUserRef.current !== targetUser) return;
      setError(errorMessage(reason));
      if (label === 'refresh') setLaborRefreshError(errorMessage(reason));
      if (reason instanceof RotaImportError && [401, 403, 404].includes(reason.status)) {
        setPreview(null); setImports([]); setReloadKey(key => key + 1);
      }
    } finally { if (operationRef.current === operation) setBusy(''); }
  };
  const submitFile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !selectedPool || selectedPool.capability !== 'write') return;
    if (!ALLOWED_FILE.test(file.name)) { setError('Chỉ nhận file .xlsx hoặc .ods.'); return; }
    if (file.size > MAX_FILE_BYTES) { setError('File vượt giới hạn 8 MB.'); return; }
    const operation = ++operationRef.current;
    const targetPool = poolId; const targetUser = session?.user.id; const controller = new AbortController();
    setActivationResetToken(token => token + 1); setBusy('upload'); setError(''); setStatus(''); setLaborRefreshError('');
    try {
      const saved = await uploadRotaImport(targetPool, file, sheet, controller.signal);
      if (operationRef.current !== operation || poolRef.current !== targetPool || currentUserRef.current !== targetUser) return;
      installPreview(saved); setStatus(saved.labor_error ? 'Đã lưu file và phiên staging; snapshot LABOR chưa làm mới được. Có thể làm mới LABOR khi kết nối sẵn sàng.' : 'Đã lưu file và phiên staging. Xem báo cáo lỗi LABOR/craft bên dưới; Maximo admin xử lý trên Maximo rồi làm mới LABOR.');
      setFile(null);
      const input = document.getElementById('rota-file') as HTMLInputElement | null; if (input) input.value = '';
    } catch (reason) {
      if (operationRef.current !== operation || poolRef.current !== targetPool || currentUserRef.current !== targetUser) return;
      setError(`${errorMessage(reason)} Nếu kết quả upload chưa rõ, kiểm tra danh sách phiên đã lưu trước khi gửi lại.`);
      if (reason instanceof RotaImportError && [401, 403, 404].includes(reason.status)) { setPreview(null); setImports([]); setReloadKey(key => key + 1); }
    } finally { if (operationRef.current === operation) setBusy(''); }
  };
  const restore = async (item: ImportSummary) => {
    if (!poolId) return;
    restoreControllerRef.current?.abort();
    const operation = ++operationRef.current;
    const targetPool = poolId; const controller = new AbortController(); restoreControllerRef.current = controller; setActivationResetToken(token => token + 1); setBusy('restore'); setError(''); setLaborRefreshError('');
    try {
      const saved = await getRotaImport(item.id, targetPool, controller.signal);
      if (operationRef.current !== operation || poolRef.current !== targetPool) return;
      installPreview(saved); setStatus('Đã mở phiên staging đã lưu.');
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (operationRef.current !== operation || poolRef.current !== targetPool) return;
      setPreview(null); setError(errorMessage(reason));
      if (reason instanceof RotaImportError && [401, 403, 404].includes(reason.status)) setReloadKey(key => key + 1);
    } finally { if (restoreControllerRef.current === controller) restoreControllerRef.current = null; if (operationRef.current === operation && !controller.signal.aborted) setBusy(''); }
  };
  const laborProblems = preview?.labor_snapshot_at ? (preview.rows.map(row => ({ row, problem: laborProblem(row) })).filter((entry): entry is { row: RotaRow; problem: { reason: string; action: string } } => entry.problem !== null)) : [];
  const laborSnapshotStale = Boolean(preview?.labor_error || laborRefreshError);

  if (!active) return null;
  return <section className={styles.page} aria-labelledby="rota-imports-title">
    <header className={styles.header}><div><p className={styles.eyebrow}>ROTA / POSTGRESQL STAGING</p><h1 id="rota-imports-title">Import rota</h1>
      <p>Tải rota lên để đối chiếu LABOR qua REST và xem các vấn đề cần Maximo admin xử lý.</p></div><span className={preview?.status === 'activated' ? styles.activeBadge : styles.badge}>{preview?.status === 'activated' ? 'Roster đã kích hoạt' : 'Đang staging · chưa kích hoạt'}</span></header>
    <div className={styles.notice}><strong>Phiên staging chưa phải roster hoạt động.</strong> Không có thao tác nào ghi lên Maximo. Tên, chức danh, craft và mã ngày lấy từ file nguồn; nếu sai, sửa file rồi upload phiên mới. Working hiển thị 10,5 giờ/ngày; ô trống/known-off là 0, unknown chưa xác định.</div>
    {authError && <div className={styles.card}><p>{authError}</p>{!session && <a href={loginUrl}>Đăng nhập</a>}<button className={styles.button} onClick={() => setReloadKey(key => key + 1)}>Kiểm tra lại phiên</button></div>}
    {session && pools.length === 0 && !authError && <div className={styles.card}><p>Tài khoản chưa có vai trò Planner hoặc Admin cho rota trên resource pool.</p></div>}
    {session && pools.length > 0 && <>
      <section className={styles.card} aria-label="Chọn pool và upload rota">
        <div className={styles.toolbar}>
          <label className={styles.field}>Resource pool
            <select value={poolId} onChange={event => choosePool(event.target.value)} aria-label="Resource pool">
              {pools.map(pool => <option key={pool.id} value={pool.id}>{pool.label} · {pool.connection_label} · {pool.environment} · {pool.orgid}</option>)}
            </select>
          </label>
          <form onSubmit={event => void submitFile(event)} className={styles.toolbar}>
            <label className={styles.field}>File rota (.xlsx / .ods, tối đa 8 MB)
              <input id="rota-file" type="file" accept=".xlsx,.ods" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} disabled={selectedPool?.capability !== 'write' || !!busy} />
            </label>
            <label className={styles.field}>Sheet<input value={sheet} onChange={event => setSheet(event.target.value)} maxLength={80} disabled={selectedPool?.capability !== 'write' || !!busy} /></label>
            <button className={styles.primary} disabled={!file || !sheet.trim() || selectedPool?.capability !== 'write' || !!busy}>{busy === 'upload' ? 'Đang upload…' : 'Upload và tạo staging'}</button>
          </form>
        </div>
        {selectedPool && <dl className={styles.meta}>
          <div><dt>Connection</dt><dd>{selectedPool.connection_label}</dd></div><div><dt>Môi trường</dt><dd>{selectedPool.environment}</dd></div>
          <div><dt>Organization</dt><dd>{selectedPool.orgid}</dd></div><div><dt>Timezone</dt><dd>{selectedPool.timezone}</dd></div>
        </dl>}
        {selectedPool?.capability === 'read' && <p>Pool chỉ có quyền đọc. Upload, refresh LABOR và hủy bị khóa.</p>}
      </section>
      {error && <div role="alert" className={styles.error}>{error} {error.includes('được cập nhật ở nơi khác') && preview && <button className={styles.button} onClick={() => void restore(preview)}>Tải lại phiên đã lưu</button>}</div>}
      {status && <p role="status" className={styles.status}>{status}</p>}
      {imports.length > 0 && <section className={styles.card}><h2>Phiên đã lưu</h2><div className={styles.history}>
        {imports.map(item => <button key={item.id} aria-current={preview?.id === item.id} onClick={() => void restore(item)} disabled={!!busy}>
          <strong>{item.file_name}</strong><small>{item.sheet} · v{item.version} · {new Date(item.created_at).toLocaleString('vi-VN')}</small>
        </button>)}
      </div></section>}
      {preview && selectedPool && preview.pool_id === selectedPool.id && <section className={styles.card} aria-label="Preview staging rota">
        <h2>Preview đã lưu · {preview.file_name}</h2>
        <dl className={styles.meta}>
          <div><dt>Sheet / policy</dt><dd>{preview.sheet} · {preview.policy_version}</dd></div>
          <div><dt>Phạm vi ngày</dt><dd>{preview.coverage_from ?? '—'} đến trước {preview.coverage_before ?? '—'}</dd></div>
          <div><dt>Snapshot LABOR</dt><dd>{preview.labor_snapshot_at ? new Date(preview.labor_snapshot_at).toLocaleString('vi-VN') : 'Chưa có'}</dd></div>
          <div><dt>LABOR ngoài rota</dt><dd>{preview.excluded_labor_count} labor được bỏ qua</dd></div>
        </dl>
        <div className={styles.summary}>
          <span>Người trong rota <b>{preview.summary.rota_people}</b></span><span>Đã map <b>{preview.summary.mapped_people}</b></span>
          <span>Lỗi chặn <b>{preview.summary.blocking_count}</b></span><span title="Giờ tổng gồm cả dòng chưa map và chỉ dùng để tham khảo; chưa phải capacity assignment">Giờ rota tổng · chưa dùng làm capacity assignment <b>{preview.summary.capacity_hours.toLocaleString('vi-VN')} giờ</b></span>
        </div>
        {!!preview.excluded_position_count && <section aria-label="Chức danh không tính Labor" className={styles.report}>
          <h3>Không tính Labor / capacity · {preview.excluded_position_count} dòng</h3>
          <p>Material Controller được loại khỏi số người, giờ rota và danh sách phân công theo policy hiện tại.</p>
          <ul>{preview.excluded_positions?.map(item => <li key={item.source_row}>Dòng {item.source_row} · {item.name} · {item.position}</li>)}</ul>
        </section>}
        {laborRefreshError && <div className={styles.error}>Không làm mới được LABOR: {laborRefreshError}. Phiên staging và snapshot cũ vẫn được giữ; các lỗi bên dưới thuộc snapshot cũ, chưa xác nhận trạng thái Maximo hiện tại.</div>}
        {laborProblems.length > 0 && !preview.labor_error && !laborRefreshError && <section className={styles.report} aria-labelledby="rota-labor-errors-title">
          <h3 id="rota-labor-errors-title">Báo cáo lỗi LABOR / craft · {laborProblems.length} dòng</h3>
          <p>Phiên upload đã được lưu. Không cần sửa mapping trên giao diện. Gửi các dòng này cho Maximo admin xử lý trên Maximo, rồi bấm “Làm mới LABOR” để lấy snapshot mới.</p>
          <div className={styles.reportWrap}><table className={styles.reportTable}><thead><tr><th>Dòng rota</th><th>Craft rota</th><th>LABOR tìm thấy trên Maximo</th><th>Lỗi</th><th>Hướng xử lý</th></tr></thead><tbody>
            {laborProblems.map(({ row, problem }) => <tr key={row.source_row}>
              <td><strong>{row.name}</strong><small>Dòng {row.source_row} · {row.position || 'Chưa có chức danh'}</small></td>
              <td>{row.craft ?? 'Chưa xác định'}</td>
              <td>{row.candidates.length ? <ul className={styles.candidateList}>{row.candidates.map(candidate => <li key={candidate.labor_key}>
                <strong>{candidate.laborcode}</strong> · Person {candidate.personid} · ORG {candidate.orgid}<br />{candidate.displayname}<br />Position: {candidate.title || 'Chưa có trong snapshot'}<br />Default craft: {candidate.default_crafts.length ? candidate.default_crafts.join(', ') : 'CHƯA KHAI BÁO'}
              </li>)}</ul> : <span>Không tìm thấy LABOR trùng tên</span>}</td>
              <td>{problem.reason}</td><td>{problem.action}</td>
            </tr>)}
          </tbody></table></div>
        </section>}
        {laborProblems.length === 0 && !preview.labor_error && !laborRefreshError && <p className={styles.success}>Không có lỗi LABOR/craft cần Maximo admin xử lý.</p>}
        {preview.labor_error && <div className={styles.error}>{preview.labor_snapshot_at ? 'Snapshot LABOR cũ vẫn được giữ, nhưng chưa xác nhận tình trạng Maximo hiện tại.' : 'Chưa có snapshot LABOR cho phiên này.'} {preview.labor_error}</div>}
        {preview.source_errors.length > 0 && <div className={styles.error}><strong>Lỗi dữ liệu nguồn</strong><ul>{preview.source_errors.map((issue, index) => <li key={`${issue.source_row}-${issue.cell}-${index}`}>
          {issue.source_row ? `Dòng ${issue.source_row}` : ''}{issue.cell ? ` · ô ${issue.cell}` : ''}{issue.date ? ` · ${issue.date}` : ''}: {issue.message}
        </li>)}</ul><p>Sửa file rota và upload lại.</p></div>}
        <RotaActivation key={`${preview.pool_id}:${preview.id}:${preview.version}:${preview.status}`} preview={preview} canWrite={selectedPool.capability === 'write'} busy={Boolean(busy)} resetToken={activationResetToken}
          onActivated={() => { void restore(preview); }} onBusyChange={isBusy => { if (isBusy) setBusy('activation'); else setBusy(current => current === 'activation' ? '' : current); }}
          onAccessFailure={() => { setBusy(''); setPreview(null); setImports([]); setReloadKey(key => key + 1); }} />
        <div className={styles.toolbar}>
          <label className={styles.field}>Tháng hiển thị
            <select value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>{months.map(month => <option key={month} value={month}>{monthName(month)}</option>)}</select>
          </label>
          <span className={styles.status}>Đang xem {daysInMonth.length} ngày trong tháng. Ngày hiển thị capacity theo giờ.</span>
        </div>
        <div className={styles.tableWrap}><table><thead><tr><th>Dòng / người / chức danh</th><th>Craft / role</th>
          {daysInMonth.map(date => <th className={styles.day} key={date}>{date.slice(-2)}<small>{new Intl.DateTimeFormat('vi-VN', { weekday:'short', timeZone:'UTC' }).format(new Date(`${date}T00:00:00Z`))}</small></th>)}<th>Lỗi</th></tr></thead>
          <tbody>{preview.rows.map(row => {
            return <tr key={row.source_row}>
              <td className={styles.person}><strong>{row.name}</strong><small>Dòng {row.source_row} · {row.position}</small>{row.mapping && <small>Person {row.mapping.personid} · Position: {row.mapping.title || 'Chưa có trong snapshot'}</small>}</td>
              <td><strong>{row.craft ?? 'Chưa xác định'}</strong><small>{row.role ? roleName[row.role] ?? row.role : 'Role chưa xác định'}</small></td>
              {daysInMonth.map(date => { const day = row.days.find(item => item.date === date); return <td className={styles.day} key={date} title={`${date} · mã rota ${day?.code ?? '—'} · ${day?.capacity_hours === null || !day ? 'chưa rõ' : `${day.capacity_hours} giờ`}`}>
                {day?.capacity_hours === null || !day ? '—' : day.capacity_hours.toLocaleString('vi-VN')}<small>{day?.code || 'trống'}</small>
              </td>; })}
              <td className={styles.issues}>{row.issues.filter(issue => !laborSnapshotStale || !['mapping', 'craft', 'duplicate'].includes(issue.kind)).length ? <ul>{row.issues.filter(issue => !laborSnapshotStale || !['mapping', 'craft', 'duplicate'].includes(issue.kind)).map((issue, index) => <li key={`${issue.kind}-${index}`}>
                {issue.cell ? `${issue.cell}: ` : ''}{issue.date ? `${issue.date}: ` : ''}{issue.message}
              </li>)}</ul> : laborSnapshotStale && row.issues.some(issue => ['mapping', 'craft', 'duplicate'].includes(issue.kind)) ? <span>{preview.labor_snapshot_at ? 'LABOR snapshot cũ · chưa xác minh' : 'LABOR chưa đối chiếu'}</span> : <span className={styles.success}>Không có lỗi</span>}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className={styles.actions}>
          <button className={styles.button} onClick={() => void runMutation('refresh', signal => refreshRotaLabor(preview, signal))} disabled={selectedPool.capability !== 'write' || !!busy || preview.status !== 'staged'}>
            {busy === 'refresh' ? 'Đang đọc LABOR…' : 'Làm mới LABOR'}
          </button>
          <button className={styles.button} onClick={() => void runMutation('cancel', signal => cancelRotaImport(preview, signal))} disabled={selectedPool.capability !== 'write' || !!busy || preview.status !== 'staged'}>
            {busy === 'cancel' ? 'Đang hủy…' : preview.status !== 'staged' ? 'Phiên không còn ở staging' : 'Hủy phiên staging'}
          </button>
        </div>
      </section>}
    </>}
  </section>;
}

export default RotaImports;
