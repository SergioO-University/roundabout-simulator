// metrics.js
// CYCLE STEP 4: metrics. Definitions (section 6 of the challenge):
//  - Discharge capacity: vehicles that changed to state "exited" during the last simulated minute.
//  - Max queue per approach: largest number of vehicles in state "queued" on that approach during the run.
//  - Average wait: average of (t_cross - t_queue) over vehicles that have already crossed.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const r1 = (x) => Math.round(x * 10) / 10;

  Sim.createMetrics = function (geo, siteCounts, profile) {
    const ids = geo.entryIds; // queues, waits and calibration are per entry
    const m = {
      arrivals: {},
      arrivals15: {},
      exits: [],
      waits: [],
      queueNow: {},
      queueMax: {},
      blockedTime_s: 0,
      blockers: new Set(),
      conflictViolations: 0,
      series: [],
    };
    for (const id of ids) {
      m.arrivals[id] = { motorcycle: 0, car: 0, bus: 0 };
      m.arrivals15[id] = { motorcycle: 0, car: 0, bus: 0 };
      m.queueNow[id] = 0;
      m.queueMax[id] = 0;
    }

    m.arrival = function (v) {
      m.arrivals[v.approach][v.type]++;
      if (v.t_arrival < Sim.BLOCK_S) m.arrivals15[v.approach][v.type]++;
    };

    m.crossed = function (v) {
      m.waits.push({ id: v.id, approach: v.approach, type: v.type, wait: v.t_cross - v.t_queue });
    };

    m.exited = function (v, e) {
      m.exits.push(e.t);
    };

    m.record = function (e) {
      for (const a of geo.approaches) {
        if (!a.hasEntry) continue;
        const s = e.approaches[a.id];
        let n = s.pending.length;
        for (const v of s.lane) if (v.state === 'queued') n++;
        for (const v of s.filter) if (v.state === 'queued') n++;
        m.queueNow[a.id] = n;
        if (n > m.queueMax[a.id]) m.queueMax[a.id] = n;
      }
      let blocked = false;
      for (const v of e.ring) {
        if (v.blocking) {
          blocked = true;
          m.blockers.add(v.id);
        }
      }
      if (blocked) m.blockedTime_s += e.dt;

      // Safety check: never two conflicting greens at the same time.
      const greens = e.control.greens();
      for (let i = 0; i < greens.length; i++) {
        for (let j = i + 1; j < greens.length; j++) {
          if (geo.conflicts.has(Sim.conflictKey(greens[i], greens[j]))) m.conflictViolations++;
        }
      }

      if (e.steps % 50 === 0) {
        let queue = 0;
        for (const id of ids) queue += m.queueNow[id];
        m.series.push({ t: e.t, total_queue: queue, on_ring: e.ring.length, discharge_last_min: m.dischargeLastMinute(e.t) });
      }
    };

    m.dischargeLastMinute = function (t) {
      let n = 0;
      for (let i = m.exits.length - 1; i >= 0 && m.exits[i] > t - 60; i--) n++;
      return n;
    };

    m.summary = function (e) {
      const t = e.t;
      const waitByApproach = {};
      for (const id of ids) {
        const list = m.waits.filter((x) => x.approach === id);
        waitByApproach[id] = list.length ? r1(list.reduce((s, x) => s + x.wait, 0) / list.length) : null;
      }
      const calibration = {};
      const profileData = siteCounts && siteCounts.profiles && siteCounts.profiles[profile];
      for (const id of ids) {
        const c = profileData ? profileData.approaches[id] || {} : null;
        const counted = c ? (c.motorcycle || 0) + (c.car || 0) + (c.bus || 0) : null;
        const a = m.arrivals15[id];
        const simulated = a.motorcycle + a.car + a.bus;
        calibration[id] = {
          counted,
          simulated,
          complete: t >= Sim.BLOCK_S,
          difference_pct: counted ? r1(((simulated - counted) / counted) * 100) : null,
        };
      }
      const totalWait = m.waits.reduce((s, x) => s + x.wait, 0);
      let generated = 0;
      for (const id of ids) generated += m.arrivals[id].motorcycle + m.arrivals[id].car + m.arrivals[id].bus;
      return {
        time_s: r1(t),
        mode: e.cfg.mode,
        profile: e.cfg.profile,
        seed: e.cfg.seed,
        site: e.cfg.site,
        vehicles_generated: generated,
        vehicles_crossed: m.waits.length,
        vehicles_exited: m.exits.length,
        discharge_last_min: m.dischargeLastMinute(t),
        discharge_avg_per_min: t > 0 ? r1(m.exits.length / (t / 60)) : 0,
        avg_wait_s: m.waits.length ? r1(totalWait / m.waits.length) : 0,
        avg_wait_by_approach_s: waitByApproach,
        queue_now: { ...m.queueNow },
        queue_max: { ...m.queueMax },
        queue_max_overall: Math.max(0, ...Object.values(m.queueMax)),
        blocked_time_s: r1(m.blockedTime_s),
        blocking_vehicles: m.blockers.size,
        signal_conflicts: m.conflictViolations,
        calibration,
      };
    };

    return m;
  };
})();
