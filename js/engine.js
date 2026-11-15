// engine.js
// Simulation clock. Every simulated 0.1 s it does the same thing, in the same order:
//   1. Arrivals  2. Control  3. Movement  4. Metrics   (5. Drawing is done by renderer.js, reading the state)
// The engine knows nothing about the canvas: it only handles numbers. So it can run without a screen (comparator, tests).
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  Sim.createEngine = function (data) {
    const engine = { state: null };

    // cfg: { site, profile: 'peak' | 'offpeak' | 'test', mode, seed, duration_s }
    engine.reset = function (cfg) {
      const params = data.parameters;
      const siteGeometry = data.geometry.sites[cfg.site];
      if (!siteGeometry) throw new Error(`Site "${cfg.site}" does not exist in geometry.json`);
      const capacityProfile = cfg.profile === 'peak' ? 'peak' : 'offpeak';
      const geo = Sim.prepareGeometry(siteGeometry, data.geometry.lane_width_m, capacityProfile, params);
      geo.key = cfg.site;
      const siteCounts = data.counts.sites[cfg.site];
      const duration = cfg.duration_s || params.simulation.max_duration_s;

      let arrivals;
      if (cfg.profile === 'test') {
        arrivals = Sim.testArrivals(params.test_case);
      } else {
        if (!siteCounts || !siteCounts.profiles[cfg.profile]) {
          throw new Error(`No "${cfg.profile}" counts for "${cfg.site}" in counts.json`);
        }
        arrivals = Sim.generateArrivals({
          profile: siteCounts.profiles[cfg.profile],
          turning: siteCounts.turning,
          geo,
          duration,
          seed: cfg.seed,
          mode: params.simulation.arrival_mode,
        });
      }

      const approaches = {};
      for (const a of geo.approaches) {
        approaches[a.id] = { lane: [], filter: [], pending: [], exit: [], nextDischarge: 0 };
      }

      engine.state = {
        t: 0,
        steps: 0,
        dt: params.simulation.step_s,
        duration,
        cfg: { ...cfg },
        geo,
        params,
        arrivals,
        idx: 0,
        approaches,
        ring: [],
        vehicles: [],
        permissions: {},
        control: Sim.createControl(geo, params, cfg.mode),
        metrics: Sim.createMetrics(geo, siteCounts, cfg.profile),
      };
      return engine.state;
    };

    engine.step = function () {
      const e = engine.state;
      Sim.processArrivals(e); // 1. arrivals
      e.control.update(e.dt); // 2. control
      Sim.moveVehicles(e); // 3. movement
      e.metrics.record(e); // 4. metrics
      e.steps++;
      e.t = Math.round(e.steps * e.dt * 1000) / 1000;
    };

    engine.run = function (seconds) {
      const n = Math.round(seconds / engine.state.dt);
      for (let i = 0; i < n; i++) engine.step();
    };

    engine.summary = function () {
      return engine.state.metrics.summary(engine.state);
    };

    // Per-vehicle detail (used to check the metrics by hand).
    engine.vehicleDetail = function () {
      return engine.state.vehicles.map((v) => ({
        id: v.id,
        type: v.type,
        approach: v.approach,
        destination: v.destination,
        state: v.state,
        t_arrival: v.t_arrival,
        t_queue: v.t_queue,
        t_cross: v.t_cross,
        wait_s: v.t_cross !== null ? Math.round((v.t_cross - v.t_queue) * 10) / 10 : null,
        t_exit: v.t_exit,
        got_stuck: v.everBlocked,
      }));
    };

    return engine;
  };

  // Runs a whole mode without drawing and returns the summary (used by the comparator).
  Sim.runHeadless = function (data, cfg) {
    const engine = Sim.createEngine(data);
    engine.reset(cfg);
    engine.run(cfg.duration_s);
    return { summary: engine.summary(), series: engine.state.metrics.series };
  };
})();
