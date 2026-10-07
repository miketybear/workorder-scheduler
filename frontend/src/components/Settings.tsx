import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loginUrl } from '../api/client';
import { getConnectionSettings, saveConnectionSetting, type ConnectionSettings } from '../api/settings';
import { RetrievalError } from '../api/workOrders';
import { activeGrant } from '../auth/activeGrant';
import styles from '../App.module.css';

export function Settings() {
  const [data, setData] = useState<ConnectionSettings | null>(null);
  const [choice, setChoice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pendingSave = useRef<AbortController | null>(null);
  const previous = useRef<ConnectionSettings | null>(null);
  useEffect(() => {
    let controller = new AbortController();
    function load() {
      if (pendingSave.current) return;
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setLoading(true); setError(''); setSignedOut(false);
      getConnectionSettings(signal).then((value) => {
        if (!signal.aborted) {
          if (previous.current?.session.user.id !== value.session.user.id ||
              previous.current.session.preferred_connection_id !== value.session.preferred_connection_id) {
            setChoice(activeGrant(value.session)?.connection_id ?? '');
          }
          previous.current = value; setData(value); setLoading(false);
        }
      }).catch((cause: unknown) => {
        if (!signal.aborted) {
          setLoading(false); setSignedOut(cause instanceof RetrievalError && cause.status === 401);
          setData(null);
          setError(cause instanceof Error ? cause.message : 'Không mở được Settings.');
        }
      });
    }
    function visibility() { if (!document.hidden) load(); }
    load();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.abort(); pendingSave.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [attempt]);
  async function save() {
    if (!data || !choice || busy) return;
    if (!window.dispatchEvent(new Event('wo-connection-change', { cancelable: true }))) return;
    const controller = new AbortController(); pendingSave.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveConnectionSetting(choice, controller.signal);
      if (controller.signal.aborted) return;
      setData({ ...data, session: { ...data.session, preferred_connection_id: choice } });
      previous.current = { ...data, session: { ...data.session, preferred_connection_id: choice } };
      setNotice('Đã lưu hệ thống cho tài khoản. Những lần đăng nhập sau sẽ dùng lựa chọn này.');
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof RetrievalError && [401, 403, 404, 409].includes(cause.status)) { setData(null); setSignedOut(cause.status === 401); }
      setError(cause instanceof Error ? cause.message : 'Chưa lưu được hệ thống.');
    } finally { if (!controller.signal.aborted) { pendingSave.current = null; setBusy(false); } }
  }
  return <>
    <Link to="/work-orders" className={styles.back}>← Work Orders</Link>
    <div className={styles.pageTitle}><h1>Settings</h1></div>
    {loading && <p role="status">Đang tải cấu hình tài khoản…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && !signedOut && <button onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1); }}>Tải lại Settings</button>}
    {signedOut && <a href={loginUrl}>Đăng nhập Microsoft</a>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {data && <section className={styles.settingsSection}>
      <h2>Hệ thống Maximo</h2>
      <p>{data.session.user.name} · Discipline tự nhận từ tài khoản.</p>
      <p>Chọn một lần và lưu cho tài khoản. Màn hình Work Orders sẽ tự dùng hệ thống này.</p>
      <fieldset disabled={busy}><legend>Kết nối đã được cấp quyền</legend>
        {data.connections.map((connection) => {
          const grants = data.session.grants.filter((grant) => grant.connection_id === connection.connection_id);
          const grant = grants[0];
          return <label key={connection.connection_id} className={styles.connectionOption}>
            <input type="radio" name="connection" value={connection.connection_id} checked={choice === connection.connection_id}
              disabled={grants.length !== 1} onChange={() => { setChoice(connection.connection_id); setNotice(''); }} />
            <span><strong>{grant.label}</strong><small>{grant.system} · {grant.environment} · {grants.map((item) => item.discipline).join(', ')}</small>
              <span>{connection.url}</span>{grants.length !== 1 && <small>Cần quản trị viên xác nhận một discipline cho tài khoản.</small>}</span>
          </label>;
        })}
        {!data.connections.length && <p>Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.</p>}
        <button className={styles.primary} disabled={!choice || choice === data.session.preferred_connection_id} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu hệ thống'}</button>
      </fieldset>
    </section>}
  </>;
}
