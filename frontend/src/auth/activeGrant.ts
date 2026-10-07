import type { Session } from '../api/client';

export function activeGrant(session: Session | null) {
  if (!session) return undefined;
  const candidates = session.preferred_connection_id
    ? session.grants.filter((grant) => grant.connection_id === session.preferred_connection_id)
    : session.grants;
  // Never choose a discipline by array order or by a browser-supplied value.
  return candidates.length === 1 ? candidates[0] : undefined;
}
