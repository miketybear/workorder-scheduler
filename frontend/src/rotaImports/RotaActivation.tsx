import { useEffect, useRef, useState } from 'react';
import { activateRota, getRotaActivationPreview, type RotaActivationPreview, type RotaActivationReceipt } from '../api/rotaActivation';
import { RotaImportError, type RotaPreview } from '../api/rotaImports';
import styles from './RotaImports.module.css';

const hours = (value: number) => `${value.toLocaleString('vi-VN')} giờ`;
const roleLabel = (value: string) => ({ TECH:'Technician', SUP:'Supervisor', ASST_SUP:'Assistant supervisor', CONTROL_RM_ENGINEER:'Control RM Engineer', MATERIAL_CONTROLLER:'Material Controller' }[value] ?? value);
const dayText = (value: { code: string; capacity_hours: number | null; craft: string | null; role: string | null } | null) => value ?
  `${value.code || 'trống'} · ${value.capacity_hours === null ? 'giờ chưa rõ' : hours(value.capacity_hours)} · ${value.craft ?? 'chưa có craft'} · ${value.role ? roleLabel(value.role) : 'chưa có role'}` : 'Không có trong roster';

interface Props { preview: RotaPreview; canWrite: boolean; busy: boolean; resetToken: number; onActivated: (receipt: RotaActivationReceipt) => void; onAccessFailure: () => void; onBusyChange: (busy: boolean) => void }
export function RotaActivation({ preview, canWrite, busy: parentBusy, resetToken, onActivated, onAccessFailure, onBusyChange }: Props) {
  const [comparison, setComparison] = useState<RotaActivationPreview | null>(null);
  const [acknowledgedFor, setAcknowledgedFor] = useState<number | null>(null);
  const acknowledged = acknowledgedFor === resetToken;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<RotaActivationReceipt | null>(null);
  const [unknown, setUnknown] = useState(false);
  const epoch = useRef(0);
  const onBusyChangeRef = useRef(onBusyChange);
  useEffect(() => { onBusyChangeRef.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => () => { epoch.current += 1; onBusyChangeRef.current(false); }, []);

  const loadComparison = async (reconcile = false) => {
    const current = ++epoch.current;
    const controller = new AbortController();
    setBusy(true); onBusyChange(true); setError(''); setNote('');
    try {
      const result = await getRotaActivationPreview(preview.id, preview.pool_id, controller.signal);
      if (current !== epoch.current) return;
      if (reconcile) {
        if (result.activation_receipt) {
          setReceipt(result.activation_receipt); setComparison(result); setUnknown(false); setAcknowledgedFor(null);
          onActivated(result.activation_receipt); setNote('Đã xác nhận phiên bản kích hoạt đã được lưu.');
        } else { setUnknown(false); setComparison(result); setAcknowledgedFor(null); setNote('Chưa thấy biên nhận kích hoạt. Kiểm tra preview mới; chỉ xác nhận lại sau khi đã đọc thay đổi.'); }
      } else {
        setComparison(result); setAcknowledgedFor(null); setReceipt(result.activation_receipt);
        if (result.activation_receipt) {
          setNote('Phiên này đã được kích hoạt. Đây là biên nhận đã lưu.');
          onActivated(result.activation_receipt);
        }
      }
    } catch (reason) {
      if (current === epoch.current) {
        setError(reason instanceof Error ? reason.message : 'Không tải được preview kích hoạt.');
        if (reason instanceof RotaImportError && [401, 403, 404].includes(reason.status)) onAccessFailure();
      }
    } finally { if (current === epoch.current) { setBusy(false); onBusyChange(false); } }
  };
  const confirm = async () => {
    if (!comparison || !acknowledged || unknown || !comparison.can_activate || !canWrite || parentBusy || busy || preview.status !== 'staged') return;
    const current = ++epoch.current; const controller = new AbortController();
    setBusy(true); onBusyChange(true); setError(''); setNote(''); setUnknown(false);
    try {
      const saved = await activateRota(comparison, true, controller.signal);
      if (current !== epoch.current) return;
      setReceipt(saved); setAcknowledgedFor(null); setNote('Roster đã được kích hoạt và có biên nhận lưu trong PostgreSQL.'); onActivated(saved);
    } catch (reason) {
      if (current !== epoch.current) return;
      setError(reason instanceof Error ? reason.message : 'Không hoàn tất được yêu cầu kích hoạt.'); setAcknowledgedFor(null);
      const status = reason instanceof RotaImportError ? reason.status : 0;
      if (status === 0 || status >= 500) setUnknown(true);
      if (status === 409) setComparison(null);
      if ([401, 403, 404].includes(status)) onAccessFailure();
    } finally { if (current === epoch.current) { setBusy(false); onBusyChange(false); } }
  };

  return <section className={styles.activation} aria-label="Kích hoạt roster">
    <div className={styles.activationHeading}><div><h3>Kích hoạt roster</h3><p>Xem thay đổi trong toàn bộ phạm vi ngày trước khi tạo phiên roster chính thức.</p></div>
      <button className={styles.button} onClick={() => void loadComparison()} disabled={busy || unknown || parentBusy || !canWrite || !['staged','activated'].includes(preview.status)}>
        {busy ? 'Đang tải…' : preview.status === 'activated' ? 'Xem biên nhận kích hoạt' : 'Xem thay đổi để kích hoạt'}
      </button>
    </div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {note && <p role="status" className={styles.status}>{note}</p>}
    {unknown && <div className={styles.error}><strong>Chưa rõ kết quả gửi yêu cầu.</strong> Không gửi lại tự động. Kiểm tra trạng thái đã lưu ở server trước.
      <button className={styles.button} onClick={() => void loadComparison(true)} disabled={busy || parentBusy}>Kiểm tra kết quả kích hoạt</button>
    </div>}
    {comparison && <>
      <dl className={styles.activationMeta}>
        <div><dt>Phạm vi áp dụng</dt><dd>{comparison.coverage_from ?? 'Chưa xác định'} đến trước {comparison.coverage_before ?? 'chưa xác định'}</dd></div>
        <div><dt>Thay roster</dt><dd>{comparison.diff.added_people} thêm · {comparison.diff.removed_people} gỡ · {comparison.diff.changed_people} đổi</dd></div>
        <div><dt>Ngày thay đổi</dt><dd>{comparison.diff.changed_days}</dd></div>
        <div><dt>Tổng giờ</dt><dd>{hours(comparison.diff.before_hours)} → {hours(comparison.diff.after_hours)}</dd></div>
      </dl>
      {/* With a receipt the import is already activated; its "cannot activate again" reasons would read as a failure. */}
      {!(receipt ?? comparison.activation_receipt) && comparison.blocking_reasons.length > 0 && <div className={styles.error}><strong>Chưa thể kích hoạt</strong><ul>{comparison.blocking_reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></div>}
      {comparison.changes.length > 0 ? <div className={styles.activationChanges}><table><thead><tr><th>Người</th><th>Thay đổi</th><th>Craft / role trước</th><th>Craft / role sau</th><th>Giờ trước → sau</th><th>Ngày</th></tr></thead><tbody>
        {comparison.changes.map(change => <tr key={change.person_key}><td><strong>{change.name}</strong></td><td>{change.change_type === 'added' ? 'Thêm' : change.change_type === 'removed' ? 'Gỡ' : 'Thay đổi'}</td>
          <td>{change.before_crafts.join(', ') || '—'}<small>{change.before_roles.map(roleLabel).join(', ') || '—'}</small></td><td>{change.after_crafts.join(', ') || '—'}<small>{change.after_roles.map(roleLabel).join(', ') || '—'}</small></td>
          <td>{hours(change.before_hours)} → {hours(change.after_hours)}</td><td>{change.changed_days}{change.day_changes_truncated ? ' · mẫu ngày bên dưới bị giới hạn' : ''}</td>
        </tr>)}
      </tbody></table>
      {comparison.changes.some(change => change.day_changes.length > 0) && <details className={styles.dayDetails}><summary>Chi tiết mã ngày và giờ theo người</summary>
        {comparison.changes.filter(change => change.day_changes.length > 0).map(change => <div key={change.person_key}><strong>{change.name}</strong><ul>{change.day_changes.map(day => <li key={day.date}>{day.date}: {dayText(day.before)} → {dayText(day.after)}</li>)}</ul>{change.day_changes_truncated && <small>Chỉ hiển thị mẫu ngày do server giới hạn.</small>}</div>)}
      </details>}</div> : !comparison.activation_receipt && <p>Không có thay đổi roster trong phạm vi này.</p>}
      {(receipt ?? comparison.activation_receipt) && <ActivationReceipt receipt={(receipt ?? comparison.activation_receipt)!} />}
      {!comparison.activation_receipt && preview.status === 'staged' && <>
        <label className={styles.activationAck}><input type="checkbox" checked={acknowledged} disabled={unknown || !comparison.can_activate || !canWrite || parentBusy || busy}
          onChange={event => setAcknowledgedFor(event.target.checked ? resetToken : null)} /> Tôi xác nhận thay thế toàn bộ roster hiện hành trong khoảng {comparison.coverage_from ?? 'chưa xác định'} đến trước {comparison.coverage_before ?? 'chưa xác định'}. Lịch và giờ rota ngoài khoảng này được giữ nguyên.</label>
        <button className={styles.primary} onClick={() => void confirm()} disabled={unknown || !comparison.can_activate || !acknowledged || !canWrite || parentBusy || busy}>
          {busy ? 'Đang kích hoạt…' : 'Xác nhận kích hoạt roster'}
        </button>
      </>}
    </>}
  </section>;
}

function ActivationReceipt({ receipt }: { receipt: RotaActivationReceipt }) {
  return <div className={styles.activationReceipt} role="status"><strong>Roster đã kích hoạt</strong><dl>
    <div><dt>Thời điểm</dt><dd>{new Date(receipt.activated_at).toLocaleString('vi-VN')}</dd></div><div><dt>Phạm vi</dt><dd>{receipt.coverage_from} đến trước {receipt.coverage_before}</dd></div>
    <div><dt>Số người</dt><dd>{receipt.person_count.toLocaleString('vi-VN')}</dd></div><div><dt>Bản ghi người/ngày</dt><dd>{receipt.day_count.toLocaleString('vi-VN')}</dd></div><div><dt>Tổng giờ</dt><dd>{hours(receipt.total_hours)}</dd></div><div><dt>Mã biên nhận</dt><dd>{receipt.id}</dd></div>
  </dl><p>Mỗi bản ghi tương ứng một người trong một ngày, gồm cả ngày làm việc, ngày nghỉ và ô trống; không phải số ngày công.</p></div>;
}
