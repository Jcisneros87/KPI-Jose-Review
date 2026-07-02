/**
 * Application bootstrap: loads configuration, wires navigation, role-based
 * access, CSV import, presentation mode, and renders the active dashboard.
 */

import { loadConfig } from '../services/configService.js';
import { importCsv } from '../services/importService.js';
import { auditLog } from '../services/auditService.js';
import { configureCharts, disposeCharts, resizeCharts } from '../charts/chartService.js';
import { el, notifyToast, fmt } from '../components/ui.js';
import { state, subscribe, setRoute, setRole, setData, can } from './state.js';
import { renderExecutiveDashboard } from '../dashboards/executive.js';
import { renderCtrDashboard } from '../dashboards/ctr.js';
import { renderSarDashboard } from '../dashboards/sar.js';
import { renderGoalsPage } from '../dashboards/goals.js';
import { renderAuditPage } from '../dashboards/audit.js';

const ROUTES = {
  executive: { label: 'Executive Dashboard', render: renderExecutiveDashboard },
  ctr: { label: 'CTR Dashboard', render: renderCtrDashboard },
  sar: { label: 'SAR Dashboard', render: renderSarDashboard },
  goals: { label: 'Goal Management', render: renderGoalsPage },
  audit: { label: 'Audit Log', render: renderAuditPage },
};

const FUTURE_MODULES = ['Alerts', 'Cases', 'Fraud', 'OFAC', '314(a)', '314(b)'];

async function importFile(file, type) {
  try {
    const result = await importCsv({ file, type, config: state.config });
    if (!result.ok) {
      notifyToast(`${type.toUpperCase()} import failed: ${result.error}`, 'error', 9000);
      auditLog('IMPORT_FAILED', `${type.toUpperCase()} CSV: ${file.name}`, { user: state.role, newValue: result.error });
      return;
    }
    setData(type, result);
    auditLog('IMPORT_CSV', `${type.toUpperCase()} CSV: ${file.name}`, {
      user: state.role,
      newValue: { records: result.records.length, duplicates: result.duplicates, blankRows: result.blankRows },
    });
    let msg = `${type.toUpperCase()} import complete: ${fmt.num(result.records.length)} records in ${result.elapsedMs} ms.`;
    if (result.duplicates) msg += ` ${result.duplicates} duplicate report number(s) skipped.`;
    if (result.blankRows) msg += ` ${result.blankRows} blank row(s) ignored.`;
    notifyToast(msg, 'success', 7000);
    if (result.invalidDates) notifyToast(`${result.invalidDates} value(s) could not be parsed as dates — affected metrics treat them as blank.`, 'warning', 9000);
    if (result.extraHeaders.length) notifyToast(`Ignored unused columns: ${result.extraHeaders.join(', ')}`, 'info', 6000);
  } catch (err) {
    console.error(err);
    notifyToast(`Import error: ${err.message}`, 'error', 9000);
  }
}

async function loadSampleData() {
  for (const type of ['ctr', 'sar']) {
    const res = await fetch(`examples/${type}-sample.csv`);
    if (!res.ok) {
      notifyToast(`Sample ${type.toUpperCase()} data not found.`, 'error');
      continue;
    }
    const text = await res.text();
    const result = await importCsv({ text, type, config: state.config });
    if (result.ok) {
      result.fileName = `${type}-sample.csv — bundled sample`;
      setData(type, result);
    }
  }
  auditLog('IMPORT_CSV', 'Bundled sample data (CTR + SAR)', { user: state.role });
  notifyToast('Sample CTR and SAR datasets loaded.', 'success');
}

function header() {
  const roleSelect = el('select', { class: 'role-select', 'aria-label': 'Active role' });
  for (const [key, def] of Object.entries(state.config.settings.roles)) {
    const opt = el('option', { value: key }, def.label);
    if (key === state.role) opt.selected = true;
    roleSelect.append(opt);
  }
  roleSelect.addEventListener('change', () => setRole(roleSelect.value));

  const ctrInput = el('input', { type: 'file', accept: '.csv', class: 'hidden-input' });
  const sarInput = el('input', { type: 'file', accept: '.csv', class: 'hidden-input' });
  ctrInput.addEventListener('change', () => ctrInput.files[0] && importFile(ctrInput.files[0], 'ctr').then(() => (ctrInput.value = '')));
  sarInput.addEventListener('change', () => sarInput.files[0] && importFile(sarInput.files[0], 'sar').then(() => (sarInput.value = '')));

  const importGroup = can('importCsv')
    ? el('div', { class: 'import-group' },
      el('button', { class: 'btn-header', onclick: () => ctrInput.click() }, '⬆ Import CTR CSV'),
      el('button', { class: 'btn-header', onclick: () => sarInput.click() }, '⬆ Import SAR CSV'),
      el('button', { class: 'btn-header btn-sample', onclick: loadSampleData }, '◍ Load Sample Data'),
      ctrInput, sarInput)
    : el('div', { class: 'import-group' });

  return el('header', { class: 'app-header' },
    el('div', { class: 'logo-block' },
      el('div', { class: 'logo-mark' }, 'A'),
      el('div', {},
        el('div', { class: 'logo-title' }, 'ALTURA'),
        el('div', { class: 'logo-sub' }, 'CREDIT UNION'))),
    el('h1', { class: 'app-title' }, state.config.settings.applicationTitle),
    el('div', { class: 'header-actions' },
      importGroup,
      el('label', { class: 'role-label' }, 'Role: ', roleSelect),
      el('button', {
        class: 'btn-header',
        title: 'Presentation mode — hides navigation and maximizes charts',
        onclick: () => {
          state.presentationMode = !state.presentationMode;
          document.body.classList.toggle('presentation', state.presentationMode);
          resizeCharts();
        },
      }, '⛶ Present'),
    ),
  );
}

function nav() {
  const items = Object.entries(ROUTES)
    .filter(([key]) => {
      if (key === 'goals') return true; // page itself explains read-only access
      if (key === 'audit') return can('viewAuditLog');
      return true;
    })
    .map(([key, def]) => el('button', {
      class: 'nav-item' + (state.route === key ? ' active' : ''),
      onclick: () => setRoute(key),
    }, def.label));

  const future = el('span', { class: 'nav-future', title: 'Phase 2+ roadmap modules' },
    FUTURE_MODULES.map((f) => el('span', { class: 'nav-future-chip' }, f)));

  return el('nav', { class: 'app-nav' },
    el('div', { class: 'nav-items' }, items),
    el('div', { class: 'breadcrumb' }, `Home / ${ROUTES[state.route].label}`),
    future,
  );
}

function dataStatus() {
  const chip = (type) => {
    const d = state.data[type];
    return el('span', { class: `data-chip ${d ? 'loaded' : ''}` },
      `${type.toUpperCase()}: ${d ? `${fmt.num(d.records.length)} records (${d.fileName})` : 'not loaded'}`);
  };
  return el('div', { class: 'data-status' }, chip('ctr'), chip('sar'));
}

function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  root.append(header(), nav(), dataStatus());
  const view = el('main', { class: 'view', id: 'view' });
  root.append(view);
  ROUTES[state.route].render(view, state);
  disposeCharts();
}

async function boot() {
  try {
    state.config = await loadConfig();
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="boot-error">Failed to load configuration: ${err.message}.<br>` +
      'Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>) — config files cannot load from file://.</div>';
    return;
  }
  configureCharts(state.config.themes);
  subscribe(() => render());
  window.addEventListener('resize', () => resizeCharts());
  render();
}

boot();
