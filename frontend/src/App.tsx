import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getLiveness } from './api/client';
import { DemoScheduler } from './scheduling/DemoScheduler';
import styles from './App.module.css';
import { SessionPanel } from './auth/SessionPanel';
import { WorkOrders } from './scheduling/WorkOrders';
import { ThemeToggle } from './components/ThemeToggle';
import { Settings } from './components/Settings';

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
  const workOrdersActive = useLocation().pathname === '/work-orders';
  return <div className={styles.shell}>
    <header className={styles.header}><Link to="/" className={styles.brand}>WORKORDER <b>/ Scheduler</b></Link>
      <div className={styles.headerActions}><span className={styles.badge}>Bản phát triển · Lập lịch & nháp</span><Link to="/settings">Settings</Link><ThemeToggle /></div></header>
    <main><Routes><Route path="/" element={<Overview />} /><Route path="/demo" element={<DemoScheduler />} />
      <Route path="/work-orders" element={null} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<p>Không tìm thấy trang. <Link to="/">Về tổng quan</Link></p>} /></Routes>
      <div hidden={!workOrdersActive}><WorkOrders active={workOrdersActive} /></div></main>
    <footer>Work Order Scheduler <span>Onshore + Offshore · Nội bộ</span></footer>
  </div>;
}
