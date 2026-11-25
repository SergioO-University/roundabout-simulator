// pca.js
// Principal Component Analysis (PCA) for the scenario comparison.
// Each row is one 15-minute block of one scenario, described by several metrics (wait, queue, diverted,
// discharge, blocked ring). The metrics have different units, so each one is standardized first
// (mean 0, standard deviation 1): PCA then works on the correlation matrix. Its eigenvectors are the new axes
// (principal components); the eigenvalues say how much of the total variation each axis explains.
// With 2 axes, a cloud of points per scenario shows at a glance whether the scenarios behave differently and
// which metrics separate them (the loadings, drawn as arrows).
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  // Eigenvalues and eigenvectors of a symmetric matrix (cyclic Jacobi rotations). Small matrices only.
  function jacobi(A) {
    const n = A.length;
    const a = A.map((r) => r.slice());
    const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
      if (off < 1e-20) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(a[p][q]) < 1e-15) continue;
          const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = a[k][p];
            const akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = a[p][k];
            const aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = v[k][p];
            const vkq = v[k][q];
            v[k][p] = c * vkp - s * vkq;
            v[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const values = a.map((r, i) => r[i]);
    const vectors = values.map((_, j) => v.map((r) => r[j])); // vectors[j] = eigenvector j
    return { values, vectors };
  }

  // rows: array of numeric arrays (same length). names: one name per column.
  // Returns { features, scores: [[pc1, pc2]...], loadings: [{name, pc1, pc2}], explained: [r1, r2], dropped }.
  // Columns that never change are dropped (they carry no information and cannot be standardized).
  // orient (optional): name of a metric that must grow to the right on axis 1 and upwards on axis 2 is left
  // as computed. Without it, the sign follows the largest loading (the sign of an axis is arbitrary in PCA).
  Sim.pca = function (rows, names, orient) {
    const n = rows.length;
    const keep = [];
    const dropped = [];
    const mean = [];
    const sd = [];
    names.forEach((name, j) => {
      const col = rows.map((r) => r[j]);
      const m = col.reduce((s, x) => s + x, 0) / n;
      const variance = col.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, n - 1);
      if (variance > 1e-12) {
        keep.push(j);
        mean.push(m);
        sd.push(Math.sqrt(variance));
      } else dropped.push(name);
    });
    const d = keep.length;
    if (n < 3 || d < 2) return null;
    const Z = rows.map((r) => keep.map((j, k) => (r[j] - mean[k]) / sd[k]));
    const R = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const z of Z) for (let i = 0; i < d; i++) for (let k = 0; k < d; k++) R[i][k] += z[i] * z[k];
    for (let i = 0; i < d; i++) for (let k = 0; k < d; k++) R[i][k] /= n - 1;
    const { values, vectors } = jacobi(R);
    const order = values.map((_, i) => i).sort((x, y) => values[y] - values[x]);
    const total = values.reduce((s, x) => s + Math.max(0, x), 0);
    const pcs = order.slice(0, 2).map((i) => {
      const vec = vectors[i].slice();
      // Sign convention: the largest loading points to the positive side (so "right" means "more of it").
      const big = vec.reduce((b, x, k) => (Math.abs(x) > Math.abs(vec[b]) ? k : b), 0);
      if (vec[big] < 0) for (let k = 0; k < d; k++) vec[k] = -vec[k];
      return { value: Math.max(0, values[i]), vec };
    });
    const oi = orient ? keep.indexOf(names.indexOf(orient)) : -1;
    if (oi >= 0 && pcs[0].vec[oi] < 0) for (let k = 0; k < d; k++) pcs[0].vec[k] = -pcs[0].vec[k];
    const scores = Z.map((z) => pcs.map((pc) => z.reduce((s, x, k) => s + x * pc.vec[k], 0)));
    // Loadings as correlations between each metric and each component (eigenvector × sqrt(eigenvalue)).
    const loadings = keep.map((j, k) => ({ name: names[j], pc1: pcs[0].vec[k] * Math.sqrt(pcs[0].value), pc2: pcs[1].vec[k] * Math.sqrt(pcs[1].value) }));
    return { features: keep.map((j) => names[j]), scores, loadings, explained: pcs.map((pc) => (total ? pc.value / total : 0)), dropped };
  };

  // Plain-language reading of a PCA of scenarios (Spanish, for the team). The PCA must be oriented so that
  // congestion (the `orient` metric) grows to the right: the scenario furthest left is then the best one.
  // groups: the scenario of each row (same order as the rows passed to Sim.pca); groupNames: id -> name.
  // phrases (optional): metric name -> how to say "more of it" in a sentence.
  Sim.describePca = function (result, groups, groupNames, phrases = {}) {
    if (!result) return [];
    const lines = [];
    const pct = (x) => `${Math.round(x * 100)} %`;
    const strong = result.loadings.filter((l) => Math.abs(l.pc1) >= 0.5).sort((a, b) => Math.abs(b.pc1) - Math.abs(a.pc1));
    const say = (l) => phrases[l.name] || l.name.toLowerCase();
    const pos = strong.filter((l) => l.pc1 > 0).map(say);
    const neg = strong.filter((l) => l.pc1 < 0).map(say);
    const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs[0]);
    lines.push(
      `El eje horizontal (componente 1) resume el ${pct(result.explained[0])} de toda la variación` +
        (pos.length ? `: hacia la derecha hay más ${list(pos)}` : '') +
        (neg.length ? `${pos.length ? '; ' : ': '}hacia la izquierda, más ${list(neg)}` : '') +
        `. El vertical (componente 2) suma otro ${pct(result.explained[1])}.`,
    );
    // Where each scenario sits on the first axis (its average), and how much of it is in the "bad" zone.
    const ids = [...new Set(groups)];
    const centre = {};
    for (const id of ids) {
      const xs = result.scores.filter((_, i) => groups[i] === id).map((s) => s[0]);
      centre[id] = xs.reduce((s, x) => s + x, 0) / xs.length;
    }
    const sorted = [...ids].sort((a, b) => centre[a] - centre[b]);
    if (sorted.length >= 2 && pos.length) {
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const gap = centre[worst] - centre[best];
      lines.push(
        gap < 0.5
          ? 'Las nubes de los escenarios casi se superponen: en estas métricas se comportan parecido.'
          : `${groupNames[worst]} queda más a la derecha (más ${list(pos)}) y ${groupNames[best]} más a la izquierda: ` +
              `${groupNames[best]} es el que mejor atiende la glorieta en esta franja.`,
      );
    }
    lines.push('Cada punto es un bloque de 15 minutos; los puntos pegados al centro son horas tranquilas, donde todos los escenarios se parecen.');
    return lines;
  };
})();
