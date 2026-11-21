// Small dependency-free SVG chart helpers.
const C = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#1F4E79", "#C0392B", "#D68910", "#1E8449", "#7D3C98", "#2E86C1", "#5D6D7E", "#B9770E"];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, "") || "0");

  function frame(W, H, m, yMax, yLabel) {
    const mant = yMax / Math.pow(10, Math.floor(Math.log10(yMax)));
    const ticks = mant === 2.5 || mant === 5 || mant === 10 ? 5 : 4;
    let s = "";
    for (let i = 0; i <= ticks; i++) {
      const v = (yMax * i) / ticks;
      const y = H - m.b - ((H - m.t - m.b) * i) / ticks;
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="grid"/>`;
      s += `<text x="${m.l - 6}" y="${y + 3.5}" class="tick" text-anchor="end">${fmt(v)}</text>`;
    }
    if (yLabel) s += `<text x="${m.l}" y="${m.t - 8}" class="axis-label">${esc(yLabel)}</text>`;
    return s;
  }

  function legend(series, W, y) {
    let x = 0, s = "";
    const items = series.filter((d) => d.name);
    items.forEach((d, i) => {
      const c = d.color || PALETTE[i % PALETTE.length];
      s += `<g transform="translate(${x},${y})"><rect width="10" height="10" rx="2" fill="${c}" ${d.dashed ? 'opacity=".55"' : ""}/><text x="14" y="9" class="legend">${esc(d.name)}</text></g>`;
      x += 26 + d.name.length * 6.2;
    });
    return s;
  }

  // Line chart. opts: {x:[labels], series:[{name, values, color, dashed}], yLabel, band:{lo,hi,label}, markers:[{at, label}], height}
  function line(el, o) {
    const W = 660, H = o.height || 250, m = { l: 44, r: 16, t: 26, b: 46 };
    const all = o.series.flatMap((s) => s.values.filter((v) => v != null));
    if (o.band) all.push(o.band.hi);
    const yMax = niceMax(Math.max(...all, 0) * 1.08);
    const n = o.x.length;
    const X = (i) => m.l + (n === 1 ? 0 : ((W - m.l - m.r) * i) / (n - 1));
    const Y = (v) => H - m.b - ((H - m.t - m.b) * v) / yMax;
    let s = frame(W, H, m, yMax, o.yLabel);
    if (o.band) {
      s += `<rect x="${m.l}" width="${W - m.l - m.r}" y="${Y(o.band.hi)}" height="${Math.max(0, Y(o.band.lo) - Y(o.band.hi))}" class="band"><title>${esc(o.band.label || "Baseline band")}</title></rect>`;
    }
    (o.markers || []).forEach((mk) => {
      const x = X(mk.at);
      const right = x > W - m.r - 70;
      s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" class="marker"/><text x="${right ? x - 3 : x + 3}" y="${m.t + 9}" class="marker-label" text-anchor="${right ? "end" : "start"}">${esc(mk.label)}</text>`;
    });
    const step = Math.max(1, Math.ceil(n / 10));
    o.x.forEach((lab, i) => {
      if (i % step === 0 || i === n - 1) s += `<text x="${X(i)}" y="${H - m.b + 15}" class="tick" text-anchor="middle">${esc(lab)}</text>`;
    });
    o.series.forEach((sr, k) => {
      const c = sr.color || PALETTE[k % PALETTE.length];
      let dpath = "", pen = false;
      sr.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        dpath += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      });
      s += `<path d="${dpath}" fill="none" stroke="${c}" stroke-width="2.2" ${sr.dashed ? 'stroke-dasharray="5 4"' : ""}/>`;
      if (n <= 20) sr.values.forEach((v, i) => {
        if (v != null) s += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.2" fill="${c}"><title>${esc(sr.name || "")} · ${esc(o.x[i])}: ${fmt(v)}</title></circle>`;
      });
    });
    s += legend(o.series, W, H - 14);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${s}</svg>`;
  }

  // Bar chart. opts: {x, series:[{name, values, color}], stacked, yLabel, refLine:{at (x index), label}, height}
  function bar(el, o) {
    const W = 660, H = o.height || 250, m = { l: 44, r: 16, t: 26, b: 46 };
    const n = o.x.length;
    const totals = o.x.map((_, i) => o.stacked ? o.series.reduce((a, s) => a + (s.values[i] || 0), 0) : Math.max(...o.series.map((s) => s.values[i] || 0)));
    const yMax = niceMax(Math.max(...totals, 0) * 1.08);
    const bw = (W - m.l - m.r) / n;
    const Y = (v) => H - m.b - ((H - m.t - m.b) * v) / yMax;
    let s = frame(W, H, m, yMax, o.yLabel);
    const step = Math.max(1, Math.ceil(n / 12));
    o.x.forEach((lab, i) => {
      if (i % step === 0) s += `<text x="${m.l + bw * (i + 0.5)}" y="${H - m.b + 15}" class="tick" text-anchor="middle">${esc(lab)}</text>`;
    });
    o.x.forEach((lab, i) => {
      let acc = 0;
      o.series.forEach((sr, k) => {
        const v = sr.values[i] || 0;
        const c = (sr.colors && sr.colors[i]) || sr.color || PALETTE[k % PALETTE.length];
        let x, w, y0, y1;
        if (o.stacked) { x = m.l + bw * i + bw * 0.15; w = bw * 0.7; y0 = Y(acc); y1 = Y(acc + v); acc += v; }
        else { const g = bw * 0.75 / o.series.length; x = m.l + bw * i + bw * 0.125 + g * k; w = g * 0.92; y0 = Y(0); y1 = Y(v); }
        if (v > 0) s += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${c}" rx="1.5"><title>${esc(sr.name || "")} · ${esc(lab)}: ${fmt(v)}</title></rect>`;
      });
    });
    if (o.refLine) {
      const x = m.l + bw * o.refLine.at;
      s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" class="marker alert"/><text x="${x + 4}" y="${m.t + 9}" class="marker-label alert">${esc(o.refLine.label)}</text>`;
    }
    if (o.series.length > 1 || o.series[0].name) s += legend(o.series, W, H - 14);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${s}</svg>`;
  }

  function spark(values, band, w = 110, h = 28) {
    const vals = values.map((v) => (v == null ? 0 : v));
    const max = Math.max(...vals, band ? band.hi : 0) * 1.1 || 1;
    const X = (i) => 2 + ((w - 4) * i) / (vals.length - 1);
    const Y = (v) => h - 2 - ((h - 4) * v) / max;
    let s = "";
    if (band) s += `<rect x="0" width="${w}" y="${Y(band.hi)}" height="${Math.max(0, Y(Math.max(0, band.lo)) - Y(band.hi))}" class="band"/>`;
    s += `<path d="${vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" fill="none" stroke="#1F4E79" stroke-width="1.6"/>`;
    s += `<circle cx="${X(vals.length - 1)}" cy="${Y(vals[vals.length - 1])}" r="2.6" fill="#1F4E79"/>`;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="spark">${s}</svg>`;
  }

  // Heat table: rows [{label, values:[...], extra?}], cols [labels]
  function heat(el, o) {
    const max = Math.max(...o.rows.flatMap((r) => r.values), 0.0001);
    const cell = (v) => {
      const a = v / max;
      const bg = `rgba(192,57,43,${(a * 0.85).toFixed(2)})`;
      return `<td class="heat" style="background:${bg};color:${a > 0.55 ? "#fff" : "#222"}" title="${fmt(v)}">${v ? (o.fmt ? o.fmt(v) : fmt(v)) : "·"}</td>`;
    };
    el.innerHTML = `<div class="table-wrap"><table class="heat-table"><thead><tr><th>${esc(o.corner || "")}</th>${o.cols.map((c) => `<th>${esc(c)}</th>`).join("")}${o.extraHead ? `<th>${esc(o.extraHead)}</th>` : ""}</tr></thead><tbody>${o.rows
      .map((r) => `<tr><th>${esc(r.label)}</th>${r.values.map(cell).join("")}${o.extraHead ? `<td>${r.extra ?? ""}</td>` : ""}</tr>`)
      .join("")}</tbody></table></div>`;
  }

  return { line, bar, spark, heat, fmt, esc, PALETTE };
})();
