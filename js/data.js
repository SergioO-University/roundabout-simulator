// data.js
// Loads geometry.json, counts.json and parameters.json.
//  - When the page is served (GitHub Pages or Live Server), it reads the .json files directly.
//  - When opened by double click (file://, no internet), the browser blocks fetch() on .json files,
//    so it uses the copy in data/embedded-data.js. After editing a .json, regenerate that copy with:
//        node tools/embed-data.js
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  Sim.loadData = async function () {
    if (location.protocol.startsWith('http')) {
      try {
        const read = async (name) => {
          const r = await fetch(`data/${name}.json`, { cache: 'no-store' });
          if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
          return r.json();
        };
        const [geometry, counts, parameters] = await Promise.all([read('geometry'), read('counts'), read('parameters')]);
        return { geometry, counts, parameters, source: 'archivos .json' };
      } catch (err) {
        console.warn('Could not read the .json files, using the embedded copy.', err);
      }
    }
    if (globalThis.EMBEDDED_DATA) {
      return { ...JSON.parse(JSON.stringify(globalThis.EMBEDDED_DATA)), source: 'copia embebida (embedded-data.js)' };
    }
    throw new Error('No se encontraron los datos. Abra la página con Live Server o genere data/embedded-data.js.');
  };
})();
