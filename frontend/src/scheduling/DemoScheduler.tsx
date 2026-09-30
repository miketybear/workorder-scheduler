import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../App.module.css';

type Row = {
  id: string; progress: number; discipline: string; description: string; type: string;
  tag: string; system: string; start: string; finish: string; actualStart: string;
  actualFinish: string; status: string; priority: string; lead: string; pic: string;
  hours: string; targetStart: string; target: string; woid: string;
  upload: boolean; changeTarget: boolean;
};
const samples: Row[] = [
  { id: 'DEMO-001', progress: 0, discipline: 'E&I', description: 'Kiểm tra tín hiệu bộ truyền áp suất', type: 'PM', tag: 'DEMO-PT-101', system: 'DEMO-INSTRUMENT', start: '2026-09-28', finish: '2026-09-29', actualStart: '', actualFinish: '', status: 'APPR', priority: 'Medium (2)', lead: 'DEMO-LEAD', pic: 'DEMO-TECH-01', hours: '8', targetStart: '2026-09-25', target: '2026-09-30', woid: '900001', upload: false, changeTarget: false },
  { id: 'DEMO-002', progress: 0, discipline: 'E&I', description: 'Thay thế bộ nguồn tủ điều khiển', type: 'CM', tag: 'DEMO-CP-201', system: 'DEMO-CONTROL', start: '2026-09-29', finish: '2026-09-30', actualStart: '', actualFinish: '', status: 'WMATL', priority: 'High (3)', lead: 'DEMO-LEAD', pic: 'DEMO-TECH-02', hours: '6', targetStart: '2026-09-26', target: '2026-10-02', woid: '900002', upload: false, changeTarget: false },
  { id: 'DEMO-003', progress: 25, discipline: 'E&I', description: 'Kiểm tra chức năng hệ thống cảnh báo', type: 'CFT', tag: 'DEMO-AL-301', system: 'DEMO-ALARM', start: '2026-09-30', finish: '2026-09-30', actualStart: '2026-09-30 08:00', actualFinish: '', status: 'SCHED', priority: 'Medium (2)', lead: 'DEMO-LEAD', pic: 'DEMO-TECH-01', hours: '4', targetStart: '2026-09-27', target: '2026-10-01', woid: '900003', upload: false, changeTarget: false },
];
const fields = { start: 'Scheduled Start', finish: 'Scheduled Finish', pic: 'Assigned PIC', hours: 'Est. Duration', targetStart: 'Target Start', target: 'Target Finish' } as const;
type EditableField = keyof typeof fields;
const headers = ['% Complete', 'Discipline', 'Work Order', 'Description', 'Work Type', 'Tag Name', 'System ID', 'Scheduled Start', 'Scheduled Finish', 'Actual Start', 'Actual Finish', 'Status', 'Priority', 'Onshore PIC', 'Assigned PIC', 'Est. Duration', 'Target Start', 'Target Finish', 'WOID', 'Upload?', 'Change Target?'];
const editableFields = Object.keys(fields) as EditableField[];
const targetLocked = (row: Row) => row.type === 'PM' || row.type === 'CFT';
const originalRow = (row: Row) => samples.find((sample) => sample.id === row.id)!;
const changedFields = (row: Row) => editableFields.filter((field) => row[field] !== originalRow(row)[field]);
const invalidRow = (row: Row) => !row.start || !row.finish || row.finish < row.start
  || !row.hours.trim() || !Number.isFinite(Number(row.hours)) || Number(row.hours) < 0
  || (row.changeTarget && (!row.targetStart || !row.target || row.target < row.targetStart));

export function DemoScheduler() {
  const [rows, setRows] = useState(samples);
  const [preview, setPreview] = useState(false);
  const modified = rows.filter((row) => changedFields(row).length > 0);
  const selected = modified.filter((row) => row.upload);
  const invalid = selected.some(invalidRow);

  function edit(id: string, field: EditableField, value: string) {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      if ((field === 'target' || field === 'targetStart') && (targetLocked(row) || !row.changeTarget)) return row;
      return { ...row, [field]: value, upload: true };
    }));
    setPreview(false);
  }
  function toggle(id: string, field: 'upload' | 'changeTarget', value: boolean) {
    setRows((current) => current.map((row) => {
      if (row.id !== id || (field === 'changeTarget' && targetLocked(row))) return row;
      if (field === 'changeTarget' && !value) {
        const original = originalRow(row);
        return { ...row, changeTarget: false, targetStart: original.targetStart, target: original.target };
      }
      return { ...row, [field]: value };
    }));
    setPreview(false);
  }
  function dateInput(row: Row, field: 'start' | 'finish' | 'targetStart' | 'target') {
    const isTarget = field === 'targetStart' || field === 'target';
    return <input aria-label={`${row.id} ${fields[field]}`} type="date" value={row[field]}
      disabled={isTarget && (targetLocked(row) || !row.changeTarget)}
      onChange={(e) => edit(row.id, field, e.target.value)} />;
  }
  return <>
    <Link to="/" className={styles.back}>← Tổng quan</Link>
    <div className={styles.pageTitle}><div><p className={styles.eyebrow}>BẢNG THỬ NGHIỆM</p><h1>Lập lịch công việc</h1></div>
      <span className={styles.badge}>Onshore giả lập / E&I</span></div>
    <p className={styles.notice}>Dữ liệu mẫu hoàn toàn giả lập. Thay đổi chỉ giữ trong trang này, không lưu bản nháp và không gửi đến Maximo. Ngày mẫu chưa đại diện hợp đồng ngày giờ thực tế.</p>
    <div className={styles.toolbar}><span><b>{rows.length}</b> WO mẫu <span className={styles.muted}>/ {modified.length} thay đổi / {selected.length} chọn upload</span><small className={styles.tableHint}>Đủ 21 cột theo Excel · Cuộn ngang để xem thêm · Tổng Est. Duration: {rows.every((row) => row.hours.trim() && Number.isFinite(Number(row.hours)) && Number(row.hours) >= 0) ? rows.reduce((sum, row) => sum + Number(row.hours), 0) : '—'} giờ</small></span>
      <div><button onClick={() => { setRows(samples); setPreview(false); }}>Đặt lại</button>
        <button className={styles.primary} disabled={!selected.length || invalid} onClick={() => setPreview(true)}>Xem thay đổi</button></div></div>
    <p className={styles.tableHint}>Các ô schedule, Assigned PIC và Est. Duration có thể chỉnh sửa. Bật Change Target? để sửa target của WO hợp lệ. Sửa ô sẽ tự chọn Upload?; bỏ chọn để loại WO khỏi preview.</p>
    <div className={`${styles.tableWrap} ${styles.schedulerTable}`} role="region" aria-label="Bảng WO, cuộn ngang để xem đủ 21 cột" tabIndex={0}>
      <table><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className={changedFields(row).length ? styles.changed : ''}>
        <td>{row.progress}%</td><td>{row.discipline}</td><td><strong>{row.id}</strong></td>
        <td className={styles.descriptionCell}>{row.description}</td><td>{row.type}</td><td>{row.tag}</td><td>{row.system}</td>
        <td>{dateInput(row, 'start')}</td><td>{dateInput(row, 'finish')}</td>
        <td>{row.actualStart || '—'}</td><td>{row.actualFinish || '—'}</td><td><span className={styles.statusBadge} data-status={row.status}>{row.status}</span></td><td>{row.priority}</td><td>{row.lead}</td>
        <td><select aria-label={`${row.id} Assigned PIC`} value={row.pic} onChange={(e) => edit(row.id, 'pic', e.target.value)}>
          <option>DEMO-TECH-01</option><option>DEMO-TECH-02</option></select></td>
        <td><input aria-label={`${row.id} Est. Duration`} type="number" min="0" step="any" value={row.hours} onChange={(e) => edit(row.id, 'hours', e.target.value)} /></td>
        <td>{dateInput(row, 'targetStart')}</td><td>{dateInput(row, 'target')}{targetLocked(row) && <small>Khóa target cho {row.type}</small>}</td>
        <td>{row.woid}</td><td><input aria-label={`${row.id} Upload?`} type="checkbox" checked={row.upload} onChange={(e) => toggle(row.id, 'upload', e.target.checked)} /></td>
        <td>{targetLocked(row) ? <span>NOT ALLOW</span> : <input aria-label={`${row.id} Change Target?`} type="checkbox" checked={row.changeTarget} onChange={(e) => toggle(row.id, 'changeTarget', e.target.checked)} />}</td>
      </tr>)}</tbody></table></div>
    {rows.some(invalidRow) && <p role="alert" className={styles.error}>WO chưa hợp lệ: {rows.filter(invalidRow).map((row) => row.id).join(', ')}. Nhập đủ ngày, Finish ≥ Start và Est. Duration ≥ 0.</p>}
    {preview && <section className={styles.preview}><h2>Thay đổi dự kiến</h2><p>Onshore giả lập / E&I · {selected.length} WO được chọn</p><ul>{selected.flatMap((row) => {
      const original = originalRow(row);
      return changedFields(row).map((field) => <li key={`${row.id}-${field}`}><b>{row.id}</b> · {fields[field]}: {original[field]} → {row[field]}</li>);
    })}</ul><button disabled>Upload Maximo — chưa kết nối</button></section>}
  </>;
}
