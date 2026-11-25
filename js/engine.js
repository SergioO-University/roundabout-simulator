// engine.js
// Simulation clock. Every simulated 0.1 s it does the same thing, in the same order:
//   1. Arrivals  2. Control  3. Movement  4. Metrics   (5. Drawing is done by renderer.js, reading the state)
// The engine knows nothing about the canvas: it only handles numbers. So it can run without a screen (comparator, tests).
//
// A run covers a whole day (profile "day"): the demand of every approach is a daily total spread over the
// 24 hours with data/daily-profile.json (js/demand.js). It can start at any time of day (start_s) and,
// optionally, warm up first (warmup_s) so the roundabout is not empty at that time.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const DAY_S = 86400;
  const TYPES = ['motorcycle', 'car', 'bus'];

  // Daily demand of a site: from data/calibration.json (real samples, measured + estimated) or, without it,
  // from the test counts of counts.json turned into daily totals.
  Sim.siteDemand = function (data, site) {
    const calib = data.calibration && data.calibration.sites ? data.calibration.sites[site] : null;
    const demand = Sim.createDemand(data.dayProfile);
    const siteCounts = data.counts.sites[site] || { profiles: {}, turning: {} };
    if (calib && calib.daily) return { demand, calib, daily: calib.daily, sources: calib.daily_sources, turning: calib.turning };
    return { demand, calib: null, daily: demand.dailyFromCounts(siteCounts), sources: null, turning: siteCounts.turning };
  };

  Sim.createEngine = function (data) {
    const engine = { state: null };

    // cfg: { site, profile: 'day' | 'test', mode, seed,
    //        start_s (time of day to start, default 0), duration_s (default a whole day),
    //        warmup_s (run this long before start_s without counting it, default 0),
    //        keep_vehicles (keep every vehicle in state.vehicles; by default finished ones are archived) }
    engine.reset = function (cfg) {
      const params = data.parameters;
      const siteGeometry = data.geometry.sites[cfg.site];
      if (!siteGeometry) throw new Error(`Site "${cfg.site}" does not exist in geometry.json`);
      const geo = Sim.prepareGeometry(siteGeometry, data.geometry.lane_width_m, 'offpeak', params);
      geo.key = cfg.site;
      const test = cfg.profile === 'test';
      const { demand, calib, daily, sources, turning } = Sim.siteDemand(data, cfg.site);
      const warmup = test ? 0 : cfg.warmup_s || 0;
      const startTod = test ? 0 : (((cfg.start_s || 0) - warmup) % DAY_S + DAY_S) % DAY_S;
      const duration = warmup + (cfg.duration_s || (test ? params.simulation.max_duration_s : DAY_S));

      // Speeds used on the ring and on each exit, per vehicle type (m/s).
      const ringParam = params.roundabout.max_speed_ms;
      const speeds = { ring: {}, exits: {} };
      for (const t of TYPES) {
        speeds.ring[t] = calib ? calib.speeds_ms.ring[t] : typeof ringParam === 'number' ? ringParam : ringParam[t];
      }
      for (const a of geo.approaches) {
        if (!a.hasExit) continue;
        speeds.exits[a.id] = {};
        for (const t of TYPES) {
          speeds.exits[a.id][t] = calib && calib.speeds_ms.exits[a.id] ? calib.speeds_ms.exits[a.id][t] : params.vehicles[t].max_speed_ms;
        }
      }

      const approaches = {};
      for (const a of geo.approaches) {
        approaches[a.id] = { lane: [], filter: [], pending: [], exit: [], nextDischarge: 0 };
      }

      const bypass = {};
      for (const b of geo.bypasses) bypass[b.id] = { pending: [], list: [] };

      const e = {
        t: 0,
        steps: 0,
        dt: params.simulation.step_s,
        duration,
        cfg: { ...cfg },
        geo,
        params,
        speeds,
        calibration: calib,
        demand,
        daily,
        dailySources: sources,
        turning,
        startTod,
        t0: 0, // elapsed time where the counted part of the run starts (after the warm-up)
        rnd: Sim.mulberry32(cfg.seed),
        arrivals: test ? Sim.testArrivals(params.test_case) : [],
        idx: 0,
        nextId: 1,
        approaches,
        bypass,
        ring: [],
        vehicles: [],
        archive: [], // finished vehicles (only their detail), when keep_vehicles is off
        keepVehicles: test || !!cfg.keep_vehicles,
        permissions: {},
        control: Sim.createControl(geo, params, cfg.mode),
      };
      if (!test) e.nextBlock = Math.floor(startTod / Sim.BLOCK_S);
      e.metrics = Sim.createMetrics(e);
      engine.state = e;

      if (warmup > 0) {
        engine.run(warmup);
        e.t0 = e.t;
        e.metrics = Sim.createMetrics(e); // the warm-up does not count
      }
      return e;
    };

    engine.step = function () {
      const e = engine.state;
      Sim.processArrivals(e); // 1. arrivals
      e.control.update(e.dt); // 2. control
      Sim.moveVehicles(e); // 3. movement
      e.metrics.record(e); // 4. metrics
      e.steps++;
      e.t = Math.round(e.steps * e.dt * 1000) / 1000;
      // Finished vehicles leave the working list (a whole day is tens of thousands of vehicles).
      if (!e.keepVehicles && e.steps % 600 === 0) {
        const active = [];
        for (const v of e.vehicles) {
          if (v.zone === 'gone') e.archive.push(detailOf(v));
          else active.push(v);
        }
        e.vehicles = active;
      }
    };

    engine.run = function (seconds) {
      const n = Math.round(seconds / engine.state.dt);
      for (let i = 0; i < n; i++) engine.step();
    };

    // Time of day now (seconds since midnight).
    engine.timeOfDay = function () {
      const e = engine.state;
      return (((e.startTod + e.t) % DAY_S) + DAY_S) % DAY_S;
    };

    engine.summary = function () {
      return engine.state.metrics.summary(engine.state);
    };

    // Per-vehicle detail (used to check the metrics by hand and to export).
    engine.vehicleDetail = function () {
      const e = engine.state;
      return e.archive.concat(e.vehicles.map(detailOf)).sort((x, y) => x.id - y.id);
    };

    function detailOf(v) {
      const e = engine.state;
      const clock = (t) => (t === null || t === undefined ? null : Sim.clockText(e.startTod + t, true));
      return {
        id: v.id,
        type: v.type,
        approach: v.approach,
        destination: v.destination,
        state: v.state,
        arrival_clock: clock(v.t_arrival),
        t_arrival: v.t_arrival,
        t_queue: v.t_queue,
        t_cross: v.t_cross,
        wait_s: v.t_cross !== null ? Math.round((v.t_cross - v.t_queue) * 10) / 10 : null,
        t_exit: v.t_exit,
        slip_road: v.bypass || null,
        got_stuck: v.everBlocked,
      };
    }

    return engine;
  };

  // Runs a whole scenario without drawing and returns the summary (used by the comparator).
  Sim.runHeadless = function (data, cfg) {
    const engine = Sim.createEngine(data);
    engine.reset(cfg);
    engine.run(cfg.duration_s || (cfg.profile === 'test' ? data.parameters.simulation.max_duration_s : DAY_S));
    return { summary: engine.summary(), series: engine.state.metrics.series };
  };
})();
