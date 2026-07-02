/**
 * Audit Service (SRS 13.6) — records imports, goal changes, exports, and
 * errors with timestamp / user / action / object / previous / new values.
 * Phase 1 persists to localStorage (client-side, per spec assumption A3).
 */

const KEY = 'altura.audit';
const MAX_ENTRIES = 500;

export function auditLog(action, object, { user = 'local-user', previousValue = null, newValue = null } = {}) {
  const entries = readAudit();
  entries.unshift({
    timestamp: new Date().toISOString(),
    user,
    action,
    object,
    previousValue,
    newValue,
  });
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage full — audit is best-effort client-side */
  }
}

export function readAudit() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearAudit() {
  localStorage.removeItem(KEY);
}
