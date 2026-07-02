/**
 * Goal Management page (SRS Ch. 8): authorized users create new goal
 * versions without code changes. Versions are effective-dated so historical
 * reporting integrity is preserved; every change is audit-logged.
 */

import { el, fmt, sectionHeader, dataTable, notifyToast } from '../components/ui.js';
import { activeGoalVersion } from '../engines/goalEngine.js';
import { saveGoalVersion, resetStoredGoals, loadStoredGoalVersions } from '../services/configService.js';
import { auditLog } from '../services/auditService.js';
import { can, notify } from '../app/state.js';

export function renderGoalsPage(container, state) {
  container.append(sectionHeader('Goal Management',
    'Configurable KPI targets — changes apply immediately across every dashboard, card, chart, and export'));

  if (!can('editGoals')) {
    container.append(el('div', { class: 'notice notice-warning' },
      'Your role has read-only access to goals. Switch to Administrator or BSA Manager to edit.'));
  }

  const goalsConfig = state.config.goals;
  const active = activeGoalVersion(goalsConfig, null);

  // ---- current goals table
  container.append(el('section', { class: 'chart-panel' },
    el('div', { class: 'panel-head' }, el('div', {},
      el('h3', { class: 'panel-title' }, `Active Goals (version ${active.version}, effective ${active.effectiveDate})`))),
    el('div', { class: 'panel-body' }, dataTable({
      headers: ['Module', 'Metric', 'Internal Target', 'Regulatory Threshold'],
      rows: [
        ['CTR', 'Average Filing Time', `${active.ctr.internalTargetDays} days`, `${active.ctr.regulatoryThresholdDays} days`],
        ['CTR', 'On-Time Filing', `${active.ctr.onTimeTargetPct ?? 100}%`, 'Regulatory minimum'],
        ['CTR', 'Queue Failures', String(active.ctr.queueFailureTarget ?? 0), 'N/A'],
        ['CTR', 'Workflow Timeline Goal Line', `${active.ctr.timelineGoalLineDays ?? 2} days`, '—'],
        ['SAR', 'Average Filing Time', `${active.sar.internalTargetDays} days`, `${active.sar.regulatoryThresholdDays} days`],
        ['SAR', 'On-Time Filing', `${active.sar.onTimeTargetPct ?? 100}%`, 'Regulatory minimum'],
        ['SAR', 'Queue Failures', String(active.sar.queueFailureTarget ?? 0), 'N/A'],
      ],
    })),
  ));

  // ---- goal editor
  if (can('editGoals')) {
    const fields = {
      ctrTarget: numInput(active.ctr.internalTargetDays),
      ctrThreshold: numInput(active.ctr.regulatoryThresholdDays),
      ctrTimeline: numInput(active.ctr.timelineGoalLineDays ?? 2),
      sarTarget: numInput(active.sar.internalTargetDays),
      sarThreshold: numInput(active.sar.regulatoryThresholdDays),
      effectiveDate: el('input', { type: 'date', class: 'filter-input', value: new Date().toISOString().slice(0, 10) }),
      summary: el('input', { type: 'text', class: 'filter-input goal-summary-input', placeholder: 'Change summary (required)' }),
    };

    const form = el('section', { class: 'chart-panel' },
      el('div', { class: 'panel-head' }, el('div', {},
        el('h3', { class: 'panel-title' }, 'Create New Goal Version'),
        el('div', { class: 'panel-subtitle' }, 'Historical months keep the goal version that was active during their period'))),
      el('div', { class: 'panel-body goal-form' },
        goalField('CTR Internal Target (days)', fields.ctrTarget),
        goalField('CTR Regulatory Threshold (days)', fields.ctrThreshold),
        goalField('CTR Timeline Goal Line (days)', fields.ctrTimeline),
        goalField('SAR Internal Target (days)', fields.sarTarget),
        goalField('SAR Regulatory Threshold (days)', fields.sarThreshold),
        goalField('Effective Date', fields.effectiveDate),
        goalField('Change Summary', fields.summary),
        el('div', { class: 'action-row' },
          el('button', {
            class: 'btn-primary',
            onclick: () => {
              if (!fields.summary.value.trim()) {
                notifyToast('A change summary is required for the audit trail.', 'warning');
                return;
              }
              const version = {
                version: Math.max(...goalsConfig.versions.map((v) => v.version)) + 1,
                effectiveDate: fields.effectiveDate.value,
                modifiedBy: state.role,
                changeSummary: fields.summary.value.trim(),
                ctr: {
                  ...active.ctr,
                  internalTargetDays: +fields.ctrTarget.value,
                  regulatoryThresholdDays: +fields.ctrThreshold.value,
                  timelineGoalLineDays: +fields.ctrTimeline.value,
                },
                sar: {
                  ...active.sar,
                  internalTargetDays: +fields.sarTarget.value,
                  regulatoryThresholdDays: +fields.sarThreshold.value,
                },
              };
              saveGoalVersion(version);
              goalsConfig.versions.push(version);
              goalsConfig.versions.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.version - b.version);
              auditLog('GOAL_CHANGE', `Goals v${version.version}`, {
                user: state.role,
                previousValue: { ctr: active.ctr, sar: active.sar },
                newValue: { ctr: version.ctr, sar: version.sar },
              });
              notifyToast(`Goal version ${version.version} saved — dashboards updated.`, 'success');
              notify({ goals: true });
            },
          }, 'Save New Goal Version'),
          el('button', {
            class: 'btn-ghost',
            onclick: () => {
              const stored = loadStoredGoalVersions();
              resetStoredGoals();
              goalsConfig.versions = goalsConfig.versions.filter((v) => !stored.some((s) => s.version === v.version && s.effectiveDate === v.effectiveDate));
              auditLog('GOAL_RESET', 'Goals restored to shipped defaults', { user: state.role });
              notifyToast('Locally saved goal versions removed — defaults restored.', 'success');
              notify({ goals: true });
            },
          }, 'Restore Defaults'),
        ),
      ),
    );
    container.append(form);
  }

  // ---- version history (SRS 8.9)
  container.append(el('section', { class: 'chart-panel' },
    el('div', { class: 'panel-head' }, el('div', {},
      el('h3', { class: 'panel-title' }, 'Goal Version History'))),
    el('div', { class: 'panel-body' }, dataTable({
      headers: ['Version', 'Effective Date', 'Modified By', 'CTR Target/Threshold', 'SAR Target/Threshold', 'Summary'],
      rows: [...goalsConfig.versions].reverse().map((v) => [
        v.version, v.effectiveDate, v.modifiedBy,
        `${v.ctr.internalTargetDays}d / ${v.ctr.regulatoryThresholdDays}d`,
        `${v.sar.internalTargetDays}d / ${v.sar.regulatoryThresholdDays}d`,
        v.changeSummary,
      ]),
    })),
  ));
}

function numInput(value) {
  return el('input', { type: 'number', class: 'filter-input', min: '0', step: '0.5', value: String(value) });
}

function goalField(label, input) {
  return el('label', { class: 'goal-field' }, el('span', { class: 'goal-field-label' }, label), input);
}
