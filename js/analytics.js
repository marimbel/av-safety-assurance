// Data loading, cleaning and the metrics every view is built from.
const A = (() => {
  const DAY = 86400000;
  let D = null;

  const by = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
  const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a, (x) => (x - m) ** 2) / (a.length - 1)); };

  async function load() {
    const d = await fetch("data/fleet.json").then((r) => r.json());
    prep(d);
    D = d;
    return d;
  }

  function prep(d) {
    const start = new Date(d.meta.start + "T00:00:00");
    d.weeks = Array.from({ length: d.meta.weeks }, (_, i) => i + 1);
    d.weekStart = (w) => new Date(start.getTime() + (w - 1) * 7 * DAY);
    d.weekOf = (iso) => Math.floor((new Date(iso.slice(0, 10) + "T00:00:00") - start) / DAY / 7) + 1;
    const md = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    d.weekLabel = (w) => `W${w} · ${md(d.weekStart(w))}`;
    d.weekRange = (w) => `${md(d.weekStart(w))} – ${md(new Date(d.weekStart(w).getTime() + 6 * DAY))}, 2026`;

    d.vehZone = {}; d.siteInfo = {};
    for (const [z, c] of Object.entries(d.meta.zones)) {
      c.vehicles.forEach((v) => (d.vehZone[v] = z));
      c.sites.forEach((s) => (d.siteInfo[s.name] = { ...s, zone: z }));
    }
    d.shiftById = {};
    d.shifts.forEach((s) => (d.shiftById[s.id] = s));

    // ---- data quality: missing km -> impute from hours x vehicle median speed
    const speeds = by(d.shifts.filter((s) => s.km != null), (s) => s.vehicle);
    const vSpeed = {};
    for (const [v, arr] of Object.entries(speeds)) vSpeed[v] = median(arr.map((s) => s.km / s.hours));
    d.dq = { imputed: [], duplicates: [], dmsOutage: [], dmsPartial: [], outOfWindow: 0, orphan: 0 };
    d.shifts.forEach((s) => {
      s.dmsHours = s.hours * s.dms_uptime;
      if (s.km == null) {
        s.kmClean = +(s.hours * vSpeed[s.vehicle]).toFixed(1);
        s.imputed = true;
        d.dq.imputed.push(s);
      } else s.kmClean = s.km;
      if (s.dms_uptime === 0) d.dq.dmsOutage.push(s);
      else if (s.dms_uptime < 0.98) d.dq.dmsPartial.push(s);
    });

    // ---- data quality: duplicate interventions (same vehicle, timestamp, type, trigger)
    const seen = new Map();
    d.intRaw = d.interventions;
    d.int = [];
    [...d.interventions].sort((a, b) => a.id.localeCompare(b.id)).forEach((r) => {
      const k = `${r.vehicle}|${r.ts}|${r.type}|${r.trigger}`;
      if (seen.has(k)) d.dq.duplicates.push({ dup: r, orig: seen.get(k) });
      else { seen.set(k, r); d.int.push(r); }
    });
    d.int.sort((a, b) => a.ts.localeCompare(b.ts));

    [d.intRaw, d.flags, d.dms].forEach((arr) => arr.forEach((r) => {
      r.week = d.weekOf(r.ts);
      r.zone = r.zone || d.vehZone[r.vehicle];
      r.hour = +r.ts.slice(11, 13) + +r.ts.slice(14, 16) / 60;
      const s = d.shiftById[r.shift];
      if (!s) { d.dq.orphan++; return; }
      const st = new Date(s.start), t = new Date(r.ts);
      const into = (t - st) / 3600000;
      if (into < -0.05 || into > s.hours + 0.05) d.dq.outOfWindow++;
    }));
    d.incidents.forEach((i) => (i.week = d.weekOf(i.ts)));
  }

  // ---------------------------------------------------------------- exposure helpers
  const shiftsIn = (f = {}) => D.shifts.filter((s) => (!f.week || s.week === f.week) && (!f.zone || s.zone === f.zone) && (!f.sw || s.sw === f.sw) && (!f.vehicle || s.vehicle === f.vehicle));
  const km = (f = {}, light) => sum(shiftsIn(f), (s) => (light ? s["km_" + light] * (s.kmClean / (s.km_day + s.km_dusk + s.km_night || 1)) : s.kmClean));
  const vsoHours = (f = {}) => sum(shiftsIn(f), (s) => s.hours);
  const dmsHours = (f = {}) => sum(shiftsIn(f), (s) => s.dmsHours);

  const match = (r, f) => Object.entries(f).every(([k, v]) => v == null || v === "" || (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
  const count = (arr, f) => arr.filter((r) => match(r, f)).length;

  // ---------------------------------------------------------------- weekly metric library
  const per = (n, d, k) => (d ? (n / d) * k : 0);
  const LEFT_SITES = ["Marlow Ave & 5th St", "Hale Rd & Pine St"];

  const metrics = {
    km: { label: "Autonomous km", unit: "km", fn: (w) => km({ week: w }), dir: 0, fmt: (v) => Math.round(v).toLocaleString() },
    sc: { label: "Safety-critical takeovers", unit: "per 1,000 km", fn: (w) => per(count(D.int, { week: w, type: "safety_critical" }), km({ week: w }), 1000), dir: 1 },
    pre: { label: "Precautionary takeovers", unit: "per 1,000 km", fn: (w) => per(count(D.int, { week: w, type: "precautionary" }), km({ week: w }), 1000), dir: 1 },
    comfort: { label: "Comfort takeovers", unit: "per 1,000 km", fn: (w) => per(count(D.int, { week: w, type: "comfort" }), km({ week: w }), 1000), dir: 1 },
    dms: { label: "DMS alerts", unit: "per 100 VSO-h", fn: (w) => per(count(D.dms, { week: w }), dmsHours({ week: w }), 100), dir: 1 },
    incidents: { label: "Incidents", unit: "count", fn: (w) => D.incidents.filter((i) => i.week === w).length, dir: 1, fmt: (v) => String(v) },
  };

  const indicators = [
    { id: "pu_left", label: "Planner-uncertainty flags at occluded left-turn sites", unit: "per 100 Ridgeview km", link: "#interventions",
      fn: (w) => per(count(D.flags, { week: w, type: "planner_uncertainty", site: LEFT_SITES }), km({ week: w, zone: "Ridgeview" }), 100) },
    { id: "hard_brake", label: "Hard-brake events", unit: "per 100 km", link: "#interventions",
      fn: (w) => per(count(D.flags, { week: w, type: "hard_brake" }), km({ week: w }), 100) },
    { id: "pre", label: "Precautionary takeovers", unit: "per 1,000 km", link: "#interventions", fn: metrics.pre.fn },
    { id: "drowsy", label: "DMS drowsiness alerts", unit: "per 100 VSO-h", link: "#dms",
      fn: (w) => per(count(D.dms, { week: w, type: "drowsiness" }), dmsHours({ week: w }), 100) },
    { id: "long_shifts", label: "Shifts over the 4.0 h limit", unit: "count", link: "#dms",
      fn: (w) => shiftsIn({ week: w }).filter((s) => s.hours > 4).length },
    { id: "ack", label: "DMS alerts acknowledged after 5 min", unit: "% of alerts", link: "#dms",
      fn: (w) => { const a = D.dms.filter((x) => x.week === w); return per(a.filter((x) => x.ack_s > 300).length, a.length, 100); } },
    { id: "loc_worst", label: "Localization drift, worst vehicle", unit: "per 100 km", link: "#interventions",
      fn: (w) => Math.max(...Object.keys(D.vehZone).map((v) => per(count(D.flags, { week: w, type: "localization_drift", vehicle: v }), km({ week: w, vehicle: v }), 100))) },
    { id: "triage", label: "Safety-critical reviews over 48 h", unit: "% of takeovers", link: "#controls",
      fn: (w) => { const a = D.int.filter((x) => x.week === w && x.type === "safety_critical"); return per(a.filter((x) => x.reviewed_h > 48).length, a.length, 100); } },
  ];

  function series(fn) { return D.weeks.map((w) => fn(w)); }

  // Baseline = weeks 1-4 (before v4.3.0). Alert when value > mean + 2 sd (minimum band width guards against tiny sd).
  function baseline(vals) {
    const b = vals.slice(0, 4);
    const m = mean(b), s = Math.max(sd(b), Math.abs(m) * 0.15, 0.01);
    return { mean: m, sd: s, lo: Math.max(0, m - 2 * s), hi: m + 2 * s, watch: m + s };
  }
  function status(v, bl) { return v > bl.hi ? "alert" : v > bl.watch ? "watch" : "normal"; }

  function indicatorTable(week) {
    return indicators.map((ind) => {
      const vals = series(ind.fn), bl = baseline(vals);
      const firstBreach = vals.findIndex((v, i) => i >= 4 && v > bl.hi);
      return { ...ind, vals, bl, value: vals[week - 1], prev: vals[week - 2], st: status(vals[week - 1], bl), firstBreach: firstBreach >= 0 ? firstBreach + 1 : null };
    });
  }

  // ---------------------------------------------------------------- anomaly detection
  function anomalies() {
    const out = [];
    const vehicles = Object.keys(D.vehZone);
    // vehicle flag rates vs fleet (cross-sectional z-score)
    ["localization_drift", "perception_low_conf", "planner_uncertainty", "hard_brake"].forEach((type) => {
      D.weeks.forEach((w) => {
        const rates = vehicles.map((v) => ({ v, n: count(D.flags, { week: w, type, vehicle: v }), k: km({ week: w, vehicle: v }) }));
        rates.forEach((r) => (r.rate = per(r.n, r.k, 100)));
        rates.forEach((r) => {
          const others = rates.filter((o) => o.v !== r.v).map((o) => o.rate);
          const m = mean(others), s = Math.max(sd(others), 0.05);
          const z = (r.rate - m) / s;
          if (z > 3 && r.n >= 5) out.push({ week: w, entity: r.v, kind: "Vehicle", metric: type.replace(/_/g, " ") + " flags", value: `${r.rate.toFixed(2)} / 100 km`, base: `fleet ${m.toFixed(2)}`, score: z });
        });
      });
    });
    // site takeovers vs the site's own baseline (Poisson-style threshold)
    Object.keys(D.siteInfo).forEach((site) => {
      const wk = series((w) => count(D.int, { week: w, site, type: ["safety_critical", "precautionary"] }));
      const b = mean(wk.slice(0, 4));
      wk.forEach((n, i) => {
        const thr = b + 3 * Math.sqrt(Math.max(b, 1));
        if (i >= 4 && n >= 4 && n > thr) out.push({ week: i + 1, entity: site, kind: "Site", metric: "SC + precautionary takeovers", value: `${n}`, base: `baseline ${b.toFixed(1)}/wk`, score: (n - b) / Math.sqrt(Math.max(b, 1)) });
      });
    });
    // VSO drowsiness vs other VSOs
    const vsos = [...new Set(D.shifts.map((s) => s.vso))];
    D.weeks.forEach((w) => {
      const rates = vsos.map((v) => {
        const h = sum(D.shifts.filter((s) => s.week === w && s.vso === v), (s) => s.dmsHours);
        const n = D.dms.filter((x) => x.week === w && x.vso === v && (x.type === "drowsiness" || x.type === "eyes_off_road")).length;
        return { v, n, h, rate: per(n, h, 100) };
      }).filter((r) => r.h >= 10);
      rates.forEach((r) => {
        const others = rates.filter((o) => o.v !== r.v).map((o) => o.rate);
        const m = mean(others), s = Math.max(sd(others), 0.5);
        const z = (r.rate - m) / s;
        if (z > 2.5 && r.n >= 4) out.push({ week: w, entity: r.v, kind: "VSO", metric: "drowsiness + eyes-off alerts", value: `${r.rate.toFixed(1)} / 100 h`, base: `fleet ${m.toFixed(1)}`, score: z });
      });
    });
    return out.sort((a, b) => b.week - a.week || b.score - a.score);
  }

  // ---------------------------------------------------------------- controls testing
  function controls() {
    const res = {};
    const shifts = D.shifts;
    const sc = D.int.filter((r) => r.type === "safety_critical");
    const sensorWork = D.maintenance.filter((m) => m.calibration !== "n/a");
    const tests = {
      shift_length: { pop: shifts, exc: shifts.filter((s) => s.hours > 4), popLabel: "shifts", desc: "Every shift's driving hours compared with the 4.0 h limit.",
        row: (s) => `${s.date} · ${s.vso} · ${s.vehicle} · ${s.hours.toFixed(2)} h`, linked: ["INC-0419"] },
      triage: { pop: sc, exc: sc.filter((r) => r.reviewed_h > 48), popLabel: "safety-critical takeovers", desc: "Time from takeover to safety review, from the review log.",
        row: (r) => `${r.id} · ${r.ts.slice(0, 10)} · ${r.vehicle} · reviewed after ${r.reviewed_h} h`, linked: [] },
      calibration: { pop: sensorWork, exc: sensorWork.filter((m) => m.calibration !== "performed"), popLabel: "maintenance jobs that can disturb sensors", desc: "Maintenance log checked for a calibration record before return to service.",
        row: (m) => `${m.date} · ${m.vehicle} · ${m.work} · calibration ${m.calibration}`, linked: ["INC-0398"] },
      dms_ack: { pop: D.dms, exc: D.dms.filter((x) => x.ack_s > 300), popLabel: "DMS alerts", desc: "Ops acknowledgement time for every DMS alert.",
        row: (x) => `${x.ts.replace("T", " ")} · ${x.vso} · ${x.type.replace(/_/g, " ")} · ack ${Math.round(x.ack_s / 60)} min`, linked: ["INC-0419"] },
      dms_uptime: { pop: shifts, exc: shifts.filter((s) => s.dms_uptime < 0.98), popLabel: "shifts", desc: "DMS uptime recorded per shift.",
        row: (s) => `${s.date} · ${s.vehicle} · ${s.vso} · uptime ${(s.dms_uptime * 100).toFixed(0)}%`, linked: [] },
      precheck: { pop: shifts, exc: shifts.filter((s) => !s.precheck), popLabel: "shifts", desc: "Pre-shift checklist completion flag per shift.",
        row: (s) => `${s.date} · ${s.vehicle} · ${s.vso}`, linked: [] },
      release: { pop: D.meta.releases, exc: D.meta.releases.filter((r) => r.coverage_gap), popLabel: "releases", desc: "Release gate records reviewed against manoeuvres with known incidents or flags.",
        row: (r) => `${r.version} (${r.date}) · gap: ${r.coverage_gap}`, linked: ["INC-0412"] },
    };
    D.controls.forEach((c) => {
      const t = tests[c.test];
      const rate = per(t.exc.length, t.pop.length, 100);
      let rating = "Effective";
      if (t.exc.length && (t.linked.length || rate > 2)) rating = "Ineffective";
      else if (t.exc.length) rating = "Partially effective";
      const weekly = c.test === "release" || c.test === "calibration" ? null : D.weeks.map((w) => t.exc.filter((x) => (x.week || D.weekOf(x.ts || x.date)) === w).length);
      res[c.id] = { ...c, ...t, rate, rating, weekly };
    });
    return res;
  }

  return { load, by, sum, mean, median, sd, per, count, match, km, vsoHours, dmsHours, shiftsIn, metrics, indicators, indicatorTable, series, baseline, status, anomalies, controls, LEFT_SITES, get D() { return D; } };
})();
