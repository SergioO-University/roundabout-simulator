// metrics.js
// CYCLE STEP 4: metrics. Definitions (section 6 of the challenge):
//  - Discharge capacity: vehicles that changed to state "exited" during the last simulated minute.
//  - Max queue per approach: largest number of vehicles in state "queued" on that approach during the run.
//  - Average wait: average of (t_cross - t_queue) over vehicles that have already crossed.
// Over a whole day the same metrics are also kept per hour of the day (summary.hourly), and arrivals are
// compared with the daily demand of each approach (summary.calibration).
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const r1 = (x) => Math.round(x * 10) / 10;
  const TYPES = ['motorcycle', 'car', 'bus'];

  // e: engine state (geo, startTod, t0, daily, demand). Metrics count from e.t0 (after any warm-up).
  Sim.createMetrics = function (e0) {
    const geo = e0.geo;
    const ids = geo.entryIds; // queues, waits and calibration are per entry
    const hourOf = (e) => Math.floor((((e.startTod + e.t) % 86400) + 86400) % 86400 / 3600);
    const m = {
      arrivals: {},
      crossedBy: {}, // approach -> { n, waitSum }
      exits: [], // instants of the last minutes (for "discharge last minute")
      exitedTotal: 0,
      bypassedTotal: 0,
      divertedTotal: 0,
      divertedBy: {},
      crossedTotal: 0,
      waitTotal: 0,
      queueNow: {},
      queueMax: {},
      blockedTime_s: 0,
      blockers: new Set(),
      conflictViolations: 0,
      series: [],
      hourly: Array.from({ length: 24 }, () => ({ arrivals: 0, crossed: 0, wait_sum: 0, exited: 0, diverted: 0, queue_max: 0, blocked_s: 0, seen: false })),
      t0: e0.t,
    };
    for (const id of ids) {
      m.arrivals[id] = { motorcycle: 0, car: 0, bus: 0 };
      m.crossedBy[id] = { n: 0, waitSum: 0 };
      m.queueNow[id] = 0;
      m.queueMax[id] = 0;
      m.divertedBy[id] = 0;
    }

    m.arrival = function (v, e) {
      m.arrivals[v.approach][v.type]++;
      if (e) m.hourly[hourOf(e)].arrivals++;
    };

    m.crossed = function (v, e) {
      const wait = v.t_cross - v.t_queue;
      m.crossedBy[v.approach].n++;
      m.crossedBy[v.approach].waitSum += wait;
      m.crossedTotal++;
      m.waitTotal += wait;
      const h = m.hourly[hourOf(e)];
      h.crossed++;
      h.wait_sum += wait;
    };

    m.exited = function (v, e) {
      m.exits.push(e.t);
      m.exitedTotal++;
      m.hourly[hourOf(e)].exited++;
      if (m.exits.length > 4000) m.exits = m.exits.filter((t) => t > e.t - 60);
    };

    // Saw a queue too long and went another way (never entered the approach).
    m.diverted = function (v, e) {
      m.divertedTotal++;
      m.divertedBy[v.approach]++;
      m.hourly[hourOf(e)].diverted++;
    };

    // Took a slip road: it never entered the ring (no wait, not a crossing), but it did leave.
    m.bypassed = function (v, e) {
      m.bypassedTotal++;
      m.exited(v, e);
    };

    m.record = function (e) {
      const h = m.hourly[hourOf(e)];
      h.seen = true;
      let queue = 0;
      for (const a of geo.approaches) {
        if (!a.hasEntry) continue;
        const s = e.approaches[a.id];
        let n = s.pending.length;
        for (const v of s.lane) if (v.state === 'queued') n++;
        for (const v of s.filter) if (v.state === 'queued') n++;
        m.queueNow[a.id] = n;
        if (n > m.queueMax[a.id]) m.queueMax[a.id] = n;
        if (n > h.queue_max) h.queue_max = n;
        queue += n;
      }
      let blocked = false;
      for (const v of e.ring) {
        if (v.blocking) {
          blocked = true;
          m.blockers.add(v.id);
        }
      }
      if (blocked) {
        m.blockedTime_s += e.dt;
        h.blocked_s += e.dt;
      }

      // Safety check: never two conflicting greens at the same time.
      const greens = e.control.greens();
      for (let i = 0; i < greens.length; i++) {
        for (let j = i + 1; j < greens.length; j++) {
          if (geo.conflicts.has(Sim.conflictKey(greens[i], greens[j]))) m.conflictViolations++;
        }
      }

      if (e.steps % 300 === 0) {
        m.series.push({ t: e.t, clock: Sim.clockText(e.startTod + e.t), total_queue: queue, on_ring: e.ring.length, discharge_last_min: m.dischargeLastMinute(e.t) });
      }
    };

    m.dischargeLastMinute = function (t) {
      let n = 0;
      for (let i = m.exits.length - 1; i >= 0 && m.exits[i] > t - 60; i--) n++;
      return n;
    };

    m.summary = function (e) {
      const t = e.t - m.t0;
      const waitByApproach = {};
      for (const id of ids) {
        const c = m.crossedBy[id];
        waitByApproach[id] = c.n ? r1(c.waitSum / c.n) : null;
      }
      // Arrivals so far against the daily demand of each approach.
      const calibration = {};
      for (const id of ids) {
        const d = (e.daily && e.daily[id]) || {};
        const a = m.arrivals[id];
        calibration[id] = {
          daily: e.cfg.profile === 'test' ? null : TYPES.reduce((s, ty) => s + (d[ty] || 0), 0),
          simulated: a.motorcycle + a.car + a.bus,
        };
      }
      let generated = 0;
      for (const id of ids) generated += m.arrivals[id].motorcycle + m.arrivals[id].car + m.arrivals[id].bus;
      const hourly = m.hourly.map((h, hour) => ({
        hour,
        arrivals: h.arrivals,
        crossed: h.crossed,
        exited: h.exited,
        diverted: h.diverted,
        avg_wait_s: h.crossed ? r1(h.wait_sum / h.crossed) : null,
        queue_max: h.queue_max,
        blocked_s: r1(h.blocked_s),
        simulated: h.seen,
      }));
      return {
        time_s: r1(t),
        clock: Sim.clockText(e.startTod + e.t),
        mode: e.cfg.mode,
        profile: e.cfg.profile,
        seed: e.cfg.seed,
        site: e.cfg.site,
        vehicles_generated: generated,
        vehicles_crossed: m.crossedTotal,
        vehicles_exited: m.exitedTotal,
        vehicles_bypassed: m.bypassedTotal,
        vehicles_diverted: m.divertedTotal,
        diverted_by_approach: { ...m.divertedBy },
        discharge_last_min: m.dischargeLastMinute(e.t),
        discharge_avg_per_min: t > 0 ? r1(m.exitedTotal / (t / 60)) : 0,
        avg_wait_s: m.crossedTotal ? r1(m.waitTotal / m.crossedTotal) : 0,
        avg_wait_by_approach_s: waitByApproach,
        queue_now: { ...m.queueNow },
        queue_max: { ...m.queueMax },
        queue_max_overall: Math.max(0, ...Object.values(m.queueMax)),
        blocked_time_s: r1(m.blockedTime_s),
        blocking_vehicles: m.blockers.size,
        signal_conflicts: m.conflictViolations,
        calibration,
        hourly,
      };
    };

    return m;
  };
})();
