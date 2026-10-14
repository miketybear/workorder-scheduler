import type { Allocation, Roster } from './model';

function describe(roster: Roster, allocation: Allocation | undefined) {
  if (!allocation) return 'Không có phân bổ';
  const person = roster.people.find(item => item.id === allocation.personId);
  const wo = roster.workOrders.find(item => item.id === allocation.workOrderId);
  return `${wo?.wonum} (${wo?.connection} / ${wo?.site}) · ${person?.name} · ${allocation.date} · ${allocation.minutes} phút`;
}

export function AllocationPreview({ baseline, current }: { baseline: Roster; current: Roster }) {
  const original = new Map(baseline.allocations.map(item => [item.id, item]));
  const updated = new Map(current.allocations.map(item => [item.id, item]));
  const changed = [...new Set([...original.keys(), ...updated.keys()])].filter(id => {
    const before = original.get(id);
    const after = updated.get(id);
    return !before || !after || before.personId !== after.personId || before.workOrderId !== after.workOrderId
      || before.date !== after.date || before.minutes !== after.minutes;
  });
  return <div aria-label="Chi tiết thay đổi phân bổ">
    <p>{changed.length} thay đổi so với dữ liệu mẫu, gồm cả phân bổ ngoài tháng đang xem.</p>
    {changed.length > 0 && <ul>{changed.map(id => <li key={id}>
      <span>Trước: {describe(baseline, original.get(id))}</span><br />
      <span>Sau: {describe(current, updated.get(id))}</span>
    </li>)}</ul>}
  </div>;
}
