import { useEffect, useRef, useState } from 'react';
import { getChildren, type ChildWorkOrder, type Identity } from '../api/drafts';
import { RetrievalError } from '../api/workOrders';
import styles from '../App.module.css';

const sce = (value: boolean | null) => (value === null ? '—' : value ? 'Có' : 'Không');

/** Read-only reference. Loads only when opened, as Carbon advises for expandable supplementary data. */
export function ChildWorkOrders({ identity, onDenied }: { identity: Identity; onDenied: () => void }) {
  const [rows, setRows] = useState<ChildWorkOrder[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function load() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setError('');
    try {
      const result = await getChildren(identity, current.signal);
      if (!current.signal.aborted) setRows(result);
    } catch (cause) {
      if (current.signal.aborted) return;
      if (cause instanceof RetrievalError && [401, 403].includes(cause.status)) onDenied();
      else setError(cause instanceof Error ? cause.message : 'Không đọc được WO con.');
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }

  return <details className={styles.childOrders} onToggle={(event) => { if (event.currentTarget.open && !rows && !loading) void load(); }}>
    <summary>WO con{rows ? ` (${rows.length})` : ''}</summary>
    {loading && <p role="status">Đang đọc WO con từ Maximo…</p>}
    {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => void load()}>Thử lại</button></p>}
    {rows?.length === 0 && <p>WO này không có WO con.</p>}
    {rows && rows.length > 0 && <table>
      <thead><tr><th scope="col">WO</th><th scope="col">Tag Number</th><th scope="col" className={styles.numeric}>Est. Duration</th><th scope="col">SCE</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.workorderid}>
        <td>{row.wonum}</td><td>{row.location ?? '—'}</td><td className={styles.numeric}>{row.estdur ?? '—'}</td><td>{sce(row.plusgsafetycrit)}</td>
      </tr>)}</tbody>
    </table>}
  </details>;
}
