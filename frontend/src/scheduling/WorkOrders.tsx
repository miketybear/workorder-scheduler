import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, loginUrl, type Session } from '../api/client';
import { RetrievalError, retrieveWorkOrders, type WorkOrder, type WorkOrderFilter } from '../api/workOrders';
import styles from '../App.module.css';
import { DraftEditor, type EditorSelection } from './DraftEditor';
import { getDetail, openDraft, listPlannedWorkOrders, type Detail, type DraftNotice, type Scope } from '../api/drafts';
import { startOfDay } from '../api/dates';
import { BatchPlanner, type BatchSelection } from './BatchPlanner';
import { displayDate, rowKey } from './presentation';
import { chosenPlan, effectiveOrder, updatePlans } from './planning';
import type { PlanningMarker } from '../api/workOrders';
import { activeGrant } from '../auth/activeGrant';
import { config } from '../config';

type Source = 'maximo' | 'drafts';
type SourceSnapshot = {
  rows: WorkOrder[] | null;
  query: WorkOrderFilter | null;
  page: { scope: Scope; offset: number } | null;
  updatedAt: number | null;
  search: string;
  statusFilter: string;
  planningFilter: string;
  draftFilter: string;
  selectedKeys: string[];
  choices: Record<string, string>;
  offset: number;
  nextOffset: number | null;
};

export function WorkOrders({ active = true }: { active?: boolean }) {
  const sources = useRef<Partial<Record<Source, SourceSnapshot>>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [batchRefresh, setBatchRefresh] = useState(0);
  const markUpdated = useCallback(() => { setUpdatedAt(Date.now()); setStale(false); }, []);
  const scrollPosition = useRef(0);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planningFilter, setPlanningFilter] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [rechecked, setRechecked] = useState<Detail | null>(null);
  const selected = useRef<{ selection: EditorSelection; scope: Scope } | null>(null);
  const [draftFilter, setDraftFilter] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [chooser, setChooser] = useState<WorkOrder | null>(null);
  const [view, setView] = useState<Source>('maximo');
  const planningPage = useRef<{ scope: Scope; offset: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const dirty = useRef(false);
  const draftRevision = useRef(0);
  const authIdentity = useRef('');
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const focusChooser = useCallback((element: HTMLElement | null) => { element?.focus(); }, []);
  const onDraftReady = useCallback((draft: DraftNotice) => {
    draftRevision.current += 1;
    for (const source of ['maximo', 'drafts'] as const) {
      const snapshot = sources.current[source];
      if (!snapshot) continue;
      const next = snapshot.rows && updatePlans(snapshot.rows, draft);
      snapshot.rows = source === 'drafts' ? next?.filter((row) => row.drafts?.length) ?? null : next;
      snapshot.choices = Object.fromEntries([
        ...Object.entries(snapshot.choices).filter(([, id]) => id !== draft.draft_id),
        ...draft.items?.map((item) => [rowKey(item.item), draft.draft_id]) ?? [],
      ]);
      const keys = new Set(snapshot.rows?.map(rowKey));
      snapshot.selectedKeys = snapshot.selectedKeys.filter((key) => keys.has(key));
    }
    setRows((previous) => {
      const next = previous && updatePlans(previous, draft);
      return planningPage.current ? next?.filter((row) => row.drafts?.length) ?? null : next;
    });
    setChoices((previous) => Object.fromEntries([
      ...Object.entries(previous).filter(([, id]) => id !== draft.draft_id),
      ...draft.items?.map((item) => [rowKey(item.item), draft.draft_id]) ?? [],
    ]));
  }, []);
  const pending = useRef<AbortController | null>(null);
  const retrieved = useRef<WorkOrderFilter | null>(null);
  const refreshSession = useRef<((refreshData?: boolean) => void) | null>(null);
  const grant = useMemo(() => activeGrant(session), [session]);
  const scope = grant ? JSON.stringify([grant.connection_id, grant.discipline]) : '';
  const statuses = useMemo(() => [...new Set(rows?.map((row) => row.status) ?? [])].sort(), [rows]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    return rows?.map((row) => effectiveOrder(row, choices[rowKey(row)])).filter((row) => (!statusFilter || row.status === statusFilter) &&
      (draftFilter !== 'yes' || !!row.drafts?.length) && (draftFilter !== 'no' || !row.drafts?.length) &&
      (planningFilter !== 'schedule' || !row.schedstart || !row.schedfinish) &&
      (planningFilter !== 'pic' || !row.assignedtechname) &&
      (!query || [row.wonum, row.description, row.location].some((value) => value?.toLocaleLowerCase('vi').includes(query)))) ?? [];
  }, [rows, search, statusFilter, planningFilter, draftFilter, choices]);

  const editorScope = useMemo(() => ({ connection_id: grant?.connection_id ?? '', discipline: grant?.discipline ?? '' }), [grant]);
  const panelOpen = active && !checking && !!(selection || batch || chooser);

  useEffect(() => {
    if (!panelOpen) return;
    const root = document.documentElement;
    root.setAttribute('data-wo-panel-open', '');
    return () => root.removeAttribute('data-wo-panel-open');
  }, [panelOpen]);

  useEffect(() => { selected.current = selection ? { selection, scope: editorScope } : null; }, [selection, editorScope]);

  const onDenied = useCallback(() => {
    sources.current = {};
    setUpdatedAt(null); setStale(false);
    retrieved.current = null;
    setBatch(null); setSelectedKeys([]);
    planningPage.current = null; setChooser(null); setChoices({});
    selected.current = null;
    pending.current?.abort(); setRows(null); setRechecked(null); setSelection(null);
    dirty.current = false; authIdentity.current = '';
    // A missing draft or revoked WO is not evidence that the login session ended.
    setChecking(true);
    refreshSession.current?.(true);
  }, []);
  function discard() {
    return !dirty.current || window.confirm('Có thay đổi chưa lưu. Bỏ các thay đổi này?');
  }
  function choose(next: EditorSelection) {
    if (!discard()) return;
    dirty.current = false;
    setBatch(null);
    setChooser(null);
    setRechecked(null);
    selected.current = { selection: next, scope: editorScope };
    setSelection(next);
    setEditorGeneration((previous) => previous + 1);
  }
  function clearResults(clearSources = true) {
    if (clearSources) sources.current = {};
    setUpdatedAt(null); setStale(false);
    selected.current = null;
    retrieved.current = null;
    setBatch(null); setSelectedKeys([]); setPlanningFilter('');
    planningPage.current = null; setView('maximo'); setOffset(0); setDraftFilter(''); setChoices({}); setChooser(null);
    setSelection(null); setRechecked(null); setNextOffset(null); dirty.current = false;
    pending.current?.abort();
    pending.current = null;
    setRows(null);
    setSearch(''); setStatusFilter('');
    setBusy(false);
    setError('');
  }
  function rememberSource() {
    sources.current[view] = { rows, query: retrieved.current, page: planningPage.current,
      updatedAt, search, statusFilter, planningFilter, draftFilter, selectedKeys, choices, offset, nextOffset };
  }
  function switchSource(source: Source) {
    if (source === view || !discard()) return;
    rememberSource();
    clearResults(false); setView(source);
    const snapshot = sources.current[source];
    if (!snapshot) {
      if (source === 'drafts') void loadDraftPage(0);
      return;
    }
    retrieved.current = snapshot.query; planningPage.current = snapshot.page;
    setRows(snapshot.rows); setUpdatedAt(snapshot.updatedAt);
    setSearch(snapshot.search); setStatusFilter(snapshot.statusFilter); setPlanningFilter(snapshot.planningFilter);
    setDraftFilter(snapshot.draftFilter); setSelectedKeys(snapshot.selectedKeys); setChoices(snapshot.choices);
    setOffset(snapshot.offset); setNextOffset(snapshot.nextOffset);
    if (source === 'drafts' && snapshot.rows === null) void loadDraftPage(snapshot.offset);
  }
  function changeDate(value: string, field: 'start' | 'end') {
    if (!discard()) return;
    delete sources.current.maximo;
    if (view === 'maximo') clearResults(false);
    if (field === 'start') setStart(value);
    else setEnd(value);
  }
  function closePanel() {
    if (!discard()) return;
    selected.current = null;
    setSelection(null); setBatch(null); setChooser(null); setRechecked(null); dirty.current = false;
  }
  function chooseBatch(next: BatchSelection) {
    if (!discard()) return;
    selected.current = null;
    setChooser(null); setSelection(null); setRechecked(null); setBatch(next); dirty.current = false;
    setEditorGeneration((previous) => previous + 1);
  }
  function filterChanged() { setSelectedKeys([]); }
  function openPlan(row: WorkOrder, plan: PlanningMarker) {
    if (!discard()) return;
    dirty.current = false;
    setChoices((previous) => ({ ...previous, [rowKey(row)]: plan.draft_id }));
    if (plan.is_batch) chooseBatch({ draftId: plan.draft_id });
    else choose({ draftId: plan.draft_id });
  }
  function openRow(row: WorkOrder) {
    if ((row.drafts?.length ?? 0) > 1) {
      if (!discard()) return;
      selected.current = null;
      setSelection(null); setBatch(null); setChooser(row); dirty.current = false;
    } else if (row.drafts?.length) openPlan(row, row.drafts[0]);
    else choose({ key: { ...editorScope, site_id: row.siteid, workorder_id: row.workorderid } });
  }
  useEffect(() => {
    if (!active) return;
    let authRequest: AbortController | null = null;
    function refresh(refreshData = false) {
      if (authRequest && !refreshData) return;
      authRequest?.abort();
      setVerifying(true); setError('');
      if (refreshData) setBusy(true);
      authRequest = new AbortController();
      const controller = authRequest;
      const signal = controller.signal;
      let authValidated = false;
      getAuthSummary(signal).then(async (auth) => {
        if (!signal.aborted) {
          authValidated = true;
          const assigned = activeGrant(auth.session);
          const identity = auth.session ? JSON.stringify([auth.session.user.id, auth.session.grants.map((item) =>
            [item.connection_id, item.discipline, item.capability, item.system, item.environment, item.timezone]).sort(), assigned?.connection_id, assigned?.discipline]) : '';
          if (identity !== authIdentity.current || !auth.session) { clearResults(); }
          else if (refreshData && selected.current) {
            const active = selected.current;
            try {
              const verified = 'key' in active.selection ? await getDetail(active.selection.key, signal)
                : await openDraft(active.selection.draftId, active.scope, signal);
              if (signal.aborted) return;
              if (selected.current === active) setRechecked(verified);
            } catch (cause) {
              if (signal.aborted) return;
              // A closed/replaced panel cannot invalidate the current page.
              if (selected.current === active) {
                if (!(cause instanceof RetrievalError) || cause.status !== 404) throw cause;
                selected.current = null; setSelection(null); setRechecked(null); dirty.current = false;
                setError('WO hoặc nháp không còn tồn tại hoặc không còn trong quyền truy cập. Bảng đã được cập nhật lại.');
              }
            }
          }
          if (refreshData && identity === authIdentity.current && auth.session && planningPage.current) {
            const page = planningPage.current;
            const revision = draftRevision.current;
            const latest = await listPlannedWorkOrders(page.scope, page.offset, signal);
            if (signal.aborted) return;
            if (revision !== draftRevision.current) {
              setStale(true); setError('Nháp đã thay đổi trong lúc tải. Bảng giữ kế hoạch mới nhất; bấm Cập nhật để lấy lại dữ liệu.'); return;
            }
            setRows(latest.items); setNextOffset(latest.next_offset);
            const keys = new Set(latest.items.map(rowKey));
            setSelectedKeys((previous) => previous.filter((key) => keys.has(key)));
            setUpdatedAt(Date.now()); setStale(false); setBatchRefresh((value) => value + 1);
          } else if (refreshData && identity === authIdentity.current && auth.session && retrieved.current) {
            const revision = draftRevision.current;
            const latest = await retrieveWorkOrders(retrieved.current, signal);
            if (signal.aborted) return;
            if (revision !== draftRevision.current) {
              setStale(true); setError('Nháp đã thay đổi trong lúc tải. Bảng giữ kế hoạch mới nhất; bấm Cập nhật để lấy lại dữ liệu.'); return;
            }
            setRows(latest);
            const keys = new Set(latest.map(rowKey));
            setSelectedKeys((previous) => previous.filter((key) => keys.has(key)));
            setUpdatedAt(Date.now()); setStale(false); setBatchRefresh((value) => value + 1);
          }
          const unchanged = !!auth.session && identity === authIdentity.current;
          authIdentity.current = identity;
          setSession((previous) => unchanged ? previous : auth.session);
          setAvailable(auth.available); setChecking(false);
        }
      }).catch((cause: unknown) => { if (!signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) {
          onDenied();
        } else {
          // Auth failure hides retained data; a failed explicit data refresh keeps the verified snapshot.
          setChecking(!authValidated);
          setError(authValidated ? 'Không cập nhật được dữ liệu. Bảng và phần đang sửa được giữ nguyên; hãy thử Cập nhật lại.' :
            'Chưa xác minh được quyền và dữ liệu hiện tại. Nội dung sửa đang được giữ ẩn; kiểm tra lại phiên để tiếp tục.');
        }
      } }).finally(() => {
        if (!signal.aborted && authRequest === controller) { authRequest = null; setVerifying(false); if (refreshData) setBusy(false); }
      });
    }
    function visibility() {
      if (!document.hidden) refresh();
    }
    refreshSession.current = refresh;
    refresh();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      refreshSession.current = null;
      authRequest?.abort(); pending.current?.abort();
      setVerifying(false); setBusy(false);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, onDenied]);

  useEffect(() => {
    if (updatedAt === null) return;
    const timer = window.setTimeout(() => setStale(true), Math.max(0, updatedAt + config.workOrderFreshnessMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [updatedAt, view]);

  useEffect(() => {
    if (!active) return;
    if (scrollPosition.current) window.scrollTo(0, scrollPosition.current);
    function rememberScroll() { scrollPosition.current = window.scrollY; }
    window.addEventListener('scroll', rememberScroll, { passive: true });
    return () => window.removeEventListener('scroll', rememberScroll);
  }, [active]);

  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } }
    function navigating(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const destination = new URL(link.href);
      if (destination.origin === window.location.origin && !destination.pathname.startsWith('/api/')) {
        return;
      } else if (!discard()) { event.preventDefault(); event.stopPropagation(); }
    }
    function changingConnection(event: Event) { if (!discard()) event.preventDefault(); }
    window.addEventListener('beforeunload', leaving);
    document.addEventListener('click', navigating, true);
    window.addEventListener('wo-connection-change', changingConnection);
    return () => { window.removeEventListener('beforeunload', leaving); document.removeEventListener('click', navigating, true); window.removeEventListener('wo-connection-change', changingConnection); };
  }, []);

  async function browseDrafts(offset = 0) {
    if (!grant || !discard()) return;
    clearResults(false); setView('drafts');
    await loadDraftPage(offset);
  }

  async function loadDraftPage(offset: number) {
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const result = await listPlannedWorkOrders(editorScope, offset, controller.signal);
      if (!controller.signal.aborted) {
        planningPage.current = { scope: editorScope, offset }; setOffset(offset);
        setRows(result.items); setNextOffset(result.next_offset);
        markUpdated();
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
        setError(cause instanceof Error ? cause.message : 'Không lấy được danh sách nháp.');
      }
    } finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }

  async function retrieve() {
    if (!grant || !discard()) return;
    if (view === 'drafts') rememberSource();
    delete sources.current.maximo;
    clearResults(false);
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const filter = { connection_id: grant.connection_id, discipline: grant.discipline,
        target_from: startOfDay(start, grant.timezone), target_before: startOfDay(end, grant.timezone) };
      const items = await retrieveWorkOrders(filter, controller.signal);
      if (!controller.signal.aborted && pending.current === controller) { retrieved.current = filter; setRows(items); markUpdated(); }
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller) {
        setError(cause instanceof Error ? cause.message : 'Không lấy được dữ liệu.');
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
      }
    } finally {
      if (!controller.signal.aborted && pending.current === controller) {
        pending.current = null; setBusy(false);
      }
    }
  }

  return <>
    <Link to="/" className={styles.back}>← Tổng quan</Link>
    <div className={styles.pageTitle}><h1>Work Orders</h1><span className={styles.badge}>Lập lịch / Nháp</span></div>
    <p className={styles.notice}>Nháp được lưu trên server và đánh dấu ngay trên WO. Ô có nhãn Nháp là kế hoạch đã lưu; Status vẫn từ Maximo. Bấm WO để mở kế hoạch và đối chiếu. Upload chưa mở.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && <button onClick={() => refreshSession.current?.()}>Kiểm tra lại phiên</button>}
    {checking && <p role="status">Đang kiểm tra quyền truy cập…</p>}
    {verifying && !checking && <p role="status">Đang xác minh phiên…</p>}
    <div hidden={checking}>{!session ? <p>
      Cần đăng nhập để xem WO. {available && <a href={loginUrl}>Đăng nhập Microsoft</a>}
    </p> : session.grants.length === 0 ? <p>Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.</p> : <>
      <div className={styles.accountContext}>
        {grant ? <span>{grant.label} · {grant.system} · {grant.environment} / {grant.discipline} · {grant.capability === 'read' ? 'Chỉ xem' : 'Có thể chỉnh sửa và lưu nháp'}</span> :
          <span>Chưa xác định được hệ thống mặc định. Mở Settings để chọn kết nối cho tài khoản.</span>}
        <Link to="/settings">Settings · Hệ thống</Link>
      </div>
      {grant && <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void retrieve(); }}>
        <label>Target Finish từ<input type="date" required value={start}
          onChange={(event) => changeDate(event.target.value, 'start')} /></label>
        <label>Target Finish trước<input type="date" required value={end}
          onChange={(event) => changeDate(event.target.value, 'end')} /></label>
        <button className={styles.primary} disabled={!grant || busy}>{busy ? 'Đang lấy WO…' : 'Retrieve WO'}</button>
      </form>}
      <details className={styles.tableHint}><summary>Khoảng ngày và bảo vệ nháp</summary>Khoảng lọc từ 00:00 ngày đầu đến trước 00:00 ngày cuối; chọn ngày kế tiếp để lấy hết ngày cuối. Bảng và phần đang sửa được giữ trong phiên làm việc; mất quyền hoặc phiên sẽ xóa dữ liệu khỏi giao diện.</details>
      {grant && <div className={styles.batchToolbar}><label>Nguồn WO<select aria-label="Nguồn WO" value={view} disabled={busy} onChange={(event) => {
        switchSource(event.target.value === 'drafts' ? 'drafts' : 'maximo');
      }}><option value="maximo">WO theo khoảng ngày Retrieve</option><option value="drafts">WO có nháp trong phạm vi</option></select></label>
        {view === 'drafts' && <><span>Nháp của tôi · trang {offset / 20 + 1} · không lọc theo khoảng ngày Retrieve</span>
          <button disabled={busy || offset === 0} onClick={() => void browseDrafts(Math.max(0, offset - 20))}>Trang trước</button>
          <button disabled={busy || nextOffset === null} onClick={() => void browseDrafts(nextOffset ?? 0)}>Trang tiếp</button></>}
      </div>}
      {grant && view === 'maximo' && rows === null && !busy && <p>Chưa Retrieve WO cho khoảng ngày này. Chọn ngày và bấm Retrieve WO để tải bảng.</p>}
      {chooser && grant && <section ref={focusChooser} role="dialog" tabIndex={-1} aria-label="Chọn nháp của WO"
        onKeyDown={(event) => { if (event.key === 'Escape') closePanel(); }} className={`${styles.draftEditor} ${styles.sidePanel}`}>
        <div className={styles.panelHeading}><h2>{chooser.wonum} · chọn nháp</h2><button onClick={closePanel}>Đóng</button></div>
        <p>WO này có nhiều kế hoạch đã lưu. Chọn kế hoạch để mở đúng phiên bản.</p>
        {chooser.drafts?.map((plan) => <p key={plan.draft_id}><button onClick={() => openPlan(chooser, plan)}>
          {plan.is_batch ? 'Nháp nhóm' : 'Nháp'} · v{plan.version} · {displayDate(plan.updated_at, grant.timezone)}
          {plan.baseline_changed ? ' · Cần đối chiếu' : ''}</button></p>)}
        <button onClick={() => choose({ key: { ...editorScope, site_id: chooser.siteid, workorder_id: chooser.workorderid } })}>Xem Maximo / tạo nháp mới</button>
      </section>}
      {selection && grant && <DraftEditor key={editorGeneration} selection={selection} scope={editorScope}
        timezone={grant.timezone}
        verifiedDetail={rechecked} writable={grant.capability === 'write'} suspended={checking} onDirty={onDirty} onDenied={onDenied}
        onDraftReady={onDraftReady} onClose={closePanel} />}
      {batch && grant && <BatchPlanner key={editorGeneration} selection={batch} scope={editorScope} timezone={grant.timezone}
        writable={grant.capability === 'write'} suspended={checking} refreshVersion={batchRefresh} onDirty={onDirty} onDenied={onDenied} onDraftReady={onDraftReady} onClose={closePanel} />}
      {busy && <p role="status">Đang lấy và kiểm tra đầy đủ các trang dữ liệu…</p>}
      {rows !== null && <>
        {updatedAt !== null && grant && <div className={styles.batchToolbar}>
          <span>Cập nhật lần cuối: {new Intl.DateTimeFormat('vi-VN', { timeZone: grant.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(updatedAt)}</span>
          {stale && <span role="status">Dữ liệu có thể đã thay đổi.</span>}
          <button disabled={busy || verifying || checking} onClick={() => refreshSession.current?.(true)}>Cập nhật</button>
        </div>}
        <p role="status">{rows.length === 0 ? view === 'drafts' ? 'Không có WO có nháp khả dụng trong trang này.' : 'Không có WO trong phạm vi và khoảng ngày đã chọn.' : `${rows.length} WO đã lấy đầy đủ.`}</p>
        {rows.length > 0 && <>
          <div className={`${styles.filters} ${styles.tableFilters}`} role="search" aria-label="Lọc WO đã tải">
            <label>Tìm WO, mô tả hoặc Tag Name<input type="search" value={search}
              onChange={(event) => { filterChanged(); setSearch(event.target.value); }} /></label>
            <label>Status<select value={statusFilter} onChange={(event) => { filterChanged(); setStatusFilter(event.target.value); }}>
              <option value="">Tất cả status đã tải</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select></label>
            <label>Lập lịch<select value={planningFilter} onChange={(e) => { filterChanged(); setPlanningFilter(e.target.value); }}><option value="">Tất cả WO</option><option value="schedule">Chưa lập lịch đầy đủ</option><option value="pic">Chưa có Assigned PIC</option></select></label>
            <label>Nháp<select aria-label="Nháp" value={draftFilter} onChange={(e) => { filterChanged(); setDraftFilter(e.target.value); }}>
              <option value="">Tất cả ({rows.length})</option><option value="yes">Có nháp ({rows.filter((row) => row.drafts?.length).length})</option>
              <option value="no">Chưa có nháp ({rows.filter((row) => !row.drafts?.length).length})</option></select></label>
            <button disabled={!search && !statusFilter && !planningFilter && !draftFilter} onClick={() => { filterChanged(); setSearch(''); setStatusFilter(''); setPlanningFilter(''); setDraftFilter(''); }}>Xóa bộ lọc bảng</button>
          </div>
          <p role="status">Hiển thị {visibleRows.length} / {rows.length} WO. Bộ lọc chỉ áp dụng cho dữ liệu đã tải.</p>
          {visibleRows.length === 0 && <p>Không có WO khớp bộ lọc bảng. Xóa bộ lọc để xem lại dữ liệu đã tải.</p>}
        </>}
        {visibleRows.length > 0 && grant && <>
          <div className={styles.batchToolbar}>
            <span>Bảng gọn · bấm Work Order để xem đầy đủ thông tin trong panel</span>
            {grant.capability === 'write' && <><span>{selectedKeys.length} WO đã chọn · đổi bộ lọc sẽ bỏ chọn</span>
              <button className={styles.primary} disabled={!selectedKeys.length || busy} onClick={() => {
                const picked = visibleRows.filter((row) => selectedKeys.includes(rowKey(row)));
                const planned = picked.filter((row) => row.drafts?.length);
                if (planned.length) {
                  const plan = chosenPlan(planned[0], choices[rowKey(planned[0])]);
                  if (plan?.is_batch && planned.length === picked.length && picked.every((row) => chosenPlan(row, choices[rowKey(row)])?.draft_id === plan.draft_id)) {
                    openPlan(planned[0], plan); return;
                  }
                  setError('Có WO đã có nháp. Bấm WO để mở kế hoạch đã lưu, hoặc lọc Chưa có nháp để lập lịch nhóm mới.'); return;
                }
                const keys = picked.map((row) => ({ site_id: row.siteid, workorder_id: row.workorderid }));
                if (keys.length > 200) { setError('Chọn tối đa 200 WO cho một nháp nhóm.'); return; }
                chooseBatch({ keys });
              }}>Lập lịch nhóm ({selectedKeys.length})</button></>}
          </div>
          <div className={`${styles.tableWrap} ${styles.compactTable}`} tabIndex={0} role="region" aria-label="WO từ Maximo">
          <table><thead><tr>{grant.capability === 'write' && <th scope="col"><input type="checkbox" aria-label={`Chọn tất cả ${visibleRows.length} WO trong kết quả lọc đã tải`} checked={!!visibleRows.length && visibleRows.every((row) => selectedKeys.includes(rowKey(row)))} onChange={(e) => setSelectedKeys(e.target.checked ? visibleRows.map(rowKey) : [])} /></th>}
            <th scope="col">Work Order / Type</th><th scope="col">Công việc / Tag Name</th><th scope="col">Status / Priority</th><th scope="col">Lịch dự kiến</th><th scope="col">Target Start / Finish</th><th scope="col">Assigned PIC</th><th scope="col">Duration (giờ)</th></tr></thead>
            <tbody>{visibleRows.map((row, index) => {
              const plan = chosenPlan(row, choices[rowKey(row)]);
              const changed = (fields: string[]) => !!plan && !plan.baseline_changed && fields.some((field) => field in plan.changes);
              return <tr key={JSON.stringify([scope, row.siteid, row.workorderid])}>
              {grant.capability === 'write' && <td><input type="checkbox" aria-label={`Chọn ${row.wonum} · dòng ${index + 1}`} checked={selectedKeys.includes(rowKey(row))} onChange={(e) => setSelectedKeys((previous) => e.target.checked ? [...previous, rowKey(row)] : previous.filter((key) => key !== rowKey(row)))} /></td>}
              <td><button className={styles.woLink} onClick={() => openRow(row)}>{row.wonum}</button><small>{row.worktype}</small>
                {!!row.drafts?.length && <small className={styles.draftMarker}>{row.drafts.length > 1 ? plan ? `${plan.is_batch ? 'Nháp nhóm' : 'Nháp'} · v${plan.version} · ${row.drafts.length} nháp` : `${row.drafts.length} nháp · chọn để mở` :
                  `${row.drafts[0].is_batch ? 'Nháp nhóm' : 'Nháp'} · v${row.drafts[0].version}`}
                  {plan?.baseline_changed && ' · Cần đối chiếu'}</small>}</td>
              <td className={styles.descriptionCell}>{row.description ?? '—'}<small>{row.location ?? 'Chưa có Tag Name'}</small></td>
              <td><span className={styles.statusBadge} data-status={row.status}>{row.status}</span><small>{row.wopriority_description ?? '—'} ({row.wopriority ?? '—'})</small></td>
              <td data-draft={changed(['schedstart', 'schedfinish'])}>{displayDate(row.schedstart, grant.timezone)}<small>→ {displayDate(row.schedfinish, grant.timezone)}</small>{changed(['schedstart', 'schedfinish']) && <small>Nháp</small>}</td>
              <td data-draft={changed(['targstartdate', 'targcompdate'])}>{displayDate(row.targstartdate, grant.timezone, false)}<small>→ {displayDate(row.targcompdate, grant.timezone, false)}</small>{changed(['targstartdate', 'targcompdate']) && <small>Nháp</small>}</td>
              <td data-draft={changed(['assignedtechname'])}>{row.assignedtechname ?? 'Chưa phân công'}{changed(['assignedtechname']) && <small>Nháp</small>}</td>
              <td data-draft={changed(['estdur'])}>{row.estdur ?? '—'}{changed(['estdur']) && <small>Nháp</small>}</td>
            </tr>; })}</tbody></table></div>
        </>}
      </>}
    </>}</div>
  </>;
}
