import { useEffect, useId, useRef, useState } from 'react';
import { createRouteSession, deleteRouteSession, getRouteSubmission, previewRoute, reconcileRoute, RouteApiError, routeWorkOrders,
  type PreviewItem, type RouteResult, type RouteResultItem, type RouteScope, type RouteStatus } from '../api/workflowRoute';
import type { WorkOrder } from '../api/workOrders';
import styles from '../App.module.css';
import { allConfirmed, reasonText, resultDetail, STATE_TEXT, SUMMARY_NEEDS_ATTENTION } from './routeRules';

type Stage = 'checking' | 'locked' | 'none' | 'login' | 'confirm' | 'running' | 'done' | 'unsure' | 'error';
const targetOf = (row: WorkOrder) => ({ site_id: row.siteid, workorder_id: row.workorderid });
const keyOf = (item: { site_id: string; workorder_id: string }) => JSON.stringify([item.site_id, item.workorder_id]);

/**
 * Route the given WOs to their Tech PIC: re-check on the server, ask for the position account's password only
 * when the server holds no session, confirm, run, and show a per-WO outcome. The password lives only in this
 * form's state until the request is sent; it is cleared right after, whatever the answer.
 */
export function RoutePanel({ scope, status, rows, onSession, onResult, onClose, onDenied }: {
  scope: RouteScope; status: RouteStatus; rows: WorkOrder[];
  onSession: (session: RouteStatus['session']) => void;
  onResult: (items: RouteResultItem[]) => void; onClose: () => void; onDenied: () => void;
}) {
  const [stage, setStage] = useState<Stage>('checking');
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const requestId = useRef('');
  const titleId = useId(); const bodyId = useId();
  const dialog = useRef<HTMLElement>(null);
  const wonumOf = new Map(rows.map((row) => [keyOf(targetOf(row)), row.wonum]));
  const label = (item: { site_id: string; workorder_id: string; wonum: string | null }) => item.wonum ?? wonumOf.get(keyOf(item)) ?? item.workorder_id;
  const ready = preview.filter((item) => item.ready);

  function fail(cause: unknown, fallback: string) {
    if (cause instanceof RouteApiError && (cause.status === 401 || cause.status === 404)) { onDenied(); return; }
    setMessage(cause instanceof Error ? cause.message : fallback);
  }

  useEffect(() => {
    const controller = new AbortController();
    previewRoute(scope, rows.map(targetOf), controller.signal).then((value) => {
      setPreview(value.items);
      if (!value.contract.ok) setStage('locked');
      else if (!value.items.some((item) => item.ready)) setStage('none');
      else setStage(status.session.active ? 'confirm' : 'login');
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { fail(cause, 'Không kiểm tra được WO.'); setStage('error'); } });
    return () => controller.abort();
    // The check runs once per opening; rows and scope are fixed for the lifetime of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { dialog.current?.focus(); }, [stage]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !status.personid || !password) return;
    const typed = password;
    setPassword(''); setBusy(true); setMessage('');
    try {
      const session = await createRouteSession(scope, status.personid, typed, new AbortController().signal);
      onSession(session); setStage('confirm');
    } catch (cause) {
      if (cause instanceof RouteApiError && cause.code === 'maximo_login_failed') {
        const left = cause.extra.remaining_attempts;
        setMessage(`Sai mật khẩu của ${status.personid}.${left === undefined ? '' : ` Còn ${left} lần thử trước khi bị khóa tạm thời.`}`);
      } else if (cause instanceof RouteApiError && cause.code === 'login_rate_limited') {
        setMessage(`Đã thử sai quá nhiều lần. Thử lại sau ${Math.ceil((cause.extra.retry_after_seconds ?? 60) / 60)} phút.`);
      } else if (cause instanceof RouteApiError && cause.code === 'maximo_unavailable') setMessage('Không kết nối được Maximo. Mật khẩu chưa bị tính là sai; thử lại.');
      else if (cause instanceof RouteApiError && cause.code === 'workflow_route_disabled') { setMessage('Tính năng route đang tắt cho kết nối này.'); setStage('error'); }
      else fail(cause, 'Không đăng nhập được tài khoản route.');
    } finally { setBusy(false); }
  }

  async function forget() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      await deleteRouteSession(scope, new AbortController().signal);
      onSession({ active: false, expires_at: null }); setStage('login');
    } catch (cause) { fail(cause, 'Chưa quên được phiên tài khoản route.'); } finally { setBusy(false); }
  }

  async function run() {
    if (busy || !ready.length) return;
    requestId.current = crypto.randomUUID();
    setBusy(true); setMessage(''); setStage('running');
    try {
      const value = await routeWorkOrders(scope, requestId.current, ready.map(({ site_id, workorder_id }) => ({ site_id, workorder_id })), new AbortController().signal);
      setResult(value); onResult(value.items); setStage('done');
    } catch (cause) {
      if (cause instanceof RouteApiError && cause.code === 'route_session_required') { onSession({ active: false, expires_at: null }); setMessage('Phiên tài khoản route đã hết. Nhập lại mật khẩu.'); setStage('login'); }
      else if (cause instanceof RouteApiError && cause.code === 'workflow_contract_changed') setStage('locked');
      else if (cause instanceof RouteApiError && cause.code === 'route_account_busy') { setMessage('Đang có lần route khác dùng tài khoản này. Thử lại sau ít giây.'); setStage('confirm'); }
      else if (cause instanceof RouteApiError && (cause.status === 401 || cause.status === 404)) onDenied();
      else if (cause instanceof RouteApiError && cause.code === 'request_id_conflict') { setMessage('Yêu cầu bị trùng mã. Thử lại.'); setStage('confirm'); }
      else { setMessage('Mất kết nối khi route. Kết quả chưa rõ; bấm Kiểm tra lại, không route lại.'); setStage('unsure'); }
    } finally { setBusy(false); }
  }

  async function recheck(reconcile: boolean) {
    if (busy || !requestId.current) return;
    setBusy(true); setMessage('');
    try {
      const signal = new AbortController().signal;
      const value = reconcile ? await reconcileRoute(requestId.current, signal) : await getRouteSubmission(requestId.current, signal);
      setResult(value); onResult(value.items); setStage('done');
    } catch (cause) {
      if (cause instanceof RouteApiError && cause.code === 'receipt_not_found') setMessage('Chưa thấy kết quả. Có thể yêu cầu vẫn đang chạy; thử lại sau ít giây.');
      else fail(cause, 'Chưa kiểm tra được kết quả.');
    } finally { setBusy(false); }
  }

  const notReady = preview.filter((item) => !item.ready);
  const locked = busy && stage === 'running';
  return <div className={styles.confirmOverlay}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
    className={`${styles.confirmDialog} ${styles.routeDialog}`} onKeyDown={(event) => { if (event.key === 'Escape' && !locked) onClose(); }}>
    <h2 id={titleId}>Route WO đến PIC thực hiện</h2>
    <p id={bodyId} className={styles.routeIntro}>Route giao việc cho PIC của từng WO qua workflow Maximo. Ứng dụng không hoàn tác được.</p>
    {message && <p role="alert" className={styles.error}>{message}</p>}

    {stage === 'checking' && <p role="status">Đang kiểm tra WO với Maximo…</p>}
    {stage === 'locked' && <p role="alert" className={styles.error}>Workflow BD_WO trên Maximo đã khác với bản đã kiểm chứng nên tính năng route đang bị khóa. Báo quản trị viên.</p>}
    {stage === 'none' && <p role="status">Không có WO nào đủ điều kiện route lúc này.</p>}
    {stage === 'error' && !message && <p role="alert" className={styles.error}>Không kiểm tra được WO. Thử lại sau.</p>}

    {(stage === 'login' || stage === 'confirm' || stage === 'none' || stage === 'locked') && notReady.length > 0 && <div>
      <strong>Không route được ({notReady.length})</strong>
      <ul className={styles.routeList}>{notReady.map((item) => <li key={keyOf(item)}>{label(item)}: {reasonText(item.code)}</li>)}</ul>
    </div>}

    {stage === 'login' && <form className={styles.routeLogin} onSubmit={(event) => void login(event)}>
      <p>Sẽ route {ready.length} WO: <strong>{ready.map(label).join(', ')}</strong>.</p>
      <p>Nhập mật khẩu Maximo của tài khoản route <strong>{status.personid}</strong> một lần cho phiên đăng nhập này. Mật khẩu chỉ dùng để route, không được lưu, và tự bỏ khi bạn đăng xuất hoặc hết phiên.</p>
      <label>Tài khoản<input value={status.personid ?? ''} readOnly aria-readonly="true" /></label>
      <label>Mật khẩu<input type="password" value={password} autoComplete="off" autoFocus disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <div className={styles.confirmActions}>
        <button type="button" className={styles.ghost} onClick={onClose}>Hủy</button>
        <button className={styles.primary} disabled={busy || !password}>{busy ? 'Đang kiểm tra…' : 'Đăng nhập'}</button>
      </div>
    </form>}

    {stage === 'confirm' && <>
      <div className={styles.tableWrap}><table className={styles.routeTable}><caption className={styles.srOnly}>WO sẽ được route</caption>
        <thead><tr><th scope="col">WO</th><th scope="col">PIC nhận việc</th><th scope="col">Supervisor</th></tr></thead>
        <tbody>{ready.map((item) => <tr key={keyOf(item)}><td>{label(item)}</td><td>{item.assigned_to ?? '—'}</td>
          <td>{item.supervisor?.current ?? (item.supervisor?.will_set ? <strong className={styles.routeWrites}>{`Sẽ điền ${item.supervisor.will_set}`}</strong> : '—')}</td></tr>)}</tbody></table></div>
      {ready.some((item) => item.supervisor?.will_set) && <p className={styles.routeIntro}>Các giá trị <strong className={styles.routeWrites}>Sẽ điền</strong> được ghi vào WO trên Maximo trước khi route.</p>}
      <div className={styles.confirmActions}>
        <button className={styles.ghost} onClick={() => void forget()} disabled={busy}>Quên phiên tài khoản route</button>
        <button className={styles.ghost} onClick={onClose}>Hủy</button>
        <button className={styles.primary} onClick={() => void run()} disabled={busy}>Route {ready.length} WO</button>
      </div>
    </>}

    {stage === 'running' && <p role="status">Đang route {ready.length} WO, từng WO một. Đừng đóng trang.</p>}

    {stage === 'unsure' && <div className={styles.confirmActions}>
      <button className={styles.primary} onClick={() => void recheck(false)} disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra lại'}</button>
    </div>}

    {stage === 'done' && result && <>
      <p role="status">{allConfirmed(result.items) ? `Đã route ${result.items.length} WO.` : `Có ${result.items.filter((item) => item.state !== 'confirmed').length}/${result.items.length} WO chưa route xong; xem từng dòng.`}</p>
      <div className={styles.tableWrap}><table className={styles.routeTable}><caption className={styles.srOnly}>Kết quả route</caption>
        <thead><tr><th scope="col">WO</th><th scope="col">Kết quả</th><th scope="col">Chi tiết</th></tr></thead>
        <tbody>{result.items.map((item) => <tr key={keyOf(item)} data-tone={STATE_TEXT[item.state].tone}>
          <td>{label(item)}</td><td>{STATE_TEXT[item.state].label}</td><td>{resultDetail(item)}</td></tr>)}</tbody></table></div>
      {SUMMARY_NEEDS_ATTENTION(result.items) && <p role="alert" className={styles.error}>
        {result.items.some((item) => item.state === 'stranded') ? 'WO mất việc cần admin Maximo khởi động lại workflow. ' : ''}
        {result.items.some((item) => item.state === 'unknown') ? 'WO chưa rõ kết quả: bấm Kiểm tra lại (chỉ đọc, không route lại).' : ''}</p>}
      <div className={styles.confirmActions}>
        {result.items.some((item) => item.state === 'unknown') && <button className={styles.tertiary} onClick={() => void recheck(true)} disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra lại'}</button>}
        <button className={styles.primary} onClick={onClose}>Đóng</button>
      </div>
    </>}

    {(stage === 'locked' || stage === 'none' || stage === 'error') && <div className={styles.confirmActions}><button className={styles.primary} onClick={onClose}>Đóng</button></div>}
  </section></div>;
}
