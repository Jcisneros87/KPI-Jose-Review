/**
 * Reusable UI component library (SRS 10.13): KPI cards, filter controls,
 * chart panels (with accessible table view + empty state), notifications,
 * progress bars. Rendering only — values arrive precomputed.
 */

import { renderChart } from '../charts/chartService.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export const fmt = {
  num: (v) => (v == null ? '—' : Number(v).toLocaleString('en-US')),
  days: (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })} days`),
  pct: (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`),
  signed: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}`),
};

// ---------------------------------------------------------------- KPI cards

/**
 * KPI card (SRS 12.4/10.7): white background, thin border, underlined
 * heading, large centered value, optional variance + trend arrow, status color.
 */
export function kpiCard({ title, value, status = 'info', variance, varianceLabel, note }) {
  const card = el('div', { class: `kpi-card kpi-${status}` },
    el('div', { class: 'kpi-title' }, title),
    el('div', { class: 'kpi-value' }, value == null ? '—' : value),
  );
  if (variance != null) {
    const dir = variance > 0 ? '▲' : variance < 0 ? '▼' : '■';
    card.append(el('div', { class: 'kpi-variance' }, `${dir} ${fmt.signed(variance)} ${varianceLabel || 'vs prior month'}`));
  }
  if (note) card.append(el('div', { class: 'kpi-note' }, note));
  return card;
}

export function kpiRail(cards) {
  return el('aside', { class: 'kpi-rail' }, cards);
}

// ---------------------------------------------------------------- chart panel

/**
 * White chart panel with subtitle banner, optional "Better ↑/↓" direction
 * indicator, table-view toggle (accessibility), and empty state.
 * tableModel: { headers: [], rows: [[]] }
 */
export function chartPanel({ title, subtitle, option, height = 380, empty, emptyMessage, tableModel, direction }) {
  const body = el('div', { class: 'panel-body' });
  const panel = el('section', { class: 'chart-panel' },
    el('div', { class: 'panel-head' },
      el('div', {},
        el('h3', { class: 'panel-title' }, title),
        subtitle ? el('div', { class: 'panel-subtitle' }, subtitle) : null,
      ),
      el('div', { class: 'panel-tools' },
        direction ? el('span', { class: 'direction-indicator', title: `${direction.label}` }, `${direction.up ? '↑' : '↓'} Better`) : null,
        tableModel ? el('button', { class: 'btn-ghost btn-table', onclick: () => toggleTable() }, '⊞ Table') : null,
      ),
    ),
    body,
  );

  let showingTable = false;
  const chartHost = el('div', { class: 'chart-host', style: `height:${height}px` });

  function renderBody() {
    body.innerHTML = '';
    if (empty) {
      body.append(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '◫'),
        el('div', {}, emptyMessage || 'No records match the selected filters.'),
      ));
      return;
    }
    if (showingTable && tableModel) {
      body.append(dataTable(tableModel));
      return;
    }
    body.append(chartHost);
    requestAnimationFrame(() => renderChart(chartHost, option));
  }

  function toggleTable() {
    showingTable = !showingTable;
    renderBody();
  }

  renderBody();
  return panel;
}

export function dataTable({ headers, rows }) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'data-table' },
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) =>
        el('td', { class: i > 0 ? 'num' : '' }, c == null ? '—' : String(c)))))),
    ),
  );
}

// ---------------------------------------------------------------- filters

/** Multi-select dropdown checklist. */
function multiSelect({ label, options, selected = [], onChange }) {
  const wrap = el('div', { class: 'filter-multi' });
  const btn = el('button', { class: 'filter-input filter-multi-btn' },
    selected.length ? `${label}: ${selected.length} selected` : `${label}: All`);
  const menu = el('div', { class: 'filter-multi-menu hidden' });
  for (const opt of options) {
    const cb = el('input', { type: 'checkbox', value: opt });
    cb.checked = selected.includes(opt);
    cb.addEventListener('change', () => {
      const values = [...menu.querySelectorAll('input:checked')].map((i) => i.value);
      btn.textContent = values.length ? `${label}: ${values.length} selected` : `${label}: All`;
      onChange(values);
    });
    menu.append(el('label', { class: 'filter-multi-item' }, cb, ` ${opt}`));
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.filter-multi-menu').forEach((m) => m !== menu && m.classList.add('hidden'));
    menu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) menu.classList.add('hidden');
  });
  wrap.append(btn, menu);
  return wrap;
}

/**
 * Filter bar builder. defs: array of
 *  { key, label, kind: 'select'|'multi'|'month'|'daterange', options }
 * Persistent per-scope; every change calls onChange(filters).
 */
export function filterBar({ defs, filters, onChange }) {
  const bar = el('div', { class: 'filter-bar' });
  const current = { ...filters };
  const apply = () => onChange({ ...current });

  for (const d of defs) {
    if (d.kind === 'select' || d.kind === 'month') {
      const sel = el('select', { class: 'filter-input', 'aria-label': d.label });
      sel.append(el('option', { value: '' }, `${d.label}: All`));
      for (const o of d.options) {
        const opt = el('option', { value: o.value ?? o }, o.label ?? o);
        if ((o.value ?? o) === current[d.key]) opt.selected = true;
        sel.append(opt);
      }
      sel.addEventListener('change', () => {
        current[d.key] = sel.value || undefined;
        apply();
      });
      bar.append(sel);
    } else if (d.kind === 'multi') {
      bar.append(multiSelect({
        label: d.label,
        options: d.options,
        selected: current[d.key] || [],
        onChange: (values) => {
          current[d.key] = values.length ? values : undefined;
          apply();
        },
      }));
    } else if (d.kind === 'daterange') {
      const from = el('input', { type: 'date', class: 'filter-input', 'aria-label': `${d.label} from` });
      const to = el('input', { type: 'date', class: 'filter-input', 'aria-label': `${d.label} to` });
      if (current.dateFromStr) from.value = current.dateFromStr;
      if (current.dateToStr) to.value = current.dateToStr;
      const applyDates = () => {
        current.dateFromStr = from.value || undefined;
        current.dateToStr = to.value || undefined;
        current.dateFrom = from.value ? new Date(from.value + 'T00:00:00') : undefined;
        current.dateTo = to.value ? new Date(to.value + 'T23:59:59') : undefined;
        apply();
      };
      from.addEventListener('change', applyDates);
      to.addEventListener('change', applyDates);
      bar.append(el('span', { class: 'filter-range' }, from, el('span', { class: 'filter-sep' }, '–'), to));
    }
  }

  bar.append(el('button', {
    class: 'btn-ghost',
    onclick: () => onChange({}),
  }, 'Reset filters'));
  return bar;
}

// ---------------------------------------------------------------- notifications

const toastHost = el('div', { class: 'toast-host' });
document.addEventListener('DOMContentLoaded', () => document.body.append(toastHost));

export function notifyToast(message, kind = 'info', timeout = 5000) {
  const t = el('div', { class: `toast toast-${kind}`, role: 'status' },
    el('span', { class: 'toast-icon' }, { info: 'ℹ', success: '✓', warning: '⚠', error: '✕' }[kind] || 'ℹ'),
    el('span', {}, message),
  );
  toastHost.append(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 400);
  }, timeout);
}

// ---------------------------------------------------------------- misc

export function progressBar({ label, valuePct, status = 'green' }) {
  const clamped = Math.max(0, Math.min(100, valuePct ?? 0));
  return el('div', { class: 'progress-row' },
    el('div', { class: 'progress-label' }, label),
    el('div', { class: 'progress-track' },
      el('div', { class: `progress-fill progress-${status}`, style: `width:${clamped}%` })),
    el('div', { class: 'progress-value' }, valuePct == null ? '—' : `${Math.round(clamped)}%`),
  );
}

export function sectionHeader(text, sub) {
  return el('div', { class: 'section-header' },
    el('h2', {}, text),
    sub ? el('p', { class: 'section-sub' }, sub) : null,
  );
}
