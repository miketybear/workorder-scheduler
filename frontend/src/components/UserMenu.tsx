import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, signOut, type Session } from '../api/client';
import { activeGrant } from '../auth/activeGrant';
import styles from '../App.module.css';
import { AdminLink } from './Admin';
import { ThemeToggle } from './ThemeToggle';

type Auth = { available: boolean; session: Session | null } | null;

function useAuth(): Auth {
  const [auth, setAuth] = useState<Auth>(null);
  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort(); controller = new AbortController();
      const signal = controller.signal;
      getAuthSummary(signal).then((result) => { if (!signal.aborted) setAuth(result); })
        .catch(() => { if (!signal.aborted) setAuth(null); });
    };
    load();
    const returning = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', returning);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', returning); };
  }, []);
  return auth;
}

// Environment must stay visible on every page so nobody edits production believing it is test.
function EnvironmentChip({ session }: { session: Session }) {
  const grant = activeGrant(session);
  if (!grant) return <Link className={styles.envChip} data-env="none" to="/settings">Chọn kết nối</Link>;
  return <span className={styles.envChip} data-env={grant.environment}>
    {grant.system === 'onshore' ? 'Onshore' : 'Offshore'} · {grant.environment === 'test' ? 'TEST' : 'PROD'}
  </span>;
}

export function UserMenu({ loadedWorkOrderRange = null }: { loadedWorkOrderRange?: string | null }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  async function logout() {
    try { await signOut(); window.location.assign('/'); } catch { setSignOutError('Chưa đăng xuất được. Hãy thử lại.'); }
  }
  const session = auth?.session ?? null;
  const name = session?.user.name ?? 'Tài khoản';
  return <div className={styles.userArea}>
    {session && <EnvironmentChip session={session} />}
    {session && loadedWorkOrderRange && <span className={styles.headerRange}>{loadedWorkOrderRange}</span>}
    <details className={styles.userMenu} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={`Menu tài khoản · ${name}`}><span className={styles.avatar} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className={styles.userName}>{name}</span></summary>
      <div className={styles.menuPanel} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setOpen(false); }}>
        {session && <p className={styles.menuIdentity}><strong>{session.user.name}</strong>
          {session.grants.map((grant) => <small key={`${grant.connection_id}/${grant.discipline}`}>
            {grant.label} · {grant.discipline} · {grant.capability === 'write' ? 'Xem và sửa' : 'Chỉ xem'}</small>)}
          {session.grants.length === 0 && <small>Chưa được cấp quyền WO</small>}</p>}
        <Link to="/settings">Cài đặt</Link>
        <AdminLink />
        <ThemeToggle />
        {import.meta.env.DEV && <nav aria-label="Công cụ thử nghiệm" className={styles.menuDev}>
          <small>Thử nghiệm (chỉ bản dev)</small>
          <Link to="/demo">Bảng lập lịch mẫu</Link>
          <Link to="/assignment-demo">Timeline thử nghiệm</Link>
          <Link to="/rota-staging-demo">Preview rota</Link>
        </nav>}
        {session && <button type="button" onClick={logout}>Đăng xuất</button>}
        {signOutError && <p role="alert">{signOutError}</p>}
      </div>
    </details>
  </div>;
}
