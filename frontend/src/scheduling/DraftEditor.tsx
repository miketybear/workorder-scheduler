import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteDraft, editableFields, getDetail, openDraft, saveDraft,
  type Baseline, type Changes, type Detail, type DraftNotice, type EditableField, type Identity, type Restored, type Saved, type Scope } from '../api/drafts';
import { RetrievalError } from '../api/workOrders';
import { equalField, scheduledChange, validateChanges } from './editing';
import { ShiftNotice } from './ShiftNotice';
import { DateTimeInput } from '../components/DateTimeInput';
import { picLabel } from './presentation';
import { todayIn } from '../resourceTimeline/timelineHelpers';
import styles from '../App.module.css';
import { WorkOrderFacts } from './WorkOrderFacts';
import { isAwareDate, localDateTime, zonedDateTime } from '../api/dates';
import { displayDate } from './presentation';
import { UploadPreviewControls, type UploadConnection } from './UploadPreviewPanel';
import type { FinalizedUpload } from './UploadPreviewPanel';
import type { UploadRecoveryEntry } from '../api/drafts';

const labels: Record<EditableField, string> = { schedstart: 'Scheduled Start', schedfinish: 'Scheduled Finish',
  assignedto: 'Assigned PIC', estdur: 'Est. Duration', targstartdate: 'Target Start', targcompdate: 'Target Finish' };
const target = (field: EditableField) => field === 'targstartdate' || field === 'targcompdate';
export type EditorSelection = { key: Identity } | { draftId: string };

export function DraftEditor({ selection, scope, writable, suspended, active = true, verifiedDetail, pmRestoreOrigin = null, prefill = null, onPrefillConsumed, seed = null, onSeedConsumed, onDirty, onDenied, onClose, onDraftReady, onUploadFinalized, onUploadRequestCreated, timezone, connection }: {
  timezone: string;
  active?: boolean;
  connection?: UploadConnection;
  prefill?: { site_id: string; workorder_id: string; pic: string } | null; onPrefillConsumed?: () => void;
  seed?: { site_id: string; workorder_id: string; changes: Changes } | null; onSeedConsumed?: () => void;
  verifiedDetail?: Detail | Restored | null; pmRestoreOrigin?: Baseline | null; selection: EditorSelection; scope: Scope; writable: boolean; suspended: boolean;
  onDirty: (dirty: boolean) => void; onDenied: () => void; onClose: () => void;
  onDraftReady?: (draft: DraftNotice) => void;
  onUploadFinalized?: (result: FinalizedUpload) => Promise<boolean>;
  onUploadRequestCreated?: (entry: UploadRecoveryEntry) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [changes, setChanges] = useState<Changes>({});
  const [saved, setSaved] = useState<Saved | null>(null);
  const [restoreBlocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadLocked, setUploadLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [keptStart, setKeptStart] = useState<string | null>(null);
  const [rebase, setRebase] = useState(false);
  // Read through refs so a changing callback identity never restarts the in-flight load.
  const prefillRef = useRef(prefill); const prefillConsumedRef = useRef(onPrefillConsumed);
  useEffect(() => { prefillRef.current = prefill; prefillConsumedRef.current = onPrefillConsumed; });
  const seedRef = useRef(seed); const seedConsumedRef = useRef(onSeedConsumed);
  useEffect(() => { seedRef.current = seed; seedConsumedRef.current = onSeedConsumed; });
  const [committed, setCommitted] = useState('{}');
  const panel = useRef<HTMLElement>(null);
  const pending = useRef<AbortController | null>(null);
  const retry = useRef<{ fingerprint: string; id: string } | null>(null);
  const pics = verifiedDetail?.allowed_pics ?? detail?.allowed_pics ?? [];
  const names = { ...detail?.pic_names, ...verifiedDetail?.pic_names };
  const versionChanged = !!saved && !!verifiedDetail && 'version' in verifiedDetail &&
    typeof verifiedDetail.version === 'number' && verifiedDetail.version > saved.version;
  const blocked = restoreBlocked || versionChanged || (!!detail && !!verifiedDetail && verifiedDetail.baseline_token !== detail.baseline_token) || (!!changes.assignedto && !pics.includes(changes.assignedto));
  const changed = editableFields.filter((field) => changes[field] !== undefined && changes[field] !== detail?.baseline[field]);
  const unsaved = JSON.stringify(changes) !== committed;
  const pmScheduleChanged = !!detail && detail.baseline.worktype.toUpperCase() === 'PM' &&
    (['schedstart', 'schedfinish'] as const).some((field) => (changes[field] ?? detail.baseline[field]) !== detail.baseline[field]);
  const sameField = (field: EditableField, current: string | null, original: string | null) =>
    current === null || original === null ? current === original : equalField(field, current, original);
  const originSafe = !!detail && !!pmRestoreOrigin && detail.baseline.worktype === 'PM' && pmRestoreOrigin.worktype === 'PM' &&
    (['assignedto', 'targstartdate', 'targcompdate'] as const).every((field) => sameField(field, detail.baseline[field], pmRestoreOrigin[field]));
  const originalDatesValid = !!pmRestoreOrigin?.schedstart && !!pmRestoreOrigin.schedfinish &&
    isAwareDate(pmRestoreOrigin.schedstart) && isAwareDate(pmRestoreOrigin.schedfinish) &&
    Date.parse(pmRestoreOrigin.schedfinish) >= Date.parse(pmRestoreOrigin.schedstart);
  const dateRestoreAvailable = !!detail && originSafe && originalDatesValid && !blocked && !unsaved &&
    (!sameField('schedstart', detail.baseline.schedstart, pmRestoreOrigin?.schedstart ?? null) ||
      !sameField('schedfinish', detail.baseline.schedfinish, pmRestoreOrigin?.schedfinish ?? null));
  const durationText = pmRestoreOrigin?.estdur;
  const durationNumber = durationText === null || durationText === undefined || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(durationText)
    ? NaN : Number(durationText);
  const originalDurationValid = Number.isFinite(durationNumber) && durationNumber >= 0 && durationNumber <= 100000;
  const durationRestoreAvailable = !!detail && originSafe && !blocked && !unsaved &&
    originalDatesValid &&
    sameField('schedstart', detail.baseline.schedstart, pmRestoreOrigin?.schedstart ?? null) &&
    sameField('schedfinish', detail.baseline.schedfinish, pmRestoreOrigin?.schedfinish ?? null) &&
    originalDurationValid && !sameField('estdur', detail.baseline.estdur, pmRestoreOrigin?.estdur ?? null);

  const uploadContext = JSON.stringify([saved?.draft_id, saved?.version, scope, timezone, connection, detail?.baseline_token,
    verifiedDetail && 'baseline_token' in verifiedDetail ? verifiedDetail.baseline_token : null,
    verifiedDetail && 'version' in verifiedDetail ? verifiedDetail.version : null, verifiedDetail?.allowed_pics, changes, committed]);
  const uploadSelection = useMemo(() => detail ? [{ site_id: detail.item.siteid, workorder_id: detail.item.workorderid, wonum: detail.item.wonum }] : [], [detail]);
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
        onDraftReady?.({ ...value, items: [value] });
      }
      // Values already staged or drafted in the table row win over what was loaded, so both views agree.
      const carried = seedRef.current;
      if (carried && carried.site_id === value.item.siteid && carried.workorder_id === value.item.workorderid) {
        const existing = 'changes' in value ? value.changes : {};
        setChanges({ ...existing, ...carried.changes });
        seedConsumedRef.current?.();
      }
      const wanted = prefillRef.current;
      if (wanted &&wanted.site_id === value.item.siteid && wanted.workorder_id === value.item.workorderid) {
        const existing = 'changes' in value ? value.changes : {};
        if (value.baseline.assignedto) setNotice(`WO đã có PIC ${value.baseline.assignedto}; không điền sẵn PIC gợi ý.`);
        else if (existing.assignedto !== undefined) setNotice('Nháp đã có PIC; không điền sẵn PIC gợi ý.');
        else if (!value.allowed_pics.includes(wanted.pic)) setNotice(`${wanted.pic} không nằm trong danh sách PIC hợp lệ của discipline này.`);
        else { setChanges({ ...existing, assignedto: wanted.pic }); setNotice(`Đã điền sẵn PIC ${wanted.pic} (chưa lưu). Xem lại rồi bấm Lưu nháp; Maximo chưa thay đổi.`); }
        prefillConsumedRef.current?.();
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
      else setError(cause instanceof Error ? cause.message : 'Không mở được WO.');
    });
    return () => controller.abort();
  }, [selection, scope, suspended, loaded, onDenied, onDraftReady]);
  useEffect(() => {
    if (suspended) { pending.current?.abort(); }
    return () => pending.current?.abort();
  }, [suspended]);

  function change(field: EditableField, value: string) {
    setNotice(''); setError('');
    setChanges((previous) => {
      if (!detail) return previous;
      const next = scheduledChange(previous, detail.baseline, field, value, timezone);
      if (target(field)) next.change_target = true;
      return next;
    });
  }
  // Take the newest Maximo values (and draft version) as the new base and keep what the user typed on top of them.
  function adoptLatest() {
    const latest = (verifiedDetail ?? detail) as (Detail | Restored) | null;
    if (!detail || !latest) return;
    const kept: Changes = {}; const dropped: string[] = [];
    for (const field of editableFields) {
      const value = changes[field];
      if (value === undefined) continue;
      if (value === latest.baseline[field] || (field === 'assignedto' && !latest.allowed_pics.includes(value))) dropped.push(labels[field]);
      else kept[field] = value;
    }
    if (changes.change_target !== undefined && Object.keys(kept).some((field) => target(field as EditableField))) kept.change_target = changes.change_target;
    setDetail(latest);
    if (saved && 'version' in latest && typeof latest.version === 'number') setSaved({ ...saved, version: latest.version, updated_at: latest.updated_at ?? saved.updated_at });
    setChanges(kept); setBlocked(false); setRebase(!!saved); setCommitted('__refreshed__'); retry.current = null; setError('');
    setNotice(`Đã cập nhật theo bản mới nhất.${dropped.length ? ` Bỏ ${dropped.join(', ')} vì đã trùng Maximo hoặc không còn hợp lệ.` : ''} Xem lại rồi bấm Lưu nháp; Maximo chưa thay đổi.`);
  }
  function validation(): string {
    return detail ? validateChanges(detail.baseline, changes, pics) : '';
  }
  async function mutate(remove = false) {
    if (!detail || busy || suspended || uploadLocked || !writable || (!remove && blocked)) return;
    if (remove && (!saved || !confirmDelete)) return;
    const problem = remove ? '' : validation();
    if (problem) { setError(problem); return; }
    const controller = new AbortController(); pending.current = controller;
    controller.signal.addEventListener('abort', () => setBusy(false), { once: true });
    setBusy(true); setError(''); setNotice('');
    try {
      if (remove && saved) {
        await deleteDraft(saved, controller.signal);
        if (!controller.signal.aborted) { onDraftReady?.({ ...saved, items: null }); onDirty(false); onClose(); }
      } else {
        const key = { ...scope, site_id: detail.item.siteid, workorder_id: detail.item.workorderid };
        const fingerprint = JSON.stringify([key, changes, detail.baseline_token, saved?.version, rebase]);
        if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: crypto.randomUUID() };
        const result = await saveDraft(key, changes, detail.baseline_token, retry.current.id, saved, controller.signal, rebase);
        if (!controller.signal.aborted) {
          setCommitted(JSON.stringify(changes)); setSaved(result); setRebase(false); onDirty(false); retry.current = null;
          setNotice('Đã lưu nháp trên server. Maximo chưa thay đổi.');
          onDraftReady?.({ ...result, items: [{ ...detail, changes }] });
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
        else setError(cause instanceof Error ? cause.message : 'Không lưu được nháp.');
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const editingDisabled = !writable || busy || suspended || blocked || uploadLocked || detail?.pics_configured === false;
  const defaultTimes: Partial<Record<EditableField, string>> = { schedstart: '06:30', targcompdate: '23:59' };
  function fieldControl(field: EditableField) {
    if (!detail) return null;
    const className = changed.includes(field) ? styles.modified : undefined;
    if (field === 'schedstart' || field === 'targstartdate' || field === 'targcompdate') {
      const current = changes[field] ?? detail.baseline[field];
      return <div key={field} className={`${styles.dateField} ${className ?? ''}`}>
        <span>{labels[field]}</span>
        <DateTimeInput label={labels[field]} value={current ? localDateTime(current, timezone) : ''} defaultTime={defaultTimes[field]} today={todayIn(timezone)}
          disabled={target(field) && ['PM', 'CFT'].includes(detail.baseline.worktype.toUpperCase())}
          onChange={(wall) => {
            try { change(field, wall ? zonedDateTime(wall, timezone) : ''); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'Ngày giờ không hợp lệ.'); }
          }} />
      </div>;
    }
    return <label key={field} className={className}>
      {labels[field]}{field === 'schedfinish' ? <><input aria-label={labels[field]} readOnly value={displayDate(changes.schedfinish ?? detail.baseline.schedfinish, timezone)} /><small>Tự tính theo ca 06:30–18:30, tối đa 10,5 giờ/ngày.</small></> : field === 'assignedto' ? <select value={changes[field] ?? detail.baseline[field] ?? ''} onChange={(e) => change(field, e.target.value)}>
        <option value={detail.baseline[field] ?? ''}>{picLabel(detail.baseline[field], names) || 'Chọn PIC'}</option>
        {changes.assignedto && changes.assignedto !== detail.baseline.assignedto && !pics.includes(changes.assignedto) &&
          <option value={changes.assignedto}>{picLabel(changes.assignedto, names)} (không còn trong crew)</option>}
        {pics.filter((pic) => pic !== detail.baseline[field]).map((pic) => <option key={pic} value={pic}>{picLabel(pic, names)}</option>)}
      </select> : <input type="text" inputMode="decimal"
        value={changes[field] ?? detail.baseline[field] ?? ''} onChange={(e) => change(field, e.target.value)} />}
    </label>;
  }
  return <section ref={panel} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape' && !busy && !uploadLocked) onClose(); }} aria-label="Chỉnh sửa nháp" role="dialog" aria-modal="false" className={`${styles.draftEditor} ${styles.sidePanel} ${styles.singlePanel}`}>
    <div className={`${styles.panelHeading} ${styles.editorHeader}`}>
      <div><h2>{detail ? detail.item.wonum : 'Đang mở WO…'}</h2>{saved && <span className={styles.badge}>Nháp đã lưu{saved.updated_at ? ` · ${displayDate(saved.updated_at, timezone)}` : ''}</span>}{connection && <span className={styles.envChip} data-env={connection.environment}>{connection.system === 'onshore' ? 'Onshore' : 'Offshore'} · {connection.environment === 'test' ? 'TEST' : 'PROD'}</span>}</div>
      <button className={styles.ghost} disabled={busy || uploadLocked} onClick={onClose}>Đóng nháp</button>
    </div>
    <div className={styles.editorBody}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {!detail && error && <button className={styles.ghost} onClick={onClose}>Đóng để mở lại</button>}
      {detail && <>
        {validation() && <p role="alert" className={styles.error}>{validation()}</p>}
        {blocked && <div role="alert"><p>{versionChanged ? 'Nháp này vừa được lưu ở nơi khác. Phần bạn đang sửa vẫn được giữ.' :
          (!!changes.assignedto && !pics.includes(changes.assignedto)) && !restoreBlocked && verifiedDetail?.baseline_token === detail?.baseline_token
            ? 'PIC đã chọn không còn nằm trong danh sách hợp lệ. Phần bạn đang sửa vẫn được giữ.'
            : 'Maximo vừa đổi dữ liệu của WO này. Phần bạn đang sửa vẫn được giữ để đối chiếu.'}</p>
          <button type="button" className={styles.ghost} disabled={busy} onClick={adoptLatest}>{versionChanged ? 'Cập nhật theo bản mới nhất' : 'Cập nhật theo Maximo'}</button></div>}
        {detail.pics_configured === false && <p>Chưa cấu hình crew/PIC cho discipline này. Có thể xem chi tiết WO; chưa thể chỉnh sửa hoặc lưu nháp.</p>}
        <div className={styles.editorLayout}>
          <div className={styles.editorSections}>
            <fieldset className={styles.editorSection} disabled={editingDisabled}>
              <legend>Lịch và phân công</legend>
              <div className={styles.filters}>{editableFields.filter((field) => !target(field)).map(fieldControl)}</div>
              {changes.schedstart !== undefined && <ShiftNotice start={changes.schedstart} timezone={timezone} keptStart={keptStart}
                onKeep={() => setKeptStart(changes.schedstart ?? null)} onMove={(opening) => change('schedstart', opening)} />}
            </fieldset>
            <fieldset className={styles.editorSection} disabled={editingDisabled}>
              <legend>Ngày mục tiêu</legend>
              <label><input type="checkbox" checked={!!changes.change_target} disabled={['PM', 'CFT'].includes(detail.baseline.worktype.toUpperCase())}
                onChange={(event) => setChanges((previous) => {
                  const next = { ...previous }; delete next.targstartdate; delete next.targcompdate;
                  if (event.target.checked) next.change_target = true; else delete next.change_target;
                  return next;
                })} />Change Target?</label>
              {['PM', 'CFT'].includes(detail.baseline.worktype.toUpperCase()) && <p>PM/CFT không được đổi target.</p>}
              {!['PM', 'CFT'].includes(detail.baseline.worktype.toUpperCase()) && <p>Chọn ngày mục tiêu sẽ bật Change Target.</p>}
              <div className={styles.filters}>{editableFields.filter(target).map(fieldControl)}</div>
            </fieldset>
            {detail.baseline.worktype === 'PM' && pmRestoreOrigin && <section className={styles.editorSection} aria-label="Khôi phục lịch PM gốc">
              <h3>Khôi phục trạng thái trước lần upload PM</h3>
              <p>Các nút chỉ chuẩn bị đề xuất trên màn hình. Hãy Lưu nháp, xem preview rồi upload như quy trình bình thường.</p>
              {!originSafe && <p role="alert">PIC, Target hoặc loại WO hiện tại khác dữ liệu gốc; khôi phục bị khóa để không ghi đè thay đổi khác.</p>}
              {originSafe && (!originalDatesValid || !pmRestoreOrigin?.schedstart || !pmRestoreOrigin.schedfinish) &&
                <p role="alert">Ngày lịch gốc bị thiếu hoặc không hợp lệ. Không thể khôi phục tự động.</p>}
              <button className={styles.tertiary} disabled={!dateRestoreAvailable || busy || suspended || uploadLocked || !writable} onClick={() => {
                if (!pmRestoreOrigin?.schedstart || !pmRestoreOrigin.schedfinish) return;
                setChanges({ schedstart: pmRestoreOrigin.schedstart, schedfinish: pmRestoreOrigin.schedfinish }); setError('');
                setNotice('Đã chuẩn bị hai ngày lịch gốc. Duration hiện tại được giữ nguyên; hãy lưu nháp và upload qua preview.');
              }}>Khôi phục ngày lịch gốc</button>
              <button className={styles.tertiary} disabled={!durationRestoreAvailable || busy || suspended || uploadLocked || !writable} onClick={() => {
                if (pmRestoreOrigin?.estdur === null || pmRestoreOrigin?.estdur === undefined) return;
                setChanges({ estdur: pmRestoreOrigin.estdur }); setError('');
                setNotice('Đã chuẩn bị Duration gốc. Hai ngày lịch hiện tại được giữ nguyên; hãy lưu nháp và upload qua preview.');
              }}>Khôi phục Duration gốc</button>
              {originSafe && !originalDurationValid && <p>Duration gốc không có giá trị hợp lệ; không thể khôi phục.</p>}
              {originSafe && originalDurationValid && !durationRestoreAvailable &&
                (!sameField('schedstart', detail.baseline.schedstart, pmRestoreOrigin?.schedstart ?? null) ||
                  !sameField('schedfinish', detail.baseline.schedfinish, pmRestoreOrigin?.schedfinish ?? null)) &&
                <p>Khôi phục Duration chỉ khả dụng sau khi ngày lịch gốc đã được xác nhận trong Maximo.</p>}
            </section>}
            {changed.length > 0 && <section className={styles.editorSection} aria-label="Đối chiếu Maximo / Nháp"><h3>Đối chiếu Maximo / Nháp</h3>
              {pmScheduleChanged && <p role="status">Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.</p>}
              <div className={styles.tableWrap}><table aria-label="Thay đổi trước / sau"><thead><tr><th>Trường</th><th>Maximo khi tạo nháp</th><th>Nháp</th>{blocked && <th>Maximo hiện tại</th>}</tr></thead>
                <tbody>{changed.map((field) => <tr key={field}><th>{labels[field]}</th>
                  <td>{field === 'assignedto' ? picLabel(detail.baseline[field], names) || '—' : field === 'estdur' ? detail.baseline[field] ?? '—' : displayDate(detail.baseline[field], timezone)}</td>
                  <td>{field === 'assignedto' ? picLabel(changes[field], names) : field === 'estdur' ? changes[field] : displayDate(changes[field] ?? null, timezone)}</td>
                  {blocked && <td>{field === 'assignedto' || field === 'estdur' ? (verifiedDetail ?? detail).item[field] ?? '—' : displayDate((verifiedDetail ?? detail).item[field], timezone)}</td>}</tr>)}</tbody></table></div>
            </section>}
            {saved && writable && <section className={styles.editorSection} aria-label="Upload nháp đã lưu">
              <UploadPreviewControls draft={saved} selection={uploadSelection} connection={connection} connectionId={scope.connection_id}
                timezone={timezone} context={uploadContext} onDenied={onDenied} active={active}
                enabled={!busy && !suspended && !blocked && !unsaved && !uploadLocked && changed.length > 0 && !validation()}
                previewLabel="Đối chiếu với Maximo trước upload"
                buttonLabel={`Upload lên ${connection?.system === 'offshore' ? 'Offshore' : 'Onshore'} ${connection?.environment === 'production' ? 'production' : 'test'}`}
                onUploadFinalized={onUploadFinalized} onWorkflowLock={setUploadLocked} discipline={scope.discipline}
                onWorkflowCreated={onUploadRequestCreated} />
            </section>}
          </div>
          <section className={`${styles.editorSection} ${styles.editorReference}`} aria-label="Thông tin WO từ Maximo">
            <h3>Thông tin WO</h3>
            <p className={styles.editorHint}>Dữ liệu gốc từ Maximo</p>
            <WorkOrderFacts row={detail.item} timezone={timezone} datesOnly={false} picNames={names} />
            <details><summary>Lịch Maximo và thực tế</summary><WorkOrderFacts row={detail.item} timezone={timezone} datesOnly /></details>
          </section>
        </div>
      </>}
    </div>
    {detail && <div className={styles.editorFooter}>
      {saved && writable && <div>
        <button className={styles.dangerGhost} disabled={busy || suspended || uploadLocked || confirmDelete} onClick={() => setConfirmDelete(true)}>Xóa nháp</button>
        {confirmDelete && <div role="group" aria-label="Xác nhận xóa nháp">
          <p>Xóa nháp đã lưu này? Maximo giữ nguyên.</p>
          <button className={styles.danger} disabled={busy || suspended || uploadLocked} onClick={() => void mutate(true)}>Xác nhận xóa nháp</button>
          <button className={styles.ghost} disabled={busy} onClick={() => setConfirmDelete(false)}>Hủy xóa</button>
        </div>}
      </div>}
      <div className={styles.editorActions}>
        <button className={styles.ghost} disabled={editingDisabled} onClick={() => { setChanges({}); setError(''); setNotice(''); }}>Reset về baseline</button>
        <button className={styles.primary} disabled={editingDisabled || changed.length === 0 || !unsaved || !!validation()} onClick={() => void mutate()}>{busy ? 'Đang lưu…' : 'Lưu nháp'}</button>
      </div>
    </div>}
  </section>;
}
