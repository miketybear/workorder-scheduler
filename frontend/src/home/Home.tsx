import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, type Session } from '../api/client';
import { currentMonthRange, startOfDay } from '../api/dates';
import { getHomeSummary, type HomeSummary } from '../api/home';
import { activeGrant } from '../auth/activeGrant';
import { SessionPanel } from '../auth/SessionPanel';
import styles from '../App.module.css';

type Grant = NonNullable<ReturnType<typeof activeGrant>>;
type Tone = 'blue' | 'purple' | 'warm' | 'red' | 'green';
type Task = { count: number; text: string; tone: Tone };

const displayDay = (day: string) => day.split('-').reverse().join('/');

/** Most urgent first: an unresolved write outranks every planning gap, and empty rows are not shown. */
export function homeTasks(summary: HomeSummary): Task[] {
  const tasks: Task[] = [
    { count: summary.unresolved_uploads, text: 'WO upload chưa rõ kết quả', tone: 'red' },
    { count: summary.unresolved_routes, text: 'WO route chưa rõ kết quả', tone: 'red' },
    { count: summary.overdue, text: 'WO đã quá Target Date', tone: 'red' },
    { count: summary.missing_schedule, text: 'WO chưa có lịch', tone: 'purple' },
    { count: summary.missing_pic, text: 'WO chưa có PIC', tone: 'warm' },
  ];
  return tasks.filter((task) => task.count > 0);
}

function Metric({ value, label, tone }: { value: number; label: string; tone: Tone }) {
  return <div className={styles.homeMetric} data-tone={tone}><strong>{value}</strong><span>{label}</span></div>;
}

function Summary({ grant }: { grant: Grant }) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const range = currentMonthRange(grant.timezone);
  useEffect(() => {
    const controller = new AbortController();
    getHomeSummary({ connection_id: grant.connection_id, discipline: grant.discipline,
      target_from: startOfDay(range.start, grant.timezone), target_before: startOfDay(range.end, grant.timezone) }, controller.signal)
      .then(setSummary)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [grant.connection_id, grant.discipline, grant.timezone, range.start, range.end]);

  const tasks = summary ? homeTasks(summary) : [];
  return <>
    <p className={styles.homeScope}>{grant.discipline} · {grant.label} · Target Date từ {displayDay(range.start)}, WO đang mở
      {summary && <> · cập nhật {new Date(summary.as_of).toLocaleTimeString('vi-VN', { timeZone: grant.timezone, hour: '2-digit', minute: '2-digit' })}</>}</p>
    {failed && <p role="alert" className={styles.error}>Chưa đọc được số liệu từ Maximo. Thử tải lại trang.</p>}
    {!summary && !failed && <p role="status">Đang đọc số liệu từ Maximo…</p>}
    {summary && <>
      <div className={styles.homeMetrics}>
        <Metric value={summary.total} label="WO trong tháng" tone="blue" />
        <Metric value={summary.missing_schedule} label="Thiếu lịch" tone={summary.missing_schedule ? 'purple' : 'green'} />
        <Metric value={summary.missing_pic} label="Thiếu PIC" tone={summary.missing_pic ? 'warm' : 'green'} />
        <Metric value={summary.overdue} label="Quá Target Date" tone={summary.overdue ? 'red' : 'green'} />
      </div>
      <div className={styles.homeColumns}>
        <section className={styles.homePanel}><h2>Cần xử lý</h2>
          {tasks.length === 0 ? <p className={styles.homeDone}>Không còn việc cần xử lý trong tháng này.</p> : <ul className={styles.homeTasks}>
            {tasks.map((task) => <li key={task.text}><Link to="/work-orders" data-tone={task.tone}>
              <strong>{task.count}</strong><span>{task.text}</span><span aria-hidden="true">›</span></Link></li>)}
          </ul>}
        </section>
        <section className={`${styles.homePanel} ${styles.homeContinue}`}><h2>Tiếp tục</h2>
          <p>Nháp của bạn: <strong>{summary.drafts}</strong></p>
          <Link className={`${styles.homeOpen} ${styles.primary}`} to="/work-orders">Mở WO Scheduler</Link>
        </section>
      </div>
    </>}
  </>;
}

/** What the signed-in planner has to deal with now; the header menu handles navigation. */
export function Home() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getAuthSummary(controller.signal).then((auth) => setSession(auth.session))
      .catch(() => { if (!controller.signal.aborted) setSession(null); });
    return () => controller.abort();
  }, []);
  const grant = activeGrant(session ?? null);
  return <>
    <div className={styles.pageTitle}><h1>{session ? `Chào ${session.user.name}` : 'Tổng quan'}</h1></div>
    {grant && <Summary grant={grant} />}
    {session && !grant && <p>Chưa có phạm vi WO để hiện số liệu. Kiểm tra kết nối trong <Link to="/settings">Cài đặt</Link>.</p>}
    <div className={styles.homeSession}><SessionPanel /></div>
  </>;
}
