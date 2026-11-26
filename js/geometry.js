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
  Sim.capacityFor = (value, profile) => byProfile(value, profile);
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

  // Two-way streets: in OpenStreetMap the entry and the exit of an arm often share the same centerline,
  // so vehicles in opposite directions would be drawn on top of each other. Each direction is pushed
  // to its own right-hand side (right-hand traffic) wherever the two paths are closer than their
  // combined half widths; where they are already apart nothing moves.
  function closestOn(pts, p) {
    let best = { d: Infinity, x: 0, y: 0 };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const x = a[0] + dx * t;
      const y = a[1] + dy * t;
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d < best.d) best = { d, x, y };
    }
    return best;
  }
  function resample(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  }
  // Moves the path `pts` (half width `half`) away from `other` (half width `otherHalf`).
  function separateFrom(pts, other, half, otherHalf) {
    const P = resample(pts, 2);
    const need = half + otherHalf;
    const shift = P.map((p) => {
      const c = closestOn(other, p);
      return Math.max(0, need - c.d) * (half / need);
    });
    // Smooth the shift so the road bends gently in and out of the shared stretch.
    const smooth = shift.map((_, i) => {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(shift.length - 1, i + 3); k++) {
        sum += shift[k];
        n++;
      }
      return sum / n;
    });
    if (!smooth.some((x) => x > 0.05)) return pts;
    return P.map((p, i) => {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // Right-hand normal (same convention as pointAt with a positive lateral offset).
      return [p[0] + Math.sin(ang) * smooth[i], p[1] - Math.cos(ang) * smooth[i]];
    });
  }

  Sim.prepareGeometry = function (site, laneWidth, profile, params) {
    const W = laneWidth;
    // Drawn lane width. At the usual zoom the vehicle icons are drawn up to 35 % larger than real
    // (or they would be a few pixels long), so roads are drawn wider in the same proportion; otherwise
    // two vehicles passing side by side would look like they touch. Lateral positions only affect the
    // drawing: the simulation runs along the centerlines.
    const DW = W * 1.35;
    const ring = Sim.makePolyline(site.ring, true);
    const C = ring.length;
    const ringWidth = site.ring_lanes * DW;
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
        exitCapacityByProfile: a.exit_capacity_vph ?? null,
      };
      let entryPts = a.entry ? a.entry.path : null;
      let exitPts = a.exit ? a.exit.path : null;
      if (entryPts && exitPts) {
        const hIn = (a.entry.lanes * DW) / 2;
        const hOut = (a.exit.lanes * DW) / 2;
        entryPts = separateFrom(a.entry.path, a.exit.path, hIn, hOut);
        exitPts = separateFrom(a.exit.path, a.entry.path, hOut, hIn);
      }
      if (a.entry) {
        res.entryPath = Sim.makePolyline(entryPts, false);
        // Yield line: where the whole width of the entry is clear of the ring roadway. Entries that meet
        // the ring at a shallow angle (like the Conector) need it farther back, or the vehicles waiting at
        // the line would sit on top of the ones circulating.
        const halfIn = (res.nIn * DW) / 2;
        const clearAt = (s) =>
          [-halfIn, 0, halfIn].every((lat) => {
            const p = Sim.pointAt(res.entryPath, s, lat);
            return closestOn(ring.pts, [p.x, p.y]).d >= ringWidth / 2 + 0.5;
          });
        let back = 0;
        while (back < 30 && !clearAt(res.entryPath.length - lineOffset - back)) back += 0.5;
        res.approachLength = Math.max(15, res.entryPath.length - lineOffset - back);
        const linePt = Sim.pointAt(res.entryPath, res.approachLength, 0);
        res.entryArc = projectOnPolyline(ring, [linePt.x, linePt.y]);
        res.stopArc = mod(res.entryArc - stopDistance, C);
        // One-lane approach: the queue on the lane and filtering motorcycles on its left edge.
        // Two-lane approach: right line on the right lane and left line on the left lane, side by side.
        res.latLane = ((res.nIn - 1) * DW) / 2;
        res.latFilter = res.nIn >= 2 ? res.latLane - DW : res.latLane - DW * 0.55;
        // Drawing only: where the entry meets the ring at an angle, a lane drawn to one side reaches the
        // ring roadway before the yield line. Each lane is drawn this many meters back so a waiting
        // vehicle never sits on top of the vehicles circulating in front of it.
        const clearOfRing = (lat) => {
          const end = res.approachLength;
          for (let back = 0; back < 15; back += 0.5) {
            const p = Sim.pointAt(res.entryPath, end - back, lat);
            if (closestOn(ring.pts, [p.x, p.y]).d >= ringWidth / 2 + 0.6) return back;
          }
          return 15;
        };
        res.setbackLane = clearOfRing(res.latLane);
        res.setbackFilter = clearOfRing(res.latFilter);
      }
      if (a.exit) {
        res.exitPath = Sim.makePolyline(exitPts, false);
        res.exitLength = Math.max(15, res.exitPath.length - lineOffset);
        res.exitArc = projectOnPolyline(ring, exitPts[0]);
        res.latExit = ((res.nOut - 1) * DW) / 2;
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

    // Lateral offset towards the outer edge of the ring (where a motorcycle rides next to a car).
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ring.pts) {
      cx += x;
      cy += y;
    }
    cx /= ring.pts.length;
    cy /= ring.pts.length;
    const p0 = Sim.pointAt(ring, 0, 0);
    const p1 = Sim.pointAt(ring, 0, 1);
    const outer = Math.hypot(p1.x - cx, p1.y - cy) > Math.hypot(p0.x - cx, p0.y - cy) ? 1 : -1;
    // Two-lane ring: the motorcycle rides in the outer lane; one lane: towards the outer edge.
    const ringOuterLat = outer * (site.ring_lanes >= 2 ? DW * 0.5 : DW * 0.3);

    return {
      name: site.name,
      center: site.center || null,
      ring,
      ringPoints: site.ring,
      C,
      W,
      drawW: DW,
      ringLanes: site.ring_lanes,
      ringWidth,
      ringOuterLat,
      lineOffset,
      laneDrawWidth: DW,
      approaches,
      entryIds: entries.map((a) => a.id),
      exitIds: approaches.filter((a) => a.hasExit).map((a) => a.id),
      angularOrder: entries.map((a) => a.id),
      byId: Object.fromEntries(approaches.map((a) => [a.id, a])),
      conflicts,
      phases: site.signal_phases || null,
      context: site.context || [],
      // Slip roads: from one approach straight to one exit, without entering the ring.
      bypasses: (site.bypasses || []).map((b) => {
        // Drawn beside the entry it branches from (to its right), not on top of the vehicles queuing there.
        const from = approaches.find((a) => a.id === b.from);
        let pts = b.path;
        if (from && from.entryPath) pts = separateFrom(b.path, from.entryPath.pts, ((b.lanes || 1) * DW) / 2 + (from.nIn * DW) / 2 + 0.3, 0);
        const path = Sim.makePolyline(pts, false);
        return { id: b.id, name: b.name, from: b.from, to: b.to, lanes: b.lanes, path, length: path.length };
      }),
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
  // Lateral position on the ring (drawing only): the centre of its ring lane (outer or inner), plus a small
  // offset when a motorcycle rides next to a car. Near its exit an inner-lane vehicle is drawn moving out.
  Sim.ringLane = function (geo, v) {
    const offset = v.ringLat || 0;
    if (geo.ringLanes < 2) return offset;
    const inner = (v.ringLane || 0) === 1 && v.remaining > 10;
    return (inner ? -geo.ringOuterLat : geo.ringOuterLat) + offset;
  };

  // lateral (optional): override the ring lateral position (the renderer passes a smoothed one).
  Sim.vehiclePosition = function (geo, v, lateral) {
    if (v.zone === 'split') {
      // motorcycles riding between the two lanes of a two-lane approach
      const a = geo.byId[v.approach];
      const s = v.s - v.length / 2 - Math.max(a.setbackLane, a.setbackFilter);
      return Sim.pointAt(a.entryPath, Math.max(0, s), (a.latLane + a.latFilter) / 2);
    }
    if (v.zone === 'lane' || v.zone === 'filter') {
      const a = geo.byId[v.approach];
      const filter = v.zone === 'filter';
      const s = v.s - v.length / 2 - (filter ? a.setbackFilter : a.setbackLane) || 0;
      return Sim.pointAt(a.entryPath, Math.max(0, s), filter ? a.latFilter : a.latLane);
    }
    if (v.zone === 'ring') {
      return Sim.pointAt(geo.ring, v.arc - v.length / 2, lateral ?? Sim.ringLane(geo, v));
    }
    if (v.zone === 'exit') {
      const a = geo.byId[v.destination];
      return Sim.pointAt(a.exitPath, geo.lineOffset + v.s - v.length / 2, a.latExit - (v.exitLane || 0) * geo.laneDrawWidth);
    }
    if (v.zone === 'bypass') {
      const b = geo.bypasses.find((x) => x.id === v.bypass);
      return Sim.pointAt(b.path, v.s - v.length / 2, 0);
    }
    return null;
  };
})();
