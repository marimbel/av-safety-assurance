// Printable report generators. Everything is computed from the dataset at render time.
const R = (() => {
  const esc = (s) => C.esc(s), f = (v) => C.fmt(v);
  const b = (t, c) => window.APP.badge(t, c);
  const AUTHOR = "Marianna Belmares, Safety Assurance Analyst";
  const D = () => A.D;
  const tbl = (head, rows) => `<table><thead><tr>${head.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${esc(h.replace(/^#/, ""))}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="muted">None</td></tr>`}</tbody></table>`;
  const tr = (cells, numFrom = 99) => `<tr>${cells.map((c, i) => `<td${i >= numFrom ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`;
  const head = (title, period, extra = "", label = "Period") => `
    <div class="classif">Internal · Safety · Simulated data</div>
    <h1>${esc(title)}</h1>
    <div class="meta"><span><b>${label}:</b> ${esc(period)}</span><span><b>Prepared by:</b> ${AUTHOR}</span>${extra}</div>`;
  const signoff = () => `<h2>Sign-off</h2>${tbl(["Role", "Name", "Date"], [tr(["Prepared", AUTHOR, "2026-11-16"]), tr(["Reviewed", "Head of Operational Safety", "—"])])}`;

  // -------------------------------------------------------------- weekly pack
  function weekly(el, w) {
    const d = D(), M = A.metrics;
    const end = new Date(d.weekStart(w).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const inds = A.indicatorTable(w);
    const alerts = inds.filter((i) => i.st === "alert"), watch = inds.filter((i) => i.st === "watch");
    const inc = d.incidents.filter((i) => i.week === w);
    const an = A.anomalies().filter((a) => a.week === w);
    const ctl = Object.values(A.controls());
    const sc = M.sc.fn(w), scPrev = w > 1 ? M.sc.fn(w - 1) : null, scBase = A.baseline(A.series(M.sc.fn)).mean;
    const dup = d.dq.duplicates.filter((x) => x.dup.week === w).length;
    const imp = d.dq.imputed.filter((s) => s.week === w).length;
    const out = d.dq.dmsOutage.filter((s) => s.week === w);
    const actions = d.investigations.flatMap((i) => i.actions.map((a) => ({ ...a, inv: i.id }))).filter((a) => a.status !== "Done" && a.due <= new Date(new Date(end).getTime() + 14 * 86400000).toISOString().slice(0, 10));

    const headline = [
      `Safety-critical takeovers ran at <b>${f(sc)}</b> per 1,000 km (prior week ${scPrev != null ? f(scPrev) : "n/a"}, W1-W4 baseline ${f(scBase)}).`,
      inc.length ? `<b>${inc.length} incident${inc.length > 1 ? "s" : ""}</b>: ${inc.map((i) => `${i.id} (${i.severity}, ${esc(i.type.toLowerCase())})`).join("; ")}.` : "No incidents this week.",
      alerts.length ? `<b>${alerts.length} leading indicator${alerts.length > 1 ? "s" : ""} in alert</b>: ${alerts.map((a) => esc(a.label.toLowerCase())).join("; ")}.` : "No leading indicators in alert.",
      an.length ? `Top anomaly: ${esc(an[0].entity)}, ${esc(an[0].metric)} (${esc(an[0].value)} vs ${esc(an[0].base)}).` : "No automatic anomalies this week.",
    ];

    el.innerHTML = `${head(`Weekly Safety Performance Pack · Week ${w}`, d.weekRange(w), `<span><b>Data as of:</b> ${end}</span>`)}
      <h2>1. Headlines</h2><ul>${headline.map((h) => `<li>${h}</li>`).join("")}</ul>
      <h2>2. Safety performance</h2>
      ${tbl(["Metric", "Unit", "#This week", "#Prior week", "#W1-W4 baseline", "Status"], Object.entries(M).map(([k, m]) => {
        const vals = A.series(m.fn), bl = A.baseline(vals);
        const st = k === "km" ? "neutral" : A.status(vals[w - 1], bl);
        const F = m.fmt || f;
        return tr([m.label, m.unit, `<b>${F(vals[w - 1])}</b>`, w > 1 ? F(vals[w - 2]) : "—", F(bl.mean), k === "km" ? b("Info", "neutral") : b(st)], 2);
      }))}
      <div id="r-chart" class="mt"></div>
      <h2>3. Leading indicators</h2>
      <p>${alerts.length} in alert, ${watch.length} on watch, ${inds.length - alerts.length - watch.length} normal.</p>
      ${tbl(["Indicator", "Unit", "#This week", "#Baseline", "First breach", "Status"], inds.filter((i) => i.st !== "normal").map((i) => tr([esc(i.label), i.unit, `<b>${f(i.value)}</b>`, f(i.bl.mean), i.firstBreach ? "W" + i.firstBreach : "—", b(i.st)], 2)))}
      <h2>4. Incidents</h2>
      ${tbl(["ID", "Date / time", "Vehicle", "Site", "Severity", "Investigation"], inc.map((i) => tr([`<b>${i.id}</b>`, i.ts.replace("T", " "), i.vehicle, esc(i.site), `${i.severity} ${i.severity_label}`, i.investigation])))}
      <h2>5. Anomalies detected</h2>
      ${tbl(["Type", "Entity", "Metric", "#Value", "#Comparison"], an.slice(0, 8).map((a) => tr([a.kind, `<b>${esc(a.entity)}</b>`, esc(a.metric), esc(a.value), esc(a.base)], 3)))}
      <h2>6. Control exceptions this week</h2>
      ${tbl(["Control", "#Exceptions this week", "Overall rating"], ctl.filter((c) => c.weekly && c.weekly[w - 1] > 0).map((c) => tr([`${c.id} · ${esc(c.name)}`, c.weekly[w - 1], b(c.rating)], 1)))}
      <h2>7. Open actions due within two weeks</h2>
      ${tbl(["Investigation", "Action", "Owner", "Due", "Status"], actions.map((a) => tr([a.inv, esc(a.action), esc(a.owner), a.due, b(a.status)])))}
      <h2>8. Data quality caveats</h2>
      <ul>${[dup ? `${dup} duplicate takeover records removed (logger retry).` : "", imp ? `${imp} shift(s) with missing odometer; km imputed.` : "", out.length ? `DMS offline on ${[...new Set(out.map((s) => s.vehicle))].join(", ")} for ${out.length} shifts; DMS rates exclude those hours.` : ""].filter(Boolean).map((x) => `<li>${x}</li>`).join("") || "<li>No data quality issues affecting this week.</li>"}</ul>
      ${signoff()}`;
    C.line(el.querySelector("#r-chart"), { x: d.weeks.slice(0, w).map((x) => `W${x}`), yLabel: "per 1,000 km", height: 210,
      series: [{ name: "Safety-critical", values: A.series(M.sc.fn).slice(0, w), color: "#C0392B" }, { name: "Precautionary", values: A.series(M.pre.fn).slice(0, w), color: "#1F4E79" }] });
  }

  // -------------------------------------------------------------- monthly assurance report
  function monthly(el, month) {
    const d = D();
    const inM = (iso) => iso.startsWith(month);
    const name = month === "2026-10" ? "October 2026" : "November 2026 (1-15, to date)";
    const sh = d.shifts.filter((s) => inM(s.date));
    const km = A.sum(sh, (s) => s.kmClean), hrs = A.sum(sh, (s) => s.hours), dmsH = A.sum(sh, (s) => s.dmsHours);
    const ints = d.int.filter((r) => inM(r.ts));
    const sc = ints.filter((r) => r.type === "safety_critical").length, pre = ints.filter((r) => r.type === "precautionary").length;
    const inc = d.incidents.filter((i) => inM(i.ts));
    const opened = d.investigations.filter((i) => inM(i.opened));
    const ctl = Object.values(A.controls());
    const excM = (c) => c.exc.filter((x) => inM(x.ts || x.date || "")).length;
    const ineff = ctl.filter((c) => c.rating === "Ineffective" && excM(c) > 0);
    const opinion = ineff.length ? "Limited assurance" : "Reasonable assurance";
    const zones = Object.keys(d.meta.zones);
    const weeksInMonth = d.weeks.filter((w) => { const s = d.weekStart(w).toISOString().slice(0, 7); const e = new Date(d.weekStart(w).getTime() + 6 * 86400000).toISOString().slice(0, 7); return s === month || e === month; });

    el.innerHTML = `${head(`Monthly Safety Assurance Report · ${name}`, name, `<span><b>Distribution:</b> Safety leadership, Fleet Ops, Engineering leads</span>`)}
      <h2>1. Assurance opinion</h2>
      <p><b>${opinion}.</b> ${ineff.length ? `${ineff.length} operational control${ineff.length > 1 ? "s were" : " was"} ineffective this month and contributed to incidents: ${ineff.map((c) => `${c.id} ${esc(c.name.toLowerCase())}`).join("; ")}. Corrective actions are tracked below.` : "Operational controls operated effectively this month."}</p>
      <h2>2. Executive summary</h2>
      <ul>
        <li>The fleet drove <b>${Math.round(km).toLocaleString()} autonomous km</b> over ${sh.length} shifts and ${Math.round(hrs).toLocaleString()} VSO hours.</li>
        <li>Safety-critical takeovers: <b>${sc}</b> (${A.per(sc, km, 1000).toFixed(2)} per 1,000 km). Precautionary: ${pre} (${A.per(pre, km, 1000).toFixed(2)} per 1,000 km).</li>
        <li>Incidents: <b>${inc.length}</b> (${inc.filter((i) => i.severity === "S0").length} near miss, ${inc.filter((i) => i.severity === "S1").length} minor contact, 0 injury).</li>
        <li>Investigations opened: ${opened.length ? opened.map((i) => `${i.id} ${esc(i.title.toLowerCase())}`).join("; ") : "none"}.</li>
      </ul>
      <h2>3. Performance by zone</h2>
      ${tbl(["Zone", "#Km", "#SC / 1,000 km", "#Precautionary / 1,000 km", "#DMS alerts / 100 h", "#Incidents"], zones.map((z) => {
        const zs = sh.filter((s) => s.zone === z), zk = A.sum(zs, (s) => s.kmClean), zi = ints.filter((r) => r.zone === z);
        const zd = d.dms.filter((x) => x.zone === z && inM(x.ts)).length;
        return tr([z, Math.round(zk).toLocaleString(), A.per(zi.filter((r) => r.type === "safety_critical").length, zk, 1000).toFixed(2), A.per(zi.filter((r) => r.type === "precautionary").length, zk, 1000).toFixed(2), A.per(zd, A.sum(zs, (s) => s.dmsHours), 100).toFixed(1), inc.filter((i) => i.zone === z).length], 1);
      }))}
      <div id="m-chart" class="mt"></div>
      <h2>4. Control effectiveness</h2>
      ${tbl(["Control", "#Exceptions in month", "Rating", "Comment"], ctl.map((c) => tr([`${c.id} · ${esc(c.name)}`, excM(c), b(c.rating), c.exc.length && c.linked.length ? `Linked to ${c.linked.join(", ")}` : c.exc.length ? "Isolated exceptions" : "No exceptions"], 1)))}
      <h2>5. Key findings and recommendations</h2>
      ${opened.length ? opened.map((i) => `<p><b>${i.id} · ${esc(i.title)}</b><br>${esc(i.root_cause)}</p><ul>${i.actions.filter((a) => a.type === "Preventive").map((a) => `<li>${esc(a.action)} (${esc(a.owner)}, due ${a.due}, ${a.status.toLowerCase()})</li>`).join("")}</ul>`).join("") : "<p>No new investigations this month.</p>"}
      <h2>6. Evidence limitations</h2>
      <ul>
        ${d.dq.duplicates.some((x) => inM(x.dup.ts)) ? `<li>${d.dq.duplicates.filter((x) => inM(x.dup.ts)).length} duplicate takeover records removed before analysis.</li>` : ""}
        ${d.dq.dmsOutage.some((s) => inM(s.date)) ? `<li>DMS offline on ${d.dq.dmsOutage.filter((s) => inM(s.date)).length} shifts; DMS rates exclude those hours.</li>` : ""}
        <li>Rates at individual sites rest on small counts and should be read with exposure and context.</li>
        <li>Dusk exposure rises through autumn; software comparisons are stratified by light condition.</li>
      </ul>
      ${signoff()}`;
    C.line(el.querySelector("#m-chart"), { x: weeksInMonth.map((w) => d.weekLabel(w)), yLabel: "per 1,000 km", height: 200,
      series: [{ name: "Safety-critical", values: weeksInMonth.map((w) => A.metrics.sc.fn(w)), color: "#C0392B" }, { name: "Precautionary", values: weeksInMonth.map((w) => A.metrics.pre.fn(w)), color: "#1F4E79" }] });
  }

  // -------------------------------------------------------------- investigation summary
  function investigation(el, inv) {
    const d = D();
    const incs = d.incidents.filter((i) => inv.incidents.includes(i.id));
    el.innerHTML = `${head(`Investigation Summary · ${inv.id}`, `Opened ${inv.opened}`, `<span><b>Status:</b> ${esc(inv.status)}</span>`)}
      <h2 style="text-transform:none;letter-spacing:0;font-size:16px">${esc(inv.title)}</h2>
      ${tbl(["Incident", "Date / time", "Vehicle / VSO", "Location", "Severity"], incs.map((i) => tr([`<b>${i.id}</b>`, i.ts.replace("T", " "), `${i.vehicle} / ${i.vso}`, esc(i.site), `${i.severity} ${i.severity_label}`])))}
      <h2>1. Summary</h2><p>${esc(inv.summary)}</p>
      ${inv.chart ? `<h2>2. Data evidence</h2><div id="ev-chart"></div>` : ""}
      <h2>${inv.chart ? 3 : 2}. Timeline</h2>
      ${tbl(["Time", "Source", "Event"], inv.timeline.map((t) => tr([`<b>${esc(t.t)}</b>`, esc(t.src), esc(t.event)])))}
      <h2>Evidence reviewed</h2>
      ${tbl(["Evidence", "Source", "Finding"], inv.evidence.map((e) => tr([esc(e.item), esc(e.source), esc(e.finding)])))}
      <h2>Causal analysis (5 Whys)</h2><ol>${inv.whys.map((w) => `<li>${esc(w)}</li>`).join("")}</ol>
      <h2>Contributing factors</h2>
      ${tbl(["Category", "Factors"], Object.entries(inv.factors).map(([k, v]) => tr([`<b>${esc(k)}</b>`, v.map(esc).join("<br>")])))}
      <h2>Root cause</h2><div class="root">${esc(inv.root_cause)}</div>
      <h2>Corrective and preventive actions</h2>
      ${tbl(["Action", "Type", "Owner", "Due", "Status"], inv.actions.map((a) => tr([esc(a.action), a.type, esc(a.owner), a.due, b(a.status)])))}
      ${inv.limitations.length ? `<h2>Evidence limitations</h2><ul>${inv.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${signoff()}`;
  }

  // -------------------------------------------------------------- incident write-up
  function incident(el, inc) {
    const d = D();
    const t0 = new Date(inc.ts);
    const shift = d.shifts.find((s) => s.vehicle === inc.vehicle && new Date(s.start) <= t0 && t0 <= new Date(new Date(s.start).getTime() + s.hours * 3600000 + 600000));
    const near = (r) => r.vehicle === inc.vehicle && new Date(r.ts) - t0 >= -15 * 60000 && new Date(r.ts) - t0 <= 2 * 60000;
    const events = [
      ...d.flags.filter(near).map((r) => ({ ts: r.ts, src: "Model flag", what: r.type.replace(/_/g, " ") + (r.site ? ` @ ${r.site}` : "") })),
      ...d.dms.filter(near).map((r) => ({ ts: r.ts, src: "DMS", what: `${r.type.replace(/_/g, " ")} (${r.duration_s}s, ack ${Math.round(r.ack_s)}s)` })),
      ...d.int.filter(near).map((r) => ({ ts: r.ts, src: "Takeover", what: `${r.type.replace("_", "-")} · ${r.trigger} · reaction ${r.reaction_s}s${r.ttc_s ? ` · TTC ${r.ttc_s}s` : ""}` })),
    ].sort((a, b) => a.ts.localeCompare(b.ts));
    const hrInto = shift ? ((t0 - new Date(shift.start)) / 3600000).toFixed(1) : "—";
    const light = shift ? (d.int.find((r) => r.ts === inc.ts)?.light || "—") : "—";
    const inv = d.investigations.find((i) => i.id === inc.investigation);
    el.innerHTML = `${head(`Incident Write-up · ${inc.id}`, inc.ts.replace("T", " "), `<span><b>Severity:</b> ${inc.severity} ${inc.severity_label}</span>`, "Occurred")}
      <h2>1. Facts</h2>
      ${tbl(["Field", "Value"], [
        ["Incident type", esc(inc.type)], ["Date / time", inc.ts.replace("T", " ")], ["Location", `${esc(inc.site)}, ${inc.zone}`],
        ["Vehicle / software", `${inc.vehicle} / ${inc.sw}`], ["VSO", `${inc.vso}${shift ? ` · ${hrInto} h into a ${shift.hours} h shift` : ""}`],
        ["Conditions", shift ? `${shift.weather}, ${light}` : "—"], ["Contact / injury", `${inc.contact ? "Contact" : "No contact"} / ${inc.injury ? "Injury" : "No injury"}`],
      ].map((r) => tr(r)))}
      <h2>2. Description</h2><p>${esc(inc.summary)}</p>
      <h2>3. Data captured (15 min before to 2 min after, same vehicle)</h2>
      ${tbl(["Time", "Source", "Event"], events.map((e) => tr([e.ts.slice(11), e.src, esc(e.what)])))}
      <p class="small muted">Automatically extracted from the flag, DMS and takeover logs. Logs, video and sensor data preserved under the incident ID.</p>
      <h2>4. Immediate actions</h2>
      <ul><li>Vehicle stopped safely; VSO welfare check completed.</li><li>${inc.contact ? "Vehicle removed from service for inspection." : "Vehicle inspected before continuing."}</li><li>Logs, video and DMS data preserved; incident reported to Safety Assurance within 1 hour.</li>${inv ? inv.actions.filter((a) => a.type === "Corrective").slice(0, 2).map((a) => `<li>${esc(a.action)} (${a.status.toLowerCase()})</li>`).join("") : ""}</ul>
      <h2>5. Initial assessment</h2>
      <p>${inv ? esc(inv.root_cause) : "Under review."}</p>
      <p>Linked investigation: <b>${inc.investigation}</b>${inv ? ` · ${esc(inv.title)} · ${esc(inv.status)}` : ""}.</p>
      ${signoff()}`;
  }

  return { weekly, monthly, investigation, incident };
})();
