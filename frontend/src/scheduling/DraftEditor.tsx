import { useEffect, useRef, useState } from 'react';
import { deleteDraft, editableFields, getDetail, openDraft, saveDraft,
  type Changes, type Detail, type EditableField, type Identity, type Restored, type Saved, type Scope } from '../api/drafts';
import { RetrievalError } from '../api/workOrders';
import { isAwareDate } from '../api/dates';
import styles from '../App.module.css';

const labels: Record<EditableField, string> = { schedstart: 'Scheduled Start', schedfinish: 'Scheduled Finish',
  assignedtechname: 'Assigned PIC', estdur: 'Est. Duration', targstartdate: 'Target Start', targcompdate: 'Target Finish' };
const target = (field: EditableField) => field === 'targstartdate' || field === 'targcompdate';
function equalField(field: EditableField, value: string, original: string | null): boolean {
  if (value === (original ?? '')) return true;
  if (original === null) return false;
  if (field === 'estdur' && /^\d+(\.\d+)?$/.test(value) && /^\d+(\.\d+)?$/.test(original)) {
    const normalize = (number: string) => number.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return normalize(value) === normalize(original);
  }
  return field !== 'estdur' && field !== 'assignedtechname' && isAwareDate(value) && isAwareDate(original) &&
    Date.parse(value) === Date.parse(original);
}
export type EditorSelection = { key: Identity } | { draftId: string };

export function DraftEditor({ selection, scope, writable, suspended, verifiedDetail, onDirty, onDenied, onClose }: {
  verifiedDetail?: Detail | null; selection: EditorSelection; scope: Scope; writable: boolean; suspended: boolean;
  onDirty: (dirty: boolean) => void; onDenied: () => void; onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [changes, setChanges] = useState<Changes>({});
  const [saved, setSaved] = useState<Saved | null>(null);
  const [restoreBlocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [committed, setCommitted] = useState('{}');
  const pending = useRef<AbortController | null>(null);
  const retry = useRef<{ fingerprint: string; id: string } | null>(null);
  const pics = verifiedDetail?.allowed_pics ?? detail?.allowed_pics ?? [];
  const blocked = restoreBlocked || (!!detail && !!verifiedDetail && verifiedDetail.baseline_token !== detail.baseline_token) || (!!changes.assignedtechname && !pics.includes(changes.assignedtechname));
  const changed = editableFields.filter((field) => changes[field] !== undefined && changes[field] !== detail?.baseline[field]);

  const unsaved = JSON.stringify(changes) !== committed;
  useEffect(() => { onDirty(unsaved); }, [unsaved, onDirty]);
  useEffect(() => {
    if (suspended || loaded) return;
    const controller = new AbortController();
    pending.current = controller;
    const promise: Promise<Detail | Restored> = 'key' in selection ? getDetail(selection.key, controller.signal) : openDraft(selection.draftId, scope, controller.signal);
    promise.then((value) => {
      if (controller.signal.aborted) return;
      setDetail(value); setLoaded(true); setError('');
      if ('changes' in value) {
        setSaved(value); setChanges(value.changes); setCommitted(JSON.stringify(value.changes));
        setBlocked(value.baseline_changed || !value.changes_valid_now);
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
      else setError(cause instanceof Error ? cause.message : 'Không mở được WO.');
    });
    return () => controller.abort();
  }, [selection, scope, suspended, loaded, onDenied]);
  useEffect(() => {
    if (suspended) { pending.current?.abort(); }
    return () => pending.current?.abort();
  }, [suspended]);

  function change(field: EditableField, value: string) {
    setNotice(''); setError('');
    setChanges((previous) => {
      const next = { ...previous };
      if (equalField(field, value, detail?.baseline[field] ?? null)) delete next[field]; else next[field] = value;
      return next;
    });
  }
  function validation(): string {
    if (!detail) return '';
    for (const field of changed) {
      const value = changes[field]!;
      if (!value.trim()) return 'Chưa hỗ trợ xóa giá trị. Dùng Reset để bỏ thay đổi.';
      if (field === 'estdur') {
        if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return 'Duration phải là số không âm.';
      } else if (field === 'assignedtechname') {
        if (!pics.includes(value)) return 'Chọn PIC thuộc crew được cấp.';
      } else if (!isAwareDate(value)) {
        return 'Nhập ngày giờ ISO có offset, ví dụ 2026-10-01T08:00:00+07:00.';
      }
    }
    for (const [start, end] of [['schedstart', 'schedfinish'], ['targstartdate', 'targcompdate']] as const) {
      if (!changed.includes(start) && !changed.includes(end)) continue;
      const a = changes[start] ?? detail.baseline[start]; const b = changes[end] ?? detail.baseline[end];
      if (!a || !b || Date.parse(b) < Date.parse(a)) return 'Cần đủ ngày bắt đầu/kết thúc; kết thúc không được trước bắt đầu.';
    }
    return '';
  }
  async function mutate(remove = false) {
    if (!detail || busy || suspended || !writable || (!remove && blocked)) return;
    if (remove && !window.confirm('Xóa nháp đã lưu này?')) return;
    const problem = remove ? '' : validation();
    if (problem) { setError(problem); return; }
    const controller = new AbortController(); pending.current = controller;
    controller.signal.addEventListener('abort', () => setBusy(false), { once: true });
    setBusy(true); setError(''); setNotice('');
    try {
      if (remove && saved) {
        await deleteDraft(saved, controller.signal);
        if (!controller.signal.aborted) { onDirty(false); onClose(); }
      } else {
        const key = { ...scope, site_id: detail.item.siteid, workorder_id: detail.item.workorderid };
        const fingerprint = JSON.stringify([key, changes, detail.baseline_token, saved?.version]);
        if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: crypto.randomUUID() };
        const result = await saveDraft(key, changes, detail.baseline_token, retry.current.id, saved, controller.signal);
        if (!controller.signal.aborted) {
          setCommitted(JSON.stringify(changes)); setSaved(result); onDirty(false); retry.current = null;
          setNotice('Đã lưu nháp trên server. Maximo chưa thay đổi.');
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
        else setError(cause instanceof Error ? cause.message : 'Không lưu được nháp.');
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section aria-label="Chỉnh sửa nháp" className={styles.draftEditor}>
    <h2>{detail ? `${detail.item.wonum} · ${detail.item.siteid}` : 'Đang mở WO…'}</h2>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!detail && error && <button onClick={onClose}>Đóng để mở lại</button>}
    {detail && <>
      {saved && <p>Nháp phiên bản {saved.version}</p>}
      {blocked && <p role="alert">Dữ liệu gốc hoặc PIC đã thay đổi. Nháp được giữ để đối chiếu; mở WO từ bảng để tạo nháp mới sau khi kiểm tra.</p>}
      {detail.pics_configured === false && <p>Chưa cấu hình crew/PIC cho discipline này. Có thể xem chi tiết WO; chưa thể chỉnh sửa hoặc lưu nháp.</p>}
      <fieldset disabled={!writable || busy || suspended || blocked || detail.pics_configured === false}>
        <legend>Lập lịch · ngày giờ ISO có offset</legend>
        <label><input type="checkbox" checked={!!changes.change_target} disabled={['PM', 'CFT'].includes(detail.baseline.worktype.toUpperCase())}
          onChange={(event) => setChanges((previous) => {
            const next = { ...previous }; delete next.targstartdate; delete next.targcompdate;
            if (event.target.checked) next.change_target = true; else delete next.change_target;
            return next;
          })} />Change Target?</label>
        {['PM', 'CFT'].includes(detail.baseline.worktype.toUpperCase()) && <p>PM/CFT không được đổi target.</p>}
        <div className={styles.filters}>{editableFields.map((field) => <label key={field} className={changed.includes(field) ? styles.modified : undefined}>
          {labels[field]}{field === 'assignedtechname' ? <select value={changes[field] ?? detail.baseline[field] ?? ''} onChange={(e) => change(field, e.target.value)}>
            <option value={detail.baseline[field] ?? ''}>{detail.baseline[field] ?? 'Chọn PIC'}</option>
            {changes.assignedtechname && changes.assignedtechname !== detail.baseline.assignedtechname && !pics.includes(changes.assignedtechname) &&
              <option value={changes.assignedtechname}>{changes.assignedtechname} (không còn trong crew)</option>}
            {pics.filter((pic) => pic !== detail.baseline[field]).map((pic) => <option key={pic}>{pic}</option>)}
          </select> : <input value={changes[field] ?? detail.baseline[field] ?? ''} disabled={target(field) && !changes.change_target}
            inputMode={field === 'estdur' ? 'decimal' : 'text'} onChange={(e) => change(field, e.target.value)} />}
        </label>)}</div>
        <button onClick={() => { setChanges({}); setError(''); setNotice(''); }}>Reset về baseline</button>
        <button className={styles.primary} disabled={changed.length === 0 || !unsaved} onClick={() => void mutate()}>{busy ? 'Đang lưu…' : 'Lưu nháp'}</button>
      </fieldset>
      <h3>Thay đổi trước / sau</h3>
      <table aria-label="Thay đổi trước / sau"><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th>{blocked && <th>Maximo hiện tại</th>}</tr></thead>
        <tbody>{changed.map((field) => <tr key={field}><th>{labels[field]}</th><td>{detail.baseline[field] ?? '—'}</td><td>{changes[field]}</td>{blocked && <td>{(verifiedDetail ?? detail).item[field] ?? '—'}</td>}</tr>)}</tbody></table>
      {saved && writable && <button disabled={busy || suspended} onClick={() => void mutate(true)}>Xóa nháp</button>}
      <button disabled={busy} onClick={onClose}>Đóng nháp</button>
    </>}
  </section>;
}
