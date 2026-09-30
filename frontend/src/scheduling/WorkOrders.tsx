import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, loginUrl, type Session } from '../api/client';
import { columns, RetrievalError, retrieveWorkOrders, type WorkOrder } from '../api/workOrders';
import styles from '../App.module.css';

export function WorkOrders() {
  const [session, setSession] = useState<Session | null>(null);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [scope, setScope] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const grant = session?.grants.find((item) => JSON.stringify([item.connection_id, item.discipline]) === scope);

  function clearResults() {
    pending.current?.abort();
    pending.current = null;
    setRows(null);
    setBusy(false);
    setError('');
  }
  useEffect(() => {
    let authRequest: AbortController | null = null;
    function refresh() {
      authRequest?.abort();
      clearResults();
      setSession(null);
      setScope('');
      setChecking(true);
      authRequest = new AbortController();
      const signal = authRequest.signal;
      getAuthSummary(signal).then((auth) => {
        if (!signal.aborted) { setSession(auth.session); setAvailable(auth.available); }
      }).catch(() => { if (!signal.aborted) setError('Không kiểm tra được quyền truy cập.'); })
        .finally(() => { if (!signal.aborted) setChecking(false); });
    }
    function visibility() {
      if (document.hidden) {
        authRequest?.abort(); clearResults(); setSession(null); setChecking(true);
      } else refresh();
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => { if (!pending.current) refresh(); }, 60000);
    return () => {
      authRequest?.abort(); pending.current?.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  async function retrieve() {
    if (!grant) return;
    clearResults();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const items = await retrieveWorkOrders({ connection_id: grant.connection_id, discipline: grant.discipline,
        target_from: start.trim(), target_before: end.trim() }, controller.signal);
      if (!controller.signal.aborted && pending.current === controller) setRows(items);
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller) {
        setError(cause instanceof Error ? cause.message : 'Không lấy được dữ liệu.');
        if (cause instanceof RetrievalError && [401, 404].includes(cause.status)) {
          setSession(null); setScope('');
        }
      }
    } finally {
      if (!controller.signal.aborted && pending.current === controller) {
        pending.current = null; setBusy(false);
      }
    }
  }

  return <>
    <Link to="/" className={styles.back}>← Tổng quan</Link>
    <div className={styles.pageTitle}><h1>Work Orders</h1><span className={styles.badge}>Chỉ đọc</span></div>
    <p className={styles.notice}>Dữ liệu lấy qua API theo quyền được cấp. Chức năng sửa, lưu nháp và upload chưa mở trên bảng này.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {checking ? <p role="status">Đang kiểm tra quyền truy cập…</p> : !session ? <p>
      Cần đăng nhập để xem WO. {available && <a href={loginUrl}>Đăng nhập Microsoft</a>}
    </p> : session.grants.length === 0 ? <p>Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.</p> : <>
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void retrieve(); }}>
        <label>Hệ thống / Discipline<select required aria-label="Hệ thống / Discipline" value={scope}
          onChange={(event) => { clearResults(); setScope(event.target.value); }}>
          <option value="">Chọn phạm vi được cấp quyền</option>
          {session.grants.map((item) => {
            const key = JSON.stringify([item.connection_id, item.discipline]);
            return <option key={key} value={key}>{item.label} · {item.system} · {item.environment} · {item.discipline}</option>;
          })}
        </select></label>
        <label>Target Finish từ<input required value={start} placeholder="2026-09-01T00:00:00+07:00"
          onChange={(event) => { clearResults(); setStart(event.target.value); }} /></label>
        <label>Target Finish trước<input required value={end} placeholder="2026-10-01T00:00:00+07:00"
          onChange={(event) => { clearResults(); setEnd(event.target.value); }} /></label>
        <button className={styles.primary} disabled={!grant || busy}>{busy ? 'Đang lấy WO…' : 'Retrieve WO'}</button>
      </form>
      <p className={styles.tableHint}>Nhập ngày giờ ISO có múi giờ đã xác nhận; mốc cuối không bao gồm. Ngày trong bảng giữ nguyên offset từ Maximo. Bảng được xóa khi kiểm tra lại quyền mỗi phút hoặc khi quay lại cửa sổ.</p>
      {grant && <p>{grant.label} · {grant.system} · {grant.environment} / {grant.discipline}</p>}
      {busy && <p role="status">Đang lấy và kiểm tra đầy đủ các trang dữ liệu…</p>}
      {rows !== null && <>
        <p role="status">{rows.length === 0 ? 'Không có WO trong phạm vi và khoảng ngày đã chọn.' : `${rows.length} WO đã lấy đầy đủ.`}</p>
        {rows.length > 0 && <div className={`${styles.tableWrap} ${styles.schedulerTable}`} tabIndex={0} role="region" aria-label="WO từ Maximo">
          <table><thead><tr>{columns.map(([field, title]) => <th scope="col" key={field}>{title}</th>)}
            <th scope="col">Upload?</th><th scope="col">Change Target?</th><th scope="col">Site</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={JSON.stringify([scope, row.siteid, row.workorderid])}>
              {columns.map(([field]) => <td key={field} className={field === 'description' ? styles.descriptionCell : undefined}>
                {field === 'status' ? <span className={styles.statusBadge} data-status={row.status}>{row.status}</span> :
                  field === 'wolo10' ? (row.wolo10 === null ? '—' : `${row.wolo10}%`) :
                    field === 'wopriority_description' ? `${row.wopriority_description ?? '—'} (${row.wopriority ?? '—'})` : row[field] ?? '—'}
              </td>)}
              <td>Chưa mở</td><td>Chưa mở</td><td>{row.siteid}</td>
            </tr>)}</tbody></table>
        </div>}
      </>}
    </>}
  </>;
}
