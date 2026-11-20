// app.js
// Wires the control panel, the metrics dashboard and the comparator to the engine and the renderer.
// UI text stays in Spanish (it is what the evaluator and the team see).
(async function () {
  const $ = (id) => document.getElementById(id);

  let data;
  try {
    data = await Sim.loadData();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:24px;color:#b91c1c">${err.message}</p>`;
    return;
  }

  const params = data.parameters;
  const engine = Sim.createEngine(data);
  const renderer = Sim.createRenderer($('canvas'));
  // On phones the toolbars and legend sit outside the canvas, so labels can use its whole height.
  const phone = window.matchMedia('(max-width: 900px)');
  const setInsets = () => {
    renderer.insets = phone.matches ? { top: 14, bottom: 30 } : { top: 62, bottom: 46 };
  };
  phone.addEventListener('change', setInsets);
  setInsets();

  const MODE_DESCRIPTIONS = {
    current: 'Cada conductor entra cuando ve un hueco en el anillo. Nadie revisa si su salida está libre: un vehículo puede quedar atravesado y bloquear a todos.',
    signal: 'Fases verde, amarillo y todo rojo. Con verde en un acceso, el tránsito del anillo se detiene antes de ese acceso.',
    officer: 'Un agente da paso por turnos fijos a un acceso a la vez, con un tiempo de transición entre turnos.',
  };

  const ui = { mode: 'current', running: false, speed: 1, accumulated: 0, lastFrame: performance.now(), lastDashboard: 0, comparison: null };

  // ---------- Scenario ----------
  $('data-source').textContent = 'Datos: ' + data.source;
  for (const [key, site] of Object.entries(data.geometry.sites)) {
    $('sel-site').add(new Option(site.name, key));
  }
  $('sel-site').value = data.geometry.active_site || Object.keys(data.geometry.sites)[0];
  $('inp-seed').value = params.simulation.seed;
  for (const [key, name] of Object.entries(Sim.MODES)) {
    $('cmp-a').add(new Option(name, key));
    $('cmp-b').add(new Option(name, key));
  }
  $('cmp-a').value = 'current';
  $('cmp-b').value = 'officer';

  function currentConfig() {
    return {
      site: $('sel-site').value,
      profile: $('sel-profile').value,
      mode: ui.mode,
      seed: Math.max(1, parseInt($('inp-seed').value, 10) || 1),
    };
  }

  function reset() {
    const cfg = currentConfig();
    let e;
    try {
      e = engine.reset(cfg);
    } catch (err) {
      $('count-time').textContent = '⚠ ' + err.message;
      return;
    }
    ui.accumulated = 0;
    const siteCounts = data.counts.sites[cfg.site];
    const site = data.geometry.sites[cfg.site];
    $('badge-test-data').hidden = !(siteCounts && siteCounts.is_test_data);
    const profile = siteCounts && siteCounts.profiles[cfg.profile];
    let note =
      cfg.profile === 'test'
        ? 'Tres vehículos fijos definidos en parameters.json → test_case. Sirve para calcular la espera a mano.'
        : profile
          ? `Conteo de campo: ${profile.time}. Llegadas al azar con semilla ${cfg.seed}.`
          : '';
    if (site.under_construction) note += ' ⚠ Punto en obra: la geometría de OpenStreetMap puede no reflejar el estado actual.';
    $('count-time').textContent = note;
    $('mode-description').textContent = MODE_DESCRIPTIONS[cfg.mode];
    const problems = e.control.problems;
    $('phase-warnings').hidden = !problems.length;
    $('phase-warnings').textContent = problems.join(' ');
    buildControls(e);
    buildApproachTable(e);
    updateDashboard();
    renderer.draw(e);
  }

  // ---------- Signal and officer controls ----------
  function slider(container, text, min, max, value, onChange) {
    const box = document.createElement('div');
    box.className = 'slider';
    box.innerHTML = `<span>${text}</span><b>${value} s</b><input type="range" min="${min}" max="${max}" step="1" value="${value}">`;
    const input = box.querySelector('input');
    input.addEventListener('input', () => {
      box.querySelector('b').textContent = input.value + ' s';
      onChange(Number(input.value));
    });
    container.appendChild(box);
  }

  function buildControls(e) {
    const sig = $('signal-controls');
    const off = $('officer-controls');
    sig.innerHTML = '';
    off.innerHTML = '';
    sig.hidden = ui.mode !== 'signal';
    off.hidden = ui.mode !== 'officer';
    const name = (id) => e.geo.byId[id].name;

    if (ui.mode === 'signal') {
      if (!Array.isArray(params.signal.green_s)) params.signal.green_s = [params.signal.green_s];
      e.control.phases.forEach((phase, i) => {
        if (params.signal.green_s[i] === undefined) params.signal.green_s[i] = params.signal.green_s[i - 1] ?? 25;
        slider(sig, `Verde fase ${i + 1}: ${phase.map(name).join(' + ')}`, 5, 90, params.signal.green_s[i], (v) => (params.signal.green_s[i] = v));
      });
      slider(sig, 'Amarillo', 0, 6, params.signal.yellow_s, (v) => (params.signal.yellow_s = v));
      slider(sig, 'Todo rojo', 0, 6, params.signal.all_red_s, (v) => (params.signal.all_red_s = v));
    }
    if (ui.mode === 'officer') {
      slider(off, 'Duración de cada turno', 10, 120, params.officer.turn_s, (v) => (params.officer.turn_s = v));
      slider(off, 'Transición entre turnos (nadie pasa)', 0, 15, params.officer.transition_s, (v) => (params.officer.transition_s = v));
      const box = document.createElement('label');
      box.className = 'checkbox';
      box.innerHTML = `<input type="checkbox" ${params.officer.prevent_blocking ? 'checked' : ''}> El agente no deja entrar si la salida está llena`;
      box.querySelector('input').addEventListener('change', (ev) => (params.officer.prevent_blocking = ev.target.checked));
      off.appendChild(box);
    }
  }

  // ---------- Dashboard ----------
  function buildApproachTable(e) {
    const body = $('approach-table').querySelector('tbody');
    body.innerHTML = '';
    for (const id of e.geo.entryIds) {
      const row = document.createElement('tr');
      row.dataset.id = id;
      row.innerHTML = `<td>${e.geo.byId[id].name}</td><td data-c="queue"></td><td data-c="max"></td><td data-c="wait"></td><td data-c="arrivals"></td>`;
      body.appendChild(row);
    }
  }

  function updateDashboard() {
    const e = engine.state;
    if (!e) return;
    const r = engine.summary();
    $('kpi-discharge').textContent = r.discharge_last_min;
    $('kpi-wait').textContent = r.avg_wait_s.toFixed(1);
    $('kpi-queue').textContent = r.queue_max_overall;
    $('kpi-blocked').textContent = Math.round(r.blocked_time_s);
    for (const row of $('approach-table').querySelectorAll('tbody tr')) {
      const id = row.dataset.id;
      const cal = r.calibration[id];
      row.querySelector('[data-c=queue]').textContent = r.queue_now[id];
      row.querySelector('[data-c=max]').textContent = r.queue_max[id];
      const wait = r.avg_wait_by_approach_s[id];
      row.querySelector('[data-c=wait]').textContent = wait === null ? '–' : wait.toFixed(1) + ' s';
      const cell = row.querySelector('[data-c=arrivals]');
      if (cal.counted === null) {
        cell.textContent = `${cal.simulated}`;
        cell.className = '';
      } else if (!cal.complete) {
        cell.textContent = `${cal.simulated} / ${cal.counted}`;
        cell.className = '';
        cell.title = 'En curso: se compara al llegar a 15 minutos simulados';
      } else {
        const ok = Math.abs(cal.difference_pct) <= 10;
        cell.textContent = `${cal.simulated}/${cal.counted} (${cal.difference_pct > 0 ? '+' : ''}${cal.difference_pct}%)`;
        cell.className = ok ? 'good' : 'bad';
        cell.title = ok ? 'Dentro del 10 % de lo contado' : 'Fuera del 10 % de lo contado';
      }
    }
    $('extra-metrics').textContent =
      `En el anillo: ${e.ring.length} · cruzaron ${r.vehicles_crossed} de ${r.vehicles_generated} · ` +
      `vehículos atravesados: ${r.blocking_vehicles}` +
      (ui.mode === 'current' ? '' : ` · verdes en conflicto: ${r.signal_conflicts}`) +
      (renderer.mapTiles && renderer.tilesStatus === 'failed' ? ' · ⚠ mapa de fondo no disponible (sin internet)' : '');
  }

  const PHASE_NAMES = { green: 'Verde', yellow: 'Amarillo', all_red: 'Todo rojo' };
  function updateClock() {
    const e = engine.state;
    const t = e ? e.t : 0;
    $('clock').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const info = $('phase-info');
    if (!e || e.cfg.mode === 'current') {
      info.hidden = true;
      return;
    }
    const c = e.control;
    const left = Math.max(0, c.currentPhaseDuration() - c.time);
    const phaseName = c.phase === 'all_red' && e.cfg.mode === 'officer' ? 'Transición' : PHASE_NAMES[c.phase];
    const who = c.phase === 'all_red' ? '' : ': ' + c.phases[c.index].map((id) => e.geo.byId[id].name).join(' + ');
    info.hidden = false;
    info.className = 'phase ' + c.phase;
    info.textContent = `${phaseName}${who} · ${left.toFixed(0)} s`;
    info.title = info.textContent;
  }

  // ---------- Animation loop ----------
  function frame(now) {
    const real = Math.min(0.1, (now - ui.lastFrame) / 1000);
    ui.lastFrame = now;
    const e = engine.state;
    if (ui.running && e) {
      ui.accumulated += real * ui.speed;
      let steps = Math.floor(ui.accumulated / e.dt + 1e-9);
      ui.accumulated -= steps * e.dt;
      steps = Math.min(steps, 200);
      for (let i = 0; i < steps && e.t < e.duration; i++) engine.step();
      if (e.t >= e.duration) pause();
    }
    renderer.draw(engine.state);
    updateClock();
    if (now - ui.lastDashboard > 250) {
      updateDashboard();
      ui.lastDashboard = now;
    }
    requestAnimationFrame(frame);
  }

  function pause() {
    ui.running = false;
    $('btn-play').textContent = '▶ Continuar';
  }

  // ---------- Events ----------
  $('btn-play').addEventListener('click', () => {
    ui.running = !ui.running;
    $('btn-play').textContent = ui.running ? '⏸ Pausar' : '▶ Continuar';
  });
  $('btn-reset').addEventListener('click', () => {
    reset();
    pause();
    $('btn-play').textContent = '▶ Iniciar';
  });
  for (const id of ['sel-site', 'sel-profile', 'inp-seed']) $(id).addEventListener('change', reset);
  $('chk-map').addEventListener('change', (ev) => (renderer.mapTiles = ev.target.checked));
  $('btn-fit').addEventListener('click', () => renderer.resetView());

  function markActive(container, attribute, value) {
    for (const b of container.querySelectorAll('button')) b.classList.toggle('active', b.dataset[attribute] === String(value));
  }
  $('modes').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    ui.mode = b.dataset.mode;
    markActive($('modes'), 'mode', ui.mode);
    reset(); // same seed: the same vehicles arrive at the same instants
  });
  $('speeds').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    ui.speed = Number(b.dataset.speed);
    markActive($('speeds'), 'speed', ui.speed);
  });
  $('tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    markActive($('tabs'), 'tab', b.dataset.tab);
    $('tab-sim').hidden = b.dataset.tab !== 'sim';
    $('tab-cmp').hidden = b.dataset.tab !== 'cmp';
  });

  // ---------- Comparator ----------
  const ROWS = [
    ['Evacuación promedio (veh/min)', (r) => r.discharge_avg_per_min, 'higher'],
    ['Evacuación último minuto (veh/min)', (r) => r.discharge_last_min, 'higher'],
    ['Espera promedio (s)', (r) => r.avg_wait_s, 'lower'],
    ['Cola máxima (veh)', (r) => r.queue_max_overall, 'lower'],
    ['Vehículos que cruzaron', (r) => r.vehicles_crossed, 'higher'],
    ['Aún en cola al final', (r) => Object.values(r.queue_now).reduce((s, x) => s + x, 0), 'lower'],
    ['Anillo bloqueado (s)', (r) => r.blocked_time_s, 'lower'],
    ['Vehículos atravesados', (r) => r.blocking_vehicles, 'lower'],
  ];
  const SHORT_MODES = { current: 'Actual', signal: 'Semáforo', officer: 'Agente' };

  $('btn-compare').addEventListener('click', () => {
    const base = currentConfig();
    if (base.profile === 'test') base.profile = 'peak';
    const duration = params.simulation.comparison_duration_s;
    const modes = [$('cmp-a').value, $('cmp-b').value];
    $('cmp-card').hidden = false;
    $('cmp-result').innerHTML = '<p class="note">Corriendo…</p>';
    setTimeout(() => {
      const results = modes.map((mode) => Sim.runHeadless(data, { ...base, mode, duration_s: duration }));
      ui.comparison = { config: { ...base, duration_s: duration }, modes, results: results.map((x) => x.summary), series: results.map((x) => x.series) };
      renderComparison();
    }, 20);
  });

  function renderComparison() {
    const c = ui.comparison;
    const [a, b] = c.results;
    const site = data.geometry.sites[c.config.site];
    const nameOf = (id) => (site.approaches.find((x) => x.id === id) || { name: id }).name;
    const rows = ROWS.map(([name, f, better]) => [name, f(a), f(b), better]);
    for (const id of Object.keys(a.queue_max)) {
      rows.push([`Cola máx · ${nameOf(id)}`, a.queue_max[id], b.queue_max[id], 'lower']);
      rows.push([`Espera · ${nameOf(id)} (s)`, a.avg_wait_by_approach_s[id] ?? 0, b.avg_wait_by_approach_s[id] ?? 0, 'lower']);
    }
    c.rows = rows.map(([name, va, vb]) => ({ metric: name, a: va, b: vb, difference: Math.round((vb - va) * 10) / 10 }));
    const profileName = { peak: 'pico', offpeak: 'valle' }[c.config.profile];
    let html = `<p class="note">${site.name} · ${profileName} · semilla ${c.config.seed} · ${c.config.duration_s / 60} min</p>`;
    html += `<table class="table"><thead><tr><th>Métrica</th><th>A: ${SHORT_MODES[c.modes[0]]}</th><th>B: ${SHORT_MODES[c.modes[1]]}</th><th>B − A</th></tr></thead><tbody>`;
    for (const [name, va, vb, better] of rows) {
      const d = Math.round((vb - va) * 10) / 10;
      const cls = d === 0 ? '' : (d > 0) === (better === 'higher') ? 'good' : 'bad';
      html += `<tr><td>${name}</td><td>${va}</td><td>${vb}</td><td class="${cls}">${d > 0 ? '+' : ''}${d}</td></tr>`;
    }
    html += '</tbody></table><p class="note">Verde: B es mejor que A. Rojo: B es peor.</p>';
    $('cmp-result').innerHTML = html;
  }

  // ---------- Export ----------
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const toCsv = (rows) =>
    '﻿' + rows.map((r) => r.map((x) => (x === null || x === undefined ? '' : `"${String(x).replace(/"/g, '""')}"`)).join(';')).join('\n');

  $('exp-cmp-csv').addEventListener('click', () => {
    const c = ui.comparison;
    if (!c) return;
    const rows = [['metric', Sim.MODES[c.modes[0]], Sim.MODES[c.modes[1]], 'difference_B_minus_A']];
    for (const r of c.rows) rows.push([r.metric, r.a, r.b, r.difference]);
    download(`comparison-${c.config.site}-${c.config.profile}-seed${c.config.seed}.csv`, toCsv(rows), 'text/csv');
  });
  $('exp-cmp-json').addEventListener('click', () => {
    const c = ui.comparison;
    if (!c) return;
    download(`comparison-${c.config.site}-${c.config.profile}-seed${c.config.seed}.json`, JSON.stringify(c, null, 2), 'application/json');
  });
  $('exp-veh-csv').addEventListener('click', () => {
    const detail = engine.vehicleDetail();
    if (!detail.length) return;
    const cols = Object.keys(detail[0]);
    const cfg = engine.state.cfg;
    download(`vehicles-${cfg.site}-${cfg.profile}-${cfg.mode}-seed${cfg.seed}.csv`, toCsv([cols, ...detail.map((v) => cols.map((k) => v[k]))]), 'text/csv');
  });

  // ---------- Start ----------
  markActive($('modes'), 'mode', ui.mode);
  markActive($('speeds'), 'speed', ui.speed);
  reset();
  requestAnimationFrame(frame);
})();
