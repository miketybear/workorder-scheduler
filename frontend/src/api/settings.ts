import { config } from '../config';
import { parseSession, type Session } from './client';
import { isRecord, RetrievalError } from './workOrders';

export type ConnectionSettings = { session: Session; connections: { connection_id: string; url: string }[] };

export async function getConnectionSettings(signal: AbortSignal): Promise<ConnectionSettings> {
  const response = await fetch(`${config.apiBase}/settings/connection`, { signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new RetrievalError(response.status, response.status === 401 ? 'Cần đăng nhập để mở Settings.' : 'Không tải được cấu hình kết nối.');
  const raw: unknown = await response.json();
  const session = parseSession(raw);
  if (!isRecord(raw) || !Array.isArray(raw.connections) || !raw.connections.every((item) => {
    if (!isRecord(item) || typeof item.connection_id !== 'string' || typeof item.url !== 'string' ||
        !session.grants.some((grant) => grant.connection_id === item.connection_id)) return false;
    try { const url = new URL(item.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }
    catch { return false; }
  }) || new Set(raw.connections.map((item) => item.connection_id)).size !== raw.connections.length) {
    throw new Error('Cấu hình kết nối không hợp lệ.');
  }
  return { session, connections: raw.connections as ConnectionSettings['connections'] };
}

export async function saveConnectionSetting(connectionId: string, signal: AbortSignal): Promise<void> {
  const csrf = document.cookie.split('; ').find((part) => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
  if (!csrf) throw new RetrievalError(401, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.');
  const response = await fetch(`${config.apiBase}/settings/connection`, { method: 'PUT', signal,
    credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ connection_id: connectionId }) });
  if (!response.ok) throw new RetrievalError(response.status,
    response.status === 409 ? 'Tài khoản có nhiều discipline trên kết nối này. Vui lòng liên hệ quản trị viên.' :
    [401, 403, 404].includes(response.status) ? 'Phiên hoặc quyền kết nối đã thay đổi. Hãy mở lại Settings.' : 'Chưa lưu được hệ thống. Có thể thử lại.');
}
