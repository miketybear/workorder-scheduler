import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getLiveness } from './api/client';
import { DemoScheduler } from './scheduling/DemoScheduler';
import styles from './App.module.css';
import bdpocLogo from './assets/bdpoc-logo.png';
import { SessionPanel } from './auth/SessionPanel';
import { WorkOrders } from './scheduling/WorkOrders';
import { ThemeToggle } from './components/ThemeToggle';
import { Settings } from './components/Settings';
import { Admin, AdminLink } from './components/Admin';
import { AssignmentTimelineDemo } from './assignmentTimeline/AssignmentTimelineDemo';
import { RotaStagingPreview } from './rotaStaging/RotaStagingPreview';
import { RotaImports } from './rotaImports/RotaImports';
import { ResourceTimeline } from './resourceTimeline/ResourceTimeline';

function Overview() {
  const [status, setStatus] = useState('Đang kiểm tra…');
  useEffect(() => {
    const controller = new AbortController();
    getLiveness(controller.signal).then((ok) => setStatus(ok ? 'Đang hoạt động' : 'Chưa sẵn sàng'))
      .catch(() => { if (!controller.signal.aborted) setStatus('Chưa kết nối'); });
    return () => controller.abort();
  }, []);
  return <>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>WORK ORDER SCHEDULER / 01</p>
        <h1>Một nơi để lập lịch.<br /><span>Rõ từng thay đổi.</span></h1>
        <p>Lên kế hoạch công việc cho Onshore và Offshore,<br />với phạm vi riêng cho từng discipline.</p>
        <Link className={styles.primary} to="/demo">Khám phá bảng lập lịch <span>↗</span></Link>
        <p><Link to="/work-orders">Mở danh sách WO theo quyền →</Link></p>
        <p><Link to="/assignment-demo">Thử timeline nhân lực theo tháng →</Link></p>
        <p><Link to="/rota-staging-demo">Kiểm tra rota trước khi kích hoạt →</Link></p>
        <p><Link to="/rota-imports">Upload rota và mở staging đã lưu →</Link></p>
      </div>
      <aside className={styles.progress}><span>NỀN TẢNG DỰ ÁN</span><strong>01 <small>/ 05</small></strong>
        <div className={styles.track}><i /></div><p>Khởi tạo ứng dụng</p><small>Tiếp theo: SSO & phân quyền</small>
      </aside>
    </section>
    <div className={styles.cards}>
      <article><span>01 / API</span><h2>{status}</h2><p>Trạng thái tiến trình backend; chưa xác nhận kết nối dữ liệu.</p></article>
      <SessionPanel />
      <article><span>03 / TÍCH HỢP</span><h2>Maximo 7.6.1.3</h2><p>Chờ hostname test và tài khoản tích hợp.</p></article>
    </div>
    <section className={styles.workflow}><p className={styles.eyebrow}>LUỒNG LÀM VIỆC DỰ KIẾN</p>
      <div><span>01 <b>Retrieve WO</b></span><span>02 <b>Chỉnh sửa</b></span><span>03 <b>Xem thay đổi</b></span><span>04 <b>Upload & đối soát</b></span></div>
    </section>
  </>;
}

export function App() {
  const pathname = useLocation().pathname;
  const workOrdersActive = pathname === '/work-orders';
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
    <header className={styles.header} onClickCapture={guardNavigation}><Link to="/" className={styles.brand}><img className={styles.brandLogo} src={bdpocLogo} alt="Petrovietnam Biendong POC" />WORKORDER <b>/ Scheduler</b></Link>
      <div className={styles.headerActions}><span className={styles.badge}>Bản phát triển · Lập lịch & nháp</span><Link to="/resource-timeline">Resource timeline</Link><Link to="/assignment-demo">Timeline thử nghiệm</Link><Link to="/rota-staging-demo">Preview rota</Link><Link to="/rota-imports">Rota staging</Link><Link to="/settings">Settings</Link><AdminLink /><ThemeToggle /></div></header>
    <main className={resourceTimelineActive ? styles.fullWidth : undefined} onClickCapture={guardNavigation}>{navigationBlocked && resourceMutationPending && <p role="status">Đang có yêu cầu phân công chưa đối soát. Hoàn tất hoặc đối soát để chuyển trang.</p>}<Routes><Route path="/" element={<Overview />} /><Route path="/demo" element={<DemoScheduler />} />
      <Route path="/work-orders" element={null} />
      <Route path="/assignment-demo" element={null} />
      <Route path="/rota-staging-demo" element={null} />
      <Route path="/rota-imports" element={null} />
      <Route path="/resource-timeline" element={null} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<p>Không tìm thấy trang. <Link to="/">Về tổng quan</Link></p>} /></Routes>
      <div hidden={!workOrdersActive}><WorkOrders active={workOrdersActive} /></div>
      {assignmentDemoVisited && <div hidden={!assignmentDemoActive}><AssignmentTimelineDemo /></div>}
      {rotaStagingVisited && <div hidden={!rotaStagingActive}><RotaStagingPreview /></div>}
      {rotaImportsVisited && <div hidden={!rotaImportsActive}><RotaImports active={rotaImportsActive} /></div>}
      {resourceTimelineVisited && <div hidden={!resourceTimelineActive}><ResourceTimeline active={resourceTimelineActive} onPendingChange={reportMutationPending} /></div>}
    </main>
    <footer>Work Order Scheduler <span>Onshore + Offshore · Nội bộ</span></footer>
  </div>;
}
