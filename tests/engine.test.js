// Engine tests, no screen needed. Run from the project root:  node tests/engine.test.js
// Checks: reproducible seed, calibration within 10 %, no overlapping vehicles,
// no conflicting greens, and prints the three-vehicle case so the wait can be computed by hand.
const fs = require('fs');
const path = require('path');

globalThis.Sim = {};
for (const f of ['geometry', 'arrivals', 'control', 'vehicles', 'metrics', 'engine']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name + '.json'), 'utf8'));
const data = { geometry: read('geometry'), counts: read('counts'), parameters: read('parameters') };

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
    for (const list of [s.lane, s.filter, s.exit]) {
      for (let i = 1; i < list.length; i++) {
        if (list[i - 1].s - list[i - 1].length < list[i].s - 1e-6) bad.push([list[i - 1].id, list[i].id]);
      }
    }
  }
  const A = [...e.ring].sort((x, y) => x.arc - y.arc);
  if (A.length > 1) {
    for (let k = 0; k < A.length; k++) {
      const leader = A[(k + 1) % A.length];
      if (mod(leader.arc - A[k].arc, e.geo.C) - leader.length < -1e-6) bad.push([leader.id, A[k].id]);
    }
  }
  return bad;
}

const sites = Object.keys(data.geometry.sites);
const seed = data.parameters.simulation.seed;
const MODES = ['current', 'signal', 'officer'];

console.log('\n1. Same seed and same mode => same metrics');
for (const mode of MODES) {
  const cfg = { site: 'la_lucha', profile: 'peak', mode, seed, duration_s: 900 };
  const a = JSON.stringify(Sim.runHeadless(data, cfg).summary);
  const b = JSON.stringify(Sim.runHeadless(data, cfg).summary);
  check(a === b, `${mode}: two identical runs`);
}

console.log('\n2. Calibration: arrivals in 15 min within 10 % of the counts');
for (const site of sites) {
  for (const profile of ['peak', 'offpeak']) {
    const r = Sim.runHeadless(data, { site, profile, mode: 'current', seed, duration_s: 900 }).summary;
    const worst = Math.max(...Object.values(r.calibration).map((c) => Math.abs(c.difference_pct)));
    check(worst <= 10, `${site} ${profile}: largest difference ${worst} %`);
  }
}

console.log('\n3. No overlapping vehicles and no conflicting greens (15 min, every mode and site)');
for (const site of sites) {
  for (const mode of MODES) {
    const engine = Sim.createEngine(data);
    engine.reset({ site, profile: 'peak', mode, seed, duration_s: 900 });
    let overlaps = 0;
    for (let i = 0; i < 9000; i++) {
      engine.step();
      overlaps += findOverlaps(engine.state).length;
    }
    const r = engine.summary();
    check(overlaps === 0 && r.signal_conflicts === 0, `${site} ${mode}: overlaps ${overlaps}, conflicting greens ${r.signal_conflicts}`);
  }
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

console.log('\n5. Mode comparison (15 min, same seed)');
for (const site of sites) {
  for (const profile of ['peak', 'offpeak']) {
    const rows = {};
    for (const mode of MODES) {
      const t0 = Date.now();
      const r = Sim.runHeadless(data, { site, profile, mode, seed, duration_s: 900 }).summary;
      rows[mode] = {
        'discharge/min': r.discharge_avg_per_min,
        'avg wait s': r.avg_wait_s,
        'max queue': r.queue_max_overall,
        crossed: r.vehicles_crossed,
        generated: r.vehicles_generated,
        'blocked s': r.blocked_time_s,
        blocking: r.blocking_vehicles,
        ms: Date.now() - t0,
      };
    }
    console.log(`\n  ${site} · ${profile}`);
    console.table(rows);
  }
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
