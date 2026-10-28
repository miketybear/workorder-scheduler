import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getLiveness } from './api/client';
import { DemoScheduler } from './scheduling/DemoScheduler';
import styles from './App.module.css';
import bdpocLogo from './assets/bdpoc-logo.png';
import { SessionPanel } from './auth/SessionPanel';
import { WorkOrders } from './scheduling/WorkOrders';
import { UserMenu } from './components/UserMenu';
import { Settings } from './components/Settings';
import { Admin } from './components/Admin';
import { AssignmentTimelineDemo } from './assignmentTimeline/AssignmentTimelineDemo';
import { RotaStagingPreview } from './rotaStaging/RotaStagingPreview';
import { RotaImports } from './rotaImports/RotaImports';
import { ResourceTimeline } from './resourceTimeline/ResourceTimeline';
import type { PicSuggestion } from './picSuggestion';

const pages = [['/work-orders', 'WO Scheduler'], ['/resource-timeline', 'Resource Timeline'], ['/rota-imports', 'Rota Upload']] as const;

/** The three app pages behind one menu button at the far left of the header. */
function PageMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Choosing a page, Esc or a click elsewhere closes the panel.
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close); document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close); };
  }, [open]);
  return <div ref={root} className={styles.pageMenu}>
    <button type="button" className={styles.pageMenuButton} aria-label="Chọn trang" aria-expanded={open} aria-controls="page-menu" onClick={() => setOpen((value) => !value)}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="4" width="16" height="2" /><rect x="2" y="9" width="16" height="2" /><rect x="2" y="14" width="16" height="2" /></svg>
    </button>
    <Link to="/" className={styles.pageMenuButton} aria-label="Trang chủ" title="Trang chủ">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 32 32" fill="currentColor"><path d="M16.61,2.21a1,1,0,0,0-1.24,0L1,13.42,2.24,15,4,13.62V26a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V13.63L29.76,15,31,13.43ZM18,26H14V18h4Zm2,0V18a2,2,0,0,0-2-2H14a2,2,0,0,0-2,2v8H6V12.06L16,4.27l10,7.8V26Z" /></svg>
    </Link>
    {open && <nav id="page-menu" className={styles.pagePanel} aria-label="Điều hướng chính">
      {pages.map(([to, label]) => <NavLink key={to} to={to} onClick={() => setOpen(false)}>{label}</NavLink>)}
    </nav>}
  </div>;
}

function Overview() {
  const [status, setStatus] = useState('Đang kiểm tra…');
  useEffect(() => {
    const controller = new AbortController();
    getLiveness(controller.signal).then((ok) => setStatus(ok ? 'Đang hoạt động' : 'Chưa sẵn sàng'))
      .catch(() => { if (!controller.signal.aborted) setStatus('Chưa kết nối'); });
    return () => controller.abort();
  }, []);
  return <>
    <div className={styles.pageTitle}><h1>Tổng quan</h1></div>
    <div className={styles.cards}>
      <Link className={styles.actionCard} to="/work-orders"><span>Work orders</span><h2>Lập lịch WO</h2>
        <p>Lấy WO theo phạm vi được cấp, chỉnh lịch, PIC, duration và lưu nháp trước khi upload.</p></Link>
      <Link className={styles.actionCard} to="/resource-timeline"><span>Resource timeline</span><h2>Phân công nhân lực</h2>
        <p>Xếp task theo ngày và capacity thật của rota.</p></Link>
      <Link className={styles.actionCard} to="/rota-imports"><span>Rota</span><h2>Upload và kích hoạt rota</h2>
        <p>Upload bảng rota, xem staging đã lưu rồi mới kích hoạt.</p></Link>
    </div>
    <div className={styles.cards}>
      <SessionPanel />
      <article><span>Dịch vụ</span><h2>{status}</h2><p>Trạng thái tiến trình backend; chưa xác nhận kết nối dữ liệu Maximo.</p></article>
    </div>
  </>;
}

export function App({ autoRetrieveWorkOrders = true }: { autoRetrieveWorkOrders?: boolean } = {}) {
  const pathname = useLocation().pathname;
  const workOrdersActive = pathname === '/work-orders';
  // The header and the browser tab name the current page.
  const pageTitle = pages.find(([to]) => to === pathname)?.[1] ?? 'Work Order Scheduler';
  useEffect(() => { document.title = pageTitle === 'Work Order Scheduler' ? pageTitle : `${pageTitle} · Work Order Scheduler`; }, [pageTitle]);
  // The WO page puts its loaded range and range button here, beside the environment chip.
  const [rangeSlot, setRangeSlot] = useState<HTMLSpanElement | null>(null);
  // ...and its row count / last-update line here, in the footer.
  const [statusSlot, setStatusSlot] = useState<HTMLSpanElement | null>(null);
  const assignmentDemoActive = pathname === '/assignment-demo';
  const rotaStagingActive = pathname === '/rota-staging-demo';
  const rotaImportsActive = pathname === '/rota-imports';
  const resourceTimelineActive = pathname === '/resource-timeline';
  const [assignmentDemoVisited, setAssignmentDemoVisited] = useState(assignmentDemoActive);
  const [rotaStagingVisited, setRotaStagingVisited] = useState(rotaStagingActive);
  const [rotaImportsVisited, setRotaImportsVisited] = useState(rotaImportsActive);
  const [resourceTimelineVisited, setResourceTimelineVisited] = useState(resourceTimelineActive);
  const [resourceMutationPending, setResourceMutationPending] = useState(false);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const reportMutationPending = useCallback((value: boolean) => setResourceMutationPending(value), []);
  const navigate = useNavigate();
  const [picSuggestion, setPicSuggestion] = useState<PicSuggestion | null>(null);
  const suggestPic = useCallback((suggestion: Omit<PicSuggestion, 'id'>) => { setPicSuggestion({ ...suggestion, id: Date.now() }); navigate('/work-orders'); }, [navigate]);
  const clearPicSuggestion = useCallback(() => setPicSuggestion(null), []);
  const guardNavigation = useCallback((event: MouseEvent<HTMLElement>) => {
    if (resourceMutationPending && (event.target as HTMLElement).closest('a')) {
      event.preventDefault(); setNavigationBlocked(true);
    }
  }, [resourceMutationPending]);
  if (assignmentDemoActive && !assignmentDemoVisited) setAssignmentDemoVisited(true);
  if (rotaStagingActive && !rotaStagingVisited) setRotaStagingVisited(true);
  if (rotaImportsActive && !rotaImportsVisited) setRotaImportsVisited(true);
  if (resourceTimelineActive && !resourceTimelineVisited) setResourceTimelineVisited(true);
  return <div className={styles.shell}>
    <header className={styles.header} onClickCapture={guardNavigation}><PageMenu />
      <span className={styles.brand}><img className={styles.brandLogo} src={bdpocLogo} alt="Petrovietnam Biendong POC" /><span className={styles.brandName}>{pageTitle}</span></span>
      <UserMenu><span ref={setRangeSlot} className={styles.headerRange} hidden={!workOrdersActive} /></UserMenu></header>
    <main className={workOrdersActive ? `${styles.fullWidth} ${styles.workOrdersMain}` : resourceTimelineActive ? styles.fullWidth : undefined} onClickCapture={guardNavigation}>{navigationBlocked && resourceMutationPending && <p role="status">Đang có yêu cầu phân công chưa đối soát. Hoàn tất hoặc đối soát để chuyển trang.</p>}<Routes><Route path="/" element={<Overview />} /><Route path="/demo" element={<DemoScheduler />} />
      <Route path="/work-orders" element={null} />
      <Route path="/assignment-demo" element={null} />
      <Route path="/rota-staging-demo" element={null} />
      <Route path="/rota-imports" element={null} />
      <Route path="/resource-timeline" element={null} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<p>Không tìm thấy trang. <Link to="/">Về tổng quan</Link></p>} /></Routes>
      <div hidden={!workOrdersActive}><WorkOrders active={workOrdersActive} autoRetrieve={autoRetrieveWorkOrders} picSuggestion={picSuggestion} onPicSuggestionHandled={clearPicSuggestion} headerSlot={rangeSlot} footerSlot={statusSlot} /></div>
      {assignmentDemoVisited && <div hidden={!assignmentDemoActive}><AssignmentTimelineDemo /></div>}
      {rotaStagingVisited && <div hidden={!rotaStagingActive}><RotaStagingPreview /></div>}
      {rotaImportsVisited && <div hidden={!rotaImportsActive}><RotaImports active={rotaImportsActive} /></div>}
      {resourceTimelineVisited && <div hidden={!resourceTimelineActive}><ResourceTimeline active={resourceTimelineActive} onPendingChange={reportMutationPending} onSuggestPic={suggestPic} /></div>}
    </main>
    <footer><span>Onshore + Offshore · Nội bộ</span><span ref={setStatusSlot} className={styles.footerStatus} hidden={!workOrdersActive} /></footer>
  </div>;
}
