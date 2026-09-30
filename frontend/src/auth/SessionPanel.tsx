import { useEffect, useState } from 'react';
import { getAuthSummary, loginUrl, signOut } from '../api/client';
import styles from '../App.module.css';

export function SessionPanel() {
  const [auth, setAuth] = useState<Awaited<ReturnType<typeof getAuthSummary>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setAuth(null);
      getAuthSummary(signal).then((result) => {
        if (!signal.aborted) { setAuth(result); setError(''); }
      }).catch(() => { if (!signal.aborted) setError('Chưa kết nối được dịch vụ đăng nhập.'); });
    };
    load();
    window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, []);
  async function logout() {
    setBusy(true);
    try {
      await signOut();
      // Reload clears all in-memory views and edits after ending the session.
      window.location.assign('/');
    } catch { setError('Chưa đăng xuất được. Hãy thử lại.'); setBusy(false); }
  }
  return <article>
    <span>02 / DANH TÍNH</span><h2>{auth?.session?.user.name ?? 'Entra ID'}</h2>
    {new URLSearchParams(window.location.search).get('auth') === 'failed' &&
      <p role="alert">Đăng nhập chưa thành công hoặc đã hết thời gian. Hãy thử lại.</p>}
    {error && <p role="alert">{error}</p>}
    {!auth && !error && <p>Đang kiểm tra phiên đăng nhập…</p>}
    {auth && !auth.session && <>
      <p>{auth.available ? 'Dùng tài khoản công ty để đăng nhập.' : 'Chờ cấu hình đăng nhập từ IT.'}</p>
      {auth.available && <a className={styles.primary} href={loginUrl}>Đăng nhập Microsoft</a>}
    </>}
    {auth?.session && <>
      {auth.session.grants.length === 0 ? <p>Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.</p> :
        <ul>{auth.session.grants.map((grant) => <li key={`${grant.connection_id}/${grant.discipline}`}>
          {grant.label} · {grant.discipline} · {grant.capability === 'write' ? 'Xem và sửa' : 'Chỉ xem'}
        </li>)}</ul>}
      <button onClick={logout} disabled={busy}>{busy ? 'Đang đăng xuất…' : 'Đăng xuất khỏi ứng dụng'}</button>
    </>}
  </article>;
}
