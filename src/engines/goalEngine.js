/**
 * Goal Engine — configurable goals with historical integrity (SRS Ch. 8).
 * Goals are versioned by effective date: historical months are always
 * evaluated against the goal version active during that period, so changing
 * a goal today never rewrites past performance.
 */

/**
 * Latest enabled goal version effective for the given month, honoring
 * effectiveDate, expirationDate, and status. Returns null when no version
 * was active — a month before the first configured goal is never evaluated
 * against a later goal (SRS 8.9).
 */
export function activeGoalVersion(goalsConfig, mKey) {
  const versions = [...(goalsConfig.versions || [])]
    .filter((v) => v.status !== 'disabled' && v.status !== 'archived')
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (!versions.length) return null;
  if (!mKey) return versions[versions.length - 1];
  const monthEnd = `${mKey}-31`;
  const monthStart = `${mKey}-01`;
  let active = null;
  for (const v of versions) {
    if (v.effectiveDate <= monthEnd && (!v.expirationDate || v.expirationDate >= monthStart)) {
      active = v;
    }
  }
  return active;
}

export function goalsFor(goalsConfig, type, mKey) {
  const v = activeGoalVersion(goalsConfig, mKey);
  return v ? v[type] : null;
}

/**
 * Classify a value against target/threshold (SRS 11.5).
 * lowerIsBetter (filing days): green ≤ target, yellow ≤ threshold, red > threshold.
 * higherIsBetter (on-time %): green ≥ target, red < threshold, yellow between.
 */
export function classify(value, target, threshold, { higherIsBetter = false } = {}) {
  if (value == null || target == null) return 'info';
  if (higherIsBetter) {
    if (value >= target) return 'green';
    if (threshold != null && value < threshold) return 'red';
    return 'yellow';
  }
  if (value <= target) return 'green';
  if (threshold == null || value <= threshold) return 'yellow';
  return 'red';
}

export function evaluate(metricName, actual, target, threshold, opts = {}) {
  const variance = actual == null || target == null ? null : Math.round((actual - target) * 10) / 10;
  const variancePct = actual == null || !target ? null : Math.round(((actual - target) / target) * 1000) / 10;
  return {
    metric: metricName,
    actual,
    target,
    threshold,
    variance,
    variancePct,
    status: classify(actual, target, threshold, opts),
  };
}
