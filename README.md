# AV Fleet Safety Assurance Console

**Live site:** https://marimbel.github.io/av-safety-assurance/

This project does operational safety assurance on a simulated autonomous vehicle fleet that has Vehicle Safety Operators (VSOs). From one seeded dataset it:

- monitors driving data, interventions, model flags, driver monitoring (DMS) alerts, incidents and field observations
- finds trends, anomalies and leading indicators of risk
- investigates incidents end to end
- tests operational controls
- produces recurring safety reports

> All data is **synthetic and fictional**. It comes from `tools/generate_data.py` (seed 42). No real vehicles, people, places or company data are used.

## What's on the site

| Tab | What it shows |
| --- | --- |
| **Overview** | Weekly KPIs with week-on-week change. Takeover-rate trend with software release markers. Leading indicators checked against a W1–W4 baseline band. Automatic anomaly detection across vehicles, sites and VSOs. |
| **Interventions & Flags** | Takeovers by the stack layer they're attributed to, and model-flag rates. A software × light-condition table normalised by exposure. Site hotspots and per-vehicle health heatmaps. |
| **Driver Monitoring** | Drowsiness by hour into shift, shift-length distribution against the 4.0 h policy, reaction time by hour, late DMS acknowledgements by time of day, and a VSO watch list. |
| **Investigations** | Incident register and five investigations. Each one has an evidence chart computed from the data, a reconstructed timeline, the evidence table, 5 Whys, contributing factors, root cause, corrective and preventive actions, and the limits of the evidence. |
| **Controls** | Seven operational controls, each tested against its full population, with exceptions, weekly trend, linked incidents and an effectiveness rating. |
| **Data Quality** | Duplicate detection, missing odometer imputation, DMS outages, referential and timestamp checks, and known evidence limitations. |
| **Reports** | Weekly safety performance pack, monthly assurance report, investigation summary and incident write-up. All are generated from the data and can be saved as PDF. |

## Problems planted in the data

The generator plants five problems so the analysis can be checked against a known answer:

1. **Software regression.** v4.3.0 hesitates on occluded unprotected left turns, worst at dusk. v4.3.1 partly fixes it. (INC-0412, INV-001)
2. **Operator fatigue.** One VSO is scheduled past the 4.0 h shift limit, and their drowsiness and takeover delay rise late in the shift. (INC-0419, INV-002)
3. **Calibration drift.** A vehicle returns from a windshield replacement without recalibration. (INC-0398, INV-003)
4. **Construction zone.** A lane closure raises takeovers at one site. The cause is the environment, not a stack defect. (INC-0427, INV-004)
5. **Data quality.** Duplicate rows from a logger retry, a DMS camera outage, and missing odometer values.

A third-party rear-end collision (INV-005) is also included, to show an impartial conclusion of no AV contribution.

## Run locally

```bash
python tools/generate_data.py      # optional: rebuilds data/fleet.json
python -m http.server 8000         # then open http://localhost:8000
```

Opening `index.html` directly from disk won't work, because browsers block `fetch` on `file://`. Serve the folder instead.

## Deploy to GitHub Pages

1. Create a public repo named `av-safety-assurance` and push these files to `main`.
2. In the repo, go to **Settings → Pages → Build and deployment → Deploy from a branch**, then pick `main` and `/ (root)`.
3. The site appears at `https://<your-username>.github.io/av-safety-assurance/` within a minute or two.

## Structure

```
index.html            app shell and navigation
css/style.css         styles, including print styles for PDF reports
js/charts.js          dependency-free SVG charts
js/analytics.js       data cleaning, exposure-normalised metrics, baselines, anomaly detection, control tests
js/app.js             dashboard views and routing
js/reports.js         report generators
data/fleet.json       generated dataset
tools/generate_data.py  seeded fleet simulator
```

There are no build steps, frameworks or external dependencies.

## Methods in brief

- **Exposure normalisation.** Takeovers are counted per 1,000 autonomous km, model flags per 100 km, and DMS alerts per 100 DMS-available VSO hours.
- **Baselines.** Weeks 1–4 (before v4.3.0). An indicator is on alert above mean + 2 sd and on watch above mean + 1 sd.
- **Anomalies.** Vehicles and VSOs get a cross-sectional z-score against the rest of the fleet that week. Sites are compared with their own baseline using a Poisson-style threshold.
- **Stratification.** Software versions are compared within the same light condition, because dusk exposure grows through autumn.
- **Controls.** Every control is tested on its full population. A control is ineffective if more than 2% of cases are exceptions or if any exception contributed to an incident.

---
Built by [Marianna Belmares](https://linkedin.com/in/marianna-belmares). Personal portfolio project, not affiliated with any company.
