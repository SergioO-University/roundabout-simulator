// arrivals.js
// Generates the vehicles arriving at each approach from counts.json.
// Uses a SEEDED random number generator (mulberry32): with the same seed, exactly the same
// vehicles arrive at exactly the same instants, so comparing two modes is fair.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const TYPES = ['motorcycle', 'car', 'bus'];
  const BLOCK_S = 900; // counts are 15-minute counts
  Sim.TYPES = TYPES;
  Sim.BLOCK_S = BLOCK_S;

  // mulberry32 pseudo-random generator: same seed -> same sequence of numbers between 0 and 1.
  Sim.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Picks the exit the vehicle will take according to the 'turning' shares.
  // ids = approaches that have an exit.
  function pickDestination(turning, origin, ids, u) {
    const table = turning && turning[origin];
    if (!table) {
      const others = ids.filter((i) => i !== origin);
      const pool = others.length ? others : ids;
      return pool[Math.min(pool.length - 1, Math.floor(u * pool.length))];
    }
    let total = 0;
    for (const id of ids) total += table[id] || 0;
    let cumulative = 0;
    let last = ids[0];
    for (const id of ids) {
      const p = (table[id] || 0) / total;
      if (p <= 0) continue;
      last = id;
      cumulative += p;
      if (u < cumulative) return id;
    }
    return last;
  }

  // Sorted list of arrivals for the whole run.
  // "exact_count" mode: in each 15-min block exactly the counted vehicles arrive, at random instants.
  // "poisson" mode: random arrivals at the counted rate (the total varies a little).
  Sim.generateArrivals = function ({ profile, turning, geo, duration, seed, mode }) {
    const rnd = Sim.mulberry32(seed);
    const entryIds = geo.entryIds;
    const exitIds = geo.exitIds;
    const list = [];
    const blocks = Math.ceil(duration / BLOCK_S);

    function make(t, approach, type) {
      return {
        t: Math.round(t * 10) / 10, // aligned with the 0.1 s step
        approach,
        type,
        destination: pickDestination(turning, approach, exitIds, rnd()),
        aggressiveness: rnd(),
      };
    }

    for (let b = 0; b < blocks; b++) {
      const start = b * BLOCK_S;
      for (const id of entryIds) {
        const count = profile.approaches[id] || {};
        for (const type of TYPES) {
          const n = count[type] || 0;
          if (mode === 'poisson') {
            const rate = n / BLOCK_S;
            if (rate <= 0) continue;
            let t = start;
            for (;;) {
              t += -Math.log(1 - rnd()) / rate;
              if (t >= start + BLOCK_S) break;
              list.push(make(t, id, type));
            }
          } else {
            for (let k = 0; k < n; k++) list.push(make(start + rnd() * BLOCK_S, id, type));
          }
        }
      }
    }
    const inside = list.filter((a) => a.t < duration);
    inside.sort((x, y) => x.t - y.t); // stable sort: ties keep their generation order
    inside.forEach((a, i) => (a.id = i + 1));
    return inside;
  };

  // Fixed arrivals for the three-vehicle test case (parameters.json -> test_case).
  Sim.testArrivals = function (testCase) {
    return testCase
      .map((c, i) => ({ id: i + 1, t: c.t, approach: c.approach, type: c.type, destination: c.destination, aggressiveness: 0.5 }))
      .sort((x, y) => x.t - y.t);
  };

  Sim.createVehicle = function (a, params) {
    const p = params.vehicles[a.type];
    return {
      id: a.id,
      type: a.type,
      approach: a.approach,
      destination: a.destination,
      aggressiveness: a.aggressiveness,
      length: p.length_m,
      props: {
        width: p.width_m,
        vmax: p.max_speed_ms,
        accel: p.acceleration_ms2,
        decel: p.deceleration_ms2,
        minGap: p.min_gap_m,
        criticalGap: p.critical_gap_s,
        pce: p.pce,
      },
      zone: 'pending', // pending | lane | filter | ring | exit | gone
      state: 'approaching', // approaching | queued | crossing | exited
      position: 0, // meters traveled along its path
      s: 0, // meters inside the current stretch (approach or exit)
      arc: 0, // position on the ring (meters)
      remaining: 0, // meters left on the ring until its exit
      speed: 0,
      t_arrival: a.t,
      t_queue: null,
      t_cross: null,
      t_exit: null,
      t_line: null,
      blocking: false,
      everBlocked: false,
    };
  };

  // CYCLE STEP 1: arrivals. Creates the vehicles whose instant has come and places them at the start of their approach.
  Sim.processArrivals = function (e) {
    while (e.idx < e.arrivals.length && e.arrivals[e.idx].t <= e.t + 1e-9) {
      const a = e.arrivals[e.idx++];
      const v = Sim.createVehicle(a, e.params);
      e.vehicles.push(v);
      e.approaches[a.approach].pending.push(v);
      e.metrics.arrival(v);
    }
    for (const ap of e.geo.approaches) {
      if (!ap.hasEntry) continue;
      const s = e.approaches[ap.id];
      while (s.pending.length) {
        const v = s.pending[0];
        const last = s.lane[s.lane.length - 1];
        const free = last ? last.s - last.length - v.props.minGap : Infinity;
        if (free < 0) break; // the approach is full up to its start: the vehicle waits outside
        s.pending.shift();
        v.zone = 'lane';
        v.s = 0;
        v.speed = Math.min(v.props.vmax, Math.sqrt(2 * v.props.decel * free));
        s.lane.push(v);
      }
      // Vehicles that did not fit are already queuing: they count as queued since they arrived.
      for (const v of s.pending) {
        if (v.state === 'approaching') {
          v.state = 'queued';
          v.t_queue = v.t_arrival;
        }
      }
    }
  };
})();
