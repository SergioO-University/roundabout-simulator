// renderer.js
// CYCLE STEP 5: drawing. Reads the engine state and paints it on the canvas.
// It never changes the state: if drawing fails, the results are not affected.
// Roads are drawn from their real OpenStreetMap shapes. With internet, an optional map
// background (CARTO Voyager tiles, © OpenStreetMap contributors © CARTO) is drawn underneath.
// Mouse wheel or pinch zooms, dragging pans. On-screen text is in Spanish.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const COLORS = {
    background: '#e9ebe4',
    context: '#cfd3c8',
    asphalt: '#4a4f57',
    border: '#b9beb2',
    island: '#9cc28a',
    laneLine: 'rgba(255,255,255,0.7)',
    bridge: 'rgba(107,114,128,0.42)',
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

  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  const lon2tile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
  const lat2tile = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
  };
  const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
  const tile2lat = (y, z) => {
    const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };

  // Older iPhones (Safari before 16.4) have no roundRect: without it nothing would be drawn.
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.max(0, Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2));
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
    };
  }

  Sim.createRenderer = function (canvas) {
    let ctx = canvas.getContext('2d');
    let layer = null;
    const lastSpeed = new WeakMap(); // previous drawn speed of each vehicle, to light up brake lights
    const view = { zoom: 1, panX: 0, panY: 0, fitFor: null, baseScale: 1, centerX: 0, centerY: 0 };
    const tiles = new Map();
    // insets: room taken by the toolbars (top) and the legend (bottom) when they float over the canvas.
    const renderer = { mapTiles: false, tilesStatus: 'off', insets: { top: 62, bottom: 46 } };

    // ---------- Pan and zoom ----------
    let drag = null;
    // One pointer (mouse or finger) pans; two fingers pinch to zoom.
    const pointers = new Map();
    let pinch = null;
    canvas.style.touchAction = 'none';
    function zoomAt(clientX, clientY, newZoom) {
      const r = canvas.getBoundingClientRect();
      const mx = clientX - r.left - r.width / 2 - view.panX;
      const my = clientY - r.top - r.height / 2 - view.panY;
      newZoom = Math.min(8, Math.max(0.4, newZoom));
      const k = newZoom / view.zoom;
      view.panX -= mx * (k - 1);
      view.panY -= my * (k - 1);
      view.zoom = newZoom;
    }
    canvas.addEventListener('pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) drag = { x: ev.clientX, y: ev.clientY, panX: view.panX, panY: view.panY };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
        drag = null;
      }
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.zoom * (dist / (pinch.dist || 1)));
      } else if (drag) {
        view.panX = drag.panX + ev.clientX - drag.x;
        view.panY = drag.panY + ev.clientY - drag.y;
      }
    });
    const release = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        drag = { x: p.x, y: p.y, panX: view.panX, panY: view.panY };
      } else drag = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, view.zoom * Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });

    renderer.resetView = function () {
      view.zoom = 1;
      view.panX = 0;
      view.panY = 0;
    };

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
      return { w: r.width, h: r.height, dpr };
    }

    // Area that must be visible when the view is reset: the ring and the modeled part of each road.
    function fitBounds(geo) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const add = (p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      };
      for (const p of geo.ringPoints) add({ x: p[0], y: p[1] });
      for (const a of geo.approaches) {
        if (a.hasEntry) add(Sim.pointAt(a.entryPath, Math.max(0, a.approachLength - 90)));
        if (a.hasExit) add(Sim.pointAt(a.exitPath, Math.min(a.exitPath.length, 60)));
      }
      return { minX, maxX, minY, maxY };
    }

    function draw(e) {
      const { w, h, dpr } = fitSize();
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, w, h);
      if (!e) return;
      const geo = e.geo;

      // The fit follows the canvas size (window resize, phone rotation); zoom and pan reset only for a new site.
      if (view.fitFor !== geo) {
        view.bounds = fitBounds(geo);
        view.fitFor = geo;
        renderer.resetView();
      }
      {
        const b = view.bounds;
        const ins = renderer.insets;
        view.baseScale = Math.min((w - 40) / (b.maxX - b.minX), (h - 24 - (ins.top + ins.bottom) / 2) / (b.maxY - b.minY));
        view.centerX = (b.minX + b.maxX) / 2;
        view.centerY = (b.minY + b.maxY) / 2;
      }
      const scale = view.baseScale * view.zoom;
      const cx = w / 2 + view.panX;
      const cy = h / 2 + view.panY;
      const X = (x) => cx + (x - view.centerX) * scale;
      const Y = (y) => cy - (y - view.centerY) * scale;
      const W = geo.W;

      // ---------- Map background ----------
      const showTiles = renderer.mapTiles && geo.center;
      if (showTiles) drawTiles(geo, w, h, dpr, scale, X, Y);
      else renderer.tilesStatus = 'off';

      // ---------- Context roads (not simulated) ----------
      if (!showTiles) {
        for (const c of geo.context) {
          if (c.kind === 'bridge') continue;
          strokePath(c.path, c.lanes * W, COLORS.context);
        }
      }

      // ---------- Simulated roads ----------
      // Over the map, roads are drawn opaque on a separate layer and blended once,
      // so overlapping road pieces do not get darker where they join.
      const asphalt = COLORS.asphalt;
      const mainCtx = ctx;
      if (showTiles) {
        if (!layer || layer.width !== canvas.width || layer.height !== canvas.height) {
          layer = document.createElement('canvas');
          layer.width = canvas.width;
          layer.height = canvas.height;
        }
        ctx = layer.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, layer.width, layer.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (!showTiles) {
        for (const a of geo.approaches) {
          if (a.hasEntry) strokePath(a.entryPath.pts, a.nIn * W + 2, COLORS.border);
          if (a.hasExit) strokePath(a.exitPath.pts, a.nOut * W + 2, COLORS.border);
        }
        strokePath(geo.ring.pts, geo.ringWidth + 2, COLORS.border);
      }
      fillPolygon(geo.ringPoints, COLORS.island);
      for (const a of geo.approaches) {
        if (a.hasEntry) strokePath(a.entryPath.pts, a.nIn * W, asphalt);
        if (a.hasExit) strokePath(a.exitPath.pts, a.nOut * W, asphalt);
      }
      strokePath(geo.ring.pts, geo.ringWidth, asphalt);

      if (showTiles) {
        ctx = mainCtx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.78;
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      }

      // Lane lines
      if (Math.round(geo.ringWidth / W) >= 2) strokePath(geo.ring.pts, 1, COLORS.laneLine, [2 * scale, 2 * scale]);
      for (const a of geo.approaches) {
        if (a.hasEntry && a.nIn >= 2) strokePath(a.entryPath.pts, 1, COLORS.laneLine, [3 * scale, 3 * scale]);
        if (a.hasExit && a.nOut >= 2) strokePath(a.exitPath.pts, 1, COLORS.laneLine, [3 * scale, 3 * scale]);
      }

      // ---------- Stop lines and signals ----------
      for (const a of geo.approaches) {
        if (!a.hasEntry) continue;
        const signal = e.control.signalFor(a.id);
        const half = (a.nIn * W) / 2;
        const p1 = Sim.pointAt(a.entryPath, a.approachLength, -half + 0.2);
        const p2 = Sim.pointAt(a.entryPath, a.approachLength, half - 0.2);
        ctx.strokeStyle = signal === null ? '#ffffff' : COLORS[signal];
        ctx.lineWidth = Math.max(2, 0.6 * scale);
        ctx.setLineDash(signal === null ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(X(p1.x), Y(p1.y));
        ctx.lineTo(X(p2.x), Y(p2.y));
        ctx.stroke();
        ctx.setLineDash([]);
        if (signal !== null) {
          const s = Sim.pointAt(a.entryPath, a.approachLength - 2, half + 2.5);
          dot(X(s.x), Y(s.y), 7, '#111');
          dot(X(s.x), Y(s.y), 5, COLORS[signal]);
        }
      }

      // ---------- Vehicles ----------
      // At the default zoom vehicles are only a few pixels long, so they are drawn slightly larger
      // than real size (never more than the free space a queue leaves between them).
      const now = performance.now() / 1000;
      const boost = scale < 6 ? Math.min(1.35, 1 + (6 - scale) * 0.08) : 1;
      const blink = Math.floor(now * 2.5) % 2 === 0;
      const alerts = [];
      for (const v of e.vehicles) {
        if (v.zone === 'pending' || v.zone === 'gone') continue;
        const p = Sim.vehiclePosition(geo, v);
        if (!p) continue;
        const prev = lastSpeed.get(v);
        lastSpeed.set(v, v.speed);
        const braking = v.speed < 0.3 || (prev !== undefined && v.speed < prev - 0.02);
        const blinkRight = blink && v.zone === 'ring' && v.remaining < 30;
        const motoBoost = v.type === 'motorcycle' && scale < 6 ? 1.3 : 1; // motorcycles are tiny at the default zoom
        const L = Math.max(5, v.length * scale * boost * motoBoost);
        const Wd = Math.max(3, v.props.width * scale * boost * (v.type === 'motorcycle' ? 1.25 : 1.1));
        const sx = X(p.x);
        const sy = Y(p.y);
        if (v.blocking) {
          const pulse = (Math.sin(now * 6) + 1) / 2;
          const rad = Math.max(L, Wd) * 0.7 + 4 + pulse * 5;
          ctx.fillStyle = `rgba(239,68,68,${0.18 + pulse * 0.15})`;
          ctx.beginPath();
          ctx.arc(sx, sy, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = COLORS.blocking;
          ctx.lineWidth = 2;
          ctx.stroke();
          alerts.push([sx, sy - rad - 9]);
        }
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-p.angle);
        Sim.drawVehicleIcon(ctx, v, L, Wd, { braking, blinkRight });
        ctx.restore();
      }
      // "!" badges above stuck vehicles
      for (const [ax, ay] of alerts) {
        ctx.fillStyle = COLORS.blocking;
        ctx.beginPath();
        ctx.arc(ax, ay, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', ax, ay + 0.5);
      }

      // ---------- Bridges on top (the Troncal passes over La Lucha) ----------
      for (const c of geo.context) {
        if (c.kind !== 'bridge') continue;
        strokePath(c.path, c.lanes * W + 1, 'rgba(255,255,255,0.35)');
        strokePath(c.path, c.lanes * W, COLORS.bridge);
      }

      // ---------- Labels ----------
      const small = w < 560; // phones: smaller labels so road names do not cover the roundabout
      ctx.font = small ? '600 10.5px system-ui, sans-serif' : '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (const a of geo.approaches) {
        if (a.hasEntry) {
          const p = Sim.pointAt(a.entryPath, Math.max(0, a.approachLength - 75), (a.nIn * W) / 2 + 6);
          const queue = e.metrics.queueNow[a.id];
          const outside = e.approaches[a.id].pending.length;
          // name and queue move together, kept below the toolbars and above the legend
          const yBase = Math.max(renderer.insets.top + 12, Math.min(h - renderer.insets.bottom - 12, Y(p.y)));
          label(a.name, X(p.x), yBase - (small ? 9 : 11), 'rgba(255,255,255,0.93)', COLORS.text);
          const text = outside ? `cola ${queue} (+${outside} fuera)` : `cola ${queue}`;
          label(text, X(p.x), yBase + (small ? 9 : 11), queue > 15 ? '#fee2e2' : 'rgba(255,255,255,0.85)', queue > 15 ? '#991b1b' : COLORS.text);
        } else if (a.hasExit) {
          const p = Sim.pointAt(a.exitPath, Math.min(a.exitPath.length, 45), (a.nOut * W) / 2 + 5);
          label(`${a.name} · solo salida`, X(p.x), Y(p.y), 'rgba(255,255,255,0.93)', COLORS.text);
        }
      }

      // ---------- Overlays ----------
      ctx.font = '600 13px system-ui, sans-serif';
      const blocking = e.ring.filter((v) => v.blocking).length;
      if (blocking) label(`⚠ ${blocking} vehículo(s) atravesado(s) bloqueando el anillo`, 12, h - 44, '#fee2e2', '#991b1b', 'left');

      // Scale bar
      const meters = scale > 4 ? 20 : 50;
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, h - 16);
      ctx.lineTo(12 + meters * scale, h - 16);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${meters} m`, 16 + meters * scale, h - 16);
      if (showTiles) {
        const att = '© OpenStreetMap contributors © CARTO';
        const ax = 70 + meters * scale;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(ax - 4, h - 24, ctx.measureText(att).width + 8, 16);
        ctx.fillStyle = COLORS.text;
        ctx.fillText(att, ax, h - 16);
      }

      // ---------- Helpers ----------
      function polyPath(pts, closed) {
        ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
        if (closed) ctx.closePath();
      }
      function strokePath(pts, widthM, color, dashes) {
        ctx.strokeStyle = color;
        ctx.lineWidth = dashes ? widthM : Math.max(1, widthM * scale);
        ctx.lineJoin = 'round';
        ctx.lineCap = dashes ? 'butt' : 'round';
        ctx.setLineDash(dashes || []);
        ctx.beginPath();
        polyPath(pts, false);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      function fillPolygon(pts, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        polyPath(pts, true);
        ctx.fill();
      }
      function dot(x, y, r, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Labels are kept inside the canvas so road names are never cut off at the edges.
      function label(text, x, y, bg, color, align = 'center') {
        const pad = small ? 8 : 12;
        const width = ctx.measureText(text).width + pad;
        let x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
        x0 = Math.max(6, Math.min(w - width - 6, x0));
        const yc = align === 'center' ? Math.max(renderer.insets.top, Math.min(h - renderer.insets.bottom, y)) : y; // never under the toolbars
        ctx.fillStyle = bg;
        ctx.beginPath();
        const lh = small ? 17 : 20;
        ctx.roundRect(x0, yc - lh / 2, width, lh, 6);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(text, x0 + pad / 2, yc + 0.5);
      }
    }

    // Draws map tiles aligned with the local meter coordinates (same projection as tools/build-geometry.js).
    function drawTiles(geo, w, h, dpr, scale, X, Y) {
      const { lat: lat0, lon: lon0 } = geo.center;
      const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
      const ky = 110574;
      const z = Math.max(14, Math.min(19, Math.ceil(Math.log2(156543.03 * Math.cos((lat0 * Math.PI) / 180) * scale * Math.min(dpr, 2)))));
      // visible area in meters -> lat/lon -> tile range
      const xm = (px) => view.centerX + (px - w / 2 - view.panX) / scale;
      const ym = (py) => view.centerY - (py - h / 2 - view.panY) / scale;
      const lonL = lon0 + xm(0) / kx;
      const lonR = lon0 + xm(w) / kx;
      const latT = lat0 + ym(0) / ky;
      const latB = lat0 + ym(h) / ky;
      const x0 = Math.floor(lon2tile(lonL, z));
      const x1 = Math.floor(lon2tile(lonR, z));
      const y0 = Math.floor(lat2tile(latT, z));
      const y1 = Math.floor(lat2tile(latB, z));
      let loaded = 0;
      let failed = 0;
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          const key = `${z}/${tx}/${ty}`;
          let t = tiles.get(key);
          if (!t) {
            const img = new Image();
            t = { img, ok: false, failed: false };
            img.onload = () => (t.ok = true);
            img.onerror = () => (t.failed = true);
            img.src = TILE_URL.replace('{s}', 'abcd'[(tx + ty) % 4]).replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
            tiles.set(key, t);
          }
          if (t.failed) failed++;
          if (!t.ok) continue;
          loaded++;
          const left = X((tile2lon(tx, z) - lon0) * kx);
          const right = X((tile2lon(tx + 1, z) - lon0) * kx);
          const top = Y((tile2lat(ty, z) - lat0) * ky);
          const bottom = Y((tile2lat(ty + 1, z) - lat0) * ky);
          ctx.drawImage(t.img, left, top, right - left + 0.5, bottom - top + 0.5);
        }
      }
      renderer.tilesStatus = loaded ? 'ok' : failed ? 'failed' : 'loading';
    }

    renderer.draw = draw;
    return renderer;
  };
})();
