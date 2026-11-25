// charts.js
// Small SVG charts for the scenario comparison: line over the day, grouped bars per approach, and the PCA
// scatter (biplot). No libraries. Conventions: 2px lines, dots with a 2px surface ring, hairline grid,
// legend always shown for 2+ series, text in text colors (never the series color), hover tooltip on every chart.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const TEXT = '#1f2937';
  const TEXT_2 = '#6b7280';
  const GRID = '#e8e9e4';
  const SURFACE = '#ffffff';

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }
  function text(parent, x, y, content, attrs) {
    const t = el('text', { x, y, fill: TEXT_2, 'font-size': 11, ...attrs }, parent);
    t.textContent = content;
    return t;
  }
  // Clean tick values between 0 (or min) and max.
  function niceTicks(min, max, count) {
    if (max <= min) max = min + 1;
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const ticks = [];
    for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }
  const fmtNumber = (v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : Math.round(v).toLocaleString('es-CO'));

  function legend(container, series) {
    const box = document.createElement('div');
    box.className = 'viz-legend';
    box.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    container.appendChild(box);
  }
  function tooltip(container) {
    const tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.hidden = true;
    container.appendChild(tip);
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.hidden = false;
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        const cw = container.clientWidth;
        tip.style.left = `${Math.max(4, Math.min(cw - w - 4, x + 12))}px`;
        tip.style.top = `${Math.max(4, y - h - 10)}px`;
      },
      hide() {
        tip.hidden = true;
      },
    };
  }
  const swatchRow = (color, name, value) => `<div class="row"><i style="background:${color}"></i><span>${name}</span><b>${value}</b></div>`;

  // ---------- Line chart over the day ----------
  // opts: { labels: [x label per point], series: [{name, color, values (null = no data)}], format(v), bands: [{from, to}] (x indexes, shaded) }
  function line(container, opts) {
    container.innerHTML = '';
    container.classList.add('viz');
    if (opts.series.length > 1) legend(container, opts.series);
    const W = Math.max(280, container.clientWidth);
    const H = opts.height || 220;
    const m = { l: 46, r: 14, t: 10, b: 26 };
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
    const n = opts.labels.length;
    const all = opts.series.flatMap((s) => s.values.filter((v) => v !== null));
    const ticks = niceTicks(0, Math.max(1, ...all), 4);
    const yMax = ticks[ticks.length - 1];
    const x = (i) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
    const y = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
    for (const b of opts.bands || []) el('rect', { x: x(b.from), y: m.t, width: Math.max(0, x(b.to) - x(b.from)), height: H - m.t - m.b, fill: 'rgba(251,146,60,0.10)' }, svg);
    for (const t of ticks) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: GRID, 'stroke-width': 1 }, svg);
      text(svg, m.l - 6, y(t) + 4, opts.format ? opts.format(t, true) : fmtNumber(t), { 'text-anchor': 'end' });
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l - m.r) / 52))));
    for (let i = 0; i < n; i += every) text(svg, x(i), H - 8, opts.labels[i], { 'text-anchor': 'middle' });
    for (const s of opts.series) {
      let d = '';
      let open = false;
      s.values.forEach((v, i) => {
        if (v === null) {
          open = false;
          return;
        }
        d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        open = true;
      });
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    }
    // crosshair + tooltip
    const tip = tooltip(container);
    const hair = el('line', { y1: m.t, y2: H - m.b, stroke: TEXT_2, 'stroke-width': 1, visibility: 'hidden' }, svg);
    const dots = opts.series.map((s) => el('circle', { r: 4, fill: s.color, stroke: SURFACE, 'stroke-width': 2, visibility: 'hidden' }, svg));
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
      hair.setAttribute('x1', x(i));
      hair.setAttribute('x2', x(i));
      hair.setAttribute('visibility', 'visible');
      opts.series.forEach((s, k) => {
        const v = s.values[i];
        dots[k].setAttribute('visibility', v === null ? 'hidden' : 'visible');
        if (v !== null) {
          dots[k].setAttribute('cx', x(i));
          dots[k].setAttribute('cy', y(v));
        }
      });
      tip.show(
        `<div class="head">${opts.labels[i]}</div>` + opts.series.map((s) => swatchRow(s.color, s.name, s.values[i] === null ? '–' : opts.format ? opts.format(s.values[i]) : fmtNumber(s.values[i]))).join(''),
        x(i),
        Math.min(...opts.series.map((s) => (s.values[i] === null ? H : y(s.values[i])))),
      );
    });
    hit.addEventListener('pointerleave', () => {
      hair.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hide();
    });
  }

  // ---------- Grouped horizontal bars (one group per category) ----------
  // opts: { categories: [name], series: [{name, color, values: [per category]}], format(v) }
  function bars(container, opts) {
    container.innerHTML = '';
    container.classList.add('viz');
    if (opts.series.length > 1) legend(container, opts.series);
    const W = Math.max(280, container.clientWidth);
    const k = opts.series.length;
    const barH = Math.min(14, Math.max(8, 30 / k));
    const groupH = k * (barH + 2) + 16;
    const labelW = Math.min(170, W * 0.38);
    const m = { l: labelW, r: 64, t: 6, b: 6 };
    const H = m.t + m.b + groupH * opts.categories.length;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
    const max = Math.max(1, ...opts.series.flatMap((s) => s.values));
    const xw = (v) => (v / max) * (W - m.l - m.r);
    const tip = tooltip(container);
    opts.categories.forEach((cat, c) => {
      const gy = m.t + c * groupH + 8;
      text(svg, m.l - 8, gy + (k * (barH + 2)) / 2 + 3, cat, { 'text-anchor': 'end', fill: TEXT, 'font-size': 11.5 });
      el('line', { x1: m.l, x2: m.l, y1: gy - 4, y2: gy + k * (barH + 2) + 2, stroke: GRID }, svg);
      opts.series.forEach((s, j) => {
        const v = s.values[c];
        const by = gy + j * (barH + 2);
        const w = xw(v);
        // 4px rounded data end, square at the baseline
        const r = Math.min(4, w / 2, barH / 2);
        const d = `M${m.l},${by} H${m.l + w - r} Q${m.l + w},${by} ${m.l + w},${by + r} V${by + barH - r} Q${m.l + w},${by + barH} ${m.l + w - r},${by + barH} H${m.l} Z`;
        const bar = el('path', { d, fill: s.color }, svg);
        text(svg, m.l + w + 5, by + barH - 2, opts.format ? opts.format(v) : fmtNumber(v), { fill: TEXT, 'font-size': 10.5 });
        const hit = el('rect', { x: m.l, y: by - 1, width: Math.max(24, w + 50), height: barH + 2, fill: 'transparent' }, svg);
        hit.addEventListener('pointermove', (ev) => {
          const rr = svg.getBoundingClientRect();
          bar.setAttribute('opacity', 0.8);
          tip.show(`<div class="head">${cat}</div>` + swatchRow(s.color, s.name, opts.format ? opts.format(v) : fmtNumber(v)), ev.clientX - rr.left, ev.clientY - rr.top);
        });
        hit.addEventListener('pointerleave', () => {
          bar.setAttribute('opacity', 1);
          tip.hide();
        });
      });
    });
  }

  // ---------- PCA scatter with loadings (biplot) ----------
  // opts: { points: [{x, y, series, detail}], series: [{id, name, color}], loadings: [{name, x, y}], xTitle, yTitle }
  function scatter(container, opts) {
    container.innerHTML = '';
    container.classList.add('viz');
    legend(container, [...opts.series, { name: 'Promedio del escenario', color: 'transparent' }]);
    container.querySelector('.viz-legend span:last-child i').className = 'centroid';
    const W = Math.max(280, container.clientWidth);
    const H = opts.height || Math.min(420, Math.max(280, W * 0.62));
    const m = { l: 40, r: 16, t: 12, b: 34 };
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
    const xs = opts.points.map((p) => p.x);
    const ys = opts.points.map((p) => p.y);
    const pad = (a, b) => [a - (b - a) * 0.08 - 0.2, b + (b - a) * 0.08 + 0.2];
    const [x0, x1] = pad(Math.min(0, ...xs), Math.max(0, ...xs));
    const [y0, y1] = pad(Math.min(0, ...ys), Math.max(0, ...ys));
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
    // axes through the origin (the average of all blocks)
    el('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: GRID }, svg);
    el('line', { x1: X(0), x2: X(0), y1: m.t, y2: H - m.b, stroke: GRID }, svg);
    text(svg, W - m.r, H - 10, opts.xTitle, { 'text-anchor': 'end', fill: TEXT });
    const yt = text(svg, 12, m.t + 4, opts.yTitle, { fill: TEXT, transform: `rotate(-90 12 ${m.t + 4})`, 'text-anchor': 'end' });
    yt.setAttribute('dy', '0');
    // loadings: arrows from the origin, scaled to the cloud
    const reach = Math.min(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(y0), Math.abs(y1))) * 0.85;
    const defs = el('defs', {}, svg);
    const marker = el('marker', { id: 'viz-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: TEXT_2 }, marker);
    for (const l of opts.loadings) {
      const ex = X(l.x * reach);
      const ey = Y(l.y * reach);
      el('line', { x1: X(0), y1: Y(0), x2: ex, y2: ey, stroke: TEXT_2, 'stroke-width': 1.5, 'marker-end': 'url(#viz-arrow)' }, svg);
      const lx = ex + (l.x >= 0 ? 4 : -4);
      const label = text(svg, lx, ey + (l.y >= 0 ? -4 : 12), l.name, { 'text-anchor': l.x >= 0 ? 'start' : 'end', fill: TEXT, 'font-size': 11, 'font-weight': 600 });
      // keep the label inside the chart
      const tw = label.getComputedTextLength ? label.getComputedTextLength() : 0;
      if (l.x < 0 && lx - tw < 2) label.setAttribute('x', 2 + tw);
      if (l.x >= 0 && lx + tw > W - 2) label.setAttribute('x', W - 2 - tw);
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('stroke', SURFACE);
      label.setAttribute('stroke-width', 3);
    }
    // points (dots with a 2px surface ring), then each scenario's centroid
    const colorOf = Object.fromEntries(opts.series.map((s) => [s.id, s.color]));
    const nameOf = Object.fromEntries(opts.series.map((s) => [s.id, s.name]));
    for (const p of opts.points) el('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: colorOf[p.series], 'fill-opacity': 0.75, stroke: SURFACE, 'stroke-width': 1.5 }, svg);
    for (const s of opts.series) {
      const own = opts.points.filter((p) => p.series === s.id);
      if (!own.length) continue;
      const cx = own.reduce((a, p) => a + p.x, 0) / own.length;
      const cy = own.reduce((a, p) => a + p.y, 0) / own.length;
      el('circle', { cx: X(cx), cy: Y(cy), r: 8, fill: s.color, stroke: TEXT, 'stroke-width': 2 }, svg);
      const t = text(svg, X(cx) + 11, Y(cy) + 4, s.name, { fill: TEXT, 'font-size': 12, 'font-weight': 700 });
      t.setAttribute('paint-order', 'stroke');
      t.setAttribute('stroke', SURFACE);
      t.setAttribute('stroke-width', 3);
    }
    // nearest-point hover (no need to land exactly on a dot)
    const tip = tooltip(container);
    const ring = el('circle', { r: 7, fill: 'none', stroke: TEXT, 'stroke-width': 2, visibility: 'hidden' }, svg);
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top;
      let best = null;
      let bestD = 24 * 24;
      for (const p of opts.points) {
        const d = (X(p.x) - px) ** 2 + (Y(p.y) - py) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) {
        ring.setAttribute('visibility', 'hidden');
        tip.hide();
        return;
      }
      ring.setAttribute('cx', X(best.x));
      ring.setAttribute('cy', Y(best.y));
      ring.setAttribute('visibility', 'visible');
      tip.show(`<div class="head"><i class="dot" style="background:${colorOf[best.series]}"></i>${nameOf[best.series]} · ${best.label}</div>${best.detail}`, X(best.x), Y(best.y));
    });
    svg.addEventListener('pointerleave', () => {
      ring.setAttribute('visibility', 'hidden');
      tip.hide();
    });
  }

  Sim.Charts = { line, bars, scatter };
})();
