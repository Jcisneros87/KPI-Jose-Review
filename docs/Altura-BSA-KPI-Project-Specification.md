# Altura BSA KPI — Consolidated Project Specification

**Version:** 1.0 (Consolidated)
**Date:** 2026-07-01
**Organization:** Altura Credit Union — BSA/AML Department
**Status:** Ready for implementation handoff

> This document consolidates the complete Altura BSA KPI Software Requirements
> Specification (SRS Parts 1–6 and Chapters 7–16) and the Technical Design
> Document (TDD Chapter 1) into a single, implementation-ready project
> specification. The source Markdown files remain the authoritative record;
> conflicts between them are flagged in Section 12 rather than silently resolved.

---

## Source Document Map

Logical reading order of the source files this specification was built from:

| # | Source File | Content |
|---|-------------|---------|
| 1 | `Altura-BSA-KPI-SRS.md` | Executive summary, vision, Phase 1 scope, UI vision, roadmap |
| 2 | `Altura-BSA-KPI-SRS-Master.md` | Master SRS shell — Chapters 1–6 summaries, revision history |
| 3 | `Altura-BSA-KPI-SRS-Part2.md` | System architecture, technology recommendations |
| 4 | `Altura-BSA-KPI-SRS-Part3.md` | Data model & KPI calculation specification |
| 5 | `Altura-BSA-KPI-SRS-Part4.md` | CTR Dashboard functional specification |
| 6 | `Altura-BSA-KPI-SRS-Part5.md` | SAR Dashboard functional specification |
| 7 | `Altura-BSA-KPI-SRS-Part6.md` | Executive Dashboard & navigation specification |
| 8 | `…Chapter7-Employee-Analytics.md` | Employee Analytics & Performance Engine |
| 9 | `…Chapter8-Goal-Management.md` | Goal Management & KPI Configuration Engine |
| 10 | `…Chapter9-PowerPoint-Export.md` | PowerPoint Export Engine |
| 11 | `…Chapter10-UI-UX-Design-System.md` | UI/UX Design System & presentation standards |
| 12 | `…Chapter11-Developer-Architecture.md` | Developer architecture & project structure |
| 13 | `…Chapter12-Data-Processing-KPI-Engine.md` | Data Processing & KPI Engine (enterprise spec) |
| 14 | `…Chapter13-Security-Roles-Configuration.md` | Security, roles, audit logging, configuration management |
| 15 | `…Chapter14-Testing-QA.md` | Testing, QA & release validation |
| 16 | `…Chapter15-Product-Roadmap.md` | Product roadmap & expansion strategy |
| 17 | `…Chapter16-Appendices-Reference.md` | Appendices: header references, formulas, glossary, config examples |
| 18 | `Altura-BSA-KPI-TDD-Chapter1-Technical-Architecture.md` | TDD: layered architecture, services, state, event flow |

Note: the standalone "Part" files and "Chapter" files use overlapping internal
section numbers (e.g., Part 3 is "11. Data Model" while a separate file is
"Chapter 11 — Developer Architecture"). This specification renumbers everything
into one clean hierarchy; see Section 12 for details.

---

## 1. Executive Summary / Overview

The Altura BSA KPI application is a web-based executive reporting platform for
the Altura Credit Union BSA/AML Department. It transforms raw **Verafin CSV
exports** into interactive executive dashboards, regulatory compliance metrics,
employee performance analytics, and **natively editable Microsoft PowerPoint
presentations**.

The application will become the department's single source for monthly KPI
reporting, leadership presentations, regulatory examinations, internal audits,
and continuous process improvement — replacing manual spreadsheet preparation
with automated, consistent, traceable reporting.

**Core principle:** the uploaded Verafin CSV files are the **single source of
truth** for all calculations. One calculation engine feeds many presentation
layers; no dashboard, chart, or export calculates business metrics
independently.

---

## 2. Purpose of the Project

- Automate monthly KPI reporting for the BSA/AML Department.
- Measure CTR (Currency Transaction Report) and SAR (Suspicious Activity
  Report) operational workflow performance.
- Track compliance against internal targets and regulatory filing thresholds.
- Measure and rank analyst performance with a balanced, transparent scoring model.
- Produce presentation-quality dashboards suitable for leadership meetings.
- Export **native, editable** Microsoft PowerPoint charts (never screenshots).
- Support future expansion into Alerts, Cases, Fraud, OFAC, 314(a)/314(b), and
  other BSA modules with configuration rather than redesign.

---

## 3. Scope

### 3.1 Phase 1 (In Scope)

- **CTR Dashboard** — five executive visualizations, KPI cards, goal lines,
  employee analytics, 13-month trend reporting.
- **SAR Dashboard** — filing workflow analytics, Initial vs. Continuing
  Activity analysis, compliance monitoring, KPI cards, monthly trends.
- **Executive Dashboard** — consolidated landing page with department-wide
  KPIs, cross-dashboard trends, employee leaderboard, goal progress.
- **Employee Analytics & Performance Engine** — scoped in Phase 1 to Alerts,
  CTRs, and SARs.
- **Goal Management & KPI Configuration Engine** — editable goals without code changes.
- **KPI / Data Processing Engine** — CSV import, validation, normalization,
  calculation, aggregation.
- **PowerPoint Export Engine** — editable export for the **CTR dashboard only**
  in Phase 1; architecture reusable for later modules.
- **Security & configuration framework** — RBAC roles, audit logging,
  externalized configuration.

### 3.2 Out of Scope for Phase 1 (Roadmap)

- **Phase 2:** Alerts, Cases, Fraud, OFAC, 314(a), 314(b) dashboards; editable
  SAR PowerPoint export; multi-slide executive presentation generation;
  department and branch scorecards.
- **Phase 3:** Trend/workload/goal forecasting, capacity planning, SLA risk
  indicators, branch and analyst benchmarking.
- **Phase 4:** AI capabilities — executive narrative generation, KPI summaries,
  outlier detection, bottleneck identification, natural-language dashboard
  search. AI insights are always recommendations requiring human review.
- **Future integrations:** Verafin APIs, Microsoft 365 / Teams / SharePoint /
  Excel, email notifications, scheduled report generation and distribution,
  authentication providers (Entra ID / Azure AD, Google Workspace, SAML 2.0,
  SSO, MFA).

---

## 4. Key Requirements (Guiding Principles)

1. **CSV-driven:** uploaded Verafin CSVs are the single source of truth; the
   engine never modifies imported source data.
2. **One calculation engine, many presentation layers** — deterministic,
   reproducible KPI results.
3. **Configuration over hardcoding:** goals, header mappings, status mappings,
   themes, chart defaults, and reporting periods live in configuration files.
4. **Executive presentation quality:** the application should resemble a
   professionally designed PowerPoint presentation, not a traditional
   reporting tool.
5. **Rolling 13-month reporting** across all trends and aggregations.
6. **Native editable PowerPoint export** — no screenshots or rasterized charts.
7. **Modular, extensible architecture:** new dashboard modules are added via
   dashboard definition + KPI mappings + chart configuration + export
   mappings, without changing core engines.
8. **Full traceability** from every reported metric back to source CSV data.

---

## 5. Functional Requirements

### 5.1 Business Rules — Workflows, Targets, Compliance

**CTR workflow:** `Creation Date → Queued Date → Submitted Date → Accepted Date`
- Internal Target: **5 days** · Regulatory Threshold: **15 days**

**SAR workflow:** `Date of Determination → Queued Date (if present) → Submitted Date → Accepted Date`
- Internal Target: **21 days** · Regulatory Threshold: **30 days**

**Due Date** is the regulatory deadline only — used exclusively for compliance
calculations, never treated as a workflow stage.

**Compliance classification (both report types):**

| Status | CTR | SAR | Color |
|--------|-----|-----|-------|
| On Target | ≤ 5 days | ≤ 21 days | Green |
| Within Regulatory Requirement | > 5 and ≤ 15 days | > 21 and ≤ 30 days | Yellow |
| Past Regulatory Requirement | > 15 days | > 30 days | Red |

**KPI calculations:**

- CTR: Creation→Queue, Queue→Submitted, Submitted→Accepted, Creation→Submitted,
  Creation→Accepted, Creation→Due Date, Accepted→Due Date (days remaining or
  past due).
- SAR: Determination→Queue, Queue→Submitted, Submitted→Accepted,
  Determination→Submitted, Determination→Accepted, Determination→Due Date,
  Accepted→Due Date (days remaining or past due).
- Average Filing Time: CTR = Creation Date → Accepted Date; SAR = Date of
  Determination → Accepted Date.

**Status normalization** (configuration-driven mappings):
- Accepted → *Accepted*
- Excluded, Cancelled (configurable) → *Excluded*
- Open, In Progress, Queued → *Pending*
- Queue Failed = Yes → *Queue Failed*
- Any unmapped value → *Other*

**Monthly aggregation:** all reporting uses rolling 13-month periods,
aggregated by reporting month, Assigned Owner, Branch Number, Status, Type of
Filing (SAR), Primary Activity Type, and Primary Activity Subtype. Every
visualization updates automatically when filters change.

### 5.2 CSV Import, Validation & Normalization Pipeline

Processing stages (see also Section 9, Technical Expectations):

1. **Import** — read CSV, detect delimiter, preserve raw values, assign an
   import identifier, record timestamp.
2. **Validation** — verify required headers (exact names), detect duplicate
   Report Numbers, invalid dates, and missing mandatory fields. Errors are
   surfaced before any KPI calculation begins; missing required fields must
   prevent KPI calculations until corrected.
3. **Normalization** — dates (consistent locale), numbers, empty values,
   status names, boolean fields. All downstream processing consumes normalized
   values only.

Additional rules: ignore blank rows and unused columns; skip duplicate Report
Numbers unless configured otherwise; log validation errors; display
user-friendly import warnings; support future header mappings through
configuration files rather than code changes. The application shall never
crash because of malformed user input.

**KPI calculation lifecycle:** normalize → classify status → calculate
workflow durations → evaluate regulatory compliance → aggregate monthly →
calculate employee metrics → compare against goals → build dashboard models →
prepare export models. The engine returns **immutable result objects**.

Suggested per-metric result model:

```json
{
  "metric": "CTR Average Filing Time",
  "actual": 3.8,
  "target": 5,
  "threshold": 15,
  "variance": -1.2,
  "status": "green"
}
```

### 5.3 CTR Dashboard (Flagship Module)

**Global filters** (on every CTR page): Reporting Month, Date Range, Assigned
Owner Name (multi-select), Status, Branch Number, Queued By. Any filter change
updates charts, KPI cards, trends, employee metrics, compliance metrics, and
exports.

**Executive KPI cards:** Current Month CTRs Accepted / Excluded / Submitted,
Current Month Average Filing Time, Month-over-Month Variance, Rolling 13-Month
Average, Internal Target, Regulatory Threshold, Selected Date Range.

**Required visualizations (all with 13-month x-axis, data labels, legends):**

1. **CTR Funnel Numbers Broken Out By Month** — clustered columns: CTRs
   Created, Queued, Submitted, Accepted, Excluded. Visualizes workflow volume
   through the reporting lifecycle.
2. **CTR SLA Performance** — stacked columns (Accepted, Excluded, Pending/In
   Progress, Queue Failed) with an On-Time Filing % overlay and a 100% goal
   reference line.
3. **CTR Workflow Timeline** — combination chart: columns for CTRs Created and
   Accepted; lines for Creation→Queue, Queue→Submitted, Submitted→Accepted,
   Creation→Accepted; configurable internal-target goal line (see Conflict C1
   in Section 12 regarding the default value).
4. **CTR Status Breakdown** — stacked columns by normalized status (Accepted,
   Excluded, Pending, Queue Failed, Other) with totals above each column.
5. **CTR Accepted vs Excluded Trend** — clustered columns (Accepted, Excluded)
   with a Total Created overlay and optional On-Time Filing % overlay.

**Other requirements:** compliance benchmark display (actual average filing
time vs. 5-day target and 15-day threshold with green/yellow/red
classification); optional vertical "Better" direction arrow (up = Accepted %,
On-Time Filing, SLA Performance; down = Processing Days, Queue Failures,
Past-Due Filings); empty state message *"No CTR records match the selected
filters."* — charts never fail silently; every visualization exports as a
native editable PowerPoint chart with its own embedded worksheet of summarized
monthly KPI values.

**Acceptance criteria:** all KPIs derive from approved CSV headers; every
chart updates with filter changes; goal lines reflect configurable targets;
KPI cards stay synchronized with chart data; PowerPoint export produces
editable Office charts; layout remains presentation-ready at common display
resolutions.

### 5.4 SAR Dashboard

Uses the same executive layout standards as CTR.

**Global filters:** Reporting Month, Date Range, Assigned Owner Name, Status,
Type of Filing, Primary Activity Type, Primary Activity Subtype.

**Executive KPI cards:** Current Month SARs Accepted / Excluded, Current Month
Average Filing Time, On-Time Filing %, Month-over-Month Variance, Rolling
13-Month Average, Internal Target (21 Days), Regulatory Threshold (30 Days),
Selected Date Range.

**Required visualizations:**

1. **SAR Filing Volume by Month** — clustered columns: Created, Submitted,
   Accepted, Excluded.
2. **SAR Filing Performance** — stacked columns (Accepted, Excluded, Pending,
   Queue Failed) with On-Time Filing % overlay and a 100% reference line.
3. **SAR Workflow Timeline** — columns for SARs Created and Accepted; lines
   for Determination→Queue, Queue→Submitted, Submitted→Accepted,
   Determination→Accepted; reference lines at 21 days (internal) and 30 days
   (regulatory).
4. **Filing Type Analysis** — Combined / Initial / Continuing Activity views;
   selecting a filing type refreshes all visualizations and KPI calculations;
   displays filing counts, average filing time, on-time %, employee
   performance, and monthly trends.
5. **Activity Type Analysis** — summaries by Primary Activity Type and
   Subtype, with drill-down into monthly trends and employee distribution.

**Continuing Activity SAR reference panel (informational only — must not
override KPI calculations unless a future configuration explicitly enables
alternate rules):** initial filing target is 30 days from Date of
Determination; Continuing Activity has an approximately 90-day review period;
continuing filings are generally submitted within 30 days after the review
period.

**Other requirements:** compliance benchmark display (21/30-day
classification), empty state *"No SAR records match the selected filters."*,
and an export architecture that supports future native editable PowerPoint
export (implementation deferred until CTR export is validated).

**Acceptance criteria:** all KPI calculations use approved SAR headers;
Initial/Continuing filtering functions correctly; all charts respond to
filters; KPI cards remain synchronized; compliance calculations classify
filing performance accurately; dashboard follows executive presentation
standards.

### 5.5 Executive Dashboard & Navigation (Landing Page)

Answers for leadership: Are we meeting internal goals? Are we meeting
regulatory requirements? What trends need attention? Where are bottlenecks?
Who needs coaching or recognition? Are we improving month over month?

**Navigation:** primary — Executive Dashboard, CTR Dashboard, SAR Dashboard;
future — Alerts, Cases, Fraud, OFAC, 314(a), 314(b), Workload, Executive
Reports, Settings. Breadcrumb trails required.

**Executive summary KPI cards** — each showing current value, previous-month
comparison, trend indicator, and color-coded status:
- *CTR:* Total Created, Total Accepted, Average Filing Time, On-Time Filing %.
- *SAR:* Total Filed, Total Accepted, Average Filing Time, On-Time Filing %.
- *Department:* Total Reports Processed, Overall Compliance %, Average
  Department Processing Time, Total Queue Failures.

**Trend charts:**
- *Monthly Filing Volume* — clustered columns: CTRs Accepted, SARs Accepted.
- *Filing Time Performance* — lines for CTR and SAR average filing time with
  reference lines for both internal targets and both regulatory thresholds.
- *Department Performance Scorecard* — stacked horizontal bars: On-Time %,
  Late %, Queue Failures, Pending Items.

**Employee leaderboard:** top performers by configurable metrics (Reports
Completed, Average Processing Time, On-Time %, Productivity Score, Workload
Score), sortable by any metric.

**Goal summary:** CTR and SAR internal target vs. actual vs. variance with
progress bars.

**Global filters:** Reporting Month, Date Range, Assigned Owner Name, Branch
Number, Status, Type of Filing (SAR) — updating KPI cards, charts, tables,
employee rankings, and PowerPoint exports.

**Notifications:** missing CSV uploads, CSV validation errors, missing data
preventing KPI calculations, successful/failed exports. Colors: Blue =
information, Green = success, Yellow = warning, Red = error.

**Presentation Mode:** hides navigation, maximizes chart area, increases font
sizes, reduces clutter, preserves chart interactivity where appropriate.

### 5.6 Employee Analytics & Performance Engine

Measures analyst performance (keyed on **Assigned Owner Name**) with a
balanced, transparent, configurable scoring model that rewards overall
effectiveness — not simply high volume. Phase 1 scoring considers only Alerts,
CTRs, and SARs.

**Overall Performance Index (0–100)**, composed of configurable-weight
components:

| Component | Description |
|-----------|-------------|
| Productivity Index | Work completed relative to workload |
| Timeliness Index | Average completion time vs. goals |
| Compliance Index | % completed within regulatory deadlines |
| Quality Index | Accuracy and accepted filing outcomes |
| Workload Index | Relative complexity and volume handled |

- **Productivity:** Alerts / CTRs / SARs completed, Initial vs. Continuing
  SARs; future weighted values by work type.
- **Timeliness:** per-stage workflow durations compared against the 5/15-day
  (CTR) and 21/30-day (SAR) benchmarks.
- **Quality:** accepted filing %, queue failure rate, excluded filing review;
  future QA review score and rework rate.
- **Workload:** normalized by total assigned workload, work-type mix, Initial
  vs. Continuing SARs, and reporting period; future case complexity/priority.

**Deliverables:** per-analyst scorecard (all six indexes plus Reports
Completed, Average Filing Time, On-Time %, rolling 13-month trend);
configurable leaderboards (Highest Overall Performance, Fastest Average
Processing Time, Highest Compliance, Highest Productivity, Most Improved,
Highest Monthly Volume — sortable by any metric); trend analysis identifying
improving/declining/stable performance; **coaching indicators** (repeated
missed goals, increasing processing times, low compliance %, high queue
failure rate — advisory only, never replacing managerial judgment);
**recognition indicators** (consistent on-time performance, high productivity
with strong quality, significant month-over-month improvement).

Managers configure score weightings and goal/recognition/coaching thresholds
without source-code changes.

**Acceptance criteria:** scores update automatically after import; rankings
reflect configured rules; cards and scorecards stay synchronized; rolling
13-month trends supported; all calculations reproducible from uploaded CSVs.

### 5.7 Goal Management & KPI Configuration Engine

Centralized, configuration-driven goal framework. Goals are editable by
authorized users without code changes and automatically update all dashboards,
KPI cards, charts, scorecards, leaderboards, and exports.

**Goal hierarchy:** Organizational (e.g., CTR/SAR Average Filing Time, overall
On-Time %), Team (workgroups / future business units), Individual (analyst).

**Default goal configuration:**

| Report | Metric | Internal Target | Regulatory Threshold |
|--------|--------|-----------------|----------------------|
| CTR | Average Filing Time | 5 days | 15 days |
| CTR | On-Time Filing | 100% | Regulatory minimum |
| CTR | Queue Failures | 0 | N/A |
| SAR | Average Filing Time | 21 days | 30 days |
| SAR | On-Time Filing | 100% | Regulatory minimum |
| SAR | Queue Failures | 0 | N/A |

SAR supports separate goals for Initial vs. Continuing Activity filings.

**Goal editor (admin page):** create, edit, disable, archive, and restore
goals; every change logged with user, timestamp, previous value, new value.

**Visualization:** horizontal reference lines, KPI cards, progress bars,
variance indicators, trend arrows. Charts clearly distinguish actual
performance, internal target, and regulatory threshold.

**Variance:** Actual vs. Goal, Previous Month vs. Goal, Rolling 13-Month
Average vs. Goal — shown as absolute and percentage variance with configurable
color-status thresholds.

**Historical integrity:** changing a goal today must **not** recalculate
historical performance; historical reports always evaluate against the goal
active during that reporting period.

**Storage:** goals stored outside application code (JSON now, database
possible later) with fields: Goal Name, Metric, Target Value, Regulatory
Threshold, Effective Date, Expiration Date, Applies To, Status, Notes.
Reusable goal templates for CTR, SAR, Executive, and future modules.

### 5.8 PowerPoint Export Engine

Generates executive-ready presentations that preserve dashboard look-and-feel
while remaining fully editable. Phase 1 covers the CTR Dashboard only; the
architecture must be reusable for SAR, Executive, Alerts, Cases, Fraud, OFAC,
and employee/department scorecards via new configuration mappings — not a
redesigned engine.

**Native chart requirement:** every exported KPI chart is a native Office
chart object. A user must be able to open the presentation, select a chart,
choose **Chart Design → Edit Data**, modify the embedded worksheet, and see the
chart update — identical to charts created directly in PowerPoint. Never
export screenshots or static images for KPI charts.

**Embedded workbook:** standard Microsoft chart layout — months as rows,
series as columns (e.g., Month | CTRs Created | CTRs Queued | CTRs Submitted |
CTRs Accepted | CTRs Excluded). Data is summarized by the approved KPI engine,
always reflects the active dashboard filters, and requires no manual
spreadsheet editing before export.

**Slide layout:** dark navy background, Altura logo placeholder, dashboard
title, subtitle, white chart panel, executive KPI summary cards, legends, goal
lines where supported, footer with reporting period and generation timestamp.

**Editable elements:** chart title, subtitle, chart type, series names and
values, axis titles and formatting, legend, colors, data labels.

**Export options:** current dashboard, selected reporting period, filtered
data only; future multi-slide executive presentations.

**Performance:** under 5 seconds for typical 13-month datasets; must not
unnecessarily block the UI.

### 5.9 Security, Roles, Audit Logging & Configuration Management

**Principles:** least privilege, role-based access, defense in depth,
configuration integrity, auditability, transparency.

**Roles and permissions:**

| Capability | Admin | Manager | Analyst | Executive | Auditor |
|------------|:-----:|:-------:|:-------:|:---------:|:-------:|
| Import CSV | ✓ | ✓ | ✓ | | |
| Edit Goals | ✓ | ✓ | | | |
| Export PowerPoint | ✓ | ✓ | ✓ | ✓ | ✓ |
| View Employee Metrics | ✓ | ✓ | Limited | Summary | ✓ |
| Modify Configuration | ✓ | | | | |
| View Audit Log | ✓ | ✓ | | | ✓ |

(Administrator: full system configuration. BSA Manager: dashboards, goals,
reporting settings. Analyst: dashboards and personal performance. Executive:
read-only reporting. Auditor: read-only plus audit history.)

**Audit logging:** record CSV imports, goal changes, configuration updates,
PowerPoint exports, sign-in events (future), and system errors — each with
timestamp, user, action, object, and previous/new values where applicable.

**Data integrity:** the KPI engine never modifies imported source data
(Raw CSV → Normalized Data → KPI Models → Dashboard).

**Configuration versioning:** every configuration change creates a new version
(version, effective date, modified by, change summary); historical KPI reports
continue using the configuration effective during their reporting period.

**Error reporting:** user-facing validation messages are separated from
internal diagnostic logs; diagnostics are not exposed to standard users.

**Backup & recovery:** scheduled backups, manual export, version restore,
disaster recovery; goal/configuration data recoverable independently of KPI data.

**Future authentication (modular):** Microsoft Entra ID / Azure AD, Google
Workspace, SAML 2.0, SSO, MFA.

---

## 6. Visual / Design Requirements

**Design philosophy:** the application shall resemble a professionally
designed executive PowerPoint presentation. Priorities: clarity, consistency,
executive readability, minimal clutter, fast KPI interpretation,
accessibility, responsive layouts.

**Standard page structure (all modules):** Header → Subtitle Banner → Filter
Bar → Primary Visualization Panel → KPI Summary Cards → Supporting Charts →
Footer.

**Executive layout standard:** full-width dark navy-blue background; Altura
Credit Union logo placeholder (top-left); large centered white title; white
subtitle banner; large white chart panel; right-side stacked KPI cards;
consistent typography, spacing, and alignment.

**Color palette** (configurable via theme file):
- Primary — Dark Navy background, White panels, Navy Blue informational text.
- Status — Green = favorable / on target; Yellow = warning / approaching
  threshold; Red = unfavorable / exceeds threshold; Navy = informational;
  Gray = disabled.

Example theme configuration:

```json
{
  "background": "#0b2d5c",
  "panel": "#ffffff",
  "success": "#2e7d32",
  "warning": "#f9a825",
  "danger": "#c62828",
  "info": "#1e3a5f"
}
```

**Typography hierarchy:** Dashboard Title → Subtitle → Section Heading → KPI
Card Heading → Chart Labels → Supporting Text; readability and presentation
quality first.

**KPI cards:** white background, thin border, underlined title, large centered
value, optional variance indicator and trend arrow, conditional coloring.

**Chart standards (every visualization):** executive title, subtitle, legend,
data labels, hover tooltips, goal lines where applicable, responsive resizing,
export compatibility. Preferred chart types: clustered columns, stacked
columns, line charts, combo charts, horizontal bars.

**Filters:** easy to locate, multi-select where appropriate, persistent during
navigation, resettable, reflected in exports.

**Responsive targets:** desktop, widescreen presentation mode, high-resolution
monitors; future mobile support may focus on KPI summaries.

**Accessibility:** sufficient color contrast, keyboard navigation, no
color-only indicators, descriptive labels and tooltips.

**Component library (reusable across all dashboards):** KPI Cards, Filter
Controls, Chart Containers, Notification Banners, Goal Indicators, Progress
Bars, Section Headers, Dialogs.

**Branding:** configurable — logo placeholder, application title, reporting
period, footer, color theme, future corporate branding profiles. Avoid
abbreviations in user-facing interfaces unless industry standard.

---

## 7. Data & File Requirements

### 7.1 CTR CSV Required Headers

| Header | Required | Purpose |
|--------|:--------:|---------|
| Entity Names | ✓ | Display only |
| Activity End Date | ✓ | Reporting reference |
| Total Cash In | ✓ | Cash metrics |
| Total Cash Out | ✓ | Cash metrics |
| Assigned Owner Name | ✓ | Employee analytics |
| Status | ✓ | Workflow status |
| Due Date | ✓ | Regulatory deadline |
| Creation Date | ✓ | Workflow start |
| Document Control Number | ✓ | Reference |
| Report Number | ✓ | Unique report identifier |
| Accepted Date | ✓ | Workflow completion |
| Queue Failed | ✓ | Queue failure tracking |
| Queued By | ✓ | Queue analytics |
| Queued Date | ✓ | Analyst completion |
| Submitted Date | ✓ | FinCEN submission |
| Branch Number | ✓ | Branch analytics |

### 7.2 SAR CSV Required Headers

| Header | Required | Purpose |
|--------|:--------:|---------|
| Entity Names | ✓ | Display only |
| Activity End Date | ✓ | Reporting reference |
| Total Value | ✓ | Dollar metrics |
| Assigned Owner Name | ✓ | Employee analytics |
| Status | ✓ | Workflow status |
| Due Date | ✓ | Regulatory deadline |
| Creation Date | ✓ | Audit reference |
| Document Control Number | ✓ | Reference |
| Report Number | ✓ | Unique report identifier |
| Queued By | ✓ | Queue analytics |
| Date of Determination | ✓ | Workflow start |
| Accepted Date | ✓ | Workflow completion |
| FI Note to FinCEN | Optional | Informational |
| Primary Activity Subtype | ✓ | Trend analysis |
| Primary Activity Type | ✓ | Trend analysis |
| Queue Failed | ✓ | Queue failure tracking |
| Submitted Date | ✓ | FinCEN submission |
| Type of Filing | ✓ | Initial vs. Continuing |

Note: `Queued Date` is used by the SAR workflow ("if present") but is not in
the SAR required-header list — see Assumption A2 in Section 12.

### 7.3 Configuration Files

Business rules live in external configuration; changes take effect without
recompilation or code changes:

- `goals.json` — KPI targets and thresholds (example below)
- `header-mappings.json` — CSV header mappings
- `status-mappings.json` — status normalization rules
- `themes.json` — colors and branding
- `chart-defaults.json` — shared chart formatting
- `application-settings.json` — general settings

```json
{
  "ctr": { "internalTargetDays": 5, "regulatoryThresholdDays": 15 },
  "sar": { "internalTargetDays": 21, "regulatoryThresholdDays": 30 }
}
```

### 7.4 Glossary

- **Accepted Date** — date FinCEN accepts a filing.
- **Creation Date** — date a CTR is created.
- **Date of Determination** — date suspicious activity is determined for SAR filing.
- **Due Date** — regulatory filing deadline.
- **Queue Failed** — filing did not successfully queue for submission.
- **Queued Date** — date the analyst completes work and queues the filing.
- **Submitted Date** — date the filing is transmitted to FinCEN.
- **On-Time Filing** — filing completed within the applicable regulatory deadline.

---

## 8. User Workflow

Primary monthly operational flow:

1. **Upload** — a Manager or Analyst uploads the monthly Verafin CTR and/or
   SAR CSV exports.
2. **Validate** — the system validates headers and data quality; validation
   errors are shown as user-friendly notifications and block KPI calculation
   until corrected.
3. **Review Executive Dashboard** — leadership sees department-wide KPI cards,
   cross-dashboard trends, the employee leaderboard, and goal progress.
4. **Drill into CTR / SAR dashboards** — apply global filters (month, date
   range, owner, status, branch, filing type, activity type); all charts, KPI
   cards, trends, and employee metrics refresh together.
5. **Review employee performance** — scorecards, leaderboards, coaching and
   recognition indicators.
6. **Manage goals** — authorized users adjust targets in the Goal Editor;
   dashboards update immediately; history is preserved and audited.
7. **Export** — generate the editable PowerPoint deck (CTR in Phase 1)
   reflecting active filters, for the monthly leadership meeting.
8. **Present** — use Presentation Mode or the exported deck at monthly KPI /
   board meetings; auditors and examiners use read-only access plus the audit log.

UAT personas: BSA Manager, Analyst, Executive, Auditor.

---

## 9. Technical Expectations

### 9.1 Technology Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+ / ES Modules) — frontend-first,
  framework-agnostic business logic.
- **Visualization:** Apache ECharts (preferred), Chart.js where appropriate.
- **CSV parsing:** Papa Parse.
- **PowerPoint export:** PptxGenJS with native editable Office chart objects.
- **Configuration:** JSON.
- **Possible future:** TypeScript, Vite, React (optional), Electron desktop packaging.

### 9.2 Layered Architecture

- **Presentation Layer** — dashboards, charts, KPI cards, filters,
  interactions. No KPI calculations here; components consume precomputed state.
- **Business Layer** — KPI calculations, goal evaluation, compliance logic,
  employee analytics, monthly aggregation. Single source of business logic.
- **Data Layer** — CSV parsing, validation, normalization, configuration
  loading. No presentation logic.

Data flow:

```text
CSV Upload → Validation → Normalization → KPI Engine
  → Dashboard State → Charts / KPI Cards / Tables → Exports (PPTX / JSON / CSV)
```

The KPI Engine branches into Regulatory Compliance, Employee Analytics, Goal
Management, and Trend Analysis engines before feeding the visualization layer.

### 9.3 Core Services

ImportService, ValidationService, KPIEngine, GoalEngine, ComplianceEngine,
EmployeeAnalyticsService, ChartService, ExportService, ConfigurationService,
ThemeService — each with a clearly defined public interface.

### 9.4 Recommended Project Structure

```text
altura-bsa-kpi/
├── docs/
├── assets/
│   ├── logos/
│   ├── icons/
│   └── themes/
├── config/
│   ├── goals.json
│   ├── header-mappings.json
│   ├── status-mappings.json
│   └── themes.json
├── src/
│   ├── app/
│   ├── components/
│   ├── dashboards/
│   │   ├── ctr/
│   │   ├── sar/
│   │   └── executive/
│   ├── services/
│   ├── engines/
│   ├── charts/
│   ├── exports/
│   ├── models/
│   ├── utils/
│   └── styles/
├── examples/
└── tests/
```

### 9.5 State Management

Application state includes imported datasets, active filters, calculated KPIs,
dashboard configuration, theme settings, goals, and export settings.
Presentation components consume state; they never calculate values independently.

### 9.6 Coding Standards & Design Principles

ES Modules; camelCase for variables/functions; PascalCase for
classes/components; one responsibility per module; JSDoc for exported
functions; consistent linting/formatting. Single Responsibility, Open/Closed,
dependency injection where appropriate, composition over inheritance,
configuration over hardcoding. Business rules never embedded in UI components.

### 9.7 Performance Targets

| Operation | Target |
|-----------|--------|
| CSV import (typical 13-month dataset) | < 3 seconds |
| Dashboard refresh after filtering | < 1 second |
| PowerPoint export | < 5 seconds |

Avoid unnecessary recalculation; cache reusable KPI results; keep the UI
responsive during imports and exports.

### 9.8 Error Handling & Logging

Gracefully handle invalid CSV files, missing headers, invalid dates, duplicate
report numbers, empty datasets, and export failures — user-friendly messages
with technical details recorded for troubleshooting. Log CSV imports,
validation failures, goal changes, export requests, and unexpected errors for
diagnostics and auditing.

### 9.9 Testing & Quality Assurance

**Testing pyramid:** unit → integration → system → UAT → regression.

- **KPI validation:** every CTR/SAR stage duration, On-Time %, and Average
  Filing Time verified against manually calculated benchmark datasets.
- **CSV import tests:** correct headers, missing headers, extra columns, blank
  rows, invalid dates/numbers, duplicate Report Numbers, empty files — with
  documented expected behavior per scenario.
- **Dashboard validation:** KPI cards match calculations; charts match cards;
  filters refresh everything; goal lines update after configuration changes.
- **Export validation:** formatting preserved, native editable charts,
  embedded data present, active filters reflected, values match the dashboard;
  verify editing via Chart Design → Edit Data.
- **Regression:** reusable checklist covering KPI calculations, layouts,
  employee rankings, goal evaluation, exports, configuration loading.

**Acceptance test matrix:**

| Feature | Pass Criteria |
|---------|---------------|
| CTR Dashboard | All KPI values match benchmark dataset |
| SAR Dashboard | Workflow metrics calculate correctly |
| Filters | All dependent components refresh |
| Goal Management | Goal changes update dashboards |
| Employee Analytics | Rankings remain reproducible |
| PowerPoint Export | Editable charts generated successfully |

**Release readiness:** unit + integration + regression pass; UAT approved;
performance targets met; documentation updated; known issues reviewed and
accepted. Every release includes updated docs, regression testing, KPI
validation, performance verification, UAT, and change-log updates.

---

## 10. Implementation Notes

- **Build order suggestion (dependency-driven):** configuration framework →
  CSV import/validation/normalization → KPI Engine (+ compliance, aggregation)
  → Goal Engine → CTR Dashboard → SAR Dashboard → Employee Analytics →
  Executive Dashboard → PowerPoint export (CTR) → security/audit hardening.
- The KPI Engine must expose a **stable interface** all presentation layers
  consume; every consumer requests precomputed KPI objects.
- New dashboard modules are added via dashboard definition + KPI mappings +
  chart configuration + export mappings; core engines stay unchanged.
- Verafin export formats may evolve — header mappings, status mappings, goals,
  colors, KPI targets, and reporting periods are all configuration so that
  routine changes require no code edits.
- The master SRS file notes that future chapters should be appended to
  `Altura-BSA-KPI-SRS-Master.md` rather than created as standalone files —
  a documentation-process instruction to carry forward.
- Success metrics for the project overall: reduced manual KPI preparation
  time, increased reporting consistency, faster executive reporting, improved
  regulatory visibility, better workload transparency, improved coaching
  opportunities, presentation-ready reporting with minimal manual editing.

---

## 11. Consolidated Acceptance Criteria (Phase 1 Definition of Done)

Phase 1 is complete when:

1. All KPIs derive exclusively from the approved CTR/SAR CSV headers and are
   reproducible from uploaded data.
2. Removing a required header produces a validation error; malformed input
   never crashes the application.
3. Every chart, KPI card, trend, employee metric, and export refreshes
   together on any filter change.
4. Goal changes update dashboards immediately, require no code changes, are
   fully audited, and never rewrite historical performance.
5. Employee scores, scorecards, and leaderboards update automatically after
   import and reflect configured weightings.
6. CTR PowerPoint export produces native editable Office charts whose embedded
   data matches dashboard calculations and active filters.
7. Performance targets are met (import < 3 s, filter refresh < 1 s, export < 5 s).
8. All dashboards follow the executive design system and remain
   presentation-ready at common display resolutions.
9. Roles/permissions are enforced and configuration changes are auditable and versioned.

---

## 12. Conflicts, Open Questions & Assumptions

### Conflicts found between source files (flagged, not silently resolved)

- **C1 — CTR Workflow Timeline goal line:** the CTR dashboard spec (Part 4,
  Dashboard 3) says the goal line defaults to **2 days** (configurable), while
  every other document defines the CTR internal target as **5 days**. This
  spec treats the goal line as configurable with the default requiring
  confirmation. *Interpretation:* the 2-day value likely targets a single
  workflow stage (e.g., Creation→Queue) rather than end-to-end filing time —
  confirm with the product owner.
- **C2 — Chapter numbering:** the Master SRS table of contents (Chapters 1–13)
  does not match the standalone files (Chapters 7–16 plus Parts 2–6 numbered
  9–14 internally); e.g., "11" is both the Data Model (Part 3) and Developer
  Architecture (Chapter 11 file). This consolidation renumbers everything;
  content conflicts, not numbering, were used to detect real contradictions.
- **C3 — On-Time Filing KPI card:** the SAR dashboard lists an "On-Time
  Filing %" KPI card; the CTR dashboard's card list omits it even though CTR
  charts overlay On-Time %. This spec assumes CTR should also display an
  On-Time Filing % card for parity — confirm.

### Assumptions (reasonable defaults documented per instruction)

- **A1 — "SARs Created" series:** SAR visualizations reference "Created"
  counts, but the SAR `Creation Date` is designated "audit reference" and the
  workflow starts at `Date of Determination`. Assumption: SAR "Created" volume
  is counted by Date of Determination unless configured otherwise.
- **A2 — SAR `Queued Date`:** the SAR workflow includes "Queued Date (if
  present)" but the SAR required-header lists omit it. Assumption:
  `Queued Date` is an **optional** SAR column; Determination→Queue metrics are
  calculated only when it is present.
- **A3 — Persistence:** the SRS is frontend-first with JSON configuration and
  no mandated backend/database. Assumption: Phase 1 runs fully client-side
  (browser) with JSON config files; goal history, audit logs, and RBAC are
  implemented to the extent possible client-side, with a database and real
  authentication deferred to the future-authentication phase.
- **A4 — "On-time"** means filed within the applicable regulatory deadline
  (per the glossary), i.e., Accepted/Submitted on or before Due Date;
  internal targets drive green/yellow classification, not on-time status.
- **A5 — Alerts data in Phase 1:** Employee Analytics scoring includes
  "Alerts" in Phase 1, but no Alerts CSV data model exists yet (Alerts
  Dashboard is Phase 2). Assumption: Alert metrics are included in the scoring
  model design but compute as zero/absent until an Alerts data source is defined.

### Open questions for the product owner

1. What is the correct default for the CTR Workflow Timeline goal line — 2 or
   5 days — and which duration does it apply to? (C1)
2. Should duplicate `Report Number` handling default to skip or include? (The
   spec says "skip unless configured otherwise" — confirm the default.)
3. Which exact date/locale format do Verafin exports use for date parsing?
4. Is client-side-only Phase 1 acceptable (A3), or is a backend required for
   RBAC and audit logging from day one?
5. What is the source and cadence for Alerts data used in employee scoring? (A5)

---

## 13. Final Consolidated Project Prompt

> Use the following as a standalone prompt for an AI coding assistant or
> development team.

**Build the Altura BSA KPI application:** a modular, frontend-first, web-based
executive reporting platform for Altura Credit Union's BSA/AML Department.

- **Input:** user-uploaded Verafin CSV exports (CTR and SAR) — the single
  source of truth. Validate exact required headers (Section 7), normalize
  dates/numbers/statuses, reject malformed data with friendly errors, and
  never modify raw source data.
- **Engine:** one deterministic KPI engine computes all workflow-stage
  durations, average filing times, on-time percentages, status breakdowns,
  rolling 13-month aggregations (by month, owner, branch, status, filing type,
  activity type/subtype), employee performance indexes, and goal variances.
  CTR: Creation→Queued→Submitted→Accepted, 5-day internal target, 15-day
  regulatory threshold. SAR: Determination→Queued→Submitted→Accepted, 21-day
  internal target, 30-day regulatory threshold. Due Date is only a compliance
  deadline. Green ≤ target, Yellow ≤ threshold, Red > threshold.
- **Dashboards:** an Executive landing dashboard (department KPI cards, cross-
  dashboard trends, employee leaderboard, goal progress, notifications,
  presentation mode), a CTR dashboard (5 specified visualizations), and a SAR
  dashboard (5 specified visualizations with Initial/Continuing Activity
  analysis) — all styled as an executive PowerPoint presentation: dark navy
  background, white chart panels, right-side KPI cards, goal lines, data
  labels, and synchronized global filters (Section 6).
- **Configuration:** goals, header mappings, status mappings, themes, and
  chart defaults live in JSON config files (Section 7.3); goal edits are
  audited, versioned, and never rewrite historical results.
- **Export:** editable PowerPoint export of the CTR dashboard using PptxGenJS
  with **native Office chart objects and embedded editable worksheets** —
  never images — reflecting the active filters and matching dashboard values.
- **Stack:** HTML5, CSS3, ES Modules, Apache ECharts, Papa Parse, PptxGenJS;
  layered architecture (data / business / presentation) with the service and
  folder structure in Section 9; business logic never in UI components.
- **Quality:** meet the performance targets (import < 3 s, filter refresh
  < 1 s, export < 5 s), the testing requirements in Section 9.9, and the
  Phase 1 acceptance criteria in Section 11. Respect the flagged conflicts and
  assumptions in Section 12; ask before hard-coding either value in conflict C1.

Design every module so Phase 2+ dashboards (Alerts, Cases, Fraud, OFAC,
314(a)/314(b)) can be added through configuration and new dashboard
definitions — without modifying the core engines.

---

## 14. Executive PowerPoint Template Integration (Revision — 2026-07-02)

The dashboard no longer generates PowerPoint charts from scratch. The export
is a **template-driven reporting engine**: it opens the corporate master
template, replaces only the embedded chart data and KPI text, and preserves
all formatting — chart style, fonts, colors, legends, markers, axes, labels,
corporate branding, and slide layout.

### Template Reference

Official reporting assets live in `template/`:

| File | Role |
|------|------|
| `Example KPI Template.pptx` | Supplied corporate template ("Regional Operations Support / Deployment Rate" slide) — the authoritative formatting reference. Never modified. |
| `Chart in Microsoft PowerPoint.xlsx` | Companion workbook the original chart was built from. Reference only. |
| `sar-executive-master.pptx` | SAR master (same corporate slide; SAR series names and 21/30-day reference lines). |
| `ctr-executive-master.pptx` | **The master export template.** Derived from the corporate template by `tools/build-master-template.mjs`: the corporate slide (theme, layout, logo, KPI card shapes) is preserved; the active chart (`ppt/charts/chart4.xml`, originally a 2-series percent line chart) is replaced once with the required 4-series CTR combo structure; text fields are tokenized (`{{REPORT_TITLE}}`, `{{KPI_MONTHLY}}`, …). |

Documented template decision: the supplied chart was a 2-series line chart and
could not express the required clustered columns + dual reference lines, so
the chart structure was transplanted **once** at template-build time; the
runtime never touches formatting.

### Chart contract

- Clustered columns — **CTRs Completed**
- Line (smooth, circular markers, data labels) — **Avg Filing Days**
  (Creation → Accepted; Creation → Submitted when acceptance is pending)
- Red dashed constant line — **Regulatory Deadline (15 Days)**
- Green dashed constant line — **Internal Goal (5 Days)**

### Embedded workbook contract (Chart Design → Edit Data)

Exactly five columns, one worksheet, no hidden sheets, helper columns, or
extra series: `Month · CTRs Completed · Avg Filing Days · Regulatory Deadline
(15 Days) · Internal Goal (5 Days)`.

### KPI cards (native editable shapes/text)

- **Monthly Performance** — avg filing days + % of internal goal (e.g. `3.8 Days · 76% of 5-day goal ✓`)
- **MoM Variance** — direction + % + day delta (e.g. `▼ 3% · Improved 0.4 Days`)
- **12-Month Historical** — rolling avg days + % of goal (e.g. `4.9 Days · 98% of goal`)

### Workflow

Import CTR CSV → dashboard recalculates → **Generate Executive Report** →
engine opens the master template → injects chart caches + embedded workbook +
KPI tokens → saves `CTR-Executive-Report-<YYYY-MM>.pptx`. The output is
indistinguishable from a manually built deck and fully editable. The SAR
dashboard uses the same engine with `sar-executive-master.pptx` (SARs
Completed · Determination→Accepted avg days with Submitted fallback ·
30-day regulatory deadline · 21-day internal goal), superseding the
original Phase 2 deferral now that the CTR export is validated. Future
template-based slides (Alerts, Cases) reuse the same engine.
