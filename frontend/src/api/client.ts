import { config } from '../config';

export async function getLiveness(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`${config.apiBase}/health/live`, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Backend chưa sẵn sàng');
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}

export type Session = {
  user: { id: string; name: string; is_admin: boolean };
  preferred_connection_id?: string | null;
  grants: { connection_id: string; label: string; system: 'onshore' | 'offshore'; environment: 'test' | 'production'; timezone: string; discipline: string; capability: 'read' | 'write' }[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function getAuthSummary(signal?: AbortSignal): Promise<{ available: boolean; session: Session | null }> {
  const [configuration, response] = await Promise.all([
    fetch(`${config.apiBase}/auth/configuration`, { signal, credentials: 'same-origin', cache: 'no-store' }),
    fetch(`${config.apiBase}/auth/session`, { signal, credentials: 'same-origin', cache: 'no-store' }),
  ]);
  if (!configuration.ok) throw new Error('Không kiểm tra được dịch vụ đăng nhập.');
  const options: unknown = await configuration.json();
  if (!record(options) || typeof options.login_available !== 'boolean') throw new Error('Phản hồi không hợp lệ.');
  if (response.status === 401) return { available: options.login_available, session: null };
  if (!response.ok) throw new Error('Không kiểm tra được phiên đăng nhập.');
  return { available: options.login_available, session: parseSession(await response.json()) };
}

export function parseSession(body: unknown): Session {
  if (!record(body) || !record(body.user) || typeof body.user.id !== 'string' ||
      typeof body.user.name !== 'string' || typeof body.user.is_admin !== 'boolean' ||
      (body.preferred_connection_id !== undefined && body.preferred_connection_id !== null && typeof body.preferred_connection_id !== 'string') ||
      !Array.isArray(body.grants) || !body.grants.every((grant: unknown) => record(grant) &&
        typeof grant.connection_id === 'string' && typeof grant.label === 'string' &&
        typeof grant.timezone === 'string' && grant.timezone.length > 0 &&
        ['onshore', 'offshore'].includes(String(grant.system)) &&
        ['test', 'production'].includes(String(grant.environment)) &&
        typeof grant.discipline === 'string' && ['read', 'write'].includes(String(grant.capability)))) {
    throw new Error('Phản hồi phiên đăng nhập không hợp lệ.');
  }
  return body as Session;
}

export const loginUrl = `${config.apiBase}/auth/login`;

export async function signOut(): Promise<void> {
  const csrf = document.cookie.split('; ').find((part) => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
  if (!csrf) throw new Error('Phiên chưa sẵn sàng. Hãy tải lại trang.');
  const response = await fetch(`${config.apiBase}/auth/logout`, {
    method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf },
  });
  if (!response.ok && response.status !== 401) throw new Error('Chưa đăng xuất được. Hãy thử lại.');
}
