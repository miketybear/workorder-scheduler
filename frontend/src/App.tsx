import { useCallback, useEffect, useState, type MouseEvent } from 'react';
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
  // The WO page puts its loaded range and range button here, beside the environment chip.
  const [rangeSlot, setRangeSlot] = useState<HTMLSpanElement | null>(null);
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
    <header className={styles.header} onClickCapture={guardNavigation}><Link to="/" className={styles.brand} title="Về Tổng quan"><img className={styles.brandLogo} src={bdpocLogo} alt="Petrovietnam Biendong POC" /><span className={styles.brandName}>Work Order Scheduler</span></Link>
      <nav className={styles.mainNav} aria-label="Điều hướng chính">
        <NavLink to="/work-orders">Work orders</NavLink><NavLink to="/resource-timeline">Resource timeline</NavLink><NavLink to="/rota-imports">Rota</NavLink></nav>
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
      <div hidden={!workOrdersActive}><WorkOrders active={workOrdersActive} autoRetrieve={autoRetrieveWorkOrders} picSuggestion={picSuggestion} onPicSuggestionHandled={clearPicSuggestion} headerSlot={rangeSlot} /></div>
      {assignmentDemoVisited && <div hidden={!assignmentDemoActive}><AssignmentTimelineDemo /></div>}
      {rotaStagingVisited && <div hidden={!rotaStagingActive}><RotaStagingPreview /></div>}
      {rotaImportsVisited && <div hidden={!rotaImportsActive}><RotaImports active={rotaImportsActive} /></div>}
      {resourceTimelineVisited && <div hidden={!resourceTimelineActive}><ResourceTimeline active={resourceTimelineActive} onPendingChange={reportMutationPending} onSuggestPic={suggestPic} /></div>}
    </main>
    <footer><span>Onshore + Offshore · Nội bộ</span></footer>
  </div>;
}
