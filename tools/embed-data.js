// Copies the .json files (geometry, counts, parameters, daily-profile, calibration, osm/sites, samples/index) into data/embedded-data.js so the simulator works
// by opening index.html with a double click, with no server and no internet.
// Run from the project root after editing any .json:   node tools/embed-data.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
const data = { geometry: read('geometry'), counts: read('counts'), parameters: read('parameters'), dayProfile: read('daily-profile') };
if (fs.existsSync(path.join(dir, 'calibration.json'))) data.calibration = read('calibration');
// For the page's "Probar muestras" button: approach settings and the samples already in the repo.
data.sitesConfig = read('osm/sites');
if (fs.existsSync(path.join(dir, 'samples', 'index.json'))) data.samples = read('samples/index');
const output =
  '// GENERATED FILE (tools/embed-data.js). Do not edit by hand: edit the .json files and regenerate.\n' +
  'globalThis.EMBEDDED_DATA = ' +
  JSON.stringify(data, null, 2) +
  ';\n';
fs.writeFileSync(path.join(dir, 'embedded-data.js'), output);
console.log('data/embedded-data.js updated.');
