// Append-only audit trail for admin actions and security events.
// Powers the admin "Audit log" tab. Rows are never updated or deleted by
// app code (a 1-year purge runs from the health cleanup job).

import { db } from '@/lib/db';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown>;
}

/** Fire-and-forget audit write — never blocks or breaks the caller. */
export function writeAudit(entry: AuditEntry): Promise<void> {
  return db.auditLog
    .create({
      data: {
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel?.slice(0, 200) ?? null,
        details: JSON.stringify(entry.details ?? {}),
      },
    })
    .then(() => undefined)
    .catch(() => undefined);
}
