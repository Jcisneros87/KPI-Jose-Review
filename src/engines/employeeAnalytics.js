/**
 * Employee Analytics & Performance Engine (SRS Ch. 7).
 * Balanced scoring keyed on Assigned Owner Name: Overall Performance Index
 * (0–100) from configurable-weight component indexes. Phase 1 scope is CTRs
 * and SARs; Alerts participate in the model but compute as absent until an
 * Alerts data source exists (spec assumption A5).
 */

import { monthKey, rollingMonths } from './kpiEngine.js';

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** 100 at/below target, linear to 0 at the regulatory threshold. */
function timelinessScore(avgDays, target, threshold) {
  if (avgDays == null) return null;
  if (avgDays <= target) return 100;
  if (avgDays >= threshold) return 0;
  return clamp(((threshold - avgDays) / (threshold - target)) * 100);
}

export function computeEmployeeStats({ ctrRecords = [], sarRecords = [], goalsConfig, scoring, months }) {
  const weights = scoring?.weights || { productivity: 0.25, timeliness: 0.2, compliance: 0.25, quality: 0.2, workload: 0.1 };
  const ctrGoal = goalsConfig?.versions?.length ? goalsConfig.versions[goalsConfig.versions.length - 1].ctr : { internalTargetDays: 5, regulatoryThresholdDays: 15 };
  const sarGoal = goalsConfig?.versions?.length ? goalsConfig.versions[goalsConfig.versions.length - 1].sar : { internalTargetDays: 21, regulatoryThresholdDays: 30 };

  const owners = new Map();
  const get = (name) => {
    const key = name || '(unassigned)';
    if (!owners.has(key)) {
      owners.set(key, {
        name: key,
        ctrCount: 0, sarCount: 0, sarInitial: 0, sarContinuing: 0, alertsCount: 0,
        accepted: 0, completed: 0, queueFailed: 0,
        onTime: 0, onTimeDen: 0,
        _ctrDays: [], _sarDays: [],
        monthly: new Map(),
      });
    }
    return owners.get(key);
  };

  const ingest = (records, type) => {
    for (const r of records) {
      const o = get(r.owner);
      if (type === 'ctr') o.ctrCount++;
      else {
        o.sarCount++;
        const ft = String(r.filingType || '').toLowerCase();
        if (ft.startsWith('continuing')) o.sarContinuing++;
        else o.sarInitial++;
      }
      if (r.statusCategory === 'accepted') o.accepted++;
      if (r.statusCategory === 'accepted' || r.statusCategory === 'excluded') o.completed++;
      if (r.statusCategory === 'queueFailed') o.queueFailed++;
      if (r.onTime != null) {
        o.onTimeDen++;
        if (r.onTime) o.onTime++;
      }
      if (r.dStartToAccept != null) (type === 'ctr' ? o._ctrDays : o._sarDays).push(r.dStartToAccept);
      const mk = monthKey(r.workflowStart);
      if (mk) {
        if (!o.monthly.has(mk)) o.monthly.set(mk, { volume: 0, days: [] });
        const mo = o.monthly.get(mk);
        mo.volume++;
        if (r.dStartToAccept != null) mo.days.push(r.dStartToAccept);
      }
    }
  };
  ingest(ctrRecords, 'ctr');
  ingest(sarRecords, 'sar');

  const stats = [...owners.values()].filter((o) => o.name !== '(unassigned)' || o.ctrCount + o.sarCount > 0);
  if (!stats.length) return [];

  const maxVolume = Math.max(...stats.map((o) => o.ctrCount + o.sarCount), 1);
  const totalVolume = stats.reduce((a, o) => a + o.ctrCount + o.sarCount, 0);

  for (const o of stats) {
    o.volume = o.ctrCount + o.sarCount + o.alertsCount;
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    o.avgCtrDays = round1(avg(o._ctrDays));
    o.avgSarDays = round1(avg(o._sarDays));
    const allDays = [...o._ctrDays, ...o._sarDays];
    o.avgFilingDays = round1(avg(allDays));
    o.onTimePct = o.onTimeDen ? round1((o.onTime / o.onTimeDen) * 100) : null;
    o.queueFailRatePct = o.volume ? round1((o.queueFailed / o.volume) * 100) : 0;
    o.acceptedPct = o.completed ? round1((o.accepted / o.completed) * 100) : null;
    o.volumeSharePct = round1((o.volume / totalVolume) * 100);

    // Component indexes (0–100)
    o.productivityIndex = round1(clamp((o.volume / maxVolume) * 100));
    const tCtr = timelinessScore(avg(o._ctrDays), ctrGoal.internalTargetDays, ctrGoal.regulatoryThresholdDays);
    const tSar = timelinessScore(avg(o._sarDays), sarGoal.internalTargetDays, sarGoal.regulatoryThresholdDays);
    const tParts = [];
    if (tCtr != null) tParts.push({ score: tCtr, w: o.ctrCount });
    if (tSar != null) tParts.push({ score: tSar, w: o.sarCount });
    const tW = tParts.reduce((a, p) => a + p.w, 0);
    o.timelinessIndex = tW ? round1(tParts.reduce((a, p) => a + p.score * p.w, 0) / tW) : null;
    o.complianceIndex = o.onTimePct;
    o.qualityIndex = o.acceptedPct == null ? null : round1(clamp(o.acceptedPct * (1 - (o.queueFailRatePct || 0) / 100)));
    o.workloadIndex = round1(clamp((o.volume / maxVolume) * 100));

    const components = [
      ['productivity', o.productivityIndex],
      ['timeliness', o.timelinessIndex],
      ['compliance', o.complianceIndex],
      ['quality', o.qualityIndex],
      ['workload', o.workloadIndex],
    ].filter(([, v]) => v != null);
    const wSum = components.reduce((a, [k]) => a + (weights[k] || 0), 0);
    o.overallIndex = wSum
      ? round1(components.reduce((a, [k, v]) => a + v * (weights[k] || 0), 0) / wSum)
      : null;

    // Trend: rolling window volumes + avg days for scorecard sparklines
    const window = months || rollingMonths([...o.monthly.keys()].sort().pop(), 13);
    o.trend = window.map((mk) => {
      const mo = o.monthly.get(mk);
      return {
        month: mk,
        volume: mo ? mo.volume : 0,
        avgDays: mo && mo.days.length ? round1(mo.days.reduce((a, b) => a + b, 0) / mo.days.length) : null,
      };
    });

    // Coaching / recognition indicators (advisory only — SRS 7.11/7.12)
    const half = Math.floor(o.trend.length / 2);
    const recentDays = o.trend.slice(half).map((t) => t.avgDays).filter((v) => v != null);
    const priorDays = o.trend.slice(0, half).map((t) => t.avgDays).filter((v) => v != null);
    const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const rising = avgOf(recentDays) != null && avgOf(priorDays) != null && avgOf(recentDays) > avgOf(priorDays) * 1.15;
    const coach = scoring?.coaching || {};
    const recog = scoring?.recognition || {};
    o.coachingFlags = [];
    if (o.onTimePct != null && o.onTimePct < (coach.minCompliancePct ?? 85)) o.coachingFlags.push('Low compliance %');
    if ((o.queueFailRatePct || 0) > (coach.maxQueueFailRatePct ?? 5)) o.coachingFlags.push('High queue failure rate');
    if (rising) o.coachingFlags.push('Processing times increasing');
    o.recognitionFlags = [];
    if (o.onTimePct != null && o.onTimePct >= (recog.minOnTimePct ?? 98)) o.recognitionFlags.push('Consistent on-time performance');
    if (o.volumeSharePct >= (recog.minVolumeSharePct ?? 12) && (o.qualityIndex ?? 0) >= 90) o.recognitionFlags.push('High productivity with strong quality');

    delete o._ctrDays;
    delete o._sarDays;
    delete o.monthly;
  }

  return stats.sort((a, b) => (b.overallIndex ?? -1) - (a.overallIndex ?? -1));
}
