import { Fragment, useMemo, useState } from 'react';
import { DateTimeInput, MonthInput } from '../components/DateTimeInput';
import styles from './AssignmentTimeline.module.css';
import { initialRoster } from './fixtures';
import { AllocationPreview } from './AllocationPreview';
import { addAllocation, availability, CRAFTS, monthDays, removeAllocation, resourceCapacity, ROLES, updateAllocation, type Allocation, type Craft, type Roster } from './model';

const roleLabel = { TECH: 'TECH', SUP: 'SUP', ASST_SUP: 'Assistant SUP', CONTROL_RM_ENGINEER: 'Control RM Engineer', MATERIAL_CONTROLLER: 'Material Controller' } as const;
const fmtHours = (minutes: number) => `${(minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}h`;
const uid = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function AssignmentTimeline() {
  const [roster, setRoster] = useState<Roster>(() => initialRoster);
  const [history, setHistory] = useState<Roster[]>([]);
  const [month, setMonth] = useState('2026-11');
  const [craftFilter, setCraftFilter] = useState<Craft | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [woId, setWoId] = useState(initialRoster.workOrders[0].id);
  const [personId, setPersonId] = useState(initialRoster.people[0].id);
  const [date, setDate] = useState('2026-11-03');
  const [hours, setHours] = useState('2');
  const days = useMemo(() => monthDays(month), [month]);
  const filteredPeople = roster.people.filter(p => craftFilter === 'ALL' || p.craft === craftFilter);
  const filteredWos = roster.workOrders.filter(w => craftFilter === 'ALL' || w.craft === craftFilter);
  const selectedPersonId = filteredPeople.some(p => p.id === personId) ? personId : filteredPeople[0]?.id ?? '';
  const selectedWoId = filteredWos.some(w => w.id === woId) ? woId : filteredWos[0]?.id ?? '';
  const backlog = roster.workOrders.filter(wo => (craftFilter === 'ALL' || wo.craft === craftFilter)
    && `${wo.wonum} ${wo.site} ${wo.description}`.toLowerCase().includes(search.toLowerCase())
    && roster.allocations.filter(a => a.workOrderId === wo.id).reduce((sum, a) => sum + a.minutes, 0) < wo.demandMinutes).slice(0, 30);
  const apply = (next: Roster, message?: string) => { setHistory(h => [...h, roster]); setRoster(next); setError(message ?? ''); };
  const add = () => {
    const rawMinutes = Number(hours) * 60;
    const minutes = Math.round(rawMinutes);
    if (!Number.isFinite(rawMinutes) || Math.abs(rawMinutes - minutes) > 0.0001) { setError('Nhập giờ theo bước 1 phút, ví dụ 1.15 giờ.'); return; }
    const item: Allocation = { id: editingId ?? uid(), personId: selectedPersonId, workOrderId: selectedWoId, date, minutes };
    const result = editingId ? updateAllocation(roster, item) : addAllocation(roster, item);
    if (result.error) setError(result.error); else { apply(result.roster, ''); setEditingId(null); }
  };
  const undo = () => { const previous = history.at(-1); if (previous) { setRoster(previous); setHistory(history.slice(0, -1)); setError(''); setEditingId(null); } };
  const reset = () => { setRoster(initialRoster); setHistory([]); setError(''); setPreview(false); setEditingId(null); };
  const remove = (id: string) => { apply(removeAllocation(roster, id)); if (editingId === id) setEditingId(null); };
  const monthName = month ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Chọn tháng';
  const monthAllocations = roster.allocations.filter(a => a.date.startsWith(`${month}-`));
  const summary = (craft: Craft, role: (typeof ROLES)[number]) => {
    const members = roster.people.filter(p => p.craft === craft && p.role === role);
    const capacity = members.reduce((sum, p) => sum + days.reduce((dSum, day) => dSum + resourceCapacity(p.id, day), 0), 0);
    const load = monthAllocations.filter(a => members.some(p => p.id === a.personId)).reduce((sum, a) => sum + a.minutes, 0);
    return { capacity, load, members };
  };
  return <div className={styles.page}>
    <div className={styles.banner}><strong>PoC local · dữ liệu tổng hợp</strong><span>Không lưu, không gọi server hoặc Maximo. Đây không phải rota thực tế.</span></div>
    <header className={styles.heading}><div><p className={styles.eyebrow}>ASSIGNMENT MANAGER / SYNTHETIC PREVIEW</p><h1>Resource timeline</h1><p>Phân bổ giờ theo người và ngày. Một người dùng chung capacity qua mọi WO, site và connection.</p></div>
      <div className={styles.controls}><div className={styles.monthField}><span>Tháng</span><MonthInput label="Tháng" value={month} onChange={setMonth} /></div><label>Craft<select aria-label="Craft" value={craftFilter} onChange={e => { setCraftFilter(e.target.value as Craft | 'ALL'); setEditingId(null); }}><option value="ALL">Tất cả craft</option>{CRAFTS.map(c => <option key={c}>{c}</option>)}</select></label></div>
    </header>
    <div className={styles.toolbar}><div><button type="button" onClick={undo} disabled={!history.length}>Hoàn tác</button><button type="button" onClick={reset}>Đặt lại PoC</button><button type="button" onClick={() => setPreview(v => !v)} aria-pressed={preview}>{preview ? 'Ẩn xem trước' : 'Xem trước'}</button></div><span>{roster.people.length} nhân sự đủ điều kiện · 87 dòng nguồn mô phỏng · gồm Control RM Engineer và Material Controller</span></div>
    {preview && <aside className={styles.preview} role="status"><strong>Xem trước trong bộ nhớ</strong><p>{monthAllocations.length} phân bổ trong {monthName}; giờ labor trước/sau: {fmtHours(initialRoster.allocations.filter(a => a.date.startsWith(`${month}-`)).reduce((n, a) => n + a.minutes, 0))} → {fmtHours(monthAllocations.reduce((n, a) => n + a.minutes, 0))}. Không thay đổi PIC hoặc estdur.</p><AllocationPreview baseline={initialRoster} current={roster} /></aside>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.workspace}>
      <aside className={styles.backlog}><div className={styles.panelTitle}><h2>WO backlog</h2><span>{backlog.length} / tối đa 30</span></div>
        <label className={styles.search}>Tìm WO, site<input value={search} onChange={e => setSearch(e.target.value)} placeholder="WO, site hoặc mô tả" /></label>
        <div className={styles.woList}>{backlog.map(wo => { const assigned = roster.allocations.filter(a => a.workOrderId === wo.id).reduce((n, a) => n + a.minutes, 0); return <button type="button" key={wo.id} className={styles.woCard} onClick={() => setWoId(wo.id)} aria-pressed={woId === wo.id}><strong>{wo.wonum}</strong><span>{wo.craft} · {wo.site} · {wo.connection}</span><small>{wo.description}</small><small>Còn {fmtHours(wo.demandMinutes - assigned)}</small></button>; })}</div>
      </aside>
      <section className={styles.timelineSection} aria-label="Resource timeline">
        <div className={styles.panelTitle}><h2>{monthName}</h2><span>Ngày làm = 10,5 giờ · lịch tổng hợp</span></div>
        <div className={styles.tableScroll}><table className={styles.timeline}><thead><tr><th className={styles.resourceHead}>Nhân sự / capacity</th>{days.map(day => <th key={day}><span>{day.slice(-2)}</span><small>{new Date(`${day}T00:00:00Z`).toLocaleDateString('vi-VN', { weekday: 'short', timeZone: 'UTC' })}</small></th>)}</tr></thead><tbody>
          {CRAFTS.filter(c => craftFilter === 'ALL' || c === craftFilter).map(craft => <FragmentCraft key={craft} craft={craft} days={days} roster={roster} summary={summary} onRemove={remove} onCell={(p, d) => { setPersonId(p); setDate(d); }} onEdit={a => { setEditingId(a.id); setPersonId(a.personId); setWoId(a.workOrderId); setDate(a.date); setHours(String(a.minutes / 60)); }} />)}
        </tbody></table></div>
        <div className={styles.legend}><span><i className={styles.work} /> Có capacity</span><span><i className={styles.off} /> Off</span><span><i className={styles.blank} /> Ô trống</span><span>Capacity / tải tính riêng cho mỗi người</span></div>
      </section>
    </div>
    <section className={styles.editor}><div><p className={styles.eyebrow}>ALLOCATION EDITOR</p><h2>Phân công labor-hours</h2><p>Chọn SUP hoặc Assistant SUP để hỗ trợ craft khi thiếu nhân lực. Tối đa 10,5h/người/ngày.</p></div>
      <form className={styles.form} onSubmit={e => { e.preventDefault(); add(); }}><label>WO<select aria-label="WO" value={selectedWoId} onChange={e => setWoId(e.target.value)}>{filteredWos.map(w => <option key={w.id} value={w.id}>{w.wonum} · {w.site} · {w.connection} · {w.craft}</option>)}</select></label><label>Nhân sự<select aria-label="Nhân sự" value={selectedPersonId} onChange={e => setPersonId(e.target.value)}>{filteredPeople.map(p => <option key={p.id} value={p.id}>{p.name} · {p.craft} · {roleLabel[p.role]}</option>)}</select></label><div className={styles.monthField}><span>Ngày</span><DateTimeInput dateOnly label="Ngày" value={date} onChange={setDate} /></div><label>Giờ<input type="number" min="0" max="10.5" step="any" value={hours} onChange={e => setHours(e.target.value)} /></label><button type="submit">{editingId ? 'Lưu thay đổi' : 'Thêm phân bổ'}</button>{editingId && <button type="button" onClick={() => setEditingId(null)}>Hủy sửa</button>}</form>
      <p className={styles.note}>Một WO có thể có nhiều người. Tổng giờ phân công là labor-hours; không sửa estimated duration, PIC hay ngày của WO.</p>
    </section>
    <section className={styles.summary}><h2>Tổng giờ theo craft trong tháng</h2><div className={styles.summaryGrid}>{CRAFTS.filter(c => craftFilter === 'ALL' || c === craftFilter).map(craft => <article key={craft}><h3>{craft}</h3>{ROLES.map(role => { const s = summary(craft, role); return <p key={role}><span>{roleLabel[role]} · {s.members.length}</span><b>Tải {fmtHours(s.load)} / capacity {fmtHours(s.capacity)}</b><span>Còn {fmtHours(s.capacity - s.load)}</span><i><em style={{ width: `${s.capacity ? Math.min(100, s.load / s.capacity * 100) : 0}%` }} /></i></p>; })}</article>)}</div></section>
  </div>;
}

export const AssignmentTimelineDemo = AssignmentTimeline;

function FragmentCraft({ craft, days, roster, summary, onRemove, onCell, onEdit }: { craft: Craft; days: string[]; roster: Roster; summary: (craft: Craft, role: (typeof ROLES)[number]) => { capacity: number; load: number; members: Roster['people'] }; onRemove: (id: string) => void; onCell: (personId: string, date: string) => void; onEdit: (a: Allocation) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return <>
    <tr className={styles.craftRow}><th className={styles.stickyPerson}>{craft}<small>{ROLES.filter(role => summary(craft, role).members.length > 0).map(role => `${summary(craft, role).members.length} ${roleLabel[role]}`).join(' · ')}</small></th>{days.map(d => { const cap = ROLES.reduce((n, r) => n + summary(craft, r).members.reduce((m, p) => m + resourceCapacity(p.id, d), 0), 0); const load = roster.allocations.filter(a => a.date === d && roster.people.find(p => p.id === a.personId)?.craft === craft).reduce((n, a) => n + a.minutes, 0); return <td key={d} title={`${fmtHours(load)} / ${fmtHours(cap)} total`}>{cap ? `${fmtHours(load)} / ${fmtHours(cap)}` : '—'}</td>; })}</tr>
    {ROLES.filter(role => summary(craft, role).members.length > 0).map(role => <Fragment key={role}><tr className={styles.roleRow}><th className={styles.stickyPerson}><button type="button" onClick={() => setCollapsed(v => ({ ...v, [role]: !v[role] }))} aria-expanded={!collapsed[role]}>{collapsed[role] ? '＋' : '−'} {roleLabel[role]} · {summary(craft, role).members.length} người</button><small>{fmtHours(summary(craft, role).load)} / {fmtHours(summary(craft, role).capacity)}</small></th>{days.map(d => { const ids = summary(craft, role).members.map(p => p.id); const cap = ids.reduce((n, id) => n + resourceCapacity(id, d), 0); const load = roster.allocations.filter(a => a.date === d && ids.includes(a.personId)).reduce((n, a) => n + a.minutes, 0); return <td key={d} title="Tải / capacity của nhóm role">{fmtHours(load)} / {fmtHours(cap)}</td>; })}</tr>
      {!collapsed[role] && summary(craft, role).members.map(person => <tr key={person.id} className={styles.personRow}><th className={styles.stickyPerson}>{person.name}<small>{roleLabel[role]}</small></th>{days.map(day => { const state = availability(person.id, day); const capacity = resourceCapacity(person.id, day); const assigned = roster.allocations.filter(a => a.personId === person.id && a.date === day); const used = assigned.reduce((n, a) => n + a.minutes, 0); return <td key={day} className={state === 'working' ? styles.working : state === 'blank' ? styles.blankCell : styles.offCell}><button type="button" className={styles.cellButton} onClick={() => onCell(person.id, day)} aria-label={`${person.name}, ${day}: ${fmtHours(used)} of ${fmtHours(capacity)}; select for allocation`}><b>{fmtHours(used)}<small> / {fmtHours(capacity)}</small></b></button>{assigned.map(a => { const wo = roster.workOrders.find(w => w.id === a.workOrderId); return <span key={a.id} className={styles.allocation} title={`${wo?.wonum} · ${wo?.site} · ${fmtHours(a.minutes)}`}><button className={styles.editAllocation} type="button" onClick={() => onEdit(a)} aria-label={`Sửa ${wo?.wonum}, ${wo?.connection}, ${wo?.site}, ${person.name}, ${day}`}>{wo?.wonum} {fmtHours(a.minutes)}</button><i>{wo?.site}</i><button type="button" aria-label={`Xóa ${wo?.wonum}, ${wo?.connection}, ${wo?.site}, ${person.name}, ${day}`} onClick={() => onRemove(a.id)}>×</button></span>; })}{state !== 'working' && <small className={styles.stateLabel}>{state === 'blank' ? 'Trống' : 'Off'}</small>}</td>; })}</tr>)}
    </Fragment>)}
  </>;
}
