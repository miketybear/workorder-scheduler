import { useEffect, useId, useRef, useState } from 'react';
import { createRouteSession, RouteApiError, type RouteScope, type RouteStatus } from '../api/workflowRoute';
import styles from '../App.module.css';
import { SAVED_LOGIN_NOTE } from './RoutePanel';

/**
 * Asks once, right after the work orders load, for the position account's password so route readiness can be read.
 * Skipping keeps the screen fully usable except for routing. The password stays in this form only until it is sent.
 */
export function RouteLogin({ scope, personid, onSession, onSkip, onDenied }: {
  scope: RouteScope; personid: string;
  onSession: (session: RouteStatus['session']) => void; onSkip: () => void; onDenied: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = useId(); const bodyId = useId();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    const typed = password;
    setPassword(''); setBusy(true); setMessage('');
    try {
      onSession(await createRouteSession(scope, personid, typed, new AbortController().signal));
    } catch (cause) {
      if (cause instanceof RouteApiError && (cause.status === 401 || cause.status === 404)) onDenied();
      else if (cause instanceof RouteApiError && cause.code === 'maximo_login_failed') {
        const left = cause.extra.remaining_attempts;
        setMessage(`Sai mật khẩu của ${personid}.${left === undefined ? '' : ` Còn ${left} lần thử trước khi bị khóa tạm thời.`}`);
      } else if (cause instanceof RouteApiError && cause.code === 'login_rate_limited') {
        setMessage(`Đã thử sai quá nhiều lần. Thử lại sau ${Math.ceil((cause.extra.retry_after_seconds ?? 60) / 60)} phút.`);
      } else if (cause instanceof RouteApiError && cause.code === 'maximo_unavailable') setMessage('Không kết nối được Maximo. Mật khẩu chưa bị tính là sai; thử lại.');
      else setMessage(cause instanceof Error ? cause.message : 'Không đăng nhập được tài khoản route.');
    } finally { setBusy(false); }
  }

  return <div className={styles.confirmOverlay}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
    className={`${styles.confirmDialog} ${styles.routeDialog}`} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onSkip(); }}>
    <h2 id={titleId}>Đăng nhập tài khoản route</h2>
    <p id={bodyId} className={styles.routeIntro}>Nhập mật khẩu Maximo của <strong>{personid}</strong> để xem WO nào route được. {SAVED_LOGIN_NOTE}</p>
    {message && <p role="alert" className={styles.error}>{message}</p>}
    <form className={styles.routeLogin} onSubmit={(event) => void login(event)}>
      <label>Tài khoản<input value={personid} readOnly aria-readonly="true" /></label>
      <label>Mật khẩu<input type="password" value={password} autoComplete="off" autoFocus disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <div className={styles.confirmActions}>
        <button type="button" className={styles.ghost} onClick={onSkip} disabled={busy}>Bỏ qua</button>
        <button className={styles.primary} disabled={busy || !password}>{busy ? 'Đang kiểm tra…' : 'Đăng nhập'}</button>
      </div>
    </form>
  </section></div>;
}
