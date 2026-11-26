// Engine tests, no screen needed. Run from the project root:  node tests/engine.test.js
// Checks: reproducible seed, arrivals equal to the daily demand, no overlapping vehicles,
// no conflicting greens, and prints the three-vehicle case so the wait can be computed by hand.
// Ends with a whole-day comparison of the three modes per roundabout (each day takes about 3 s).
const fs = require('fs');
const path = require('path');

globalThis.Sim = {};
for (const f of ['demand', 'geometry', 'arrivals', 'control', 'vehicles', 'metrics', 'engine', 'pca']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name + '.json'), 'utf8'));
const data = { geometry: read('geometry'), counts: read('counts'), parameters: read('parameters'), dayProfile: read('daily-profile') };
if (fs.existsSync(path.join(__dirname, '..', 'data', 'calibration.json'))) data.calibration = read('calibration');

let failures = 0;
function check(condition, message) {
  console.log((condition ? '  ✔ ' : '  ✘ ') + message);
  if (!condition) failures++;
}

const mod = (a, m) => ((a % m) + m) % m;
function findOverlaps(e) {
  const bad = [];
  for (const a of e.geo.approaches) {
    const s = e.approaches[a.id];
    const exitLanes = [0, 1, 2].map((k) => s.exit.filter((v) => (v.exitLane || 0) === k));
    for (const list of [s.lane, s.filter, s.split, ...exitLanes]) {
      for (let i = 1; i < list.length; i++) {
        if (list[i - 1].s - list[i - 1].length < list[i].s - 1e-6) bad.push([list[i - 1].id, list[i].id]);
      }
    }
  }
  for (const b of e.geo.bypasses) {
    const list = e.bypass[b.id].list;
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].s - list[i - 1].length < list[i].s - 1e-6) bad.push([list[i - 1].id, list[i].id]);
    }
  }
  for (const lane of [0, 1]) {
    const A = e.ring.filter((v) => (v.ringLane || 0) === lane).sort((x, y) => x.arc - y.arc);
    if (A.length > 1) {
      for (let k = 0; k < A.length; k++) {
        // A motorcycle riding side by side with a car (pair) does not overlap it.
        let leader = A[(k + 1) % A.length];
        if (leader === A[k].pair) leader = A[(k + 2) % A.length];
        if (leader === A[k] || leader === A[k].pair) continue;
        if (mod(leader.arc - A[k].arc, e.geo.C) - leader.length < -1e-6) bad.push([leader.id, A[k].id]);
      }
    }
  }
  return bad;
}

const sites = Object.keys(data.geometry.sites);
const seed = data.parameters.simulation.seed;
const MODES = ['current', 'signal', 'officer'];

console.log('\n1. Same seed and same mode => same metrics (17:00-18:00)');
for (const mode of MODES) {
  const cfg = { site: 'la_lucha', profile: 'day', mode, seed, start_s: 17 * 3600, warmup_s: 600, duration_s: 3600 };
  const a = JSON.stringify(Sim.runHeadless(data, cfg).summary);
  const b = JSON.stringify(Sim.runHeadless(data, cfg).summary);
  check(a === b, `${mode}: two identical runs`);
}

console.log('\n2. Demand: the 24-hour profile adds up, and the arrivals of a day are exactly the daily demand');
{
  const demand = Sim.createDemand(data.dayProfile);
  for (const type of Sim.TYPES) {
    const total = demand.windowShare(type, 0, 86400);
    check(Math.abs(total - 1) < 1e-9, `${type}: the 96 blocks of 15 min add up to the whole day (${total.toFixed(6)})`);
  }
  const share = demand.windowShare('car', ...Sim.parseWindow('16:37-16:52'));
  check(share > 0.005 && share < 0.03, `share of the day in 16:37-16:52 (cars): ${(share * 100).toFixed(2)} %`);
}
for (const site of sites) {
  const engine = Sim.createEngine(data);
  engine.reset({ site, profile: 'day', mode: 'current', seed });
  engine.run(86400);
  const r = engine.summary();
  const worst = Math.max(...Object.values(r.calibration).map((c) => Math.abs(c.simulated - c.daily)));
  check(worst === 0, `${site}: arrivals in 24 h = daily demand of every approach (${Object.values(r.calibration).map((c) => c.simulated).join(', ')})`);
}

if (data.calibration) {
  console.log('\n2b. Real samples (data/calibration.json) are the daily demand the simulation uses');
  for (const [site, cal] of Object.entries(data.calibration.sites)) {
    const { daily } = Sim.siteDemand(data, site);
    for (const [ap, c] of Object.entries(cal.daily)) {
      const src = cal.daily_sources[ap];
      if (Object.values(src).every((x) => x === 'assumed')) continue;
      const kind = Object.values(src).every((x) => x === 'estimated') ? 'estimado' : 'medido';
      const total = c.motorcycle + c.car + c.bus;
      check(daily[ap].motorcycle + daily[ap].car + daily[ap].bus === total, `${site} ${ap}: ${kind} ${total} vehículos al día`);
    }
  }

  console.log('\n2c. With the estimated approaches, measured approaches still get into the ring what was counted (current mode)');
  const demand = Sim.createDemand(data.dayProfile);
  for (const [site, cal] of Object.entries(data.calibration.sites)) {
    for (const w of cal.windows || []) {
      if (!Object.values(cal.daily_sources[w.approach]).every((x) => x.startsWith('measured'))) continue;
      // average of 3 seeds, as tools/check-calibration.js does (one random draw can be off by itself)
      const length = w.end - w.start;
      let entered = 0;
      for (const sd of [seed, 11, 42]) {
        const engine = Sim.createEngine(data);
        engine.reset({ site, profile: 'day', mode: 'current', seed: sd, start_s: w.start, warmup_s: 600, duration_s: Math.max(900, length), keep_vehicles: true });
        engine.run(Math.max(900, length));
        const e = engine.state;
        const passed = (v) => (v.t_cross !== null ? v.t_cross : v.t_bypass ?? null); // into the ring or onto the slip road
        entered += e.vehicles.filter((v) => v.approach === w.approach && passed(v) !== null && passed(v) >= e.t0 && passed(v) < e.t0 + length).length / 3;
      }
      entered = Math.round(entered);
      const counted = Sim.TYPES.reduce((s, t) => s + cal.daily[w.approach][t] * demand.windowShare(t, w.start, w.end), 0);
      check(Math.abs(entered - counted) / counted <= 0.1, `${site} ${w.approach} ${w.time}: entraron ${entered}, contados ${Math.round(counted)}`);
    }
  }
}

console.log('\n3. No overlapping vehicles and no conflicting greens (15 min of evening peak, every mode and site)');
for (const site of sites) {
  for (const mode of MODES) {
    const engine = Sim.createEngine(data);
    engine.reset({ site, profile: 'day', mode, seed, start_s: 18 * 3600, warmup_s: 300, duration_s: 900 });
    let overlaps = 0;
    for (let i = 0; i < 9000; i++) {
      engine.step();
      overlaps += findOverlaps(engine.state).length;
    }
    const r = engine.summary();
    check(overlaps === 0 && r.signal_conflicts === 0, `${site} ${mode}: overlaps ${overlaps}, conflicting greens ${r.signal_conflicts}`);
  }
}

console.log('\n3b. Congestion diversion: by midnight the queues are gone (current mode, whole day)');
for (const site of sites) {
  const r = Sim.runHeadless(data, { site, profile: 'day', mode: 'current', seed }).summary;
  const left = Object.values(r.queue_now).reduce((s, x) => s + x, 0);
  check(left < 20, `${site}: ${left} en cola a las 24:00 · ${r.vehicles_diverted} se fueron por otra ruta en el día`);
}

console.log('\n3c. PCA of the scenario comparison');
{
  // Two perfectly related columns and an independent one: the first axis must carry the related pair.
  const rows = [];
  let u = 7;
  const rnd = () => ((u = (u * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) {
    const a = rnd();
    rows.push([a, 2 * a + 1, rnd(), 5]);
  }
  const p = Sim.pca(rows, ['a', 'b', 'c', 'constant']);
  check(p.dropped.includes('constant'), 'a column that never changes is left out');
  check(Math.abs(p.explained[0] - 2 / 3) < 0.03, `first axis explains about 2/3 of the variation (${(p.explained[0] * 100).toFixed(1)} %)`);
  const la = p.loadings.find((l) => l.name === 'a');
  check(Math.abs(la.pc1) > 0.99, `"a" lies on the first axis (loading ${la.pc1.toFixed(3)})`);
  // On a real comparison the modes must separate along the first axis.
  const results = MODES.map((mode) => Sim.runHeadless(data, { site: 'la_lucha', profile: 'day', mode, seed, start_s: 17 * 3600, warmup_s: 1800, duration_s: 3 * 3600 }).summary);
  const blocks = Array.from({ length: 12 }, (_, k) => 68 + k);
  const pr = [];
  const groups = [];
  results.forEach((r, i) => {
    for (const b of blocks) {
      const x = r.blocks[b];
      pr.push([x.avg_wait_s ?? 0, x.avg_queue, x.diverted, x.arrivals ? x.exited / x.arrivals : 1, x.blocked_s]);
      groups.push(MODES[i]);
    }
  });
  const q = Sim.pca(pr, ['Espera', 'Cola', 'Se fueron', 'Atendidos / llegadas', 'Anillo bloqueado'], 'Espera');
  check(q && q.explained[0] + q.explained[1] > 0.6, `17:00-20:00: two axes keep ${Math.round((q.explained[0] + q.explained[1]) * 100)} % of the variation`);
  check(q.loadings.find((l) => l.name === 'Espera').pc1 > 0, 'more wait always points to the right of axis 1');
  // The reading never names as best the mode with the highest average wait over those hours.
  // (The lowest wait is not enough to be best: a mode that sends more drivers elsewhere also lowers the wait.)
  const meanWait = MODES.map((m, i) => results[i].avg_wait_s);
  const worstByWait = MODES[meanWait.indexOf(Math.max(...meanWait))];
  const reading = Sim.describePca(q, groups, { current: 'Actual', signal: 'Semáforo', officer: 'Agente' }).join(' ');
  const worstName = { current: 'Actual', signal: 'Semáforo', officer: 'Agente' }[worstByWait];
  check(!reading.includes(`${worstName} es el que mejor`), `the reading does not pick ${worstName}, the mode with the most wait, as best`);
}

console.log('\n4. Three-vehicle case (signal mode, test profile)');
{
  const engine = Sim.createEngine(data);
  engine.reset({ site: 'la_lucha', profile: 'test', mode: 'signal', seed, duration_s: 120 });
  engine.run(120);
  const detail = engine.vehicleDetail();
  console.table(detail.map(({ id, approach, t_arrival, t_queue, t_cross, wait_s }) => ({ id, approach, t_arrival, t_queue, t_cross, wait_s })));
  const byHand = detail.reduce((s, v) => s + (v.t_cross - v.t_queue), 0) / detail.length;
  check(Math.abs(byHand - engine.summary().avg_wait_s) < 0.06, `average wait by hand ${byHand.toFixed(2)} s = simulator ${engine.summary().avg_wait_s} s`);
}

console.log('\n5. Mode comparison (whole day, same seed)');
for (const site of sites) {
  const rows = {};
  for (const mode of MODES) {
    const t0 = Date.now();
    const r = Sim.runHeadless(data, { site, profile: 'day', mode, seed }).summary;
    rows[mode] = {
      'veh/day': r.vehicles_generated,
      crossed: r.vehicles_crossed,
      'avg wait s': r.avg_wait_s,
      'max queue': r.queue_max_overall,
      diverted: r.vehicles_diverted,
      'still queued': Object.values(r.queue_now).reduce((s, x) => s + x, 0),
      'blocked s': r.blocked_time_s,
      ms: Date.now() - t0,
    };
  }
  console.log(`\n  ${site}`);
  console.table(rows);
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
