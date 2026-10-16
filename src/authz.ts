// Permission matrix. Server-side checks use these; the database enforces tenant/client
// scoping and identifiable-worker access independently through RLS.
export const ROLES = ['org_admin', 'practitioner', 'field_technician', 'technical_reviewer', 'action_owner', 'client_readonly'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'read', 'org.manage', 'users.manage', 'sites.write', 'register.write', 'groups.review',
  'worker.identity.read', 'worker.identity.write', 'plans.write', 'plans.review',
  'field.capture', 'instruments.write', 'lab.write', 'lab.import',
  'assess.write', 'assess.approve', 'benchmark.write', 'benchmark.verify',
  'controls.write', 'controls.inspect', 'actions.assign', 'actions.implement', 'actions.review',
  'reports.generate', 'reports.read_drafts', 'audit.read', 'export.data',
  'disposal.request', 'disposal.approve', 'conflicts.resolve', 'integrations.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const m: Record<Role, Permission[]> = {
  org_admin: ['read', 'org.manage', 'users.manage', 'sites.write', 'worker.identity.read', 'worker.identity.write',
    'audit.read', 'export.data', 'disposal.request', 'disposal.approve', 'integrations.manage', 'reports.read_drafts'],
  practitioner: ['read', 'sites.write', 'register.write', 'groups.review', 'worker.identity.read', 'worker.identity.write',
    'plans.write', 'field.capture', 'instruments.write', 'lab.write', 'lab.import', 'assess.write', 'benchmark.write',
    'controls.write', 'controls.inspect', 'actions.assign', 'reports.generate', 'reports.read_drafts', 'conflicts.resolve',
    'export.data', 'disposal.request'],
  field_technician: ['read', 'field.capture', 'instruments.write', 'controls.inspect'],
  technical_reviewer: ['read', 'groups.review', 'worker.identity.read', 'plans.review', 'assess.approve', 'benchmark.verify',
    'actions.review', 'reports.generate', 'reports.read_drafts', 'conflicts.resolve', 'audit.read', 'export.data'],
  action_owner: ['read', 'actions.implement', 'controls.inspect'],
  client_readonly: ['read'],
};

export const permissionsFor = (role: Role): Set<Permission> => new Set(m[role]);
export const matrix = m;
