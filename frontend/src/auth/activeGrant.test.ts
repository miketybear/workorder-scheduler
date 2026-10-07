import { expect, it } from 'vitest';
import type { Session } from '../api/client';
import { activeGrant } from './activeGrant';

const one = { connection_id: 'one', label: 'Onshore', system: 'onshore', environment: 'test',
  timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'read' } as const;
const session: Session = { user: { id: 'user', name: 'Planner', is_admin: false }, grants: [one] };

it('automatically uses the only account scope without a saved preference', () => {
  expect(activeGrant(session)).toEqual(one);
  expect(activeGrant(null)).toBeUndefined();
  expect(activeGrant({ ...session, grants: [] })).toBeUndefined();
});
it('uses a saved connection only when exactly one current discipline belongs to it', () => {
  const two = { ...one, connection_id: 'two' };
  expect(activeGrant({ ...session, grants: [one, two], preferred_connection_id: 'two' })).toEqual(two);
  expect(activeGrant({ ...session, grants: [one, two] })).toBeUndefined();
  expect(activeGrant({ ...session, preferred_connection_id: 'revoked' })).toBeUndefined();
  expect(activeGrant({ ...session, grants: [one, { ...one, discipline: 'E&I' }], preferred_connection_id: 'one' })).toBeUndefined();
});
