// geometry.js
// Turns the description in geometry.json into the measurements the engine uses:
// where each approach starts and ends, and where each vehicle enters and leaves the ring.
// Coordinates are in meters, roundabout center at (0, 0), y axis pointing north.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const TURN = Math.PI * 2;

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

  Sim.prepareGeometry = function (site, laneWidth, profile, params) {
    const W = laneWidth;
    const R = site.radius_m;
    const ringWidth = site.ring_lanes * W;
    const C = TURN * R;
    // Yield / stop line: just outside the ring.
    const rLine = R + ringWidth / 2 + 1.5;
    const stopDistance = (params && params.roundabout.ring_stop_distance_m) || 10;

    const approaches = site.approaches.map((a, i) => {
      const theta = (a.angle_deg * Math.PI) / 180;
      const nIn = a.lanes_in;
      const nOut = a.lanes_out;
      // Logical entry lane: the right-hand one. Motorcycles filter along the line between lanes.
      const latLane = (nIn - 0.5) * W;
      const latFilter = nIn === 1 ? 0.6 : (nIn - 1) * W;
      const latExit = (nOut - 0.5) * W;
      const entryAngle = theta + Math.asin(Math.min(0.9, latLane / R));
      const exitAngle = theta - Math.asin(Math.min(0.9, latExit / R));
      const entryArc = mod(entryAngle, TURN) * R;
      return {
        id: a.id,
        name: a.name,
        index: i,
        theta,
        nIn,
        nOut,
        latLane,
        latFilter,
        latExit,
        entryArc,
        exitArc: mod(exitAngle, TURN) * R,
        // Point on the ring where circulating vehicles stop while this approach has green.
        stopArc: mod(entryArc - stopDistance, C),
        approachLength: a.approach_length_m,
        exitLength: a.exit_length_m,
        exitCapacity: byProfile(a.exit_capacity_vph, profile),
      };
    });

    // Two approaches conflict if they are neighbors on the ring:
    // vehicles entering from one reach the entry point of the other right away.
    const sorted = [...approaches].sort((x, y) => mod(x.theta, TURN) - mod(y.theta, TURN));
    const conflicts = new Set();
    if (sorted.length > 1) {
      for (let k = 0; k < sorted.length; k++) {
        const a = sorted[k];
        const b = sorted[(k + 1) % sorted.length];
        if (a !== b) conflicts.add(conflictKey(a.id, b.id));
      }
    }

    return {
      name: site.name,
      R,
      C,
      W,
      ringWidth,
      rLine,
      approaches,
      angularOrder: sorted.map((a) => a.id),
      byId: Object.fromEntries(approaches.map((a) => [a.id, a])),
      conflicts,
      phases: site.signal_phases || null,
    };
  };

  // Automatic phases when geometry.json has none: alternate approaches together (never neighbors).
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
        if (!geo.byId[phase[a]]) problems.push(`La fase ${i + 1} menciona el acceso "${phase[a]}", que no existe.`);
        for (let b = a + 1; b < phase.length; b++) {
          if (geo.conflicts.has(conflictKey(phase[a], phase[b]))) {
            problems.push(`La fase ${i + 1} da verde a "${phase[a]}" y "${phase[b]}", que están en conflicto.`);
          }
        }
      }
    });
    return problems;
  };

  function point(theta, r, lat, angle) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return { x: r * c - lat * s, y: r * s + lat * c, angle };
  }

  // Position of the vehicle CENTER in meters, and its heading (radians).
  Sim.vehiclePosition = function (geo, v) {
    if (v.zone === 'lane' || v.zone === 'filter') {
      const a = geo.byId[v.approach];
      const lat = v.zone === 'filter' ? a.latFilter : a.latLane;
      const r = geo.rLine + a.approachLength - (v.s - v.length / 2);
      return point(a.theta, r, lat, a.theta + Math.PI);
    }
    if (v.zone === 'ring') {
      const angle = (v.arc - v.length / 2) / geo.R;
      return { x: geo.R * Math.cos(angle), y: geo.R * Math.sin(angle), angle: angle + Math.PI / 2 };
    }
    if (v.zone === 'exit') {
      const a = geo.byId[v.destination];
      const r = geo.rLine + (v.s - v.length / 2);
      return point(a.theta, r, -a.latExit, a.theta);
    }
    return null;
  };
})();
