/**
 * Audit Log view (SRS 13.6) — role-gated history of imports, goal changes,
 * exports, and errors.
 */

import { el, sectionHeader, dataTable } from '../components/ui.js';
import { readAudit } from '../services/auditService.js';
import { can } from '../app/state.js';

export function renderAuditPage(container, state) {
  container.append(sectionHeader('Audit Log',
    'Recorded imports, goal changes, configuration updates, and exports'));

  if (!can('viewAuditLog')) {
    container.append(el('div', { class: 'notice notice-warning' },
      'Your role does not include audit log access. Switch to Administrator, BSA Manager, or Auditor.'));
    return;
  }

  const entries = readAudit();
  container.append(el('section', { class: 'chart-panel' },
    el('div', { class: 'panel-body' },
      entries.length
        ? dataTable({
          headers: ['Timestamp', 'User (role)', 'Action', 'Object', 'Detail'],
          rows: entries.map((e) => [
            new Date(e.timestamp).toLocaleString('en-US'),
            e.user,
            e.action,
            e.object,
            e.newValue ? JSON.stringify(e.newValue).slice(0, 120) : '—',
          ]),
        })
        : el('div', { class: 'empty-state' }, 'No audit entries recorded yet.'),
    ),
  ));
}
