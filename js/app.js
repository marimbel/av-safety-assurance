// Views and routing.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = C.esc, f = C.fmt;
  const view = $("#view");
  const state = { week: 8, zone: "", itype: "", inv: "INV-001", report: "weekly", reportWeek: 8, reportInv: "INV-001", reportInc: "INC-0412", month: "2026-10" };
  let D;

  const badge = (txt, cls) => `<span class="badge b-${(cls || txt).toLowerCase().replace(/[^a-z]+/g, "-")}">${esc(txt)}</span>`;
  const pct = (v) => `${v.toFixed(1)}%`;
  const delta = (cur, prev, dir = 1, unit = "") => {
    if (prev == null || !isFinite(prev)) return "";
    const d = cur - prev;
    if (Math.abs(d) < 1e-9 || (prev && Math.abs(d / prev) < 0.005)) return `<span class="flat">no change vs prior week</span>`;
    const cls = dir === 0 ? "flat" : d * dir > 0 ? "up-bad" : "down-good";
    const rel = prev ? ` (${d > 0 ? "+" : ""}${((d / prev) * 100).toFixed(0)}%)` : "";
    return `<span class="${cls}">${d > 0 ? "▲" : "▼"} ${f(Math.abs(d))}${unit}${rel} vs W${state.week - 1}</span>`;
  };
  const weekSelect = (id, val) => `<select id="${id}">${D.weeks.map((w) => `<option value="${w}" ${w === val ? "selected" : ""}>${D.weekLabel(w)}</option>`).join("")}</select>`;
  const zoneSelect = (id, val) => `<select id="${id}"><option value="">All zones</option>${Object.keys(D.meta.zones).map((z) => `<option ${z === val ? "selected" : ""}>${z}</option>`).join("")}</select>`;
  // x position on a weekly axis (index 0 = W1 midpoint) for a calendar date
  const at = (iso) => (new Date(iso + "T12:00:00") - new Date(D.meta.start + "T00:00:00")) / 86400000 / 7 - 0.5;
  const releaseMarkers = () => [
    { at: at("2026-10-19"), label: "v4.3.0" },
    { at: at("2026-11-04"), label: "v4.3.1" },
  ];
  const wkLabels = () => D.weeks.map((w) => `W${w}`);

  // ================================================================ OVERVIEW
  function overview() {
    const w = state.week;
    const M = A.metrics;
    const kp = Object.entries(M).map(([k, m]) => {
      const cur = m.fn(w), prev = w > 1 ? m.fn(w - 1) : null;
      return `<div class="kpi"><div class="k-label">${m.label}</div><div class="k-value">${m.fmt ? m.fmt(cur) : f(cur)}</div><div class="k-unit">${m.unit}</div><div class="k-delta">${delta(cur, prev, m.dir)}</div></div>`;
    }).join("");
    const inds = A.indicatorTable(w);
    const an = A.anomalies();
    const open = D.investigations.filter((i) => i.status !== "Closed");
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Fleet safety overview</h1><p class="lede">Where the fleet stands this week, which leading indicators are moving, and what the data flags automatically. Rates are normalised by exposure (autonomous km or VSO hours) so weeks with different mileage compare fairly.</p></div>
        <label class="f">Reporting week ${weekSelect("wk", w)}</label>
      </div>
      <div class="kpis">${kp}</div>
      <div class="grid g2">
        <div class="card"><h2>Takeover rates by week</h2><div class="sub">Per 1,000 autonomous km · dashed lines mark software releases</div><div id="c-rates"></div></div>
        <div class="card"><h2>Emerging risks</h2><div class="sub">Open investigations, highest risk first</div>
          <ul class="risk-list">${open.sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.risk] - { High: 0, Medium: 1, Low: 2 }[b.risk])).map((i) => `
            <li>${badge(i.risk)}<div><div class="r-title"><a href="#investigations/${i.id}">${i.id} · ${esc(i.title)}</a></div><div class="r-sub">${esc(i.status)} · ${i.incidents.join(", ")}</div></div></li>`).join("")}
          </ul>
        </div>
      </div>
      <div class="card mt">
        <div class="card-head"><h2>Leading indicators · ${D.weekLabel(w)}</h2><span class="muted small">Green band = weeks 1-4 baseline (mean ± 2 sd). Alert above the band, watch above +1 sd.</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Indicator</th><th>Unit</th><th>Trend W1-W8</th><th class="num">This week</th><th class="num">Baseline</th><th>First breach</th><th>Status</th></tr></thead>
          <tbody>${inds.map((r) => `<tr><td><a href="${r.link}">${esc(r.label)}</a></td><td class="muted small">${r.unit}</td><td>${C.spark(r.vals, r.bl)}</td><td class="num"><b>${f(r.value)}</b></td><td class="num muted">${f(r.bl.mean)}</td><td>${r.firstBreach ? "W" + r.firstBreach : "—"}</td><td>${badge(r.st)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="card mt">
        <div class="card-head"><h2>Automatic anomaly detection</h2><span class="muted small">${an.length} entity-weeks flagged across vehicles, sites and VSOs</span></div>
        <div class="sub">Vehicles and VSOs are compared with the rest of the fleet that week (z-score); sites are compared with their own W1-W4 baseline.</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Week</th><th>Type</th><th>Entity</th><th>Metric</th><th class="num">Value</th><th class="num">Comparison</th><th class="num">Score</th></tr></thead>
          <tbody>${an.slice(0, 14).map((a) => `<tr><td>W${a.week}</td><td>${badge(a.kind, "neutral")}</td><td><b>${esc(a.entity)}</b></td><td>${esc(a.metric)}</td><td class="num">${esc(a.value)}</td><td class="num muted">${esc(a.base)}</td><td class="num">${a.score.toFixed(1)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`;
    C.line($("#c-rates"), {
      x: wkLabels(), yLabel: "per 1,000 km", markers: releaseMarkers(),
      series: [
        { name: "Safety-critical", values: A.series(M.sc.fn), color: "#C0392B" },
        { name: "Precautionary", values: A.series(M.pre.fn), color: "#1F4E79" },
        { name: "Comfort", values: A.series(M.comfort.fn), color: "#8a96a3", dashed: true },
      ],
    });
    $("#wk").onchange = (e) => { state.week = +e.target.value; overview(); };
  }

  // ================================================================ INTERVENTIONS & FLAGS
  function interventions() {
    const z = state.zone;
    const ints = D.int.filter((r) => (!z || r.zone === z) && (!state.itype || r.type === state.itype));
    const triggers = ["perception", "prediction", "planning", "localization", "control", "external", "vso_precaution"];
    const colors = ["#2E86C1", "#7D3C98", "#C0392B", "#D68910", "#5D6D7E", "#1E8449", "#B0BAC5"];
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Interventions &amp; model flags</h1><p class="lede">Takeovers by the Vehicle Safety Operator, attributed to the stack layer that caused them, alongside the model's own warning flags. Breaking rates down by software version and light condition separates a software change from seasonal exposure.</p></div>
        <div class="filters"><label class="f">Zone ${zoneSelect("z", z)}</label>
          <label class="f">Type <select id="it"><option value="">All takeovers</option><option value="safety_critical" ${state.itype === "safety_critical" ? "selected" : ""}>Safety-critical</option><option value="precautionary" ${state.itype === "precautionary" ? "selected" : ""}>Precautionary</option><option value="comfort" ${state.itype === "comfort" ? "selected" : ""}>Comfort</option></select></label></div>
      </div>
      <div class="grid g2">
        <div class="card"><h2>Takeovers by attributed layer</h2><div class="sub">Count per week · ${z || "all zones"} · ${ints.length} takeovers after de-duplication</div><div id="c-layer"></div></div>
        <div class="card"><h2>Model flags by week</h2><div class="sub">Per 100 autonomous km · ${z || "all zones"}</div><div id="c-flags"></div></div>
      </div>
      <div class="card mt"><h2>Safety-critical + precautionary takeovers per 1,000 km, by software version and light</h2>
        <div class="sub">Exposure-normalised. Dusk km grew through the period as sunsets moved earlier, so raw counts would overstate the v4.3.0 effect.</div><div id="t-sw"></div></div>
      <div class="grid g2 mt">
        <div class="card"><h2>Hotspots: takeovers by site and week</h2><div class="sub">Safety-critical + precautionary at mapped sites</div><div id="h-site"></div></div>
        <div class="card"><h2>Vehicle health: drift + low-confidence flags</h2><div class="sub">localization_drift + perception_low_conf per 100 km, by vehicle</div><div id="h-veh"></div></div>
      </div>`;
    C.bar($("#c-layer"), {
      x: wkLabels(), stacked: true, yLabel: "takeovers",
      series: triggers.map((t, i) => ({ name: t.replace("_", " "), color: colors[i], values: D.weeks.map((w) => ints.filter((r) => r.week === w && r.trigger === t).length) })),
    });
    const ftypes = ["planner_uncertainty", "perception_low_conf", "occlusion_high", "hard_brake", "localization_drift", "ood_scene"];
    C.line($("#c-flags"), {
      x: wkLabels(), yLabel: "per 100 km", markers: releaseMarkers(),
      series: ftypes.map((t) => ({ name: t.replace(/_/g, " "), values: D.weeks.map((w) => A.per(D.flags.filter((x) => x.week === w && x.type === t && (!z || x.zone === z)).length, A.km({ week: w, zone: z }), 100)) })),
    });
    const lights = ["day", "dusk", "night"];
    const sws = D.meta.releases.map((r) => r.version);
    const leftOnly = state.swScope !== "all";
    const cell = (sw, lt) => {
      const n = D.int.filter((r) => r.sw === sw && r.light === lt && (r.type === "safety_critical" || r.type === "precautionary") && (leftOnly ? A.LEFT_SITES.includes(r.site) : !z || r.zone === z)).length;
      const k = A.sum(D.shifts.filter((s) => s.sw === sw && (leftOnly ? s.zone === "Ridgeview" : !z || s.zone === z)), (s) => s["km_" + lt]);
      return { n, k, r: k >= 150 ? A.per(n, k, 1000) : null };
    };
    const grid = sws.map((sw) => lights.map((lt) => cell(sw, lt)));
    $("#t-sw").innerHTML = `<div class="filters" style="margin-bottom:8px"><label class="f">Scope <select id="swscope"><option value="left" ${leftOnly ? "selected" : ""}>Occluded left-turn sites (Marlow, Hale) · per 1,000 Ridgeview km</option><option value="all" ${!leftOnly ? "selected" : ""}>All takeovers · ${z || "all zones"}</option></select></label></div>
      <div class="table-wrap"><table><thead><tr><th>Software</th>${lights.map((l) => `<th class="num">${l}</th>`).join("")}<th class="num">all light</th></tr></thead><tbody>${sws.map((sw, i) => {
      const all = grid[i].reduce((a, c) => ({ n: a.n + c.n, k: a.k + c.k }), { n: 0, k: 0 });
      return `<tr><th>${sw}</th>${grid[i].map((c, j) => {
        const base = grid[0][j].r;
        const hi = c.r != null && base != null && i > 0 && c.r > 2 * Math.max(base, 0.05);
        return `<td class="num" style="${hi ? "background:#fdecea;color:#C0392B;font-weight:700" : ""}">${c.r == null ? '<span class="muted">too little exposure</span>' : c.r.toFixed(2)} <span class="muted small">(${c.n} / ${Math.round(c.k).toLocaleString()} km)</span></td>`;
      }).join("")}<td class="num"><b>${A.per(all.n, all.k, 1000).toFixed(2)}</b></td></tr>`;
    }).join("")}</tbody></table></div>
      <p class="muted small">Red = more than double the v4.2.0 rate in the same light. Cells under 150 km of exposure are not rated.</p>`;
    $("#swscope").onchange = (e) => { state.swScope = e.target.value; interventions(); };
    const sites = Object.entries(D.siteInfo).filter(([, s]) => !z || s.zone === z).map(([n]) => n);
    C.heat($("#h-site"), {
      corner: "Site", cols: wkLabels(), extraHead: "Total",
      rows: sites.map((s) => { const v = D.weeks.map((w) => D.int.filter((r) => r.site === s && r.week === w && r.type !== "comfort").length); return { label: s, values: v, extra: A.sum(v) }; }).sort((a, b) => b.extra - a.extra),
      fmt: (v) => String(v),
    });
    const vehicles = Object.keys(D.vehZone).filter((v) => !z || D.vehZone[v] === z);
    C.heat($("#h-veh"), {
      corner: "Vehicle", cols: wkLabels(),
      rows: vehicles.map((v) => ({ label: v, values: D.weeks.map((w) => A.per(D.flags.filter((x) => x.vehicle === v && x.week === w && (x.type === "localization_drift" || x.type === "perception_low_conf")).length, A.km({ week: w, vehicle: v }), 100)) })),
    });
    $("#z").onchange = (e) => { state.zone = e.target.value; interventions(); };
    $("#it").onchange = (e) => { state.itype = e.target.value; interventions(); };
  }

  // ================================================================ DRIVER MONITORING
  function dms() {
    const shifts = D.shifts;
    const buckets = [0, 1, 2, 3, 4, 5, 6];
    const expo = (filter) => buckets.map((b) => A.sum(shifts.filter(filter), (s) => Math.max(0, Math.min(1, s.hours - b)) * s.dms_uptime));
    const cnt = (filter, type) => buckets.map((b) => D.dms.filter((x) => filter(D.shiftById[x.shift]) && x.type === type && Math.min(6, Math.floor(x.hour_into_shift)) === b).length);
    const is24 = (s) => s.vso === "VSO-24", not24 = (s) => s.vso !== "VSO-24";
    const rate = (n, e) => n.map((v, i) => A.per(v, e[i], 100));
    const vsos = [...new Set(shifts.map((s) => s.vso))].sort();
    const fleetReact = A.median(D.int.filter((r) => r.type !== "comfort").map((r) => r.reaction_s));
    const rows = vsos.map((v) => {
      const sh = shifts.filter((s) => s.vso === v);
      const h = A.sum(sh, (s) => s.dmsHours);
      const ev = D.dms.filter((x) => x.vso === v);
      const dr = ev.filter((x) => x.type === "drowsiness").length;
      const react = A.median(D.int.filter((r) => r.vso === v && r.type !== "comfort").map((r) => r.reaction_s));
      const late = A.median(D.int.filter((r) => r.vso === v && r.type !== "comfort" && r.hour_into_shift > 4).map((r) => r.reaction_s));
      return { v, n: sh.length, hours: A.sum(sh, (s) => s.hours), long: sh.filter((s) => s.hours > 4).length, alerts: A.per(ev.length, h, 100), drowsy: A.per(dr, h, 100), react, late };
    });
    const drM = A.mean(rows.map((r) => r.drowsy)), drS = A.sd(rows.map((r) => r.drowsy));
    rows.forEach((r) => { r.flag = r.long > 3 || r.drowsy > drM + 2 * drS; r.score = r.long * 0.5 + (r.drowsy - drM) / (drS || 1); });
    rows.sort((a, b) => b.score - a.score);
    const ackH = Array.from({ length: 15 }, (_, i) => i + 7);
    const totalH = A.sum(shifts, (s) => s.hours);
    view.innerHTML = `
      <div class="page-head"><div><h1>Driver Monitoring System &amp; VSO behaviour</h1><p class="lede">DMS alerts, shift patterns and takeover reaction times per Vehicle Safety Operator. Rates use DMS-available hours, so the AV-03 camera outage does not look like an improvement.</p></div></div>
      <div class="kpis">
        <div class="kpi"><div class="k-label">VSO hours</div><div class="k-value">${Math.round(totalH).toLocaleString()}</div><div class="k-unit">across ${shifts.length} shifts</div></div>
        <div class="kpi"><div class="k-label">DMS alerts</div><div class="k-value">${f(A.per(D.dms.length, A.sum(shifts, (s) => s.dmsHours), 100))}</div><div class="k-unit">per 100 VSO-h</div></div>
        <div class="kpi"><div class="k-label">Drowsiness alerts</div><div class="k-value">${D.dms.filter((x) => x.type === "drowsiness").length}</div><div class="k-unit">${D.dms.filter((x) => x.type === "drowsiness" && x.hour_into_shift > 4).length} after hour 4</div></div>
        <div class="kpi"><div class="k-label">Shifts over 4.0 h</div><div class="k-value">${shifts.filter((s) => s.hours > 4).length}</div><div class="k-unit">${shifts.filter((s) => s.hours > 4 && s.vso === "VSO-24").length} by VSO-24</div></div>
        <div class="kpi"><div class="k-label">Ack after 5 min</div><div class="k-value">${pct(A.per(D.dms.filter((x) => x.ack_s > 300).length, D.dms.length, 100))}</div><div class="k-unit">SLA: 5 min</div></div>
        <div class="kpi"><div class="k-label">Median takeover reaction</div><div class="k-value">${fleetReact.toFixed(2)} s</div><div class="k-unit">SC + precautionary</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><h2>Drowsiness by hour into shift</h2><div class="sub">Alerts per 100 DMS-hours · VSO-24 vs rest of fleet</div><div id="c-fat"></div></div>
        <div class="card"><h2>Shift length distribution</h2><div class="sub">Number of shifts by driving hours · policy limit 4.0 h</div><div id="c-len"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h2>Takeover reaction time by hour into shift</h2><div class="sub">Median seconds, safety-critical + precautionary takeovers</div><div id="c-react"></div></div>
        <div class="card"><h2>Late DMS acknowledgements by time of day</h2><div class="sub">% of alerts acknowledged after 5 min</div><div id="c-ack"></div></div>
      </div>
      <div class="card mt"><h2>VSO watch list</h2><div class="sub">Sorted by risk score (overtime shifts + drowsiness z-score). Fleet median reaction ${fleetReact.toFixed(2)} s.</div>
        <div class="table-wrap"><table><thead><tr><th>VSO</th><th class="num">Shifts</th><th class="num">Hours</th><th class="num">Shifts &gt; 4 h</th><th class="num">DMS alerts /100 h</th><th class="num">Drowsiness /100 h</th><th class="num">Median reaction</th><th class="num">Reaction after hour 4</th><th>Status</th></tr></thead>
        <tbody>${rows.slice(0, 12).map((r) => `<tr><td><b>${r.v}</b></td><td class="num">${r.n}</td><td class="num">${r.hours.toFixed(0)}</td><td class="num">${r.long}</td><td class="num">${r.alerts.toFixed(1)}</td><td class="num">${r.drowsy.toFixed(1)}</td><td class="num">${r.react != null ? r.react.toFixed(2) + " s" : "—"}</td><td class="num">${r.late != null ? r.late.toFixed(2) + " s" : "—"}</td><td>${r.flag ? badge("Alert") : badge("Normal")}</td></tr>`).join("")}</tbody></table></div>
        <p class="muted small">Showing the top 12 of ${rows.length} VSOs.</p></div>`;
    C.bar($("#c-fat"), {
      x: buckets.map((b) => (b === 6 ? "6h+" : `${b}-${b + 1}h`)), yLabel: "per 100 DMS-h", refLine: { at: 4, label: "4.0 h limit" },
      series: [{ name: "VSO-24", color: "#C0392B", values: rate(cnt(is24, "drowsiness"), expo(is24)) }, { name: "All other VSOs", color: "#1F4E79", values: rate(cnt(not24, "drowsiness"), expo(not24)) }],
    });
    const bins = [3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 5.0, 5.5, 6.0, 6.5];
    const lab = bins.slice(0, -1).map((b, i) => `${b}-${bins[i + 1]}`);
    const hist = (fl) => bins.slice(0, -1).map((b, i) => shifts.filter((s) => fl(s) && s.hours >= b && s.hours < bins[i + 1] + (i === bins.length - 2 ? 0.01 : 0)).length);
    C.bar($("#c-len"), { x: lab, stacked: true, yLabel: "shifts", refLine: { at: 4, label: "4.0 h limit" },
      series: [{ name: "Other VSOs", color: "#1F4E79", values: hist(not24) }, { name: "VSO-24", color: "#C0392B", values: hist(is24) }] });
    const reactB = buckets.map((b) => A.median(D.int.filter((r) => r.type !== "comfort" && Math.min(6, Math.floor(r.hour_into_shift)) === b).map((r) => r.reaction_s)) || 0);
    C.bar($("#c-react"), { x: buckets.map((b) => (b === 6 ? "6h+" : `${b}-${b + 1}h`)), yLabel: "seconds", refLine: { at: 4, label: "4.0 h limit" }, series: [{ name: "", color: "#1F4E79", values: reactB }] });
    C.bar($("#c-ack"), { x: ackH.map((h) => `${h}:00`), yLabel: "% late", series: [{ name: "", values: ackH.map((h) => { const a = D.dms.filter((x) => Math.floor(x.hour) === h); return A.per(a.filter((x) => x.ack_s > 300).length, a.length, 100); }), colors: ackH.map((h) => (h >= 18 ? "#C0392B" : "#1F4E79")) }] });
  }

  // ================================================================ INVESTIGATIONS
  function investigations(id) {
    if (id) state.inv = id;
    const inv = D.investigations.find((i) => i.id === state.inv) || D.investigations[0];
    view.innerHTML = `
      <div class="page-head"><div><h1>Incidents &amp; investigations</h1><p class="lede">Each investigation collects evidence from the logs, rebuilds the timeline, works through the causes and records corrective and preventive actions. Every number in the evidence charts is computed live from the dataset.</p></div></div>
      <div class="card"><h2>Incident register</h2>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Date / time</th><th>Vehicle</th><th>Site</th><th>Type</th><th>Severity</th><th>SW</th><th>Investigation</th></tr></thead>
        <tbody>${D.incidents.map((i) => `<tr class="clickable" data-inv="${i.investigation}"><td><b>${i.id}</b></td><td>${i.ts.replace("T", " ")}</td><td>${i.vehicle}</td><td>${esc(i.site)}</td><td>${esc(i.type)}</td><td>${badge(i.severity + " " + i.severity_label, i.severity === "S0" ? "watch" : "alert")}</td><td>${i.sw}</td><td><a href="#investigations/${i.investigation}">${i.investigation}</a></td></tr>`).join("")}</tbody></table></div>
        <p class="muted small">Severity: S0 near miss (no contact) · S1 minor contact, no injury · S2+ injury (none in period).</p>
      </div>
      <div class="grid g-side mt">
        <div class="inv-list">${D.investigations.map((i) => `<button class="inv-item ${i.id === inv.id ? "active" : ""}" data-inv="${i.id}"><div class="i-id">${i.id} · ${i.incidents.join(", ")}</div><div class="i-title">${esc(i.title)}</div>${badge(i.risk)} ${badge(i.status.startsWith("Closed") ? "Closed" : "Open", i.status.startsWith("Closed") ? "closed" : "in-progress")}</button>`).join("")}</div>
        <div>${invDetail(inv)}</div>
      </div>`;
    $$("[data-inv]").forEach((b) => (b.onclick = () => (location.hash = "#investigations/" + b.dataset.inv)));
    drawEvidence(inv, $("#ev-chart"));
    $("#to-report").onclick = () => { state.report = "investigation"; state.reportInv = inv.id; location.hash = "#reports"; };
  }

  function invDetail(inv) {
    const keyRe = /INC-\d+|takes over|takeover|Rear impact|strikes|crossing/i;
    return `<div class="card">
      <div class="card-head"><div><div class="muted small">${inv.id} · opened ${inv.opened} · ${esc(inv.owner)}</div><h2 style="margin-top:2px">${esc(inv.title)}</h2></div><div>${badge(inv.risk + " risk", inv.risk)} <button class="primary" id="to-report">Open as report</button></div></div>
      <p>${esc(inv.summary)}</p>
      <p class="muted small">Status: ${esc(inv.status)}</p>
      ${inv.chart ? `<h3 class="mt">Evidence from the data</h3><div id="ev-chart"></div>` : `<div id="ev-chart"></div>`}
      <div class="grid g2 mt">
        <div><h3>Reconstructed timeline</h3><ul class="timeline">${inv.timeline.map((t) => `<li class="${keyRe.test(t.event) ? "key" : ""}"><span class="t">${esc(t.t)}</span><span class="src">${esc(t.src)}</span><div>${esc(t.event)}</div></li>`).join("")}</ul></div>
        <div><h3>Evidence collected</h3><table><thead><tr><th>Evidence</th><th>Finding</th></tr></thead><tbody>${inv.evidence.map((e) => `<tr><td><b>${esc(e.item)}</b><div class="muted small">${esc(e.source)}</div></td><td>${esc(e.finding)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <h3 class="mt">5 Whys</h3><ol class="whys">${inv.whys.map((w) => `<li>${esc(w)}</li>`).join("")}</ol>
      <h3 class="mt">Contributing factors</h3><div class="fishbone">${Object.entries(inv.factors).map(([k, v]) => `<div class="fish"><h4>${esc(k)}</h4><ul>${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div>
      <h3 class="mt">Root cause</h3><div class="root">${esc(inv.root_cause)}</div>
      <h3 class="mt">Corrective and preventive actions</h3>
      <div class="table-wrap"><table><thead><tr><th>Action</th><th>Type</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>${inv.actions.map((a) => `<tr><td>${esc(a.action)}</td><td>${a.type}</td><td>${esc(a.owner)}</td><td>${a.due}</td><td>${badge(a.status)}</td></tr>`).join("")}</tbody></table></div>
      ${inv.limitations.length ? `<h3 class="mt">Evidence limitations</h3><ul class="small">${inv.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    </div>`;
  }

  // Evidence charts, shared with reports
  function drawEvidence(inv, el) {
    if (!el || !inv.chart) return;
    const daysIn = (a, b) => { const out = []; for (let t = new Date(a + "T12:00:00Z"); t <= new Date(b + "T12:00:00Z"); t = new Date(t.getTime() + 86400000)) out.push(t.toISOString().slice(0, 10)); return out; };
    if (inv.chart === "left_turn") {
      const sites = A.LEFT_SITES;
      el.innerHTML = `<div id="ev1"></div><div class="callout small mt">Flags per 100 Ridgeview km at Marlow Ave &amp; 5th St and Hale Rd &amp; Pine St. The band is the W1-W4 baseline. Flags crossed the band in W5, the week before INC-0412 (W6).</div>`;
      const pu = A.series((w) => A.per(A.count(D.flags, { week: w, type: "planner_uncertainty", site: sites }), A.km({ week: w, zone: "Ridgeview" }), 100));
      const hb = A.series((w) => A.per(A.count(D.flags, { week: w, type: "hard_brake", site: sites }), A.km({ week: w, zone: "Ridgeview" }), 100));
      const tk = A.series((w) => A.per(A.count(D.int, { week: w, site: sites, type: ["safety_critical", "precautionary"] }), A.km({ week: w, zone: "Ridgeview" }), 100));
      C.line($("#ev1", el), { x: wkLabels(), yLabel: "per 100 Ridgeview km", band: { ...A.baseline(pu), label: "planner-uncertainty baseline" }, markers: [...releaseMarkers(), { at: at("2026-10-29"), label: "INC-0412" }],
        series: [{ name: "Planner-uncertainty flags", values: pu, color: "#C0392B" }, { name: "Hard-brake flags", values: hb, color: "#D68910" }, { name: "SC + precautionary takeovers", values: tk, color: "#1F4E79" }] });
    } else if (inv.chart === "fatigue") {
      el.innerHTML = `<div id="ev1"></div><div class="callout small mt">Each point is a VSO-24 shift: driving hours and DMS drowsiness + eyes-off alerts per hour. The green band is the 4.0 h policy limit; overtime starts on Oct 19 and alert rates climb with it. INC-0419 happened on the 6.3 h shift of Nov 5.</div>`;
      const sh = D.shifts.filter((s) => s.vso === "VSO-24").sort((a, b) => a.date.localeCompare(b.date));
      const lab = sh.map((s) => s.date.slice(5));
      const alerts = sh.map((s) => A.per(D.dms.filter((x) => x.shift === s.id && (x.type === "drowsiness" || x.type === "eyes_off_road")).length, s.dmsHours || 1, 1));
      C.line($("#ev1", el), { x: lab, yLabel: "hours / alerts per hour", band: { lo: 0, hi: 4, label: "within 4.0 h policy" }, markers: [{ at: sh.findIndex((s) => s.date === "2026-11-05"), label: "INC-0419" }],
        series: [{ name: "Shift hours", values: sh.map((s) => s.hours), color: "#1F4E79" }, { name: "DMS alerts per hour", values: alerts, color: "#C0392B" }] });
    } else if (inv.chart === "calibration") {
      const ds = daysIn("2026-10-01", "2026-10-31").filter((d) => new Date(d + "T12:00:00Z").getUTCDay() !== 0);
      const av9 = ds.map((d) => A.per(D.flags.filter((x) => x.vehicle === "AV-09" && x.type === "localization_drift" && x.ts.startsWith(d)).length, A.sum(D.shifts.filter((s) => s.vehicle === "AV-09" && s.date === d), (s) => s.kmClean), 100));
      const fleet = ds.map((d) => A.per(D.flags.filter((x) => x.vehicle !== "AV-09" && x.type === "localization_drift" && x.ts.startsWith(d)).length, A.sum(D.shifts.filter((s) => s.vehicle !== "AV-09" && s.date === d), (s) => s.kmClean), 100));
      el.innerHTML = `<div id="ev1"></div><div class="callout small mt">Daily localization-drift flags per 100 km. AV-09 separates from the fleet the day the windshield was replaced and returns to normal after recalibration.</div>`;
      C.line($("#ev1", el), { x: ds.map((d) => d.slice(5)), yLabel: "per 100 km", markers: [{ at: ds.indexOf("2026-10-09"), label: "Windshield" }, { at: ds.indexOf("2026-10-15"), label: "INC-0398" }, { at: ds.indexOf("2026-10-20"), label: "Recal" }],
        series: [{ name: "AV-09", values: av9, color: "#C0392B" }, { name: "Rest of fleet", values: fleet, color: "#1F4E79" }] });
    } else if (inv.chart === "construction") {
      const harbor = Object.entries(D.siteInfo).filter(([, s]) => s.zone === "Harbor District").map(([n]) => n);
      const dock = A.series((w) => A.count(D.int, { week: w, site: "Dock St & Pier 3", type: ["safety_critical", "precautionary"] }));
      const other = A.series((w) => A.count(D.int, { week: w, site: harbor.filter((s) => s !== "Dock St & Pier 3"), type: ["safety_critical", "precautionary"] }) / 4);
      el.innerHTML = `<div id="ev1"></div><div class="callout small mt">Takeovers rise at Dock St only, from the week the closure began, on every software version. Other Harbor sites stay flat, which points to the environment rather than the stack.</div>`;
      C.line($("#ev1", el), { x: wkLabels(), yLabel: "takeovers per week", markers: [{ at: at("2026-10-26"), label: "Closure" }, { at: at("2026-11-10"), label: "INC-0427" }],
        series: [{ name: "Dock St & Pier 3", values: dock, color: "#C0392B" }, { name: "Other Harbor sites (avg)", values: other, color: "#1F4E79" }] });
    }
  }

  // ================================================================ CONTROLS
  function controls() {
    const res = A.controls();
    view.innerHTML = `
      <div class="page-head"><div><h1>Operational controls assurance</h1><p class="lede">Each control is tested against its full population in the data, not a sample. A control is rated ineffective if exceptions exceed 2% or any exception contributed to an incident.</p></div></div>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
        ${["Effective", "Partially effective", "Ineffective"].map((r) => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value">${Object.values(res).filter((c) => c.rating === r).length}</div><div class="k-unit">of ${Object.keys(res).length} controls</div></div>`).join("")}
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Control</th><th>How it was tested</th><th class="num">Population</th><th class="num">Exceptions</th><th>Weekly exceptions</th><th>Linked incidents</th><th>Rating</th></tr></thead>
        <tbody>${Object.values(res).map((c) => `
          <tr class="clickable" data-c="${c.id}"><td><b>${c.id} · ${esc(c.name)}</b><div class="muted small">${esc(c.policy)}</div></td><td class="small">${esc(c.desc)}</td><td class="num">${c.pop.length.toLocaleString()}<div class="muted small">${c.popLabel}</div></td><td class="num"><b>${c.exc.length}</b><div class="muted small">${c.rate.toFixed(1)}%</div></td><td>${c.weekly ? C.spark(c.weekly) : '<span class="muted small">n/a</span>'}</td><td>${c.exc.length && c.linked.length ? c.linked.join(", ") : "—"}</td><td>${badge(c.rating)}</td></tr>
          <tr id="x-${c.id}" style="display:none"><td colspan="7" class="small"><b>Exceptions (first 12):</b><ul>${c.exc.slice(0, 12).map((x) => `<li>${esc(c.row(x))}</li>`).join("") || "<li>None</li>"}</ul></td></tr>`).join("")}</tbody>
      </table></div><p class="muted small">Click a control to see its exceptions.</p></div>`;
    $$("[data-c]").forEach((r) => (r.onclick = () => { const x = $("#x-" + r.dataset.c); x.style.display = x.style.display === "none" ? "" : "none"; }));
  }

  // ================================================================ DATA QUALITY
  function quality() {
    const q = D.dq;
    const dupDates = [...new Set(q.duplicates.map((d) => d.dup.ts.slice(0, 10)))];
    const w5raw = D.intRaw.filter((r) => r.week === 5).length, w5 = D.int.filter((r) => r.week === 5).length;
    const outShifts = q.dmsOutage;
    view.innerHTML = `
      <div class="page-head"><div><h1>Data quality &amp; evidence limitations</h1><p class="lede">Checks run on load before any metric is computed. Each issue lists how it would distort the analysis and how it is handled.</p></div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Check</th><th>Dataset</th><th>Result</th><th>Impact if ignored</th><th>Handling</th></tr></thead><tbody>
        <tr><td><b>Duplicate records</b></td><td>interventions</td><td>${badge(q.duplicates.length + " duplicates", q.duplicates.length ? "alert" : "normal")}<div class="small muted">${dupDates.join(", ")}</div></td><td>W5 takeovers overstated by ${w5raw - w5} (${A.per(w5raw - w5, w5, 100).toFixed(0)}%).</td><td>Matched on vehicle + timestamp + type + trigger; later copy dropped. Pattern points to a logger retry.</td></tr>
        <tr><td><b>Missing odometer</b></td><td>shifts.km</td><td>${badge(q.imputed.length + " shifts", q.imputed.length ? "watch" : "normal")}</td><td>Lower km denominator inflates per-km rates.</td><td>Imputed from shift hours × that vehicle's median speed; flagged as imputed.</td></tr>
        <tr><td><b>DMS outage</b></td><td>shifts.dms_uptime</td><td>${badge(outShifts.length + " shifts at 0%", outShifts.length ? "alert" : "normal")}<div class="small muted">${[...new Set(outShifts.map((s) => s.vehicle))].join(", ")} · ${outShifts.length ? outShifts[0].date + " → " + outShifts[outShifts.length - 1].date : ""}</div></td><td>Zero alerts would read as perfect behaviour.</td><td>DMS rates use DMS-available hours only; outage reported under control C5.</td></tr>
        <tr><td><b>Partial DMS uptime</b></td><td>shifts.dms_uptime</td><td>${badge(q.dmsPartial.length + " shifts < 98%", "watch")}</td><td>Slight undercount of alerts.</td><td>Hours weighted by uptime.</td></tr>
        <tr><td><b>Events outside shift window</b></td><td>interventions, flags, DMS</td><td>${badge(q.outOfWindow + " records", q.outOfWindow ? "watch" : "normal")}</td><td>Mis-attributed hour-into-shift.</td><td>Within a 3-minute tolerance; kept.</td></tr>
        <tr><td><b>Orphan records</b></td><td>all event tables</td><td>${badge(q.orphan + " records", q.orphan ? "alert" : "normal")}</td><td>Events that cannot be tied to a shift or VSO.</td><td>None found.</td></tr>
        <tr><td><b>Site tagging coverage</b></td><td>flags.site</td><td>${badge(((D.flags.filter((x) => x.site).length / D.flags.length) * 100).toFixed(0) + "% tagged", "neutral")}</td><td>Site analysis only sees mapped sites.</td><td>Expected: only mapped sites are tagged. Site rates use zone km as denominator.</td></tr>
        </tbody></table></div></div>
      <div class="grid g2 mt">
        <div class="card"><h2>Effect of de-duplication</h2><div class="sub">Takeovers per day, Oct 19-24 (W5)</div><div id="c-dup"></div></div>
        <div class="card"><h2>DMS alerts per shift, AV-03</h2><div class="sub">The gap is a camera outage, not safer driving</div><div id="c-out"></div></div>
      </div>
      <div class="card mt"><h2>Known limitations of this evidence</h2><ul>
        <li>Trigger attribution (perception, planning, …) is assigned at review and may be revised.</li>
        <li>DMS detects eye and head behaviour; it does not measure fatigue directly.</li>
        <li>Low event counts at single sites give wide uncertainty; trends are read with exposure and context, not alone.</li>
        <li>Dusk and night exposure change with season, which confounds before/after comparisons of software releases.</li>
        <li>Field observations are free text and depend on who is riding.</li></ul></div>`;
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
    C.bar($("#c-dup"), { x: days.map((d) => d.slice(5)), yLabel: "takeovers", series: [{ name: "Raw", color: "#C0392B", values: days.map((d) => D.intRaw.filter((r) => r.ts.startsWith(d)).length) }, { name: "De-duplicated", color: "#1F4E79", values: days.map((d) => D.int.filter((r) => r.ts.startsWith(d)).length) }] });
    const sh = D.shifts.filter((s) => s.vehicle === "AV-03" && s.date >= "2026-10-26" && s.date <= "2026-11-14");
    C.bar($("#c-out"), { x: sh.map((s) => s.date.slice(5) + s.id.slice(-1)), yLabel: "alerts", series: [{ name: "", values: sh.map((s) => D.dms.filter((x) => x.shift === s.id).length), colors: sh.map((s) => (s.dms_uptime === 0 ? "#C0392B" : "#1F4E79")) }] });
  }

  // ================================================================ REPORTS
  function reports() {
    const tabs = [["weekly", "Weekly safety performance pack"], ["monthly", "Monthly assurance report"], ["investigation", "Investigation summary"], ["incident", "Incident write-up"]];
    let sel = "";
    if (state.report === "weekly") sel = `<label class="f">Week ${weekSelect("rw", state.reportWeek)}</label>`;
    if (state.report === "monthly") sel = `<label class="f">Month <select id="rm"><option value="2026-10" ${state.month === "2026-10" ? "selected" : ""}>October 2026</option><option value="2026-11" ${state.month === "2026-11" ? "selected" : ""}>November 2026 (to date)</option></select></label>`;
    if (state.report === "investigation") sel = `<label class="f">Investigation <select id="ri">${D.investigations.map((i) => `<option value="${i.id}" ${i.id === state.reportInv ? "selected" : ""}>${i.id} · ${esc(i.title)}</option>`).join("")}</select></label>`;
    if (state.report === "incident") sel = `<label class="f">Incident <select id="rc">${D.incidents.map((i) => `<option value="${i.id}" ${i.id === state.reportInc ? "selected" : ""}>${i.id} · ${esc(i.type)}</option>`).join("")}</select></label>`;
    view.innerHTML = `
      <div class="page-head no-print"><div><h1>Safety reporting</h1><p class="lede">Recurring reports generated from the same data as the dashboards. Pick a report, then use <b>Save as PDF</b> to print or export it.</p></div></div>
      <div class="subtabs">${tabs.map(([k, l]) => `<button data-r="${k}" class="${k === state.report ? "active" : ""}">${l}</button>`).join("")}</div>
      <div class="report-bar"><div class="filters">${sel}</div><button class="primary" id="print">Save as PDF</button></div>
      <article class="paper" id="paper"></article>`;
    const paper = $("#paper");
    if (state.report === "weekly") R.weekly(paper, state.reportWeek);
    if (state.report === "monthly") R.monthly(paper, state.month);
    if (state.report === "investigation") { const inv = D.investigations.find((i) => i.id === state.reportInv); R.investigation(paper, inv); drawEvidence(inv, $("#ev-chart", paper)); }
    if (state.report === "incident") R.incident(paper, D.incidents.find((i) => i.id === state.reportInc));
    $$("[data-r]").forEach((b) => (b.onclick = () => { state.report = b.dataset.r; reports(); }));
    $("#print").onclick = () => window.print();
    const on = (id, fn) => { const e = $("#" + id); if (e) e.onchange = (ev) => { fn(ev.target.value); reports(); }; };
    on("rw", (v) => (state.reportWeek = +v));
    on("rm", (v) => (state.month = v));
    on("ri", (v) => (state.reportInv = v));
    on("rc", (v) => (state.reportInc = v));
  }

  // ================================================================ ABOUT
  function about() {
    view.innerHTML = `
      <div class="page-head"><div><h1>About this project</h1><p class="lede">A working example of operational safety assurance for an autonomous vehicle fleet with Vehicle Safety Operators: monitoring, leading indicators, investigations, controls testing and reporting, all built on one simulated dataset.</p></div></div>
      <div class="grid g2">
        <div class="card"><h2>The simulated stack and operation</h2>
          <div class="stack"><div class="layer"><b>Sensors</b>cameras, lidar, radar, IMU</div><span class="arrow">→</span><div class="layer"><b>Perception</b>objects, lanes, confidence</div><span class="arrow">→</span><div class="layer"><b>Prediction</b>other road users</div><span class="arrow">→</span><div class="layer"><b>Planning</b>manoeuvre choice, uncertainty</div><span class="arrow">→</span><div class="layer"><b>Control</b>steering, braking</div></div>
          <div class="stack mt"><div class="layer"><b>VSO + DMS</b>Safety operator supervises; driver monitoring camera tracks attention</div><div class="layer"><b>Fleet ops</b>shift scheduling, maintenance, releases, field observations</div><div class="layer"><b>Data pipeline</b>shift logs, takeovers, model flags, DMS alerts, incidents</div></div>
          <p class="small">12 vehicles run two shifts a day, six days a week, in three fictional zones. Every 15 minutes of driving the generator draws takeovers, model flags and DMS alerts from rates that depend on software version, light, weather, site, hour into shift and vehicle health.</p></div>
        <div class="card"><h2>What was planted in the data</h2><p class="small">The generator plants five problems so the analysis can be checked against a known answer. The dashboards find them from the data, without being told where they are.</p>
          <ol class="small"><li><b>Software regression</b>: v4.3.0 hesitates on occluded unprotected left turns, worst at dusk.</li><li><b>Operator fatigue</b>: one VSO is scheduled past the 4.0 h limit.</li><li><b>Calibration drift</b>: a vehicle returns from a windshield replacement without recalibration.</li><li><b>Construction zone</b>: a lane closure raises takeovers at one site (environment, not a defect).</li><li><b>Data quality</b>: duplicate rows, a DMS camera outage, missing odometer values.</li></ol>
          <p class="small">Regenerate with <code>python tools/generate_data.py</code>.</p></div>
      </div>
      <div class="card mt"><h2>Skills map</h2><div class="table-wrap"><table class="skills"><thead><tr><th>Safety assurance skill</th><th>Where it is shown</th></tr></thead><tbody>
        <tr><td>Monitor VSO driving data, incidents, interventions, model flags, DMS events and field observations</td><td><a href="#overview">Overview</a>, <a href="#interventions">Interventions &amp; Flags</a>, <a href="#dms">Driver Monitoring</a></td></tr>
        <tr><td>Identify trends, anomalies and leading indicators of risk</td><td>Leading-indicator table with baseline bands and automatic anomaly detection on the <a href="#overview">Overview</a></td></tr>
        <tr><td>Validate operational safety controls</td><td><a href="#controls">Controls</a>: seven controls tested against full populations, with exceptions and ratings</td></tr>
        <tr><td>Support investigations: evidence, timelines, root cause, contributing factors, documentation</td><td><a href="#investigations">Investigations</a>: five cases with timelines, 5 Whys, fishbone factors, actions</td></tr>
        <tr><td>Produce weekly packs, monthly assurance reports, investigation summaries and incident write-ups</td><td><a href="#reports">Reports</a>, printable to PDF</td></tr>
        <tr><td>Validate data quality and recognise evidence limitations</td><td><a href="#quality">Data Quality</a> and the limitations listed in every investigation</td></tr>
        <tr><td>Impartial, evidence-based judgement</td><td>INV-004 and INV-005 conclude the cause was environmental or a third party, not the AV stack</td></tr>
        <tr><td>Data analytics literacy</td><td>Exposure-normalised rates, stratification by software and light, z-score anomaly detection, Python data generation</td></tr>
      </tbody></table></div></div>
      <div class="card mt"><h2>Disclaimer</h2><p class="small">This is a personal portfolio project. All vehicles, operators, places, software versions, incidents and figures are synthetic and fictional. It does not use or represent any company's data, systems or processes.</p></div>`;
  }

  // ================================================================ ROUTER
  const routes = { overview, interventions, dms, investigations, controls, quality, reports, about };
  function route() {
    const [name, arg] = (location.hash.slice(1) || "overview").split("/");
    const fn = routes[name] || overview;
    $$("#tabs a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + (routes[name] ? name : "overview")));
    fn(arg);
    window.scrollTo(0, 0);
  }

  A.load().then((d) => {
    D = d;
    window.APP = { drawEvidence, badge, state };
    window.addEventListener("hashchange", route);
    route();
  }).catch((e) => { view.innerHTML = `<div class="card">Could not load data/fleet.json (${esc(e.message)}). If you opened index.html directly from disk, serve the folder instead: <code>python -m http.server</code>.</div>`; });
})();
