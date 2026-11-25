// arrivals.js
// Generates the vehicles arriving at each approach, block by block (15 min) over the day.
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
    if (!(total > 0)) {
      // turning left at zero (not filled yet): spread vehicles evenly over the other exits
      const others = ids.filter((i) => i !== origin);
      const pool = others.length ? others : ids;
      return pool[Math.min(pool.length - 1, Math.floor(u * pool.length))];
    }
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

  // Arrivals of one 15-minute block of the day (block = absolute index since midnight of the run's first day).
  // daily: approach -> type -> vehicles per day. Each block gets demand.blockCount(...) vehicles per approach and type.
  // "exact_count": exactly that many, at random instants inside the block. "poisson": random arrivals at that rate.
  // t is in seconds since the start of the run (elapsed); blockStart is the elapsed time where the block begins.
  Sim.generateBlockArrivals = function ({ daily, turning, geo, demand, block, blockStart, rnd, mode }) {
    const list = [];
    function make(t, approach, type) {
      return {
        t: Math.round(t * 10) / 10, // aligned with the 0.1 s step
        approach,
        type,
        destination: pickDestination(turning, approach, geo.exitIds, rnd()),
        aggressiveness: rnd(),
      };
    }
    for (const id of geo.entryIds) {
      const byType = daily[id] || {};
      for (const type of TYPES) {
        const n = demand.blockCount(byType[type] || 0, type, block);
        if (mode === 'poisson') {
          const rate = n / BLOCK_S;
          if (rate <= 0) continue;
          let t = blockStart;
          for (;;) {
            t += -Math.log(1 - rnd()) / rate;
            if (t >= blockStart + BLOCK_S) break;
            list.push(make(t, id, type));
          }
        } else {
          for (let k = 0; k < n; k++) list.push(make(blockStart + rnd() * BLOCK_S, id, type));
        }
      }
    }
    list.sort((x, y) => x.t - y.t); // stable sort: ties keep their generation order
    return list;
  };

  // Fixed arrivals for the three-vehicle test case (parameters.json -> test_case).
  Sim.testArrivals = function (testCase) {
    return testCase
      .map((c, i) => ({ id: i + 1, t: c.t, approach: c.approach, type: c.type, destination: c.destination, aggressiveness: 0.5 }))
      .sort((x, y) => x.t - y.t);
  };

  // Congestion diversion: expected wait = vehicles queued on the approach / how fast it has been letting
  // vehicles into the ring in the last 5 minutes. Above simulation.divert_after_wait_s the driver goes elsewhere.
  const RATE_WINDOW_S = 300;
  Sim.wouldDivert = function (e, approachId) {
    const limit = e.params.simulation.divert_after_wait_s;
    if (!limit || e.cfg.profile === 'test') return false;
    const s = e.approaches[approachId];
    let queued = s.pending.length;
    for (const v of s.lane) if (v.state === 'queued') queued++;
    for (const v of s.filter) if (v.state === 'queued') queued++;
    if (queued < 10) return false;
    const times = s.entryTimes || [];
    while (times.length && times[0] < e.t - RATE_WINDOW_S) times.shift();
    const window = Math.min(RATE_WINDOW_S, Math.max(60, e.t));
    const rate = Math.max(times.length / window, 1 / 60); // vehicles per second (at least one a minute)
    return queued / rate > limit;
  };

  // Generates the arrivals of block e.nextBlock and updates what depends on the time of day (exit capacity).
  Sim.openBlock = function (e) {
    const b = e.nextBlock++;
    const blockStart = b * BLOCK_S - e.startTod; // elapsed seconds
    const fresh = Sim.generateBlockArrivals({
      daily: e.daily,
      turning: e.turning,
      geo: e.geo,
      demand: e.demand,
      block: b,
      blockStart,
      rnd: e.rnd,
      mode: e.params.simulation.arrival_mode,
    }).filter((a) => a.t >= e.t - 1e-9); // a run that starts inside a block keeps only what is still to come
    for (const a of fresh) a.id = e.nextId++;
    e.arrivals = e.arrivals.slice(e.idx).concat(fresh);
    e.idx = 0;
    // Exit capacity (downstream congestion) depends on whether this block is in a peak period.
    const peak = e.demand.periodAt(b * BLOCK_S).peak;
    for (const a of e.geo.approaches) {
      if (a.hasExit) a.exitCapacity = Sim.capacityFor(a.exitCapacityByProfile, peak ? 'peak' : 'offpeak');
    }
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
        followUp: p.follow_up_s || 0,
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
    if (e.nextBlock !== undefined) {
      // Whole-day run: create the next 15-minute block of arrivals when the clock reaches it.
      while (e.startTod + e.t >= e.nextBlock * BLOCK_S - 1e-9) Sim.openBlock(e);
    }
    while (e.idx < e.arrivals.length && e.arrivals[e.idx].t <= e.t + 1e-9) {
      const a = e.arrivals[e.idx++];
      const v = Sim.createVehicle(a, e.params);
      e.vehicles.push(v);
      // Going to an exit served by a slip road from this approach: it takes the slip road, not the ring.
      const by = e.geo.bypasses.find((b) => b.from === a.approach && b.to === a.destination);
      e.metrics.arrival(v, e);
      if (by) {
        v.bypass = by.id;
        e.bypass[by.id].pending.push(v);
      } else if (Sim.wouldDivert(e, a.approach)) {
        // Sees a queue that would take too long: takes another route and never joins it.
        v.zone = 'gone';
        v.state = 'diverted';
        e.metrics.diverted(v, e);
      } else e.approaches[a.approach].pending.push(v);
    }
    // Slip roads: vehicles start at the beginning as soon as there is room.
    for (const b of e.geo.bypasses) {
      const s = e.bypass[b.id];
      while (s.pending.length) {
        const v = s.pending[0];
        const last = s.list[s.list.length - 1];
        const free = last ? last.s - last.length - v.props.minGap : Infinity;
        if (free < 0) break;
        s.pending.shift();
        v.zone = 'bypass';
        v.state = 'crossing';
        v.s = 0;
        v.speed = Math.min(v.props.vmax, Math.sqrt(2 * v.props.decel * free));
        s.list.push(v);
      }
    }
    for (const ap of e.geo.approaches) {
      if (!ap.hasEntry) continue;
      const s = e.approaches[ap.id];
      const twoLanes = ap.nIn >= 2 && e.geo.ringLanes >= 2;
      while (s.pending.length) {
        const v = s.pending[0];
        // Two-lane approach: the left lane (s.filter) for vehicles going further round, the right one for the rest.
        const left = twoLanes && Sim.chooseRingLane(e, { ...ap, nIn: 1 }, v, false) === 1;
        const list = left ? s.filter : s.lane;
        const last = list[list.length - 1];
        const free = last ? last.s - last.length - v.props.minGap : Infinity;
        if (free < 0) break; // the approach is full up to its start: the vehicle waits outside
        s.pending.shift();
        v.zone = left ? 'filter' : 'lane';
        v.s = 0;
        v.speed = Math.min(v.props.vmax, Math.sqrt(2 * v.props.decel * free));
        list.push(v);
      }
      // Vehicles that did not fit are already queuing: they count as queued since they arrived.
      // Only the newest ones (at the end of the line) can still be unmarked, so walk back until a marked one.
      for (let i = s.pending.length - 1; i >= 0; i--) {
        const v = s.pending[i];
        if (v.state !== 'approaching') break;
        v.state = 'queued';
        v.t_queue = v.t_arrival;
      }
    }
  };
})();
