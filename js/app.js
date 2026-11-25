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

  const ui = { mode: 'current', running: false, speed: 60, accumulated: 0, lastFrame: performance.now(), lastDashboard: 0, comparison: null, startHour: 0 };

  // ---------- Scenario ----------
  $('data-source').textContent = 'Datos: ' + data.source;
  for (const [key, site] of Object.entries(data.geometry.sites)) {
    $('sel-site').add(new Option(site.name, key));
  }
  $('sel-site').value = data.geometry.active_site || Object.keys(data.geometry.sites)[0];
  $('inp-seed').value = params.simulation.seed;
  for (let h = 0; h < 24; h++) $('sel-hour').add(new Option(`${String(h).padStart(2, '0')}:00`, h));

  // A day run starts at ui.startHour (00:00 by default) and goes to midnight. Starting later, the 30 minutes
  // before are simulated first (not counted) so the roundabout is not empty at that hour.
  const WARMUP_S = 1800;
  function currentConfig() {
    const cfg = {
      site: $('sel-site').value,
      profile: $('sel-profile').value,
      mode: ui.mode,
      seed: Math.max(1, parseInt($('inp-seed').value, 10) || 1),
    };
    if (cfg.profile === 'day') {
      cfg.start_s = ui.startHour * 3600;
      cfg.warmup_s = ui.startHour > 0 ? WARMUP_S : 0;
      cfg.duration_s = 86400 - cfg.start_s;
    }
    return cfg;
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
    const site = data.geometry.sites[cfg.site];
    renderRealData(e, cfg);
    let note = '';
    if (cfg.profile === 'test') {
      note = 'Tres vehículos fijos definidos en parameters.json → test_case. Sirve para calcular la espera a mano.';
    } else {
      const n = sourceTally(e);
      const nMeasured = n.measured + n.partial;
      const perDay = Object.values(e.daily).reduce((sum, d) => sum + d.motorcycle + d.car + d.bus, 0);
      const rest = [n.estimated ? `${n.estimated} estimado${n.estimated > 1 ? 's' : ''} a partir de lo medido` : '', n.assumed ? `${n.assumed} de prueba` : '']
        .filter(Boolean)
        .join(', ');
      const windows = e.calibration && e.calibration.windows ? [...new Set(e.calibration.windows.map((w) => w.time + (w.date ? ' (' + w.date + ')' : '')))] : [];
      note =
        `${perDay.toLocaleString('es-CO')} vehículos en el día, repartidos por hora con el perfil de 24 h. ` +
        (nMeasured
          ? `${nMeasured} de ${n.total} accesos medidos (conteo ${windows.join(', ')})${rest ? '; ' + rest : ''}.`
          : n.estimated
            ? `Sin conteos propios: ${rest}. Detalle en «Datos reales».`
            : 'Conteos supuestos (de prueba): aún no hay mediciones.') +
        ` Llegadas al azar con semilla ${cfg.seed}.`;
    }
    if (site.under_construction) note += ' ⚠ Punto en obra: la geometría de OpenStreetMap puede no reflejar el estado actual.';
    $('count-time').textContent = note;
    $('mode-description').textContent = MODE_DESCRIPTIONS[cfg.mode];
    const problems = e.control.problems;
    $('phase-warnings').hidden = !problems.length;
    $('phase-warnings').textContent = problems.join(' ');
    buildControls(e);
    buildApproachTable(e);
    dayChart.expected = cfg.profile === 'test' ? null : e.demand.hourlyTotals(e.daily);
    if (!dayChart.expected) {
      const c = $('day-chart');
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }
    $('sel-hour').value = ui.startHour;
    $('sel-hour').disabled = cfg.profile === 'test';
    updateDashboard();
    renderer.draw(e);
  }

  // ---------- Real data vs assumptions ----------
  const SOURCE_LABEL = { measured: 'medido', partial: 'parcial', estimated: 'estimado', assumed: 'supuesto' };
  // Source of one approach's daily demand: measured, partial, estimated or assumed.
  function countSource(e, id) {
    const src = e.dailySources && e.dailySources[id];
    if (!src) return 'assumed';
    const kinds = Object.values(src).map((x) => (x.startsWith('measured') ? 'm' : x === 'estimated' ? 'e' : 'a'));
    if (kinds.every((k) => k === 'm')) return 'measured';
    if (kinds.includes('m')) return 'partial';
    return kinds.includes('e') ? 'estimated' : 'assumed';
  }
  function sourceTally(e) {
    const n = { measured: 0, partial: 0, estimated: 0, assumed: 0, total: 0 };
    for (const id of e.geo.entryIds) {
      n[countSource(e, id)]++;
      n.total++;
    }
    return n;
  }

  function renderRealData(e, cfg) {
    const badge = $('badge-test-data');
    const cal = e.calibration;
    const card = $('real-data-card');
    if (!cal) {
      const siteCounts = data.counts.sites[cfg.site];
      badge.hidden = !(siteCounts && siteCounts.is_test_data);
      badge.className = 'badge warning';
      badge.textContent = 'Datos de prueba';
      card.hidden = true;
      return;
    }
    const n = sourceTally(e);
    const measured = n.measured + n.partial;
    badge.hidden = false;
    badge.className = measured === n.total ? 'badge ok' : 'badge warning';
    badge.textContent =
      measured === n.total
        ? 'Datos reales'
        : measured
          ? `Datos reales: ${measured} de ${n.total} accesos medidos${n.estimated ? `, ${n.estimated} estimados` : ''}`
          : n.estimated
            ? 'Conteos estimados de otra glorieta'
            : 'Datos de prueba';
    card.hidden = false;
    const parts = [];
    parts.push(cal.samples.length ? `${cal.samples.length} muestra(s) de campo de este punto.` : 'Aún no hay muestras de campo de este punto.');
    parts.push(`De ${n.total} accesos: ${measured} medido${measured === 1 ? '' : 's'}, ${n.estimated} estimado${n.estimated === 1 ? '' : 's'} a partir de lo medido, ${n.assumed} de prueba. Cada conteo se convierte en vehículos por día con el perfil de 24 horas.`);
    if (n.estimated) parts.push('Los estimados se reemplazan solos cuando llegue la toma de ese acceso.');
    if (localSamples.length) parts.push(`Incluye ${localSamples.length} muestra(s) local(es) sin guardar: para que queden, súbanlas a data/samples/.`);
    $('real-data-summary').textContent = parts.join(' ');
    $('real-data-samples').innerHTML = cal.samples.length
      ? cal.samples
          .map((s) => {
            const local = localSamples.some((x) => x.site === cfg.site && x.file === s.file) ? '<span class="tag-local">local, sin guardar</span>' : '';
            return `<li><b>${escapeHtml(s.file)}</b>${local}<br>${s.measured.length ? s.measured.join('; ') : 'sin datos utilizables'}</li>`;
          })
          .join('')
      : '<li>Ninguna todavía.</li>';
    $('real-data-assumptions').innerHTML = cal.assumptions.map((a) => `<li>${a}</li>`).join('') +
      (cal.problems.length ? cal.problems.map((p) => `<li class="bad">${p}</li>`).join('') : '');
  }

  // ---------- Samples tried in the browser (not saved) ----------
  // The page recalculates the calibration with the repo's samples plus the dropped ones (js/calibration.js),
  // exactly as tools/build-calibration.js does. A local file with the same name as a repo sample replaces it.
  const localSamples = []; // { site, file, data }
  const escapeHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const canRecalculate = !!(data.sitesConfig && Sim.buildCalibration);
  if (!canRecalculate) $('sample-drop').hidden = true;

  function showSampleMessage(lines, bad) {
    $('sample-msg').hidden = !lines.length;
    $('sample-msg').className = 'note' + (bad ? ' msg-bad' : '');
    $('sample-msg').innerHTML = lines.map(escapeHtml).join('<br>');
  }

  function recalculate() {
    const samples = {};
    const repo = (data.samples && data.samples.sites) || {};
    for (const [site, list] of Object.entries(repo)) samples[site] = list.map((x) => ({ file: x.file, data: x.data }));
    for (const x of localSamples) {
      const list = (samples[x.site] ??= []);
      const i = list.findIndex((y) => y.file === x.file);
      if (i >= 0) list[i] = { file: x.file, data: x.data };
      else list.push({ file: x.file, data: x.data });
    }
    const { calibration } = Sim.buildCalibration({
      samples,
      counts: data.counts,
      params: data.parameters,
      sitesConfig: data.sitesConfig,
      geometry: data.geometry,
      dayProfile: data.dayProfile,
    });
    data.calibration = calibration;
    $('btn-clear-samples').hidden = !localSamples.length;
    reset();
  }

  async function addSampleFiles(fileList) {
    const notes = [];
    let bad = false;
    let added = 0;
    for (const f of fileList) {
      if (!/\.json$/i.test(f.name)) {
        notes.push(`${f.name}: no es un .json; se ignora.`);
        bad = true;
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(await f.text());
      } catch (err) {
        notes.push(`${f.name}: no es un JSON válido (${err.message}).`);
        bad = true;
        continue;
      }
      const fromFile = Sim.sampleSiteKey(parsed, data.sitesConfig);
      const site = fromFile || $('sel-site').value;
      if (!fromFile) notes.push(`${f.name}: el campo "site" no coincide con ninguna glorieta; se asignó a ${data.geometry.sites[site].name}.`);
      const i = localSamples.findIndex((x) => x.site === site && x.file === f.name);
      if (i >= 0) localSamples.splice(i, 1);
      localSamples.push({ site, file: f.name, data: parsed });
      added++;
      if (site !== $('sel-site').value) notes.push(`${f.name}: es de ${data.geometry.sites[site].name}; elijan ese punto para verla.`);
    }
    if (added) {
      try {
        recalculate();
        notes.unshift(`${added} muestra(s) agregada(s). La simulación ya usa la calibración recalculada.`);
        // Problems found in the files just added (wrong field, weekend date, more than a lane carries…)
        const names = new Set(localSamples.map((x) => x.file));
        for (const site of Object.values(data.calibration.sites)) {
          for (const p of site.problems) {
            if ([...names].some((n) => p.startsWith(n + ':'))) {
              notes.push('⚠ ' + p);
              bad = true;
            }
          }
        }
      } catch (err) {
        notes.push(`No se pudo recalcular: ${err.message}`);
        bad = true;
      }
    }
    showSampleMessage(notes, bad);
  }

  $('btn-pick-samples').addEventListener('click', () => $('sample-input').click());
  $('sample-input').addEventListener('change', (ev) => {
    addSampleFiles([...ev.target.files]);
    ev.target.value = '';
  });
  $('btn-clear-samples').addEventListener('click', () => {
    localSamples.length = 0;
    recalculate();
    showSampleMessage(['Muestras locales quitadas: de nuevo solo las del repositorio.'], false);
  });
  const drop = $('sample-drop');
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (ev) => {
      ev.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) drop.addEventListener(type, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    addSampleFiles([...ev.dataTransfer.files]);
  });

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

  // ---------- Day chart: demand and wait over the 24 hours ----------
  const dayChart = { expected: null, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0f766e' };
  const CHART_PAD = { l: 4, r: 4, t: 4, b: 13 };
  const fmtWait = (s) => (s >= 120 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
  function drawDayChart(r) {
    const canvas = $('day-chart');
    const e = engine.state;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || !dayChart.expected) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cw = w - CHART_PAD.l - CHART_PAD.r;
    const ch = h - CHART_PAD.t - CHART_PAD.b;
    const x = (hours) => CHART_PAD.l + (hours / 24) * cw;
    const bottom = CHART_PAD.t + ch;
    // peak periods (pico y placa) shaded
    ctx.fillStyle = 'rgba(251, 146, 60, 0.14)';
    for (const p of e.demand.periods) if (p.peak) ctx.fillRect(x(p.start / 3600), CHART_PAD.t, x(p.end / 3600) - x(p.start / 3600), ch);
    // bars: demand of the day (grey) and arrivals so far (color)
    const exp = dayChart.expected;
    const maxV = Math.max(1, ...exp, ...r.hourly.map((x) => x.arrivals));
    const bw = cw / 24;
    for (let i = 0; i < 24; i++) {
      const he = (exp[i] / maxV) * ch;
      ctx.fillStyle = '#e3e5df';
      ctx.fillRect(x(i) + 1, bottom - he, bw - 2, he);
      const va = r.hourly[i].arrivals;
      if (va) {
        const ha = (va / maxV) * ch;
        ctx.fillStyle = dayChart.accent;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x(i) + bw * 0.22, bottom - ha, bw * 0.56, ha);
        ctx.globalAlpha = 1;
      }
    }
    // red line: average wait of each hour
    const waits = r.hourly.map((x) => x.avg_wait_s);
    const known = waits.filter((v) => v !== null);
    if (known.length) {
      const maxW = Math.max(30, ...known);
      ctx.strokeStyle = '#dc2626';
      ctx.fillStyle = '#dc2626';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < 24; i++) {
        if (waits[i] === null) {
          open = false;
          continue;
        }
        const px = x(i + 0.5);
        const py = bottom - (waits[i] / maxW) * ch;
        if (open) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        open = true;
      }
      ctx.stroke();
      for (let i = 0; i < 24; i++) {
        if (waits[i] === null) continue;
        ctx.beginPath();
        ctx.arc(x(i + 0.5), bottom - (waits[i] / maxW) * ch, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      const worst = waits.indexOf(Math.max(...known));
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`espera máx. ${fmtWait(waits[worst])} (${String(worst).padStart(2, '0')}:00)`, w - CHART_PAD.r - 2, CHART_PAD.t + 10);
    }
    // hour labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px system-ui, sans-serif';
    for (let hh = 0; hh <= 24; hh += 3) {
      ctx.textAlign = hh === 0 ? 'left' : hh === 24 ? 'right' : 'center';
      ctx.fillText(`${hh}:00`, x(hh), h - 2);
    }
    // now
    const now = e.t >= e.duration ? 24 : engine.timeOfDay() / 3600;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(now), CHART_PAD.t);
    ctx.lineTo(x(now), bottom);
    ctx.stroke();
  }

  // Start the day at another hour (the 30 minutes before are simulated first so the roundabout is not empty).
  function jumpToHour(hour) {
    if ($('sel-profile').value !== 'day') return;
    ui.startHour = Math.max(0, Math.min(23, hour));
    const wasRunning = ui.running;
    reset();
    if (!wasRunning) $('btn-play').textContent = '▶ Iniciar';
  }
  $('sel-hour').addEventListener('change', (ev) => jumpToHour(Number(ev.target.value)));
  $('day-chart').addEventListener('click', (ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const hours = ((ev.clientX - rect.left - CHART_PAD.l) / (rect.width - CHART_PAD.l - CHART_PAD.r)) * 24;
    jumpToHour(Math.floor(hours));
  });

  // ---------- Dashboard ----------
  function buildApproachTable(e) {
    const body = $('approach-table').querySelector('tbody');
    body.innerHTML = '';
    for (const id of e.geo.entryIds) {
      const row = document.createElement('tr');
      row.dataset.id = id;
      const src = e.cfg.profile === 'test' ? null : countSource(e, id);
      const tag = src ? `<span class="src ${src}" title="Demanda diaria de este acceso: ${SOURCE_LABEL[src]}">${SOURCE_LABEL[src]}</span>` : '';
      row.innerHTML = `<td>${e.geo.byId[id].name}${tag}</td><td data-c="queue"></td><td data-c="max"></td><td data-c="wait"></td><td data-c="arrivals"></td>`;
      body.appendChild(row);
    }
  }

  function updateDashboard() {
    const e = engine.state;
    if (!e) return;
    const r = engine.summary();
    $('kpi-discharge').textContent = r.discharge_last_min;
    const test = e.cfg.profile === 'test';
    const hourNow = r.hourly[Math.floor(engine.timeOfDay() / 3600)];
    const waitHour = test ? r.avg_wait_s : hourNow.avg_wait_s ?? 0;
    $('kpi-wait').textContent = waitHour.toFixed(1);
    $('kpi-wait-caption').textContent = test ? 's · espera promedio' : `s · espera promedio esta hora (en el día: ${r.avg_wait_s.toFixed(1)} s)`;
    const queueNow = Object.values(r.queue_now).reduce((sum, x) => sum + x, 0);
    $('kpi-queue').textContent = queueNow;
    $('kpi-queue-caption').textContent = `veh · en cola ahora (máximo en un acceso: ${r.queue_max_overall})`;
    if (!test) drawDayChart(r);
    $('kpi-blocked').textContent = Math.round(r.blocked_time_s);
    for (const row of $('approach-table').querySelectorAll('tbody tr')) {
      const id = row.dataset.id;
      const cal = r.calibration[id];
      row.querySelector('[data-c=queue]').textContent = r.queue_now[id];
      row.querySelector('[data-c=max]').textContent = r.queue_max[id];
      const wait = r.avg_wait_by_approach_s[id];
      row.querySelector('[data-c=wait]').textContent = wait === null ? '–' : wait.toFixed(1) + ' s';
      const cell = row.querySelector('[data-c=arrivals]');
      if (cal.daily === null) cell.textContent = `${cal.simulated}`;
      else {
        const gone = r.diverted_by_approach[id] || 0;
        cell.textContent = `${cal.simulated.toLocaleString('es-CO')} / ${cal.daily.toLocaleString('es-CO')}` + (gone ? ` (−${gone.toLocaleString('es-CO')})` : '');
        cell.title = 'Llegaron hoy / demanda del día completo' + (gone ? `. Entre paréntesis: ${gone} se fueron por otra ruta al ver la fila` : '');
        cell.className = gone ? 'bad' : '';
      }
    }
    $('extra-metrics').textContent =
      `En el anillo: ${e.ring.length} · cruzaron ${r.vehicles_crossed.toLocaleString('es-CO')} de ${r.vehicles_generated.toLocaleString('es-CO')}` +
      (e.geo.bypasses.length ? ` (${r.vehicles_bypassed.toLocaleString('es-CO')} por el desvío, sin entrar)` : '') +
      (r.vehicles_diverted ? ` · se fueron por otra ruta: ${r.vehicles_diverted.toLocaleString('es-CO')}` : '') +
      ' · ' +
      `vehículos atravesados: ${r.blocking_vehicles}` +
      (ui.mode === 'current' ? '' : ` · verdes en conflicto: ${r.signal_conflicts}`) +
      (renderer.mapTiles && renderer.tilesStatus === 'failed' ? ' · ⚠ mapa de fondo no disponible (sin internet)' : '');
  }

  const PHASE_NAMES = { green: 'Verde', yellow: 'Amarillo', all_red: 'Todo rojo' };
  function updateClock() {
    const e = engine.state;
    if (!e) return;
    if (e.cfg.profile === 'test') {
      $('clock').textContent = `${Math.floor(e.t / 60)}:${String(Math.floor(e.t % 60)).padStart(2, '0')}`;
      $('day-period').textContent = 'Caso de prueba';
      $('day-period').className = 'period';
    } else {
      const tod = engine.timeOfDay();
      $('clock').textContent = e.t >= e.duration ? '24:00:00' : Sim.clockText(tod, true);
      const p = e.demand.periodAt(tod);
      $('day-period').textContent = e.t >= e.duration ? 'Fin del día' : p.name + (p.peak ? ' · pico y placa' : '');
      $('day-period').className = 'period' + (p.peak && e.t < e.duration ? ' peak' : '');
    }
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
      steps = Math.min(steps, 4000); // up to ×1200 at 30 frames per second
      for (let i = 0; i < steps && e.t < e.duration; i++) engine.step();
      if (e.t >= e.duration) {
        pause();
        $('btn-play').textContent = '▶ Iniciar';
      }
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
  // Runs 2 or 3 modes with the same seed (same arrivals) and shows the difference in charts:
  // tiles per metric, a line over time, bars per approach, and a PCA map of 15-minute blocks.
  const MODE_NAMES = { current: 'Actual', signal: 'Semáforo', officer: 'Agente' };
  const MODE_COLORS = { current: '#257de0', signal: '#f47230', officer: '#00b894' }; // categorical slots 1-3, fixed per mode
  const sumValues = (o) => Object.values(o).reduce((s, x) => s + x, 0);
  const TILE_METRICS = [
    ['Espera promedio', (r) => r.avg_wait_s, 'lower', (v) => `${v.toLocaleString('es-CO')} s`],
    ['Se fueron por otra ruta', (r) => r.vehicles_diverted || 0, 'lower', (v) => v.toLocaleString('es-CO')],
    ['Cruzaron la glorieta', (r) => r.vehicles_crossed, 'higher', (v) => v.toLocaleString('es-CO')],
    ['Evacuación promedio', (r) => r.discharge_avg_per_min, 'higher', (v) => `${v.toLocaleString('es-CO')} veh/min`],
    ['Cola máxima en un acceso', (r) => r.queue_max_overall, 'lower', (v) => `${v.toLocaleString('es-CO')} veh`],
    ['Anillo bloqueado', (r) => r.blocked_time_s, 'lower', (v) => `${Math.round(v).toLocaleString('es-CO')} s`],
  ];
  const ROWS = [
    ['Evacuación promedio (veh/min)', (r) => r.discharge_avg_per_min, 'higher'],
    ['Espera promedio (s)', (r) => r.avg_wait_s, 'lower'],
    ['Cola máxima (veh)', (r) => r.queue_max_overall, 'lower'],
    ['Vehículos que cruzaron', (r) => r.vehicles_crossed, 'higher'],
    ['Se fueron por otra ruta (fila muy larga)', (r) => r.vehicles_diverted || 0, 'lower'],
    ['Aún en cola al final', (r) => sumValues(r.queue_now), 'lower'],
    ['Anillo bloqueado (s)', (r) => r.blocked_time_s, 'lower'],
    ['Vehículos atravesados', (r) => r.blocking_vehicles, 'lower'],
  ];
  const LINE_METRICS = {
    wait: ['Espera promedio', (b) => b.avg_wait_s, (v) => `${Math.round(v)} s`, 'Segundos que esperaron, en promedio, los vehículos que entraron al anillo en cada bloque de 15 minutos.'],
    queue: ['Cola promedio', (b) => b.avg_queue, (v) => `${Math.round(v)} veh`, 'Vehículos en cola, sumando todos los accesos, en promedio durante cada bloque de 15 minutos.'],
    diverted: ['Se fueron', (b) => b.diverted, (v) => `${Math.round(v)} veh`, 'Vehículos que vieron una fila demasiado larga y se fueron por otra ruta, en cada bloque de 15 minutos.'],
    exited: ['Evacuados', (b) => b.exited, (v) => `${Math.round(v)} veh`, 'Vehículos que salieron de la glorieta en cada bloque de 15 minutos (más es mejor).'],
  };
  const BAR_METRICS = {
    wait: ['Espera promedio', (r, id) => r.avg_wait_by_approach_s[id] ?? 0, (v) => `${Math.round(v)} s`],
    diverted: ['Se fueron', (r, id) => r.diverted_by_approach[id] ?? 0, (v) => Math.round(v).toLocaleString('es-CO')],
    queue: ['Cola máxima', (r, id) => r.queue_max[id] ?? 0, (v) => `${Math.round(v)} veh`],
  };
  const cmpUi = { line: 'wait', bar: 'wait' };

  // Runs one scenario in slices so the page keeps responding (a whole day takes a few seconds per mode).
  function runInSlices(cfg, onProgress) {
    return new Promise((resolve) => {
      const runner = Sim.createEngine(data);
      runner.reset(cfg);
      const total = cfg.duration_s;
      let done = 0;
      (function next() {
        const n = Math.min(1800, total - done);
        runner.run(n);
        done += n;
        onProgress(done / total);
        if (done >= total) resolve(runner.summary());
        else setTimeout(next, 0);
      })();
    });
  }

  $('btn-compare').addEventListener('click', async () => {
    const modes = [...$('cmp-modes').querySelectorAll('input:checked')].map((x) => x.value);
    if (modes.length < 2) {
      $('cmp-progress').textContent = 'Elijan al menos dos modos.';
      return;
    }
    const base = currentConfig();
    base.profile = 'day';
    const choice = $('cmp-window').value;
    const label = $('cmp-window').selectedOptions[0].textContent;
    let start = 0;
    let duration = 86400;
    let warmup = 0;
    if (choice !== 'day') {
      const w = Sim.parseWindow(choice);
      start = w[0];
      duration = w[1] - w[0];
      warmup = WARMUP_S;
    }
    $('btn-compare').disabled = true;
    const results = [];
    for (const [i, mode] of modes.entries()) {
      const cfg = { ...base, mode, start_s: start, warmup_s: warmup, duration_s: duration };
      results.push(
        await runInSlices(cfg, (f) => {
          $('cmp-progress').textContent = `Corriendo ${MODE_NAMES[mode]} (${i + 1} de ${modes.length})… ${Math.round(f * 100)} %`;
        }),
      );
    }
    $('btn-compare').disabled = false;
    $('cmp-progress').textContent = '';
    ui.comparison = { config: { ...base, start_s: start, duration_s: duration, window: label }, modes, results };
    renderComparison();
    openComparison();
  });

  function renderComparison() {
    const c = ui.comparison;
    const site = data.geometry.sites[c.config.site];
    const nameOf = (id) => (site.approaches.find((x) => x.id === id) || { name: id }).name;
    const first = c.results[0];
    const rows = ROWS.map(([name, f, better]) => [name, c.results.map(f), better]);
    for (const id of Object.keys(first.queue_max)) {
      rows.push([`Cola máx · ${nameOf(id)}`, c.results.map((r) => r.queue_max[id]), 'lower']);
      rows.push([`Espera · ${nameOf(id)} (s)`, c.results.map((r) => r.avg_wait_by_approach_s[id] ?? 0), 'lower']);
      rows.push([`Se fueron · ${nameOf(id)}`, c.results.map((r) => r.diverted_by_approach[id] ?? 0), 'lower']);
    }
    c.rows = rows.map(([metric, values]) => ({ metric, ...Object.fromEntries(c.modes.map((m, i) => [m, values[i]])) }));
    // full table (difference against the first mode)
    let html = `<table class="table"><thead><tr><th>Métrica</th>${c.modes.map((m) => `<th>${MODE_NAMES[m]}</th>`).join('')}</tr></thead><tbody>`;
    for (const [name, values, better] of rows) {
      html += `<tr><td>${name}</td>` + values.map((v, i) => {
        if (i === 0) return `<td>${v}</td>`;
        const d = Math.round((v - values[0]) * 10) / 10;
        const cls = d === 0 ? '' : (d > 0) === (better === 'higher') ? 'good' : 'bad';
        return `<td>${v} <small class="${cls}">(${d > 0 ? '+' : ''}${d})</small></td>`;
      }).join('') + '</tr>';
    }
    html += `</tbody></table><p class="note">Entre paréntesis, la diferencia contra ${MODE_NAMES[c.modes[0]]}. Verde: mejor; rojo: peor.</p>`;
    $('cmp-table').innerHTML = html;
    // short summary in the panel
    const byWait = c.modes.map((m, i) => [m, c.results[i]]).sort((x, y) => x[1].avg_wait_s + (x[1].vehicles_diverted || 0) * 60 - (y[1].avg_wait_s + (y[1].vehicles_diverted || 0) * 60));
    $('cmp-summary').innerHTML =
      `<p class="note">${site.name} · ${c.config.window} · semilla ${c.config.seed}</p>` +
      c.modes.map((m, i) => `<div class="tile-line"><i class="sw" style="background:${MODE_COLORS[m]}"></i><b>${MODE_NAMES[m]}</b>: espera ${c.results[i].avg_wait_s} s · se fueron ${(c.results[i].vehicles_diverted || 0).toLocaleString('es-CO')}</div>`).join('') +
      `<p class="note">Mejor en esta franja: <b>${MODE_NAMES[byWait[0][0]]}</b> (menos espera y menos vehículos que se van).</p>`;
    $('cmp-card').hidden = false;
  }

  function openComparison() {
    $('cmp-view').hidden = false;
    drawComparisonCharts();
  }
  $('btn-cmp-open').addEventListener('click', openComparison);
  $('btn-cmp-close').addEventListener('click', () => ($('cmp-view').hidden = true));
  window.addEventListener('resize', () => {
    if (!$('cmp-view').hidden) drawComparisonCharts();
  });

  function chips(container, options, current, onPick) {
    container.innerHTML = '';
    for (const [key, [name]] of Object.entries(options)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.classList.toggle('active', key === current);
      b.addEventListener('click', () => onPick(key));
      container.appendChild(b);
    }
  }

  function drawComparisonCharts() {
    const c = ui.comparison;
    if (!c) return;
    const site = data.geometry.sites[c.config.site];
    const nameOf = (id) => (site.approaches.find((x) => x.id === id) || { name: id }).name;
    const series = c.modes.map((m) => ({ id: m, name: MODE_NAMES[m], color: MODE_COLORS[m] }));
    $('cmp-meta').textContent = `${site.name} · ${c.config.window} · semilla ${c.config.seed} · mismas llegadas en todos los modos`;

    // Tiles: one per metric, every mode, difference against the first one
    $('cmp-tiles').innerHTML = TILE_METRICS.map(([name, f, better, fmt]) => {
      const values = c.results.map(f);
      const rows = c.modes.map((m, i) => {
        let delta = '';
        if (i > 0) {
          const base = values[0];
          const d = values[i] - base;
          const rel = base ? Math.round((d / base) * 100) : null;
          const good = d === 0 ? '' : (d > 0) === (better === 'higher') ? 'good' : 'bad';
          const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '=';
          delta = `<span class="delta ${good}">${arrow} ${rel === null ? fmt(Math.abs(d)) : Math.abs(rel) + ' %'}</span>`;
        }
        return `<div class="row"><i style="background:${MODE_COLORS[m]}"></i><span>${MODE_NAMES[m]}</span>&nbsp;<b>${fmt(values[i])}</b>${delta}</div>`;
      });
      return `<div class="tile"><h4>${name}</h4>${rows.join('')}</div>`;
    }).join('');

    // Line over time (15-minute blocks inside the compared window)
    const first = c.config.start_s / 900;
    const count = Math.round(c.config.duration_s / 900);
    const idx = Array.from({ length: count }, (_, k) => (first + k) % 96);
    const [lname, lget, lfmt, lnote] = LINE_METRICS[cmpUi.line];
    chips($('cmp-line-metric'), LINE_METRICS, cmpUi.line, (k) => {
      cmpUi.line = k;
      drawComparisonCharts();
    });
    $('cmp-line-note').textContent = lnote + ' Franjas naranjas: horas pico.';
    const demand = engine.state.demand;
    const bands = [];
    for (const p of demand.periods.filter((p) => p.peak)) {
      const from = idx.findIndex((b) => b * 900 >= p.start);
      let to = idx.findIndex((b) => b * 900 >= p.end);
      if (from < 0) continue;
      if (to < 0) to = idx.length - 1;
      if (to > from) bands.push({ from, to });
    }
    Sim.Charts.line($('cmp-line'), {
      labels: idx.map((b) => Sim.clockText(b * 900)),
      series: series.map((s, i) => ({ ...s, values: idx.map((b) => {
        const v = lget(c.results[i].blocks[b]);
        return v === undefined ? null : v;
      }) })),
      format: (v) => lfmt(v),
      bands,
    });

    // Bars per approach
    chips($('cmp-bar-metric'), BAR_METRICS, cmpUi.bar, (k) => {
      cmpUi.bar = k;
      drawComparisonCharts();
    });
    const [, bget, bfmt] = BAR_METRICS[cmpUi.bar];
    const ids = Object.keys(c.results[0].queue_max);
    Sim.Charts.bars($('cmp-bars'), {
      categories: ids.map(nameOf),
      series: series.map((s, i) => ({ ...s, values: ids.map((id) => bget(c.results[i], id)) })),
      format: bfmt,
    });

    // PCA: each 15-minute block of each mode is a point described by five metrics
    // "Atendidos / llegadas": vehicles that left per vehicle that arrived in the block (1 = keeping up,
    // below 1 = the queue grows). Raw throughput is left out on purpose: it mostly measures how busy the hour is.
    const FEATURES = ['Espera', 'Cola', 'Se fueron', 'Atendidos / llegadas', 'Anillo bloqueado'];
    const active = idx.filter((b) => c.results.some((r) => r.blocks[b].arrivals > 0));
    const rowsPca = [];
    const groups = [];
    const pts = [];
    c.modes.forEach((m, i) => {
      for (const b of active) {
        const x = c.results[i].blocks[b];
        const served = x.arrivals ? Math.min(2, x.exited / x.arrivals) : 1;
        rowsPca.push([x.avg_wait_s ?? 0, x.avg_queue, x.diverted, served, x.blocked_s]);
        groups.push(m);
        pts.push({ series: m, label: Sim.clockText(b * 900), detail: `Espera ${Math.round(x.avg_wait_s ?? 0)} s · cola ${Math.round(x.avg_queue)} · se fueron ${x.diverted} · llegaron ${x.arrivals}, salieron ${x.exited}` });
      }
    });
    const pca = Sim.pca(rowsPca, FEATURES, 'Espera'); // more wait always to the right
    if (!pca) {
      $('cmp-pca-text').innerHTML = '<p>No hay suficientes bloques con tráfico para el PCA en esta franja.</p>';
      $('cmp-pca').innerHTML = '';
      return;
    }
    const PHRASES = { Espera: 'espera', Cola: 'cola', 'Se fueron': 'vehículos que se van por otra ruta', 'Atendidos / llegadas': 'vehículos atendidos por cada uno que llega', 'Anillo bloqueado': 'tiempo con el anillo bloqueado' };
    $('cmp-pca-text').innerHTML = Sim.describePca(pca, groups, MODE_NAMES, PHRASES).map((t) => `<p>${t}</p>`).join('');
    Sim.Charts.scatter($('cmp-pca'), {
      points: pts.map((p, i) => ({ ...p, x: pca.scores[i][0], y: pca.scores[i][1] })),
      series,
      loadings: pca.loadings.map((l) => ({ name: l.name, x: l.pc1, y: l.pc2 })),
      xTitle: `Componente 1 (${Math.round(pca.explained[0] * 100)} %) →`,
      yTitle: `Componente 2 (${Math.round(pca.explained[1] * 100)} %) →`,
    });
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
    const rows = [['metric', ...c.modes.map((m) => Sim.MODES[m])]];
    for (const r of c.rows) rows.push([r.metric, ...c.modes.map((m) => r[m])]);
    download(`comparison-${c.config.site}-${c.config.window.split(' (')[0].replace(/\s+/g, '-')}-seed${c.config.seed}.csv`, toCsv(rows), 'text/csv');
  });
  $('exp-cmp-json').addEventListener('click', () => {
    const c = ui.comparison;
    if (!c) return;
    download(`comparison-${c.config.site}-${c.config.window.split(' (')[0].replace(/\s+/g, '-')}-seed${c.config.seed}.json`, JSON.stringify(c, null, 2), 'application/json');
  });
  $('exp-veh-csv').addEventListener('click', () => {
    const detail = engine.vehicleDetail();
    if (!detail.length) return;
    const cols = Object.keys(detail[0]);
    const cfg = engine.state.cfg;
    download(`vehicles-${cfg.site}-${cfg.profile}-${cfg.mode}-seed${cfg.seed}.csv`, toCsv([cols, ...detail.map((v) => cols.map((k) => v[k]))]), 'text/csv');
  });

  $('exp-hour-csv').addEventListener('click', () => {
    const e = engine.state;
    if (!e || e.cfg.profile === 'test') return;
    const r = engine.summary();
    const rows = [['hour', 'period', 'expected_arrivals', 'arrivals', 'diverted', 'crossed', 'exited', 'avg_wait_s', 'max_queue', 'ring_blocked_s']];
    for (const x of r.hourly) {
      if (!x.simulated) continue;
      rows.push([`${String(x.hour).padStart(2, '0')}:00`, e.demand.periodAt(x.hour * 3600 + 1800).name, Math.round(dayChart.expected[x.hour]), x.arrivals, x.diverted, x.crossed, x.exited, x.avg_wait_s, x.queue_max, x.blocked_s]);
    }
    download(`hourly-${e.cfg.site}-${e.cfg.mode}-seed${e.cfg.seed}.csv`, toCsv(rows), 'text/csv');
  });

  // ---------- Start ----------
  markActive($('modes'), 'mode', ui.mode);
  markActive($('speeds'), 'speed', ui.speed);
  reset();
  requestAnimationFrame(frame);
})();
