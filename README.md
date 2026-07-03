# Altura BSA KPI

Executive reporting platform for the Altura Credit Union BSA/AML Department.
Transforms Verafin CTR/SAR CSV exports into executive dashboards, regulatory
compliance metrics, employee performance analytics, and **natively editable**
Microsoft PowerPoint presentations.

Built to the consolidated specification in
[`docs/Altura-BSA-KPI-Project-Specification.md`](docs/Altura-BSA-KPI-Project-Specification.md)
(SRS Chapters 1–16 + TDD Chapter 1).

## Run on any computer

The app is fully self-contained — all libraries are vendored in `vendor/`,
so **no internet connection is needed** after you have the folder.

1. Get the folder onto the machine: `git clone`, GitHub → Code → **Download
   ZIP** (then unzip), or copy it from a USB drive / network share.
2. Double-click the launcher:
   - **macOS:** `Start Dashboard.command`
     (first time: right-click → Open, or run `xattr -d com.apple.quarantine "Start Dashboard.command"` if Gatekeeper blocks it)
   - **Windows:** `Start Dashboard.bat`
3. The dashboard opens at <http://localhost:8137>. Close the server window to stop.

The only prerequisite is **Python 3 or Node.js** (either one) — the launcher
finds whichever is installed. A local HTTP server is required because
browsers block config/template fetches from `file://`; nothing is ever sent
off the machine — all CSV processing happens client-side.

Manual alternative: `python3 -m http.server 8080` (or `npm start`, or
`node tools/serve.mjs`) in the folder, then open the printed URL.

Once running, either:

- **Load Sample Data** (header button) — bundled 14-month CTR/SAR datasets, or
- **Import CTR CSV / Import SAR CSV** — real Verafin exports with the
  approved headers (validated on import; missing headers block processing).

## What's included (Phase 1)

| Module | Where |
|---|---|
| Executive Dashboard (KPI cards, cross-module trends, leaderboard, goal progress) | `src/dashboards/executive.js` |
| CTR Dashboard — 5 spec visualizations + compliance benchmarks | `src/dashboards/ctr.js` |
| SAR Dashboard — Performance Trend + 5 spec visualizations incl. Initial/Continuing + activity analysis, template-driven executive report | `src/dashboards/sar.js` |
| KPI / Data Processing Engine (pure JS, UI-free) | `src/engines/kpiEngine.js` |
| Goal Engine — versioned, effective-dated goals (history preserved) | `src/engines/goalEngine.js` |
| Employee Analytics — balanced 0–100 performance indexes, coaching/recognition flags | `src/engines/employeeAnalytics.js` |
| Executive Report generation — template-driven engine: injects chart data, embedded workbook, and KPI text into the corporate master template (`template/ctr-executive-master.pptx`), preserving all formatting | `src/exports/reportEngine.js` |
| Goal Management page (role-gated, audited) | `src/dashboards/goals.js` |
| Audit Log (imports, goal changes, exports — localStorage) | `src/services/auditService.js` |
| Role-based access (Admin / Manager / Analyst / Executive / Auditor) | `config/application-settings.json` |

All business rules live in `config/*.json` (goals, header mappings, status
mappings, theme colors) — routine changes need no code edits.

## Tests

```bash
npm test        # node --test tests/engine.test.mjs — 16 KPI/goal/analytics validations
```

Regenerate the deterministic sample datasets with `npm run generate-samples`.
Rebuild the master report template (only needed when the corporate template
or chart series structure changes) with `node tools/build-master-template.mjs`
(requires `npm install` for the dev dependencies).

## Key business rules

- **CTR:** Creation → Queued → Submitted → Accepted · target 5 days · regulatory 15 days
- **SAR:** Determination → Queued → Submitted → Accepted · target 21 days · regulatory 30 days
- Due Date is a compliance deadline only, never a workflow stage.
- Green ≤ target · Yellow ≤ regulatory threshold · Red > threshold.
- All trends use rolling 13-month windows; every chart offers a table view.
- On-time = Accepted Date ≤ Due Date (spec glossary / assumption A4).

## Phase 1 simplifications (per spec assumptions)

- Runs fully client-side; goal versions and the audit log persist in
  `localStorage` (assumption A3 — no backend mandated for Phase 1).
- The role selector simulates RBAC pending a future authentication provider
  (SRS 13.10).
- The CTR Workflow Timeline goal line defaults to **2 days**
  (`config/goals.json → timelineGoalLineDays`) per SRS Part 4 §12.5 — flagged
  as conflict C1 in the project specification; confirm with the product owner.
