import { describe, expect, it } from 'vitest';
import { AUDIT_ENTITY_TYPES, auditEntityPath } from './audit-links';

describe('auditEntityPath', () => {
  it('links entities that have a page', () => {
    expect(auditEntityPath('contract', 'c-1')).toBe('contracts/c-1');
    expect(auditEntityPath('asset', 'ebike-008')).toBe('items/ebike-008');
    expect(auditEntityPath('waiting_list', 'wait-13')).toBe('waiting-list/wait-13');
  });

  it('sends both intake entity names to the returns console', () => {
    expect(auditEntityPath('return_intake', 'seed-ebike-007')).toBe(
      'returns?intake=seed-ebike-007'
    );
    expect(auditEntityPath('return', 'seed-ebike-007')).toBe('returns?intake=seed-ebike-007');
  });

  it('has no page for other entity types', () => {
    expect(auditEntityPath('rating_report', 'r-1')).toBeNull();
    expect(auditEntityPath('database', 'main')).toBeNull();
    expect(auditEntityPath('', 'x')).toBeNull();
  });

  it('encodes ids so they cannot change the path', () => {
    expect(auditEntityPath('contract', '../admin?x=1')).toBe('contracts/..%2Fadmin%3Fx%3D1');
    expect(auditEntityPath('asset', 'a b')).toBe('items/a%20b');
  });

  it('gives no link for a blank id', () => {
    expect(auditEntityPath('contract', '')).toBeNull();
    expect(auditEntityPath('contract', '   ')).toBeNull();
  });

  it('offers only known types as filters', () => {
    expect(new Set(AUDIT_ENTITY_TYPES).size).toBe(AUDIT_ENTITY_TYPES.length);
    expect(AUDIT_ENTITY_TYPES).toContain('contract');
  });
});
