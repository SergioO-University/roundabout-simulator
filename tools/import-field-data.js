// Imports the field spreadsheet ("Planilla de campo", downloaded as .xlsx) into data/counts.json.
// Run from the project root:
//   node tools/import-field-data.js                       (reads data/field/planilla-campo.xlsx)
//   node tools/import-field-data.js path/to/file.xlsx
//   node tools/import-field-data.js --dry-run             (checks everything, writes nothing)
//
// Reads the tabs "Conteos", "Giros", "Bloqueos", "Tiempos" and "Brazos" (names and column headers
// as in the template). Approaches can be written by their name ("Calle 31 (sur)") or id ("calle31_sur").
// Nothing is written if there are errors. No dependencies: the .xlsx is unzipped with Node's zlib.
// Messages are in Spanish because the whole team runs this script.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'data/field/planilla-campo.xlsx');

const errors = [];
const warnings = [];

// ---------- Minimal .xlsx reader ----------
function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo no parece un .xlsx (no es un zip válido).');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buffer.subarray(start, start + compSize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const textOf = (xml) => decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readWorkbook(filePath) {
  const files = unzip(fs.readFileSync(filePath));
  const str = (name) => (files[name] ? files[name].toString('utf8') : '');
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = {};
  for (const m of str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const target = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && target) rels[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = {};
  for (const m of str('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode((m[0].match(/name="([^"]+)"/) || [])[1] || '');
    const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
    const xml = str('xl/' + rels[rid]);
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] || '';
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/t="([^"]+)"/) || [])[1];
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = null;
        if (type === 's') value = shared[Number(v)];
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str') value = v === undefined ? null : decode(v);
        else if (type === 'b') value = v === '1';
        else if (type === 'e') value = null;
        else if (v !== undefined) value = Number(v);
        if (ref) row[colIndex(ref)] = value;
      }
      rows.push(row);
    }
    sheets[name] = rows;
  }
  return sheets;
}

// ---------- Helpers ----------
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Turns a tab into objects keyed by normalized header (first row).
function table(sheets, name, required) {
  const key = Object.keys(sheets).find((k) => norm(k) === norm(name));
  if (!key) {
    if (required) errors.push(`No se encontró la pestaña "${name}".`);
    return [];
  }
  const [header = [], ...rows] = sheets[key];
  const cols = header.map(norm);
  return rows
    .map((r, i) => ({ _row: i + 2, ...Object.fromEntries(cols.map((c, j) => [c, r[j] ?? null])) }))
    .filter((o) => Object.entries(o).some(([k, v]) => k !== '_row' && v !== null && v !== ''));
}

// Excel stores dates as days since 1899-12-30 and times as fractions of a day.
const excelDate = (v) => (isNum(v) ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : v ? String(v) : null);
const excelTime = (v) => {
  if (!isNum(v)) return v ? String(v) : null;
  const minutes = Math.round((v % 1) * 1440);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const addMinutes = (hhmm, add) => {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]) + add;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// ---------- Main ----------
if (!fs.existsSync(file)) {
  console.error(`No existe ${path.relative(ROOT, file)}. Descarguen la planilla como .xlsx y guárdenla ahí.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/osm/sites.json'), 'utf8'));
const siteKey = config.active_site;
const site = config.sites[siteKey];
const byName = new Map();
for (const a of site.approaches) {
  byName.set(norm(a.id), a);
  byName.set(norm(a.name), a);
}
const entries = site.approaches.filter((a) => a.entry);
const exits = site.approaches.filter((a) => a.exit);
const PROFILES = { pico: 'peak', valle: 'offpeak', peak: 'peak', offpeak: 'offpeak' };
const TYPES = { motos: 'motorcycle', carros: 'car', busetas: 'bus' };

const sheets = readWorkbook(file);
console.log(`Leyendo ${path.relative(ROOT, file)} · punto activo: ${site.name}\n`);

// Conteos
const profiles = {};
const intervals = {};
const firstTime = {};
for (const r of table(sheets, 'Conteos', true)) {
  const prof = PROFILES[norm(r.perfil)];
  const ap = byName.get(norm(r.acceso));
  if (!prof) {
    errors.push(`Conteos fila ${r._row}: perfil "${r.perfil ?? ''}" no válido (use Pico o Valle).`);
    continue;
  }
  if (!ap || !ap.entry) {
    errors.push(`Conteos fila ${r._row}: el acceso "${r.acceso ?? ''}" no existe o no tiene entrada en ${site.name}.`);
    continue;
  }
  const counts = Object.fromEntries(Object.entries(TYPES).map(([col, type]) => [type, r[col]]));
  if (Object.values(counts).every((v) => v === null || v === '')) {
    errors.push(`Conteos fila ${r._row}: ${ap.name}, ${r.perfil}, ${r.intervalo ?? 'sin intervalo'} no tiene ningún conteo.`);
    continue;
  }
  for (const [type, v] of Object.entries(counts)) {
    if (v !== null && v !== '' && (!isNum(v) || v < 0 || !Number.isInteger(v))) {
      errors.push(`Conteos fila ${r._row}: "${v}" no es un número entero válido.`);
    }
  }
  profiles[prof] ??= {};
  profiles[prof][ap.id] ??= { motorcycle: 0, car: 0, bus: 0 };
  for (const [type, v] of Object.entries(counts)) if (isNum(v)) profiles[prof][ap.id][type] += v;
  const k = `${prof}|${ap.id}`;
  intervals[k] = (intervals[k] || 0) + 1;
  if (!firstTime[prof] && r['hora inicio']) firstTime[prof] = { date: excelDate(r.fecha), time: excelTime(r['hora inicio']) };
}
for (const prof of Object.keys(profiles)) {
  for (const a of entries) {
    const n = intervals[`${prof}|${a.id}`] || 0;
    if (n !== 3) errors.push(`Conteos: ${a.name} en ${prof === 'peak' ? 'pico' : 'valle'} tiene ${n} de 3 intervalos llenos.`);
  }
}
if (!profiles.peak) errors.push('Conteos: no hay ningún conteo de hora pico.');
if (!profiles.offpeak) warnings.push('Conteos: no hay conteos de hora valle; solo se cargará el perfil pico.');

// Giros
const observed = {};
for (const r of table(sheets, 'Giros', false)) {
  const from = byName.get(norm(r['acceso origen']));
  const to = byName.get(norm(r['salida destino']));
  const n = r['vehiculos observados'];
  if (n === null || n === '') continue;
  if (!from || !from.entry) errors.push(`Giros fila ${r._row}: acceso de origen "${r['acceso origen']}" no válido.`);
  else if (!to || !to.exit) errors.push(`Giros fila ${r._row}: salida "${r['salida destino']}" no válida.`);
  else if (!isNum(n) || n < 0) errors.push(`Giros fila ${r._row}: "${n}" no es un número válido.`);
  else {
    observed[from.id] ??= {};
    observed[from.id][to.id] = (observed[from.id][to.id] || 0) + n;
  }
}
const previous = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/counts.json'), 'utf8'));
const prevSite = previous.sites[siteKey] || {};
const turning = {};
for (const a of entries) {
  const obs = observed[a.id] || {};
  const total = Object.values(obs).reduce((s, x) => s + x, 0);
  if (total > 0) {
    turning[a.id] = Object.fromEntries(exits.map((x) => [x.id, Math.round(((obs[x.id] || 0) / total) * 1000) / 1000]));
  } else {
    warnings.push(`Giros: ${a.name} no tiene observaciones; se mantienen los giros anteriores${prevSite.is_test_data ? ' (que son de prueba)' : ''}.`);
    if (prevSite.turning && prevSite.turning[a.id]) turning[a.id] = prevSite.turning[a.id];
  }
}

// Bloqueos
const blockages = table(sheets, 'Bloqueos', false).map((r) => ({
  profile: PROFILES[norm(r.perfil)] || null,
  time: excelTime(r.hora),
  duration_s: isNum(r['duracion (s)']) ? r['duracion (s)'] : null,
  affected: (byName.get(norm(r['acceso o salida afectada'])) || {}).id || r['acceso o salida afectada'] || null,
  cause: r.causa || null,
  description: r.descripcion || null,
  video_minute: r['minuto del video'] ?? null,
}));

// Tiempos: average speed per type, printed so parameters.json can be updated by hand
const speeds = { moto: [], carro: [], buseta: [] };
for (const r of table(sheets, 'Tiempos', false)) {
  const t = norm(r.tipo);
  const d = r['distancia (m)'];
  const s = r['tiempo (s)'];
  if (!speeds[t] || !isNum(d) || !isNum(s) || s <= 0) continue;
  speeds[t].push(d / s);
}

// Brazos: compare what was seen in the field with data/osm/sites.json
const brazos = table(sheets, 'Brazos', false);

if (warnings.length) {
  console.log('Avisos:');
  for (const w of warnings) console.log('  · ' + w);
  console.log('');
}
if (errors.length) {
  console.log('Errores (no se escribió nada):');
  for (const e of errors) console.log('  ✘ ' + e);
  process.exit(1);
}

// Summary
console.log('Conteos por acceso (vehículos en 15 minutos):');
for (const [prof, label] of [['peak', 'Pico'], ['offpeak', 'Valle']]) {
  if (!profiles[prof]) continue;
  const when = firstTime[prof] ? ` · ${firstTime[prof].date || ''} ${firstTime[prof].time || ''}` : '';
  console.log(`  ${label}${when}`);
  for (const a of entries) {
    const c = profiles[prof][a.id];
    console.log(`    ${a.name.padEnd(32)} ${String(c.motorcycle + c.car + c.bus).padStart(4)}  (motos ${c.motorcycle}, carros ${c.car}, busetas ${c.bus})`);
  }
}
console.log(`\nBloqueos registrados: ${blockages.length}`);
const speedLines = Object.entries(speeds).filter(([, list]) => list.length);
if (speedLines.length) {
  console.log('\nVelocidad promedio medida (pasar a data/parameters.json → vehicles.*.max_speed_ms):');
  for (const [t, list] of speedLines) {
    const avg = list.reduce((s, x) => s + x, 0) / list.length;
    console.log(`  ${t.padEnd(7)} ${avg.toFixed(1)} m/s (${(avg * 3.6).toFixed(0)} km/h) · ${list.length} mediciones`);
  }
}
const lanesNote = [];
for (const r of brazos) {
  const a = byName.get(norm(r['acceso (id)'])) || byName.get(norm(r['nombre en el simulador']));
  if (!a) continue;
  const inLanes = r['carriles de entrada'];
  const outLanes = r['carriles de salida'];
  if (isNum(inLanes) && a.entry && inLanes !== a.entry_lanes) lanesNote.push(`${a.name}: entrada ${a.entry_lanes} → ${inLanes} carriles`);
  if (isNum(outLanes) && a.exit && outLanes !== a.exit_lanes) lanesNote.push(`${a.name}: salida ${a.exit_lanes} → ${outLanes} carriles`);
  if (r['nombre real de la via'] && norm(r['nombre real de la via']) !== norm(a.name)) lanesNote.push(`${a.name}: nombre real "${r['nombre real de la via']}"`);
}
if (lanesNote.length) {
  console.log('\nDiferencias con data/osm/sites.json (corregir a mano y correr node tools/build-geometry.js):');
  for (const l of lanesNote) console.log('  · ' + l);
}

const timeLabel = (prof) => {
  const f = firstTime[prof];
  if (!f || !f.time) return 'sin hora';
  const end = addMinutes(f.time, 15);
  return end ? `${f.time}-${end}` : f.time;
};
const newSite = {
  site: site.name,
  is_test_data: false,
  coordinates: prevSite.coordinates ?? null,
  profiles: Object.fromEntries(
    Object.entries(profiles).map(([prof, approaches]) => [
      prof,
      { time: timeLabel(prof), date: firstTime[prof] ? firstTime[prof].date : null, approaches },
    ]),
  ),
  turning,
  observed_blockages: blockages,
};
if (dryRun) {
  console.log('\n--dry-run: todo está bien, pero no se escribió nada.');
  process.exit(0);
}
previous.sites[siteKey] = newSite;
previous.note = 'Field counts imported with tools/import-field-data.js. Sites still marked is_test_data have made-up counts.';
fs.writeFileSync(path.join(ROOT, 'data/counts.json'), JSON.stringify(previous, null, 2) + '\n');
console.log(`\ndata/counts.json actualizado para ${site.name}. Siguiente: node tools/embed-data.js y node tests/engine.test.js`);
