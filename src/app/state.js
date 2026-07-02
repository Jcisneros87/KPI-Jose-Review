/**
 * Application state (TDD Ch. 1 §7): imported datasets, active filters,
 * configuration, role, and route. Presentation components consume this
 * state; they never calculate business values themselves.
 */

const listeners = new Set();

export const state = {
  config: null,
  role: 'manager',
  route: 'executive',
  presentationMode: false,
  data: {
    ctr: null, // { records, fileName, importedAt, warnings, ... }
    sar: null,
  },
  filters: {
    ctr: {},
    sar: {},
    executive: {},
  },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(change = {}) {
  for (const fn of listeners) fn(state, change);
}

export function setRoute(route) {
  state.route = route;
  notify({ route: true });
}

export function setRole(role) {
  state.role = role;
  notify({ role: true });
}

export function setData(type, payload) {
  state.data[type] = payload;
  notify({ data: true });
}

export function setFilters(scope, filters) {
  state.filters[scope] = filters;
  notify({ filters: true });
}

export function can(capability) {
  const roles = state.config?.settings?.roles || {};
  const r = roles[state.role];
  return r ? !!r[capability] : false;
}
