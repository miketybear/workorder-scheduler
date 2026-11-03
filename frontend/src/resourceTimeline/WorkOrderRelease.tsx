// Confirms and releases every still-local assignment of one WO; the server decides what is included.
import { useEffect, useRef, useState } from 'react';
import { AssignmentError, getWorkOrderRelease, lookupWorkOrderRelease, releaseWorkOrder, type WorkOrderReleaseInput, type WorkOrderReleasePreview, type WorkOrderReleaseResult } from '../api/assignments';
import { displayHours } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';

type Props = {
  poolId: string;
  allocationId: string;
  label: string;
  personName: (personId: string) => string | undefined;
  verify: () => Promise<void>;
  onReleased: (result: WorkOrderReleaseResult) => Promise<void>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};

export function WorkOrderRelease({ poolId, allocationId, label, personName, verify, onReleased, onClose, onBusyChange }: Props) {
  const [preview, setPreview] = useState<WorkOrderReleasePreview | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [unknown, setUnknown] = useState<WorkOrderReleaseInput | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getWorkOrderRelease(poolId, allocationId, controller.signal).then(setPreview).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không đọc được danh sách phân công.');
    });
    return () => controller.abort();
  }, [poolId, allocationId]);

  const run = async (action: () => Promise<void>) => {
    setWorking(true); onBusyChange(true); setError('');
    try { await action(); } finally { setWorking(false); onBusyChange(false); }
  };
  const confirm = () => run(async () => {
    if (!preview || started.current) return;
    started.current = true;
    const input: WorkOrderReleaseInput = { request_id: crypto.randomUUID(), expected_allocation_ids: preview.allocation_ids };
    try {
      await verify();
      await onReleased(await releaseWorkOrder(poolId, allocationId, input, new AbortController().signal));
    } catch (reason) {
      // Only a definite refusal may be retried; anything else could already have been applied.
      if (reason instanceof AssignmentError && ([401, 403, 404, 409, 422].includes(reason.status) || reason.outcome === 'not_sent')) {
        started.current = false; setPreview(null); setError(`${reason.message} Hãy đóng lại rồi thử lại.`);
      } else {
        setUnknown(input); setError('Chưa xác nhận được kết quả xóa. Không gửi lại; bấm "Kiểm tra kết quả".');
      }
    }
  });
  const reconcile = () => run(async () => {
    if (!unknown) return;
    try {
      const receipt = await lookupWorkOrderRelease(poolId, unknown, new AbortController().signal);
      if (receipt) await onReleased(receipt);
      else setError('Chưa tìm thấy biên nhận. Tải lại timeline để kiểm tra.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không đối soát được.'); }
  });

  const people = preview ? preview.person_ids.map(id => personName(id)).filter(Boolean).join(', ') : '';
  return <div role="alertdialog" aria-label="Xác nhận xóa tất cả phân công" className={styles.releaseConfirm}>
    {!preview && !error && <p role="status">Đang đọc phân công của WO…</p>}
    {preview && (preview.allocation_ids.length
      ? <p><strong>Xóa {preview.task_count} task, {displayHours(preview.total_minutes)} giờ của {label}?</strong> Giờ được trả lại rota{people ? ` của ${people}` : ''}.</p>
      : <p>Không có phân công nào của {label} có thể xóa.</p>)}
    {!!preview?.kept_task_count && <p>{preview.kept_task_count} task đã gửi lên Maximo sẽ được giữ nguyên.</p>}
    {error && <p role="alert">{error}</p>}
    <div>
      {unknown
        ? <button type="button" disabled={working} onClick={() => void reconcile()}>Kiểm tra kết quả</button>
        : <><button type="button" disabled={working} onClick={onClose}>Giữ lại</button>
          {!!preview?.allocation_ids.length && <button type="button" data-danger disabled={working} onClick={() => void confirm()}>Xóa tất cả</button>}</>}
    </div>
  </div>;
}
