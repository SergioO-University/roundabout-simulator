// renderer.js
// CYCLE STEP 5: drawing. Reads the engine state and paints it on the canvas.
// It never changes the state: if drawing fails, the results are not affected.
// On-screen text is in Spanish (it is what the evaluator and the team see).
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const COLORS = {
    background: '#dfe3d6',
    asphalt: '#4a4f57',
    sidewalk: '#c9cdc0',
    island: '#7fa66a',
    centerLine: '#f2c94c',
    laneLine: 'rgba(255,255,255,0.75)',
    motorcycle: '#f59e0b',
    car: '#3b82f6',
    bus: '#10b981',
    blocking: '#ef4444',
    green: '#22c55e',
    yellow: '#facc15',
    red: '#ef4444',
    text: '#1f2933',
  };
  Sim.COLORS = COLORS;

  Sim.createRenderer = function (canvas) {
    const ctx = canvas.getContext('2d');

    function fitSize() {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: r.width, h: r.height };
    }

    function draw(e) {
      const { w, h } = fitSize();
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, w, h);
      if (!e) return;
      const geo = e.geo;
      // The view shows about 65 m of each approach; longer queues show up in the label count.
      const maxLength = Math.max(...geo.approaches.map((a) => Math.max(a.approachLength, a.exitLength)));
      const visible = Math.min(maxLength, 65);
      const extent = geo.rLine + visible + 4;
      const scale = Math.min(w, h) / (2 * extent);
      const cx = w / 2;
      const cy = h / 2;
      const X = (x) => cx + x * scale;
      const Y = (y) => cy - y * scale;

      // Point at distance r from the center along the approach axis, shifted 'lat' meters toward the inbound side.
      const P = (a, r, lat) => {
        const c = Math.cos(a.theta);
        const s = Math.sin(a.theta);
        return [X(r * c - lat * s), Y(r * s + lat * c)];
      };
      const rEnd = (a) => geo.rLine + Math.max(a.approachLength, a.exitLength);

      // Approach roads
      for (const a of geo.approaches) {
        const W = geo.W;
        const r0 = geo.R * 0.6;
        const r1 = rEnd(a);
        const left = a.nIn * W;
        const right = -a.nOut * W;
        ctx.fillStyle = COLORS.sidewalk;
        polygon([P(a, r0, left + 1.5), P(a, r1, left + 1.5), P(a, r1, right - 1.5), P(a, r0, right - 1.5)]);
        ctx.fillStyle = COLORS.asphalt;
        polygon([P(a, r0, left), P(a, r1, left), P(a, r1, right), P(a, r0, right)]);
      }

      // Ring and central island
      const rOuter = geo.R + geo.ringWidth / 2;
      const rIsland = Math.max(3, geo.R - geo.ringWidth / 2);
      circle(0, 0, rOuter + 1.5, COLORS.sidewalk);
      circle(0, 0, rOuter, COLORS.asphalt);
      circle(0, 0, rIsland, COLORS.island);
      ctx.setLineDash([2 * scale, 2 * scale]);
      ctx.strokeStyle = COLORS.laneLine;
      ctx.lineWidth = 1;
      for (let k = 1; k < Math.round(geo.ringWidth / geo.W); k++) {
        ctx.beginPath();
        ctx.arc(X(0), Y(0), (rIsland + k * geo.W) * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Road markings, stop lines and signals
      for (const a of geo.approaches) {
        const r0 = rOuter + 1.5;
        const r1 = rEnd(a);
        line(P(a, r0, 0), P(a, r1, 0), COLORS.centerLine, 2, []);
        for (let k = 1; k < a.nIn; k++) line(P(a, r0, k * geo.W), P(a, r1, k * geo.W), COLORS.laneLine, 1, [3 * scale, 3 * scale]);
        for (let k = 1; k < a.nOut; k++) line(P(a, r0, -k * geo.W), P(a, r1, -k * geo.W), COLORS.laneLine, 1, [3 * scale, 3 * scale]);

        const signal = e.control.signalFor(a.id);
        const lineColor = signal === null ? '#ffffff' : COLORS[signal];
        line(P(a, geo.rLine, 0.2), P(a, geo.rLine, a.nIn * geo.W - 0.2), lineColor, 3, signal === null ? [4, 3] : []);
        if (signal !== null) {
          const [sx, sy] = P(a, geo.rLine + 2, a.nIn * geo.W + 2.6);
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(sx, sy, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLORS[signal];
          ctx.beginPath();
          ctx.arc(sx, sy, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Vehicles
      for (const v of e.vehicles) {
        if (v.zone === 'pending' || v.zone === 'gone') continue;
        const p = Sim.vehiclePosition(geo, v);
        if (!p) continue;
        ctx.save();
        ctx.translate(X(p.x), Y(p.y));
        ctx.rotate(-p.angle);
        const l = v.length * scale;
        const wd = Math.max(2, v.props.width * scale);
        ctx.fillStyle = COLORS[v.type];
        ctx.fillRect(-l / 2, -wd / 2, l, wd);
        if (v.blocking) {
          ctx.strokeStyle = COLORS.blocking;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(-l / 2 - 1.5, -wd / 2 - 1.5, l + 3, wd + 3);
        }
        ctx.restore();
      }

      // Road names and queue per approach
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const a of geo.approaches) {
        const rLabel = Math.min(rEnd(a), extent) - 8;
        const [tx, ty] = P(a, rLabel, 0);
        const queue = e.metrics.queueNow[a.id];
        const outside = e.approaches[a.id].pending.length;
        label(a.name, tx, ty, 'rgba(255,255,255,0.92)', COLORS.text);
        const [qx, qy] = P(a, rLabel - 10, a.nIn * geo.W + 7);
        const text = outside ? `cola ${queue} (+${outside} fuera del tramo)` : `cola ${queue}`;
        label(text, qx, qy, queue > 15 ? '#fee2e2' : 'rgba(255,255,255,0.85)', queue > 15 ? '#991b1b' : COLORS.text);
      }

      // Header labels
      ctx.textAlign = 'left';
      ctx.font = '600 13px system-ui, sans-serif';
      const min = Math.floor(e.t / 60);
      const sec = Math.floor(e.t % 60);
      label(`${Sim.MODES[e.cfg.mode]}  ·  t = ${min}:${String(sec).padStart(2, '0')}`, 12, 18, 'rgba(255,255,255,0.92)', COLORS.text, 'left');
      const blocking = e.ring.filter((v) => v.blocking).length;
      if (blocking) label(`⚠ ${blocking} vehículo(s) atravesado(s) bloqueando el anillo`, 12, h - 42, '#fee2e2', '#991b1b', 'left');
      if (e.cfg.mode !== 'current') {
        const left = Math.max(0, e.control.currentPhaseDuration() - e.control.time);
        const PHASE_NAMES = { green: 'verde', yellow: 'amarillo', all_red: e.cfg.mode === 'officer' ? 'transición' : 'todo rojo' };
        const who = e.control.phase === 'all_red' ? '' : ` → ${e.control.phases[e.control.index].join(' + ')}`;
        label(`${PHASE_NAMES[e.control.phase]}${who} · ${left.toFixed(0)} s`, w - 12, 18, 'rgba(255,255,255,0.92)', COLORS.text, 'right');
      }

      // Scale bar
      const meters = 20;
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, h - 14);
      ctx.lineTo(12 + meters * scale, h - 14);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${meters} m`, 16 + meters * scale, h - 14);

      function polygon(pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
      }
      function circle(x, y, r, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(x), Y(y), r * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      function line(p1, p2, color, width, dashes) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dashes);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      function label(text, x, y, bg, color, align = 'center') {
        ctx.textAlign = align;
        const width = ctx.measureText(text).width + 12;
        const x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(x0, y - 10, width, 20, 6);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillText(text, align === 'center' ? x : align === 'right' ? x - 6 : x + 6, y + 0.5);
      }
    }

    return { draw };
  };
})();
