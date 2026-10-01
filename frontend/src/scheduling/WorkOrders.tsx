import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, loginUrl, type Session } from '../api/client';
import { columns, RetrievalError, retrieveWorkOrders, type WorkOrder } from '../api/workOrders';
import styles from '../App.module.css';
import { DraftEditor, type EditorSelection } from './DraftEditor';
import { getDetail, openDraft, listDrafts, type Detail, type DraftSummary, type Scope } from '../api/drafts';

export function WorkOrders() {
  const [session, setSession] = useState<Session | null>(null);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [scope, setScope] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [rechecked, setRechecked] = useState<Detail | null>(null);
  const selected = useRef<{ selection: EditorSelection; scope: Scope } | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const dirty = useRef(false);
  const authIdentity = useRef('');
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const pending = useRef<AbortController | null>(null);
  const refreshSession = useRef<(() => void) | null>(null);
  const grant = session?.grants.find((item) => JSON.stringify([item.connection_id, item.discipline]) === scope);

  const editorScope = useMemo(() => ({ connection_id: grant?.connection_id ?? '', discipline: grant?.discipline ?? '' }), [grant?.connection_id, grant?.discipline]);

  useEffect(() => { selected.current = selection ? { selection, scope: editorScope } : null; }, [selection, editorScope]);

  const onDenied = useCallback(() => {
    pending.current?.abort(); setRows(null); setRechecked(null); setSelection(null); setDrafts(null); setSession(null); setScope('');
    dirty.current = false; authIdentity.current = '';
  }, []);
  function discard() {
    return !dirty.current || window.confirm('Có thay đổi chưa lưu. Bỏ các thay đổi này?');
  }
  function choose(next: EditorSelection) {
    if (!discard()) return;
    dirty.current = false;
    setRechecked(null);
    setSelection(next);
    setEditorGeneration((previous) => previous + 1);
  }
  function clearResults() {
    setSelection(null); setRechecked(null); setDrafts(null); setNextOffset(null); dirty.current = false;
    pending.current?.abort();
    pending.current = null;
    setRows(null);
    setBusy(false);
    setError('');
  }
  useEffect(() => {
    let authRequest: AbortController | null = null;
    function refresh() {
      authRequest?.abort();
      pending.current?.abort(); pending.current = null; setBusy(false);
      setRows(null); setDrafts(null); setChecking(true); setError('');
      authRequest = new AbortController();
      const signal = authRequest.signal;
      getAuthSummary(signal).then(async (auth) => {
        if (!signal.aborted) {
          const identity = auth.session ? JSON.stringify([auth.session.user.id, [...auth.session.grants].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]) : '';
          if (identity !== authIdentity.current || !auth.session) { clearResults(); setScope(''); }
          else if (selected.current) {
            const active = selected.current;
            const verified = 'key' in active.selection ? await getDetail(active.selection.key, signal)
              : await openDraft(active.selection.draftId, active.scope, signal);
            if (signal.aborted) return;
            setRechecked(verified);
          }
          authIdentity.current = identity; setSession(auth.session); setAvailable(auth.available); setChecking(false);
        }
      }).catch((cause: unknown) => { if (!signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) {
          onDenied(); setChecking(false); setError(cause.message);
        } else setError('Chưa xác minh được quyền và dữ liệu hiện tại. Nội dung sửa đang được giữ ẩn; kiểm tra lại phiên để tiếp tục.');
      } });
    }
    function visibility() {
      if (document.hidden) {
        authRequest?.abort(); pending.current?.abort(); pending.current = null; setBusy(false); setChecking(true);
      } else refresh();
    }
    refreshSession.current = refresh;
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => { if (!document.hidden && !pending.current) refresh(); }, 60000);
    return () => {
      refreshSession.current = null;
      authRequest?.abort(); pending.current?.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [onDenied]);

  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } }
    function navigating(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('a[href]') && !discard()) { event.preventDefault(); event.stopPropagation(); }
    }
    window.addEventListener('beforeunload', leaving);
    document.addEventListener('click', navigating, true);
    return () => { window.removeEventListener('beforeunload', leaving); document.removeEventListener('click', navigating, true); };
  }, []);

  async function browseDrafts(offset = 0) {
    if (!grant) return;
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const result = await listDrafts(editorScope, offset, controller.signal);
      if (!controller.signal.aborted) { setDrafts(result.items); setNextOffset(result.next_offset); }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
        setError(cause instanceof Error ? cause.message : 'Không lấy được danh sách nháp.');
      }
    } finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }

  async function retrieve() {
    if (!grant || !discard()) return;
    clearResults();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const items = await retrieveWorkOrders({ connection_id: grant.connection_id, discipline: grant.discipline,
        target_from: start.trim(), target_before: end.trim() }, controller.signal);
      if (!controller.signal.aborted && pending.current === controller) setRows(items);
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller) {
        setError(cause instanceof Error ? cause.message : 'Không lấy được dữ liệu.');
        if (cause instanceof RetrievalError && [401, 404].includes(cause.status)) {
          setSession(null); setScope('');
        }
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
    <p className={styles.notice}>Dữ liệu lấy qua API theo quyền được cấp. Lưu nháp không thay đổi Maximo; upload chưa mở.</p>
    <p>Bấm số WO để mở phần lập lịch. Mỗi nháp lưu thay đổi của một WO; người có quyền đọc chỉ xem được dữ liệu.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && <button onClick={() => refreshSession.current?.()}>Kiểm tra lại phiên</button>}
    {checking && <p role="status">Đang kiểm tra quyền truy cập…</p>}
    <div hidden={checking}>{!session ? <p>
      Cần đăng nhập để xem WO. {available && <a href={loginUrl}>Đăng nhập Microsoft</a>}
    </p> : session.grants.length === 0 ? <p>Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.</p> : <>
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void retrieve(); }}>
        <label>Hệ thống / Discipline<select required aria-label="Hệ thống / Discipline" value={scope}
          onChange={(event) => { if (discard()) { clearResults(); setScope(event.target.value); } }}>
          <option value="">Chọn phạm vi được cấp quyền</option>
          {session.grants.map((item) => {
            const key = JSON.stringify([item.connection_id, item.discipline]);
            return <option key={key} value={key}>{item.label} · {item.system} · {item.environment} · {item.discipline}</option>;
          })}
        </select></label>
        <label>Target Finish từ<input required value={start} placeholder="2026-09-01T00:00:00+07:00"
          onChange={(event) => { if (discard()) { clearResults(); setStart(event.target.value); } }} /></label>
        <label>Target Finish trước<input required value={end} placeholder="2026-10-01T00:00:00+07:00"
          onChange={(event) => { if (discard()) { clearResults(); setEnd(event.target.value); } }} /></label>
        <button className={styles.primary} disabled={!grant || busy}>{busy ? 'Đang lấy WO…' : 'Retrieve WO'}</button>
      </form>
      <p className={styles.tableHint}>Nhập ngày giờ ISO có múi giờ đã xác nhận; mốc cuối không bao gồm. Ngày trong bảng giữ nguyên offset từ Maximo. Nội dung sửa được giữ khi kiểm tra lại phiên nếu tài khoản và quyền không đổi; dữ liệu bị xóa khi phiên hết hạn hoặc quyền thay đổi.</p>
      {grant && <p>{grant.label} · {grant.system} · {grant.environment} / {grant.discipline}</p>}
      {grant && <button disabled={busy} onClick={() => void browseDrafts()}>Danh sách nháp</button>}
      {drafts !== null && <section aria-label="Danh sách nháp">
        <h2>Nháp của tôi</h2>{drafts.length === 0 && <p>Không có nháp trong trang này.</p>}
        {drafts.map((draft) => <p key={draft.draft_id}><button onClick={() => choose({ draftId: draft.draft_id })}>Mở {draft.wonum} · {draft.site_id} · v{draft.version}</button></p>)}
        {nextOffset !== null && <button disabled={busy} onClick={() => void browseDrafts(nextOffset)}>Trang nháp tiếp</button>}
      </section>}
      {selection && grant && <DraftEditor key={editorGeneration} selection={selection} scope={editorScope}
        verifiedDetail={rechecked} writable={grant.capability === 'write'} suspended={checking} onDirty={onDirty} onDenied={onDenied}
        onClose={() => { if (discard()) { setSelection(null); setDrafts(null); dirty.current = false; } }} />}
      {busy && <p role="status">Đang lấy và kiểm tra đầy đủ các trang dữ liệu…</p>}
      {rows !== null && <>
        <p role="status">{rows.length === 0 ? 'Không có WO trong phạm vi và khoảng ngày đã chọn.' : `${rows.length} WO đã lấy đầy đủ.`}</p>
        {rows.length > 0 && <div className={`${styles.tableWrap} ${styles.schedulerTable}`} tabIndex={0} role="region" aria-label="WO từ Maximo">
          <table><thead><tr>{columns.map(([field, title]) => <th scope="col" key={field}>{title}</th>)}
            <th scope="col">Upload?</th><th scope="col">Change Target?</th><th scope="col">Site</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={JSON.stringify([scope, row.siteid, row.workorderid])}>
              {columns.map(([field]) => <td key={field} className={field === 'description' ? styles.descriptionCell : undefined}>
                {field === 'wonum' && grant ? <button onClick={() => choose({ key: { ...editorScope, site_id: row.siteid, workorder_id: row.workorderid } })}>{row.wonum}</button> : field === 'status' ? <span className={styles.statusBadge} data-status={row.status}>{row.status}</span> :
                  field === 'wolo10' ? (row.wolo10 === null ? '—' : `${row.wolo10}%`) :
                    field === 'wopriority_description' ? `${row.wopriority_description ?? '—'} (${row.wopriority ?? '—'})` : row[field] ?? '—'}
              </td>)}
              <td>Chưa mở</td><td>Chưa mở</td><td>{row.siteid}</td>
            </tr>)}</tbody></table>
        </div>}
      </>}
    </>}</div>
  </>;
}
