// geometry.js
// Turns geometry.json (real shapes taken from OpenStreetMap) into what the engine uses:
// the ring as a closed polyline, and each approach's entry and exit paths as open polylines.
// The engine only needs 1-D positions (meters along a path); this file maps them to x/y for drawing.
// Coordinates are in meters around the ring centroid: x = east, y = north.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  function mod(a, m) {
    return ((a % m) + m) % m;
  }
  Sim.mod = mod;

  function conflictKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }
  Sim.conflictKey = conflictKey;

  // Resolves a value that can be a number or an object {peak, offpeak}.
  function byProfile(value, profile) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    return value[profile] ?? value.offpeak ?? null;
  }

  // ---------- Polylines ----------
  Sim.makePolyline = function (points, closed) {
    const pts = closed ? [...points, points[0]] : points;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, length: cum[cum.length - 1], closed: !!closed };
  };

  // Point and heading at distance s along the polyline. Open polylines extend straight past their ends.
  Sim.pointAt = function (pl, s, lateral = 0) {
    const { pts, cum, length } = pl;
    if (pl.closed) s = mod(s, length);
    let i = 1;
    if (s <= 0) i = 1;
    else if (s >= length) i = pts.length - 1;
    else {
      let lo = 1;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < s) lo = mid + 1;
        else hi = mid;
      }
      i = lo;
    }
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    // lateral > 0 shifts to the right of the travel direction
    return { x: x + Math.sin(angle) * lateral, y: y - Math.cos(angle) * lateral, angle };
  };

  // Distance along a closed polyline of the point closest to p.
  function projectOnPolyline(pl, p) {
    let best = Infinity;
    let bestS = 0;
    for (let i = 1; i < pl.pts.length; i++) {
      const a = pl.pts[i - 1];
      const b = pl.pts[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
      if (d < best) {
        best = d;
        bestS = pl.cum[i - 1] + Math.sqrt(len2) * t;
      }
    }
    return bestS;
  }

  Sim.prepareGeometry = function (site, laneWidth, profile, params) {
    const W = laneWidth;
    const ring = Sim.makePolyline(site.ring, true);
    const C = ring.length;
    const ringWidth = site.ring_lanes * W;
    // The stop / yield line sits just outside the ring roadway.
    const lineOffset = ringWidth / 2 + 1;
    const stopDistance = (params && params.roundabout.ring_stop_distance_m) || 10;

    const approaches = site.approaches.map((a, i) => {
      const res = {
        id: a.id,
        name: a.name,
        index: i,
        hasEntry: !!a.entry,
        hasExit: !!a.exit,
        nIn: a.entry ? a.entry.lanes : 0,
        nOut: a.exit ? a.exit.lanes : 0,
        exitCapacity: byProfile(a.exit_capacity_vph, profile),
      };
      if (a.entry) {
        res.entryPath = Sim.makePolyline(a.entry.path, false);
        res.approachLength = Math.max(15, res.entryPath.length - lineOffset);
        res.entryArc = projectOnPolyline(ring, a.entry.path[a.entry.path.length - 1]);
        res.stopArc = mod(res.entryArc - stopDistance, C);
        // Logical lane drawn on the right-hand lane; filtering motorcycles ride on its left edge.
        res.latLane = ((res.nIn - 1) * W) / 2;
        res.latFilter = res.latLane - W * 0.55;
      }
      if (a.exit) {
        res.exitPath = Sim.makePolyline(a.exit.path, false);
        res.exitLength = Math.max(15, res.exitPath.length - lineOffset);
        res.exitArc = projectOnPolyline(ring, a.exit.path[0]);
        res.latExit = ((res.nOut - 1) * W) / 2;
      }
      return res;
    });

    // Entries in the order a vehicle driving around the ring meets them.
    const entries = approaches.filter((a) => a.hasEntry).sort((x, y) => x.entryArc - y.entryArc);
    // Two entries conflict if they are neighbors on the ring:
    // vehicles entering from one reach the entry point of the other right away.
    const conflicts = new Set();
    if (entries.length > 1) {
      for (let k = 0; k < entries.length; k++) {
        const a = entries[k];
        const b = entries[(k + 1) % entries.length];
        if (a !== b) conflicts.add(conflictKey(a.id, b.id));
      }
    }

    return {
      name: site.name,
      center: site.center || null,
      ring,
      ringPoints: site.ring,
      C,
      W,
      ringWidth,
      lineOffset,
      approaches,
      entryIds: entries.map((a) => a.id),
      exitIds: approaches.filter((a) => a.hasExit).map((a) => a.id),
      angularOrder: entries.map((a) => a.id),
      byId: Object.fromEntries(approaches.map((a) => [a.id, a])),
      conflicts,
      phases: site.signal_phases || null,
      context: site.context || [],
    };
  };

  // Automatic phases when geometry.json has none: alternate entries together (never neighbors).
  Sim.automaticPhases = function (geo) {
    const ids = geo.angularOrder;
    if (ids.length >= 4 && ids.length % 2 === 0) {
      return [ids.filter((_, i) => i % 2 === 0), ids.filter((_, i) => i % 2 === 1)];
    }
    return ids.map((id) => [id]);
  };

  // Checks that no phase gives green to two conflicting approaches. Returns the list of problems (in Spanish, shown in the UI).
  Sim.validatePhases = function (geo, phases) {
    const problems = [];
    phases.forEach((phase, i) => {
      for (let a = 0; a < phase.length; a++) {
        const ap = geo.byId[phase[a]];
        if (!ap || !ap.hasEntry) problems.push(`La fase ${i + 1} menciona el acceso "${phase[a]}", que no existe o no tiene entrada.`);
        for (let b = a + 1; b < phase.length; b++) {
          if (geo.conflicts.has(conflictKey(phase[a], phase[b]))) {
            problems.push(`La fase ${i + 1} da verde a "${phase[a]}" y "${phase[b]}", que están en conflicto.`);
          }
        }
      }
    });
    return problems;
  };

  // Position of the vehicle CENTER in meters, and its heading (radians).
  Sim.vehiclePosition = function (geo, v) {
    if (v.zone === 'lane' || v.zone === 'filter') {
      const a = geo.byId[v.approach];
      return Sim.pointAt(a.entryPath, v.s - v.length / 2, v.zone === 'filter' ? a.latFilter : a.latLane);
    }
    if (v.zone === 'ring') {
      return Sim.pointAt(geo.ring, v.arc - v.length / 2, 0);
    }
    if (v.zone === 'exit') {
      const a = geo.byId[v.destination];
      return Sim.pointAt(a.exitPath, geo.lineOffset + v.s - v.length / 2, a.latExit);
    }
    return null;
  };
})();
