import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, type Session } from '../api/client';
import { getAdminRoster, savePlannerPermission, type AdminRoster, type Permission } from '../api/admin';
import { RetrievalError } from '../api/workOrders';
import styles from '../App.module.css';

function permissionKey(value: Permission) { return JSON.stringify([value.user_id, value.connection_id, value.discipline]); }

export function AdminLink() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let controller = new AbortController();
    const refresh = () => {
      controller.abort(); controller = new AbortController();
      const current = controller;
      getAuthSummary(current.signal).then(({ session }) => { if (!current.signal.aborted) setVisible(session?.user.is_admin === true); })
        .catch(() => { if (!current.signal.aborted) setVisible(false); });
    };
    refresh();
    const visibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return visible ? <Link to="/admin">Admin</Link> : null;
}

export function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [roster, setRoster] = useState<AdminRoster | null>(null);
  const [authorizationReady, setAuthorizationReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [userId, setUserId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState(0);
  const active = useRef<AbortController | null>(null);
  const pending = useRef<AbortController | null>(null);
  const identity = useRef<string | null>(null);
  function clearSelection() { setUserId(''); setConnectionId(''); setDiscipline(''); setReason(''); setNotice(''); }

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setAuthorizationReady(false); setRoster(null); setError('');
    try {
      const auth = await getAuthSummary(signal);
      if (signal.aborted) return;
      const current = auth.session;
      const nextIdentity = current ? `${current.user.id}:${current.user.is_admin}` : null;
      if (identity.current !== nextIdentity) { setRoster(null); clearSelection(); identity.current = nextIdentity; }
      setSession(current);
      if (!current) { setRoster(null); clearSelection(); setError('Đăng nhập để tiếp tục.'); return; }
      if (!current.user.is_admin) { setRoster(null); clearSelection(); setError('Tài khoản này không có quyền quản trị.'); return; }
      const data = await getAdminRoster(signal);
      if (!signal.aborted) { setRoster(data); setAuthorizationReady(true); setError(''); }
    } catch (cause) {
      if (!signal.aborted) {
        // A failed session recheck cannot safely leave private account records on screen.
        setRoster(null); setSession(null); setAuthorizationReady(false); identity.current = null; clearSelection();
        setError(cause instanceof Error ? cause.message : 'Không tải được danh sách quản trị.');
      }
    } finally { if (!signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) return;
      active.current?.abort();
      const controller = new AbortController(); active.current = controller;
      void load(controller.signal);
    };
    refresh();
    const visibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { active.current?.abort(); pending.current?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [attempt, load]);

  const chosenUser = roster?.users.find((user) => user.id === userId);
  const chosenConnection = roster?.connections.find((connection) => connection.id === connectionId);
  const assignment = roster?.permissions.some((item) => permissionKey(item) === permissionKey({ user_id: userId, connection_id: connectionId, discipline })) ?? false;
  const canRevoke = Boolean(authorizationReady && !loading && session?.user.is_admin && chosenUser && discipline && reason.trim() && !busy && assignment);
  const canGrant = Boolean(authorizationReady && !loading && session?.user.is_admin && chosenUser?.active && chosenConnection?.enabled &&
    chosenConnection.disciplines.includes(discipline) && reason.trim() && !busy && !assignment);

  async function change(enabled: boolean) {
    if (!(enabled ? canGrant : canRevoke) || !roster) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setAuthorizationReady(false); setError(''); setNotice('');
    let authorizationVerified = false;
    let saveConfirmed = false;
    try {
      const auth = await getAuthSummary(controller.signal);
      if (!auth.session?.user.is_admin || auth.session.user.id !== session?.user.id) {
        setRoster(null); setSession(null); identity.current = null; clearSelection();
        throw new RetrievalError(auth.session ? 403 : 401, 'Phiên hoặc quyền quản trị đã thay đổi.');
      }
      authorizationVerified = true;
      await savePlannerPermission({ user_id: userId, connection_id: connectionId, discipline, enabled, reason: reason.trim() }, controller.signal);
      if (controller.signal.aborted) return;
      saveConfirmed = true;
      setNotice(enabled ? 'Đã gửi yêu cầu cấp quyền. Đang tải lại trạng thái…' : 'Đã gửi yêu cầu thu hồi quyền. Đang tải lại trạng thái…');
      const updated = await getAdminRoster(controller.signal);
      if (controller.signal.aborted) return;
      setRoster(updated); setAuthorizationReady(true); setNotice(enabled ? 'Đã cấp quyền và xác nhận trạng thái mới.' : 'Đã thu hồi quyền và xác nhận trạng thái mới.');
      setReason('');
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (!authorizationVerified) { setRoster(null); setSession(null); setAuthorizationReady(false); identity.current = null; clearSelection(); }
        if (cause instanceof RetrievalError && [401, 403].includes(cause.status)) {
          setRoster(null); setSession(null); setAuthorizationReady(false); identity.current = null; clearSelection();
        } else if (saveConfirmed) {
          setRoster(null); setAuthorizationReady(false);
          setNotice('Đã lưu quyền nhưng chưa xác nhận được danh sách mới. Tải lại trước khi tiếp tục.');
        } else if (authorizationVerified) {
          try {
            const current = await getAdminRoster(controller.signal);
            if (!controller.signal.aborted) { setRoster(current); setAuthorizationReady(true); }
          } catch {
            if (!controller.signal.aborted) { setRoster(null); setAuthorizationReady(false); }
          }
        }
        setError(cause instanceof Error ? cause.message : 'Chưa xác nhận được kết quả. Tải lại danh sách trước khi thử lại.');
      }
    } finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }

  return <>
    <Link to="/work-orders" className={styles.back}>← Work Orders</Link>
    <div className={styles.pageTitle}><h1>Quản trị Planner</h1>
      <button disabled={loading || busy} onClick={() => setAttempt((value) => value + 1)}>Tải lại danh sách</button></div>
    {loading && <p role="status">Đang xác minh phiên và tải roster…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {authorizationReady && roster && session?.user.is_admin && <>
      <section className={styles.settingsSection}>
        <h2>Quyền Planner</h2>
        <p>Chọn tài khoản, kết nối và discipline đã cấu hình. Discipline tự lấy từ roster; mỗi thay đổi cần lý do kiểm toán.</p>
        <fieldset disabled={busy} className={styles.adminForm}><legend>Phạm vi quyền</legend>
          <label>Tài khoản
            <select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Chọn tài khoản</option>
              {roster.users.map((user) => <option key={user.id} value={user.id}>{user.display_name}{user.active ? '' : ' · inactive'}{user.is_admin ? ' · admin' : ''}</option>)}</select>
          </label>
          <label>Kết nối
            <select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setDiscipline(''); }}><option value="">Chọn kết nối</option>
              {roster.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label} · {connection.system} · {connection.environment}{connection.enabled ? '' : ' · disabled'}</option>)}</select>
          </label>
          <label>Discipline
            <select value={discipline} onChange={(event) => setDiscipline(event.target.value)}><option value="">Chọn discipline</option>
              {[...new Set([...(chosenConnection?.disciplines ?? []), ...roster.permissions.filter((p) => p.user_id === userId && p.connection_id === connectionId).map((p) => p.discipline)])].sort().map((item) => <option key={item} value={item}>{item}</option>)}</select>
          </label>
          <label>Lý do
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required rows={3} placeholder="Nêu lý do cấp hoặc thu hồi quyền" />
          </label>
          <p aria-live="polite">{assignment ? 'Đã gán quyền Planner cho phạm vi này.' : 'Chưa gán quyền Planner cho phạm vi này.'}
            {' '}{roster.grants.filter((grant) => permissionKey(grant) === permissionKey({ user_id: userId, connection_id: connectionId, discipline })).map((grant) => `Quyền hiệu lực gần nhất (cache): ${grant.capability}`).join(' · ') || 'Chưa có quyền hiệu lực được ghi nhận.'}</p>
          <div className={styles.adminActions}>
            <button className={styles.primary} disabled={!canGrant} onClick={() => void change(true)}>{busy ? 'Đang lưu…' : 'Cấp quyền'}</button>
            <button disabled={!canRevoke} onClick={() => void change(false)}>Thu hồi quyền</button>
          </div>
        </fieldset>
      </section>
      <section className={styles.adminRoster} aria-label="Danh sách quản trị">
        <h2>Danh sách tài khoản</h2><p>Quyền hiệu lực là trạng thái lưu gần nhất; lần xác minh PERSON tiếp theo có thể thay đổi phạm vi.</p><div className={styles.tableWrap}><table><thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Quyền Planner đã gán</th><th>Quyền hiệu lực gần nhất</th></tr></thead>
          <tbody>{roster.users.map((user) => <tr key={user.id}><th scope="row">{user.display_name}<small>{user.tenant_id} · {user.object_id}</small></th>
            <td>{user.active ? 'Active' : 'Inactive'}{user.is_admin ? ' · Admin' : ''}</td>
            <td>{roster.permissions.filter((p) => p.user_id === user.id).map((p) => `${roster.connections.find((c) => c.id === p.connection_id)?.label ?? p.connection_id} · ${p.discipline}`).join(', ') || '—'}</td>
            <td>{roster.grants.filter((g) => g.user_id === user.id).map((g) => `${roster.connections.find((c) => c.id === g.connection_id)?.label ?? g.connection_id} · ${g.discipline} · ${g.capability}`).join(', ') || '—'}</td>
          </tr>)}</tbody></table></div>
      </section>
    </>}
  </>;
}
