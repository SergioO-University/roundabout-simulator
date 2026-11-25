// Compares the simulation against what was measured in the field (data/calibration.json -> targets).
// Run from the project root:   node tools/check-calibration.js            (current mode, 3 seeds)
//                               node tools/check-calibration.js officer    (another mode)
// It simulates each measured time window (for example 16:37-16:52, after 10 minutes of warm-up) and reports,
// next to the observed values:
//   - space-mean speed per vehicle type on the ring and on each measured exit (km/h)
//   - median and 15th-percentile time between vehicles entering from each measured approach (s)
//   - vehicles that entered the ring from each counted approach in the counted window
//   - vehicles that left through each counted exit (profiles.<profile>.exits in the samples)
// Messages are in Spanish because the whole team runs this script.
const fs = require('fs');
const path = require('path');

globalThis.Sim = {};
for (const f of ['demand', 'geometry', 'arrivals', 'control', 'vehicles', 'metrics', 'engine']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
const read = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', n + '.json'), 'utf8'));
const calPath = path.join(__dirname, '..', 'data', 'calibration.json');
if (!fs.existsSync(calPath)) {
  console.error('No existe data/calibration.json. Corra primero: node tools/build-calibration.js');
  process.exit(1);
}
const data = { geometry: read('geometry'), counts: read('counts'), parameters: read('parameters'), dayProfile: read('daily-profile'), calibration: read('calibration') };
const mode = process.argv[2] || 'current';
const SEEDS = [data.parameters.simulation.seed, 11, 42];
const WARMUP = 600;
const TYPES = ['motorcycle', 'car', 'bus'];
const TYPE_ES = { motorcycle: 'Motos', car: 'Carros', bus: 'Busetas' };
const avg = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
const quantile = (l, q) => {
  if (!l.length) return null;
  const s = [...l].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const fmt = (x, d = 1) => (x === null || x === undefined ? '–' : x.toFixed(d));
// Metrics beyond ±15 % are flagged; in GitHub Actions they also show up as warnings on the run.
const outOfRange = [];
const diff = (sim, obs, label) => {
  if (sim === null || !obs) return '';
  const pct = Math.round(((sim - obs) / obs) * 100);
  if (Math.abs(pct) > 15) outOfRange.push(`${label || 'métrica'}: medido ${fmt(obs)}, simulado ${fmt(sim)} (${pct >= 0 ? '+' : ''}${pct} %)`);
  return `${pct >= 0 ? '+' : ''}${pct} %${Math.abs(pct) > 15 ? '  ⚠' : ''}`;
};

const demand = Sim.createDemand(data.dayProfile);
for (const [siteKey, cal] of Object.entries(data.calibration.sites)) {
  if (!cal.samples.length) continue; // nothing observed here to compare against
  const t = cal.targets;
  const nameOf = (id) => (data.geometry.sites[siteKey].approaches.find((a) => a.id === id) || { name: id }).name;
  // Every measured window: counts, speeds and headways, each compared in its own window.
  const windows = new Map();
  const add = (w) => w && !windows.has(`${w.start}-${w.end}`) && windows.set(`${w.start}-${w.end}`, { time: w.time, start: w.start, end: w.end });
  for (const w of cal.windows || []) add(w);
  for (const w of t.speed_windows || []) add(w);
  for (const h of t.entry_headways) add(h.window);
  for (const x of t.exit_counts || []) add(x.window);

  for (const w of windows.values()) {
    const key = `${w.start}-${w.end}`;
    const length = w.end - w.start;
    const run = Math.max(900, length);
    const hasSpeeds = (t.speed_windows || []).some((x) => `${x.start}-${x.end}` === key);
    const hs = t.entry_headways.filter((h) => h.window && `${h.window.start}-${h.window.end}` === key);
    const counted = [...new Set((cal.windows || []).filter((x) => `${x.start}-${x.end}` === key).map((x) => x.approach))].filter((ap) =>
      Object.values(cal.daily_sources[ap] || {}).every((src) => src.startsWith('measured')),
    );
    // accumulate over several seeds so the comparison does not depend on one random draw
    const ring = { motorcycle: [], car: [], bus: [] };
    const exitSp = {};
    const gaps = {};
    const entered = {};
    const exitTargets = (t.exit_counts || []).filter((x) => `${x.window.start}-${x.window.end}` === key);
    const left = {};
    for (const seed of SEEDS) {
      const engine = Sim.createEngine(data);
      engine.reset({ site: siteKey, profile: 'day', mode, seed, start_s: w.start, warmup_s: WARMUP, duration_s: run, keep_vehicles: true });
      const e = engine.state;
      const steps = Math.round(run / e.dt);
      for (let i = 0; i < steps; i++) {
        engine.step();
        if (!hasSpeeds || e.t - e.t0 > length) continue;
        for (const v of e.ring) ring[v.type].push(v.speed);
        for (const a of e.geo.approaches) {
          if (!a.hasExit || !t.observed_speeds_kmh.exits[a.id]) continue;
          for (const v of e.approaches[a.id].exit) ((exitSp[a.id] ??= { motorcycle: [], car: [], bus: [] })[v.type]).push(v.speed);
        }
      }
      const inWindow = (x) => x !== null && x >= e.t0 && x < e.t0 + length;
      for (const ap of counted) entered[ap] = (entered[ap] || 0) + e.vehicles.filter((v) => v.approach === ap && inWindow(v.t_cross)).length;
      for (const x of exitTargets) left[x.exit] = (left[x.exit] || 0) + e.vehicles.filter((v) => v.destination === x.exit && inWindow(v.t_exit)).length;
      for (const h of hs) {
        const crossings = e.vehicles.filter((v) => v.approach === h.approach && inWindow(v.t_cross)).map((v) => v.t_cross).sort((a, b) => a - b);
        for (let k = 1; k < crossings.length; k++) (gaps[h.approach] ??= []).push(crossings[k] - crossings[k - 1]);
      }
    }

    console.log(`\n${cal.site} · ${w.time} · modo ${mode} · ${SEEDS.length} semillas (con ${WARMUP / 60} min previos para que la glorieta no arranque vacía)`);
    if (hasSpeeds) {
      console.log('\n  Velocidad promedio (km/h)        medido   simulado   diferencia');
      const obsRing = t.observed_speeds_kmh.ring || {};
      for (const ty of TYPES) {
        const sim = ring[ty].length ? avg(ring[ty]) * 3.6 : null;
        const obs = obsRing[ty] ? avg(obsRing[ty]) : null;
        if (obs === null && sim === null) continue;
        console.log(`    Anillo · ${TYPE_ES[ty].padEnd(20)} ${fmt(obs).padStart(6)}   ${fmt(sim).padStart(8)}   ${diff(sim, obs, `${cal.site} · anillo · ${TYPE_ES[ty]}`)}`);
      }
      for (const [exitId, obsExit] of Object.entries(t.observed_speeds_kmh.exits || {})) {
        const name = nameOf(exitId);
        for (const ty of TYPES) {
          const sim = exitSp[exitId] && exitSp[exitId][ty].length ? avg(exitSp[exitId][ty]) * 3.6 : null;
          const obs = obsExit[ty] ? avg(obsExit[ty]) : null;
          if (obs === null && sim === null) continue;
          console.log(`    Salida ${name} · ${TYPE_ES[ty].padEnd(8)} ${fmt(obs).padStart(6)}   ${fmt(sim).padStart(8)}   ${diff(sim, obs, `${cal.site} · salida ${name} · ${TYPE_ES[ty]}`)}`);
        }
      }
    }
    if (hs.length) {
      console.log('\n  Tiempo entre vehículos que entran (s)  medido   simulado   diferencia');
      for (const h of hs) {
        const name = nameOf(h.approach);
        const g = gaps[h.approach] || [];
        if (h.median_s !== null) console.log(`    ${name} · mediana`.padEnd(40) + `${fmt(h.median_s).padStart(6)}   ${fmt(quantile(g, 0.5)).padStart(8)}   ${diff(quantile(g, 0.5), h.median_s, `${cal.site} · ${name} · mediana entre entradas`)}`);
        if (h.queue_discharge_p15_s !== null) console.log(`    ${name} · percentil 15`.padEnd(40) + `${fmt(h.queue_discharge_p15_s).padStart(6)}   ${fmt(quantile(g, 0.15)).padStart(8)}   ${diff(quantile(g, 0.15), h.queue_discharge_p15_s, `${cal.site} · ${name} · percentil 15 entre entradas`)}`);
      }
    }
    if (exitTargets.length) {
      console.log(`\n  Vehículos que salen (${w.time})          medido   simulado   diferencia`);
      for (const x of exitTargets) {
        const obs = TYPES.reduce((sum, ty) => sum + (x.counts[ty] || 0), 0);
        const sim = left[x.exit] / SEEDS.length;
        console.log(`    ${nameOf(x.exit)}`.padEnd(42) + `${fmt(obs, 0).padStart(6)}   ${fmt(sim, 0).padStart(8)}   ${diff(sim, obs, `${cal.site} · salen por ${nameOf(x.exit)}`)}`);
      }
    }
    if (counted.length) {
      console.log(`\n  Vehículos que entran al anillo (${w.time})  medido   simulado   diferencia`);
      for (const ap of counted) {
        const d = cal.daily[ap];
        const obs = TYPES.reduce((sum, ty) => sum + d[ty] * demand.windowShare(ty, w.start, w.end), 0);
        const sim = entered[ap] / SEEDS.length;
        console.log(`    ${nameOf(ap)}`.padEnd(42) + `${fmt(obs, 0).padStart(6)}   ${fmt(sim, 0).padStart(8)}   ${diff(sim, obs, `${cal.site} · ${nameOf(ap)} · vehículos que entran`)}`);
      }
    }
  }
}
console.log('\nGuía: diferencias de hasta ±15 % se consideran razonables para este modelo. Si una métrica se aleja más, ajusten el parámetro relacionado en data/parameters.json y vuelvan a correr este script.');
if (outOfRange.length) {
  console.log('\n⚠ Fuera de ±15 %:');
  for (const m of outOfRange) console.log('  - ' + m);
  if (process.env.GITHUB_ACTIONS) for (const m of outOfRange) console.log(`::warning title=Calibración fuera de ±15 %::${m}`);
} else {
  console.log('\n✔ Todas las métricas comparadas están dentro de ±15 %.');
}
