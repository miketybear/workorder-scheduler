import { useEffect, useMemo, useRef, useState } from 'react';
import { continueUpload, editableFields, getUploadStatus, previewUpload, reconcileUpload, submitUpload,
  type Baseline, type Saved, type UploadPreview, type UploadPreviewItem, type UploadRecoveryEntry, type UploadStatus } from '../api/drafts';
import { RetrievalError } from '../api/workOrders';
import { displayDate } from './presentation';
import styles from '../App.module.css';

const labels: Record<typeof editableFields[number], string> = { schedstart: 'Scheduled Start', schedfinish: 'Scheduled Finish',
  assignedtechname: 'Assigned PIC', estdur: 'Est. Duration', targstartdate: 'Target Start', targcompdate: 'Target Finish' };
const stateLabels = { pending: 'Chờ xử lý', sending: 'Đang gửi', confirmed: 'Đã xác nhận', failed: 'Thất bại', conflict: 'Xung đột', unknown: 'Chưa xác định' } as const;
export type UploadConnection = { label: string; system: 'onshore' | 'offshore'; environment: 'test' | 'production' };
export type FinalizedUpload = { draft_id: string; version: number; items: { site_id: string; workorder_id: string; restore_source: { before: Baseline } | null }[] };

export function UploadPreviewControls({ draft, selection, connection, connectionId, timezone, context, onDenied, enabled, buttonLabel, previewLabel,
  active = true, onUploadFinalized, onWorkflowLock, discipline, onWorkflowCreated, uploadAll = false, permitted = true }: {
  draft: Saved; selection: { site_id: string; workorder_id: string; wonum: string }[]; connection?: UploadConnection;
  connectionId: string; timezone: string; context: string; onDenied: () => void; enabled: boolean; buttonLabel: string; previewLabel: string; active?: boolean;
  onUploadFinalized?: (result: FinalizedUpload) => Promise<boolean>; onWorkflowLock?: (locked: boolean) => void;
  discipline: string; onWorkflowCreated?: (entry: UploadRecoveryEntry) => void;
  uploadAll?: boolean;
  permitted?: boolean;
}) {
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [workflow, setWorkflow] = useState<{ draft: Saved; preview: UploadPreview; connectionId: string } | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const [error, setError] = useState('');
  const [previewContext, setPreviewContext] = useState('');
  const previewController = useRef<AbortController | null>(null);
  const operationController = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const autoContinueRef = useRef(false);
  const hiddenStopRef = useRef(false);
  const signature = JSON.stringify([draft.draft_id, draft.version, selection, connectionId, connection, timezone, context]);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const activeRef = useRef(active);
  activeRef.current = active;
  const permittedRef = useRef(permitted);
  permittedRef.current = permitted;
  const statusCheckRequiredRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const apiItems = useMemo(() => selection.map(({ site_id, workorder_id }) => ({ site_id, workorder_id })), [selection]);
  const wonum = (item: UploadPreviewItem) => selection.find((row) => row.site_id === item.site_id && row.workorder_id === item.workorder_id)?.wonum ?? '—';
  const currentPreview = previewContext === signature && preview?.draft_id === draft.draft_id && preview.version === draft.version && preview.items.length === selection.length ? preview : null;
  const workflowCompatible = !workflow || (workflow.connectionId === connectionId && workflow.draft.draft_id === draft.draft_id && workflow.draft.version === draft.version);
  const canRecoverRequest = !!requestId && workflowCompatible;
  const showWorkflow = workflowCompatible && (!!status || !!requestId);

  // WorkOrders stays mounted when an internal route hides the page. Clear only the read preview
  // on that transition; keep a durable receipt/request identity for explicit recovery actions.
  const [viewState, setViewState] = useState({ active, open: false });
  const panelVisible = workflowCompatible && (viewState.open || showWorkflow);
  if (viewState.active !== active) setViewState({ active, open: false });
  useEffect(() => {
    if (active) return;
    hiddenStopRef.current = true;
    previewController.current?.abort();
    setBusy((current) => operationController.current ? current : false);
  }, [active]);
  useEffect(() => {
    operationController.current?.abort();
    autoContinueRef.current = false;
    if (statusRef.current) statusCheckRequiredRef.current = true;
  }, [signature]);
  useEffect(() => { if (!permitted) { autoContinueRef.current = false; if (status) statusCheckRequiredRef.current = true; } }, [permitted, status]);
  useEffect(() => () => { previewController.current?.abort(); operationController.current?.abort(); autoContinueRef.current = false; }, []);
  useEffect(() => { onWorkflowLock?.(workflowCompatible && !!requestId && (!status || (!status.source_finalized &&
    ((status.counts.pending ?? 0) + (status.counts.sending ?? 0) + (status.counts.unknown ?? 0) > 0)))); },
  [workflowCompatible, requestId, status, onWorkflowLock]);

  function handleError(cause: unknown) {
    if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
    setError(cause instanceof Error ? cause.message : 'Không hoàn tất yêu cầu.');
  }
  async function loadPreview() {
    if (!active || !enabled || busy) return;
    previewController.current?.abort();
    const controller = new AbortController(); previewController.current = controller;
    setBusy(true); setError(''); setPreview(null); setPreviewContext(''); setViewState({ active, open: true });
    try {
      const result = await previewUpload(draft, apiItems, controller.signal);
      if (!controller.signal.aborted) { setPreview(result); setPreviewContext(signature); }
    } catch (cause) { if (!controller.signal.aborted) handleError(cause); }
    finally { if (operationController.current === controller) operationController.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  async function refreshStatus() {
    if (!status || busy) return;
    const expected = workflow ?? (preview ? { draft, preview, connectionId } : null);
    if (!expected) return;
    const controller = new AbortController(); operationController.current = controller;
    setBusy(true); setNeedsStatusCheck(false); setError('');
    try {
      const next = await getUploadStatus(status.batch_id, expected.draft, expected.connectionId, expected.preview.items, controller.signal);
      if (!controller.signal.aborted) { statusCheckRequiredRef.current = false; setStatus(next); await finalize(next); }
    } catch (cause) { if (!controller.signal.aborted) { handleError(cause); setNeedsStatusCheck(true); } }
    finally { if (operationController.current === controller) { operationController.current = null; setBusy(false); } }
  }
  async function finalize(next: UploadStatus) {
    if (!next.source_finalized || !onUploadFinalized) return;
    const refreshed = await onUploadFinalized({ draft_id: draft.draft_id, version: draft.version,
      items: next.items.map(({ site_id, workorder_id, restore_source }) => ({ site_id, workorder_id, restore_source })) });
    if (!refreshed) setError('Maximo đã xác nhận thay đổi, nhưng bảng chưa được làm mới. Hãy thử làm mới lại từ đây.');
  }
  async function submitOrRecover() {
    if ((!requestId && !currentPreview) || busy || submittingRef.current || !active) return;
    submittingRef.current = true;
    hiddenStopRef.current = false;
    autoContinueRef.current = uploadAll;
    const startedSignature = signature;
    const controller = new AbortController(); operationController.current = controller;
    setBusy(true); setError('');
    try {
      let id = requestId;
      let verified = workflow?.preview ?? currentPreview;
      let submittedDraft = workflow?.draft ?? draft;
      let submittedConnection = workflow?.connectionId ?? connectionId;
      if (!id) {
        const fresh = await previewUpload(draft, apiItems, controller.signal);
        if (controller.signal.aborted) return;
        if (!activeRef.current || !permittedRef.current || hiddenStopRef.current || signatureRef.current !== startedSignature ||
          (uploadAll && !autoContinueRef.current)) return;
        setPreview(fresh); verified = fresh;
        if (!fresh.send_enabled || fresh.gate !== null || fresh.items.some((item) => item.code !== 'ready')) {
          setError('Maximo chưa thay đổi. Dữ liệu cần được đối chiếu trước khi gửi.'); return;
        }
        id = crypto.randomUUID(); setRequestId(id);
        submittedDraft = draft; submittedConnection = connectionId;
        setWorkflow({ draft, preview: fresh, connectionId });
        onWorkflowCreated?.({ request_id: id, draft_id: draft.draft_id, version: draft.version,
          preview_hash: fresh.preview_hash, connection_id: connectionId, discipline,
          items: fresh.items.map(({ site_id, workorder_id }) => ({ site_id, workorder_id })) });
      }
      if (!verified) return;
      const receipt = await submitUpload(submittedDraft, id, verified, submittedConnection, controller.signal);
      if (!controller.signal.aborted) {
        setStatus(receipt); setNeedsStatusCheck(false); await finalize(receipt);
        let previous = receipt;
        while (uploadAll && autoContinueRef.current && !hiddenStopRef.current && activeRef.current && permittedRef.current &&
          signatureRef.current === startedSignature && safeAutoAdvance(previous, verified.items.length)) {
          const next = await continueUpload(previous.batch_id, submittedDraft, submittedConnection, verified.items, controller.signal);
          if (controller.signal.aborted) break;
          if (!safeAutoProgress(previous, next, verified.items.length)) {
            autoContinueRef.current = false;
            setNeedsStatusCheck(true);
            setError('Upload tự động đã dừng vì trạng thái chưa tiến triển an toàn. Kiểm tra trạng thái trước khi tiếp tục.');
            setStatus(next);
            break;
          }
          previous = next; setStatus(next); setNeedsStatusCheck(false); await finalize(next);
        }
        autoContinueRef.current = false;
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        handleError(cause);
        setNeedsStatusCheck(true);
        setError('Chưa xác định được kết quả. Kiểm tra kết quả yêu cầu trước khi tiếp tục; hệ thống sẽ giữ nguyên yêu cầu hiện tại.');
      }
    } finally { submittingRef.current = false; if (operationController.current === controller) { operationController.current = null; setBusy(false); } }
  }
  async function advance(action: 'continue' | 'reconcile') {
    if (!status || busy || submittingRef.current || needsStatusCheck) return;
    const expected = workflow ?? (preview ? { draft, preview, connectionId } : null);
    if (!expected) return;
    const controller = new AbortController(); operationController.current = controller;
    setBusy(true); setError('');
    if (action === 'continue') setNeedsStatusCheck(true);
    try {
      const next = action === 'continue'
        ? await continueUpload(status.batch_id, expected.draft, expected.connectionId, expected.preview.items, controller.signal)
        : await reconcileUpload(status.batch_id, expected.draft, expected.connectionId, expected.preview.items, controller.signal);
      if (!controller.signal.aborted) { statusCheckRequiredRef.current = false; setStatus(next); setNeedsStatusCheck(false); await finalize(next); }
    } catch (cause) { if (!controller.signal.aborted) { handleError(cause); setNeedsStatusCheck(action === 'continue'); } }
    finally { if (operationController.current === controller) { operationController.current = null; setBusy(false); } }
  }
  const counts = status?.counts ?? {};
  const pending = counts.pending ?? 0;
  const unknown = counts.unknown ?? 0;
  const sending = counts.sending ?? 0;
  const safeToContinue = pending > 0 && unknown === 0 && sending === 0 && (counts.failed ?? 0) === 0 &&
    (counts.conflict ?? 0) === 0 && !needsStatusCheck && !statusCheckRequiredRef.current;
  const needsExplicitStatus = pending > 0 || sending > 0 || unknown > 0 || statusCheckRequiredRef.current;
  const showReceiptRecovery = canRecoverRequest && !status;

  function safeAutoAdvance(value: UploadStatus, total: number) {
    return !value.source_finalized && total > 0 && value.items.length === total &&
      (value.counts.pending ?? 0) > 0 && (value.counts.sending ?? 0) === 0 &&
      (value.counts.unknown ?? 0) === 0 && (value.counts.failed ?? 0) === 0 &&
      (value.counts.conflict ?? 0) === 0 && (value.counts.confirmed ?? 0) < total;
  }
  function safeAutoProgress(before: UploadStatus, after: UploadStatus, total: number) {
    const complete = after.source_finalized && (after.counts.confirmed ?? 0) === total &&
      (after.counts.pending ?? 0) === 0 && (after.counts.sending ?? 0) === 0 &&
      (after.counts.unknown ?? 0) === 0 && (after.counts.failed ?? 0) === 0 && (after.counts.conflict ?? 0) === 0;
    return after.items.length === total && (complete || safeAutoAdvance(after, total)) &&
      (after.counts.confirmed ?? 0) > (before.counts.confirmed ?? 0) &&
      (after.counts.confirmed ?? 0) <= total;
  }
  async function resumeAll() {
    if (!status || !workflow || submittingRef.current || needsStatusCheck || statusCheckRequiredRef.current || !activeRef.current || !permittedRef.current ||
      !safeAutoAdvance(status, workflow.preview.items.length)) return;
    submittingRef.current = true;
    hiddenStopRef.current = false;
    autoContinueRef.current = true;
    const startedSignature = signature;
    const controller = new AbortController(); operationController.current = controller;
    setBusy(true); setError('');
    try {
      let previous = status;
      while (autoContinueRef.current && !hiddenStopRef.current && activeRef.current && permittedRef.current &&
        signatureRef.current === startedSignature && safeAutoAdvance(previous, workflow.preview.items.length)) {
        const next = await continueUpload(previous.batch_id, workflow.draft, workflow.connectionId, workflow.preview.items, controller.signal);
        if (controller.signal.aborted) break;
        if (!safeAutoProgress(previous, next, workflow.preview.items.length)) {
          autoContinueRef.current = false; setNeedsStatusCheck(true);
          setError('Upload tự động đã dừng vì trạng thái chưa tiến triển an toàn. Kiểm tra trạng thái trước khi tiếp tục.');
          setStatus(next); break;
        }
        previous = next; setStatus(next); await finalize(next);
      }
      autoContinueRef.current = false;
    } catch (cause) {
      autoContinueRef.current = false;
      if (!controller.signal.aborted) { handleError(cause); setNeedsStatusCheck(true); }
    } finally { submittingRef.current = false; if (operationController.current === controller) { operationController.current = null; setBusy(false); } }
  }

  return <>
    {(!workflow || panelVisible) && <button className={styles.tertiary} disabled={!active || busy || (!!status && !status.source_finalized) || (!canRecoverRequest && !status && !enabled)} onClick={() => {
      if (canRecoverRequest && !status) { void submitOrRecover(); return; }
      if (viewState.open) { previewController.current?.abort(); setBusy(false); setViewState({ active, open: false }); }
      else void loadPreview();
    }}>{canRecoverRequest && !status ? 'Lấy kết quả yêu cầu trước' : viewState.open ? 'Ẩn đối chiếu' : previewLabel}</button>}
    {panelVisible && <section className={styles.editorSection} aria-label="Preview upload Maximo">
      <h3>Đối chiếu trước khi upload</h3>
      <ol className={styles.stepper} aria-label="Các bước upload">
        {['Chỉnh sửa', 'Đối chiếu', 'Kết quả'].map((label, index) => {
          const current = status || requestId ? 2 : 1;
          return <li key={label} data-state={index < current ? 'done' : index === current ? 'current' : 'todo'}
            aria-current={index === current ? 'step' : undefined}>{label}</li>;
        })}
      </ol>
      {connection && <p className={styles.uploadTarget} data-env={connection.environment}>
        {connection.label} · {connection.system === 'onshore' ? 'Onshore' : 'Offshore'} · {connection.environment === 'test' ? 'Test' : 'Production'}
        {connection.environment === 'production' && ' — thay đổi sẽ ghi vào Maximo thật'}</p>}
      {busy && <p role="status">{requestId ? 'Đang xử lý yêu cầu upload và kiểm tra kết quả…' : status ? 'Đang cập nhật trạng thái…' : 'Đang đối chiếu với Maximo…'}</p>}
      {uploadAll && busy && autoContinueRef.current && <button className={styles.tertiary} onClick={() => { autoContinueRef.current = false; }}>
        Dừng sau đợt đang gửi
      </button>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {currentPreview && !status && !requestId && <>
        <div className={styles.tableWrap}><table><thead><tr><th>WO</th><th>Trường</th><th>Maximo hiện tại</th><th>Giá trị nháp</th><th>Kết quả</th></tr></thead>
          <tbody>{currentPreview.items.flatMap((item) => [...(Object.keys(item.changes).length ? Object.keys(item.changes).map((rawField) => {
            const field = rawField as typeof editableFields[number];
            const date = field !== 'assignedtechname' && field !== 'estdur';
            return <tr key={`${item.site_id}:${item.workorder_id}:${field}`}><td>{wonum(item)}</td><th>{labels[field]}</th>
              <td>{date ? displayDate(item.before[field] ?? null, timezone) : item.before[field] ?? '—'}</td>
              <td>{date ? displayDate(item.changes[field] ?? null, timezone) : item.changes[field] ?? '—'}</td>
              <td>{item.code === 'ready' ? 'Khớp' : item.code === 'conflict' ? 'Xung đột' : item.code === 'invalid_changes' ? 'Thay đổi không hợp lệ' : 'Không có thay đổi'}</td></tr>;
          }) : [<tr key={`${item.site_id}:${item.workorder_id}:issue`}><th>{wonum(item)}</th>
            <td colSpan={3}>Không có trường nào đủ điều kiện đối chiếu.</td><td>{item.code === 'conflict' ? 'Xung đột' : item.code === 'invalid_changes' ? 'Thay đổi không hợp lệ' : 'Không có thay đổi'}</td></tr>]),
            ...item.warnings.map((warning) => <tr key={`${item.site_id}:${item.workorder_id}:warning:${warning}`}><th>{wonum(item)}</th>
              <td colSpan={4} role="status">Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.</td></tr>)])}</tbody></table></div>
        {!currentPreview.send_enabled && <p role="status">Maximo chưa thay đổi. Upload chưa mở vì chưa hoàn tất kiểm chứng cập nhật Maximo.</p>}
        {!currentPreview.send_enabled && <button className={styles.primary} disabled>Upload chưa khả dụng</button>}
        {currentPreview.send_enabled && <p role="status">Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.</p>}
        {currentPreview.send_enabled && currentPreview.items.every((item) => item.code === 'ready') && <button className={styles.primary} disabled={busy} onClick={() => void submitOrRecover()}>{buttonLabel}</button>}
        {currentPreview.send_enabled && currentPreview.items.some((item) => item.code !== 'ready') && <>
          <p role="status">Maximo chưa thay đổi. Xử lý các WO có xung đột hoặc thay đổi không hợp lệ trước khi upload.</p>
          <button className={styles.primary} disabled>Upload chưa khả dụng</button>
        </>}
      </>}
      {showReceiptRecovery && !busy && <p role="status">Kết quả yêu cầu chưa xác định; dữ liệu nháp được giữ nguyên.</p>}
      {status && <>
        {uploadAll && <p role="status">Tiến độ: {counts.confirmed ?? 0}/{status.items.length} WO đã xác nhận.</p>}
        <h4>Kết quả từng WO</h4>
        <div className={styles.resultGroups} aria-label="Tóm tắt kết quả">
          <span data-tone="success">Hoàn tất <b>{counts.confirmed ?? 0}</b></span>
          <span data-tone="danger">Lỗi / xung đột <b>{(counts.failed ?? 0) + (counts.conflict ?? 0)}</b></span>
          <span data-tone="warning">Cần đối chiếu <b>{pending + sending + unknown}</b></span>
        </div>
        <ul>{Object.entries(counts).filter(([, count]) => (count ?? 0) > 0).map(([state, count]) =>
          <li key={state}>{stateLabels[state as keyof typeof stateLabels]}: {count}</li>)}</ul>
        <div className={styles.tableWrap}><table><thead><tr><th>WO</th><th>Trạng thái</th><th>Kết quả Duration</th><th>Cập nhật</th></tr></thead>
          <tbody>{status.items.map((item) => <tr key={item.item_id}><th>{selection.find((row) => row.site_id === item.site_id && row.workorder_id === item.workorder_id)?.wonum ?? '—'}</th>
            <td>{stateLabels[item.state]}</td><td>{item.duration_result?.code === 'pm_duration_recalculated'
              ? `Maximo đã tính lại Duration: ${item.duration_result.expected ?? '—'} → ${item.duration_result.actual ?? '—'} giờ.`
              : item.duration_result?.code === 'pm_duration_mismatch'
                ? `Chưa xác nhận: Duration thực tế ${item.duration_result.actual ?? '—'} giờ, dự kiến ${item.duration_result.expected ?? '—'} giờ. Nháp được giữ lại; hãy đối chiếu trước khi xử lý tiếp.`
                : '—'}</td><td>{new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.updated_at))}</td></tr>)}</tbody></table></div>
        {status.source_finalized ? <p role="status">Các thay đổi đã được xác nhận trong Maximo; đang cập nhật dữ liệu trên bảng.</p>
          : status.items.every((item) => ['confirmed', 'failed', 'conflict'].includes(item.state))
            ? <p role="status">Nháp được giữ lại vì dữ liệu hiện tại hoặc nháp chưa đủ điều kiện hoàn tất.</p>
            : <p role="status">Kết quả chưa hoàn tất. Kiểm tra trạng thái để quyết định bước tiếp theo.</p>}
        {(needsStatusCheck || error || needsExplicitStatus) && <button className={styles.tertiary} disabled={busy || !active || !permitted} onClick={() => void refreshStatus()}>Kiểm tra trạng thái</button>}
        {safeToContinue && <button className={styles.primary} disabled={busy || !active || !permitted} onClick={() => uploadAll
          ? void resumeAll() : void advance('continue')}>{uploadAll ? 'Tiếp tục upload toàn bộ nhóm' : 'Tiếp tục gửi tối đa 10 WO'}</button>}
        {unknown > 0 && <button className={styles.tertiary} disabled={busy || !active} onClick={() => void advance('reconcile')}>Đối chiếu WO chưa xác định</button>}
        {status.source_finalized && error && <button className={styles.tertiary} disabled={busy || !active} onClick={() => void refreshStatus()}>Làm mới dữ liệu Maximo</button>}
      </>}
    </section>}
  </>;
}
