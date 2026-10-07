import { config } from '../config';
import { isRecord, RetrievalError } from './workOrders';

export type AdminUser = { id: string; tenant_id: string; object_id: string; display_name: string; active: boolean; is_admin: boolean };
export type AdminConnection = { id: string; label: string; system: string; environment: string; enabled: boolean; disciplines: string[] };
export type Permission = { user_id: string; connection_id: string; discipline: string };
export type EffectiveGrant = Permission & { capability: string };
export type AdminRoster = { users: AdminUser[]; connections: AdminConnection[]; permissions: Permission[]; grants: EffectiveGrant[] };

function invalid(): never { throw new Error('Phản hồi quản trị viên không hợp lệ.'); }

export async function getAdminRoster(signal: AbortSignal): Promise<AdminRoster> {
  const response = await fetch(`${config.apiBase}/admin/roster`, { signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new RetrievalError(response.status, response.status === 401 ? 'Phiên đăng nhập đã hết hạn.' : response.status === 403 ? 'Quyền quản trị đã thay đổi.' : 'Không tải được danh sách quản trị.');
  const raw: unknown = await response.json();
  if (!isRecord(raw) || !Array.isArray(raw.users) || !Array.isArray(raw.connections) || !Array.isArray(raw.permissions) || !Array.isArray(raw.grants)) return invalid();
  if (!raw.users.every((u) => isRecord(u) && ['id', 'tenant_id', 'object_id', 'display_name'].every((k) => typeof u[k] === 'string') && typeof u.active === 'boolean' && typeof u.is_admin === 'boolean') ||
      !raw.connections.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.label === 'string' &&
        ['onshore', 'offshore'].includes(String(c.system)) && ['test', 'production'].includes(String(c.environment)) &&
        typeof c.enabled === 'boolean' && Array.isArray(c.disciplines) && c.disciplines.every((d) => typeof d === 'string' && d.length > 0)) ||
      !raw.permissions.every((p) => isRecord(p) && ['user_id', 'connection_id', 'discipline'].every((k) => typeof p[k] === 'string')) ||
      !raw.grants.every((g) => isRecord(g) && ['user_id', 'connection_id', 'discipline'].every((k) => typeof g[k] === 'string') &&
        ['read', 'write'].includes(String(g.capability)))) return invalid();
  return raw as AdminRoster;
}

export async function savePlannerPermission(input: Permission & { enabled: boolean; reason: string }, signal: AbortSignal): Promise<void> {
  const csrf = document.cookie.split('; ').find((part) => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
  if (!csrf) throw new RetrievalError(401, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.');
  const response = await fetch(`${config.apiBase}/admin/planner-permissions`, { method: 'PUT', signal,
    credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(input) });
  if (!response.ok) throw new RetrievalError(response.status,
    response.status === 401 ? 'Phiên đăng nhập đã hết hạn.' : response.status === 403 ? 'Quyền quản trị đã thay đổi.' : response.status === 409 ? 'Quyền đã thay đổi. Tải lại danh sách.' : 'Chưa lưu được quyền. Ý định vẫn được giữ; kiểm tra trạng thái trước khi thử lại.');
}
