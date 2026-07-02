/**
 * Configuration Service — loads external JSON configuration (SRS 11.9/13.5)
 * and layers locally persisted goal versions (Goal Editor changes) on top of
 * the shipped defaults.
 */

const GOALS_OVERRIDE_KEY = 'altura.goals.versions';

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

export async function loadConfig() {
  const [goals, headerMappings, statusMappings, themes, settings] = await Promise.all([
    fetchJson('config/goals.json'),
    fetchJson('config/header-mappings.json'),
    fetchJson('config/status-mappings.json'),
    fetchJson('config/themes.json'),
    fetchJson('config/application-settings.json'),
  ]);
  const stored = loadStoredGoalVersions();
  if (stored.length) {
    goals.versions = [...goals.versions, ...stored].sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) || a.version - b.version
    );
  }
  return { goals, headerMappings, statusMappings, themes, settings };
}

export function loadStoredGoalVersions() {
  try {
    return JSON.parse(localStorage.getItem(GOALS_OVERRIDE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveGoalVersion(version) {
  const stored = loadStoredGoalVersions();
  stored.push(version);
  localStorage.setItem(GOALS_OVERRIDE_KEY, JSON.stringify(stored));
}

export function resetStoredGoals() {
  localStorage.removeItem(GOALS_OVERRIDE_KEY);
}
