import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { BatchError, deleteDraft, openBatch, prepareBatch, saveBatch, editableFields, type BatchRow, type Changes,
  type DraftNotice, type EditableField, type Saved, type Scope } from '../api/drafts';
import { localDateTime, zonedDateTime } from '../api/dates';
import { RetrievalError } from '../api/workOrders';
import { scheduledChange, validateChanges } from './editing';
import { displayDate, rowKey } from './presentation';
import { BatchWorkOrderInfo } from './BatchWorkOrderInfo';
import styles from '../App.module.css';

export type BatchSelection = { keys: { site_id: string; workorder_id: string }[] } | { draftId: string };
const fields = ['schedstart', 'schedfinish', 'assignedtechname', 'estdur'] as const;
const inputFields = ['schedstart', 'assignedtechname', 'estdur'] as const;
const labels = { schedstart: 'Scheduled Start', schedfinish: 'Scheduled Finish', assignedtechname: 'Assigned PIC', estdur: 'Est. Duration' };

export function BatchPlanner({ selection, scope, timezone, writable, suspended, refreshVersion = 0, onDirty, onDenied, onClose, onDraftReady }: {
  selection: BatchSelection; scope: Scope; timezone: string; writable: boolean; suspended: boolean;
  onDirty: (value: boolean) => void; onDenied: () => void; onClose: () => void;
  onDraftReady?: (draft: DraftNotice) => void;
  refreshVersion?: number;
}) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [committed, setCommitted] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [group, setGroup] = useState<Changes>({});
  const [paste, setPaste] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [history, setHistory] = useState<BatchRow[][]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const infoId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  const current = useRef<BatchRow[]>([]);
  const existing = useRef<Saved | null>(null);
  const pending = useRef<AbortController | null>(null);
  const retry = useRef<{ fingerprint: string; id: string } | null>(null);
  const dirty = JSON.stringify(rows.map((row) => row.changes)) !== committed;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { current.current = rows; existing.current = saved; }, [rows, saved]);
  const fail = useCallback((cause: unknown) => {
    if ((cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) ||
        (cause instanceof BatchError && cause.issues.some((issue) => issue.code === 'unavailable'))) onDenied();
    else {
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được nhóm WO.');
      if (cause instanceof BatchError) setIssues(Object.fromEntries(cause.issues.map((issue) =>
        [JSON.stringify([issue.site_id, issue.workorder_id]), ({ unavailable: 'WO không còn khả dụng; mở lại để kiểm tra.',
          baseline_changed: 'WO đã thay đổi; mở lại để đối chiếu.' } as Record<string, string>)[issue.code]]).filter((entry) => entry[1])));
    }
  }, [onDenied]);
  useEffect(() => {
    pending.current?.abort();
    if (suspended) return;
    const controller = new AbortController(); pending.current = controller;
    const before = current.current;
    const action = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return null;
      setBusy(true); setError(''); setVerified(false);
      return existing.current ? openBatch(existing.current.draft_id, scope, controller.signal)
      : 'draftId' in selection ? openBatch(selection.draftId, scope, controller.signal)
        : prepareBatch(scope, selection.keys, controller.signal);
    });
    action.then((result) => {
      if (controller.signal.aborted || result === null) return;
      const loaded: BatchRow[] = Array.isArray(result) ? result.map((detail) => ({ ...detail, changes: {} })) : result.items;
      if (!before.length) {
        setRows(loaded); setCommitted(JSON.stringify(loaded.map((row) => row.changes)));
        if (!Array.isArray(result)) setSaved(result);
      } else {
        const fresh = new Map(loaded.map((row) => [rowKey(row.item), row]));
        const changed: Record<string, string> = {};
        before.forEach((row) => {
          const value = fresh.get(rowKey(row.item));
          if (!value || value.baseline_token !== row.baseline_token || value.baseline_changed || value.changes_valid_now === false) {
            changed[rowKey(row.item)] = 'Dữ liệu gốc đã đổi; giữ nháp để đối chiếu, mở lại trước khi lưu.';
          }
        });
        if (existing.current && !Array.isArray(result) && result.version !== existing.current.version) {
          before.forEach((row) => { changed[rowKey(row.item)] = 'Nháp đã đổi phiên bản; mở lại trước khi lưu.'; });
        }
        setRows(before.map((row) => ({ ...row, allowed_pics: fresh.get(rowKey(row.item))?.allowed_pics ?? [] })));
        setIssues(changed);
      }
      if (loaded.some((row) => row.baseline_changed || row.changes_valid_now === false)) {
        setIssues(Object.fromEntries(loaded.filter((row) => row.baseline_changed || row.changes_valid_now === false)
          .map((row) => [rowKey(row.item), 'Baseline hoặc crew đã đổi; tạo nháp mới sau đối chiếu.'])));
      }
      setVerified(true);
      if (!Array.isArray(result)) onDraftReady?.({ ...result, items: loaded });
    }).catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [selection, scope, suspended, refreshVersion, fail, onDraftReady]);

  const pics = rows.length ? rows[0].allowed_pics.filter((pic) => rows.every((row) => row.allowed_pics.includes(pic))) : [];
  const changed = rows.filter((row) => editableFields.some((field) => row.changes[field] !== undefined));
  const problems = Object.fromEntries(rows.map((row) => [rowKey(row.item), issues[rowKey(row.item)] || validateChanges(row.baseline, row.changes, row.allowed_pics)]));
  const blocked = !verified || busy || suspended || !writable;
  function stage(next: BatchRow[]) {
    setHistory((previous) => [...previous.slice(-19), rows]); setRows(next); setNotice(''); setError(''); setShowPreview(false);
  }
  function edit(index: number, field: EditableField, value: string) {
    stage(rows.map((row, i) => i === index ? { ...row, changes: scheduledChange(row.changes, row.baseline, field, value) } : row));
  }
  function apply() {
    if (!Object.keys(group).length) return;
    stage(rows.map((row) => ({ ...row, changes: inputFields.reduce((changes, field) => group[field] === undefined ? changes :
      scheduledChange(changes, row.baseline, field, group[field]!), row.changes) })));
  }
  function applyPaste() {
    const lines = paste.replace(/\r?\n$/, '').split(/\r?\n/);
    if (!paste.trim() || lines.length !== rows.length) { setError(`Cần đúng ${rows.length} dòng, theo thứ tự WO trong bảng.`); return; }
    try {
      const next = rows.map((row, index) => {
        const values = lines[index].split('\t');
        if (values.length !== 3) throw new Error('Mỗi dòng cần 3 cột: Start, PIC, Duration. Finish tự tính; ô trống giữ nguyên.');
        let changes = row.changes;
        inputFields.forEach((field, i) => {
          const value = values[i].trim();
          if (value) changes = scheduledChange(changes, row.baseline, field,
            field === 'schedstart' ? zonedDateTime(value, timezone) : value);
        });
        const problem = validateChanges(row.baseline, changes, row.allowed_pics);
        if (problem) throw new Error(`${row.item.wonum}: ${problem}`);
        return { ...row, changes };
      });
      stage(next); setPaste('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Dữ liệu dán không hợp lệ.'); }
  }
  async function save() {
    if (blocked || !dirty || !showPreview || Object.values(problems).some(Boolean)) return;
    const items = saved ? rows : changed;
    if (!items.length || items.some((row) => !editableFields.some((field) => row.changes[field] !== undefined))) {
      setError('Nháp đã lưu phải giữ thay đổi của từng WO; dùng Undo hoặc tạo nhóm mới.'); return;
    }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
    const fingerprint = JSON.stringify([scope, items, saved?.version]);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await saveBatch(scope, items, retry.current.id, saved, controller.signal);
      if (!controller.signal.aborted) {
        setSaved(result); setRows(items); setCommitted(JSON.stringify(items.map((row) => row.changes)));
        setHistory([]); retry.current = null; setNotice(`Đã lưu nháp ${items.length} WO · v${result.version}. Maximo chưa thay đổi.`);
        onDraftReady?.({ ...result, items });
      }
    } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function remove() {
    if (blocked || !saved || !confirmDelete) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
    try {
      await deleteDraft(saved, controller.signal);
      if (!controller.signal.aborted) { onDraftReady?.({ ...saved, items: null }); onDirty(false); onClose(); }
    } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section ref={panel} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }} className={`${styles.sidePanel} ${styles.batchPanel}`} role="dialog" aria-label="Lập lịch hàng loạt" aria-modal="false">
    <div className={styles.panelHeading}><h2>Lập lịch {rows.length || ('keys' in selection ? selection.keys.length : '')} WO</h2><button disabled={busy} onClick={onClose}>Đóng nhóm</button></div>
    <p>{scope.discipline} · {saved ? `Nháp v${saved.version}` : 'Chưa lưu nháp'}</p>
    <p>Scheduled Finish tự tính từ Scheduled Start + Est. Duration (giờ).</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">Đang kiểm tra từng WO…</p>}
    <fieldset disabled={blocked} className={styles.groupFields}><legend>Áp dụng cho nhóm · trường không chọn giữ nguyên</legend>
      {inputFields.map((field) => <label key={field}><input type="checkbox" aria-label={labels[field]} checked={group[field] !== undefined}
        onChange={(event) => setGroup((previous) => { const next = { ...previous }; if (event.target.checked) next[field] = ''; else delete next[field]; return next; })} />{labels[field]}
        {group[field] !== undefined && (field === 'assignedtechname' ? <select aria-label={`Nhóm ${labels[field]}`} value={group[field]}
          onChange={(e) => setGroup((previous) => ({ ...previous, [field]: e.target.value }))}><option value="">Chọn PIC</option>{pics.map((pic) => <option key={pic}>{pic}</option>)}</select>
          : <input aria-label={`Nhóm ${labels[field]}`} type={field === 'estdur' ? 'text' : 'datetime-local'} value={field === 'estdur' ? group[field] : group[field] ? localDateTime(group[field]!, timezone) : ''}
            inputMode={field === 'estdur' ? 'decimal' : undefined} onChange={(e) => {
              try { const value = field === 'estdur' || !e.target.value ? e.target.value : zonedDateTime(e.target.value, timezone);
                setGroup((previous) => ({ ...previous, [field]: value })); setError('');
              } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ngày không hợp lệ.'); }
            }} />)}
      </label>)}
      <button onClick={apply} disabled={!Object.keys(group).length || Object.values(group).some((value) => !String(value).trim())}>Áp dụng vào nháp</button>
    </fieldset>
    <div className={styles.batchToolbar}><button disabled={blocked || !history.length} onClick={() => { const previous = history.at(-1); if (previous) { setRows(previous); setHistory(history.slice(0, -1)); setShowPreview(false); } }}>Undo</button>
      <span>{changed.length} / {rows.length} WO có thay đổi</span><button disabled={blocked || !changed.length} onClick={() => setShowPreview(true)}>Xem trước thay đổi</button>
      <button className={styles.primary} disabled={blocked || !dirty || !showPreview || Object.values(problems).some(Boolean)} onClick={() => void save()}>Lưu nháp nhóm</button></div>
    <div className={styles.tableWrap}><table className={styles.planningTable}><thead><tr><th>Work Order / Công việc</th>{fields.map((field) => <th key={field}>{labels[field]}</th>)}<th>Kiểm tra</th></tr></thead>
      <tbody>{rows.map((row, index) => <Fragment key={rowKey(row.item)}><tr><th scope="row">{row.item.wonum}<small>{row.item.worktype} · {row.item.status}</small><small>{row.item.description ?? '—'}</small><small>{row.item.location ?? 'Chưa có Tag Name'}</small>
        <button className={styles.batchInfoToggle} aria-label={`Thông tin ${row.item.wonum}`} aria-expanded={expandedRow === rowKey(row.item)} aria-controls={`${infoId}-${index}`}
          onClick={() => setExpandedRow((previous) => previous === rowKey(row.item) ? null : rowKey(row.item))}>
          <span aria-hidden="true">{expandedRow === rowKey(row.item) ? '▾' : '▸'}</span> Thông tin bổ sung
        </button></th>
        {fields.map((field) => { const value = row.changes[field] ?? row.baseline[field] ?? ''; return <td key={field} className={row.changes[field] !== undefined ? styles.modified : undefined}>
          {field === 'schedfinish' ? <input aria-label={`${row.item.wonum} ${labels[field]}`} readOnly value={displayDate(value || null, timezone)} /> : field === 'assignedtechname' ? <select aria-label={`${row.item.wonum} ${labels[field]}`} disabled={blocked} value={value} onChange={(e) => edit(index, field, e.target.value)}>
            <option value={row.baseline[field] ?? ''}>{row.baseline[field] ?? 'Chưa có PIC'}</option>{row.allowed_pics.filter((pic) => pic !== row.baseline[field]).map((pic) => <option key={pic}>{pic}</option>)}</select>
            : <input aria-label={`${row.item.wonum} ${labels[field]}`} disabled={blocked} type={field === 'estdur' ? 'text' : 'datetime-local'} value={field === 'estdur' ? value : value ? localDateTime(value, timezone) : ''}
              inputMode={field === 'estdur' ? 'decimal' : undefined} onChange={(e) => { try { edit(index, field, field === 'estdur' || !e.target.value ? e.target.value : zonedDateTime(e.target.value, timezone)); }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'Ngày không hợp lệ.'); } }} />}</td>; })}
        <td>{problems[rowKey(row.item)] && <span role="alert" className={styles.error}>{problems[rowKey(row.item)]}</span>}<button disabled={blocked} onClick={() => stage(rows.map((value, i) => i === index ? { ...value, changes: {} } : value))}>Reset dòng</button></td></tr>
        {expandedRow === rowKey(row.item) && <tr><td colSpan={fields.length + 2} className={styles.batchInfoCell}>
          <BatchWorkOrderInfo row={row.item} timezone={timezone} id={`${infoId}-${index}`} />
        </td></tr>}
      </Fragment>)}</tbody></table></div>
    {showPreview && <section aria-label="Preview nhóm"><h3>Thay đổi trước / sau</h3><table><thead><tr><th>WO</th><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>
      {changed.flatMap((row) => editableFields.filter((field) => row.changes[field] !== undefined).map((field) => <tr key={`${rowKey(row.item)}:${field}`}><td>{row.item.wonum}</td><td>{field in labels ? labels[field as keyof typeof labels] : field}</td>
        <td>{field.includes('start') || field.includes('finish') || field.includes('date') ? displayDate(row.baseline[field], timezone) : row.baseline[field] ?? '—'}</td>
        <td>{field.includes('start') || field.includes('finish') || field.includes('date') ? displayDate(row.changes[field] ?? null, timezone) : row.changes[field]}</td></tr>))}</tbody></table></section>}
    <details><summary>Dán vùng từ Excel</summary><p>Theo thứ tự WO trong bảng: Start, PIC, Duration. Ngày: YYYY-MM-DDTHH:mm; Finish tự tính, ô trống giữ nguyên. Kiểm tra và áp vào nháp trước khi lưu.</p>
      <textarea aria-label="Vùng dữ liệu Excel" disabled={blocked} value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} /><button disabled={blocked} onClick={applyPaste}>Kiểm tra và áp dữ liệu dán</button></details>
    {saved && writable && <div className={styles.batchToolbar}><button disabled={blocked} onClick={() => setConfirmDelete(true)}>Xóa nháp nhóm</button>
      {confirmDelete && <><span>Xóa nháp của toàn bộ {rows.length} WO? Maximo giữ nguyên.</span><button disabled={blocked} onClick={() => void remove()}>Xác nhận xóa nháp nhóm</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>Hủy xóa</button></>}</div>}
  </section>;
}
