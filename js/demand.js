// demand.js
// Demand over a whole day, from data/daily-profile.json (share of the day's traffic in each hour, per vehicle type).
//  - A field count of any time window (for example 16:37-16:52) becomes a daily total:
//        daily = count / (share of the day that falls in that window)
//  - The daily total is spread back over the 96 blocks of 15 minutes of the day. Inside each hour the rate
//    changes smoothly (straight lines between the middle of consecutive hours), so there are no jumps on the hour.
//  - Each block gets a whole number of vehicles; the rounding is cumulative over the day, so the 96 blocks
//    add up exactly to the daily total.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const DAY_S = 86400;
  const BLOCK_S = 900;
  const BLOCKS = DAY_S / BLOCK_S; // 96
  const TYPES = ['motorcycle', 'car', 'bus'];
  Sim.DAY_S = DAY_S;

  // "16:37-16:52" -> [59820, 60720] (seconds of the day). A window that crosses midnight ends after 86400.
  Sim.parseWindow = function (text) {
    const m = String(text || '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
    if (!m) return null;
    const a = (Number(m[1]) * 60 + Number(m[2])) * 60;
    let b = (Number(m[3]) * 60 + Number(m[4])) * 60;
    if (b <= a) b += DAY_S;
    return [a, b];
  };

  // 59820 -> "16:37"
  Sim.clockText = function (seconds, withSeconds) {
    const s = ((Math.floor(seconds) % DAY_S) + DAY_S) % DAY_S;
    const h = Math.floor(s / 3600);
    const mi = Math.floor((s % 3600) / 60);
    const text = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    return withSeconds ? `${text}:${String(s % 60).padStart(2, '0')}` : text;
  };

  Sim.createDemand = function (dayProfile) {
    const shares = {}; // type -> 96 fractions that add up to 1
    const cumulative = {}; // type -> 97 values: share of the day before each block
    for (const type of TYPES) {
      const hourly = dayProfile.hourly_share_pct[type] || dayProfile.hourly_share_pct.car;
      const rateAt = (hours) => {
        // linear between the middle of hour h (value hourly[h]) and the middle of hour h+1
        const x = hours - 0.5;
        const h0 = Math.floor(x);
        const f = x - h0;
        const v0 = hourly[((h0 % 24) + 24) % 24];
        const v1 = hourly[(((h0 + 1) % 24) + 24) % 24];
        return v0 + (v1 - v0) * f;
      };
      const raw = [];
      for (let b = 0; b < BLOCKS; b++) raw.push(Math.max(0, rateAt((b + 0.5) / 4)));
      const total = raw.reduce((s, x) => s + x, 0);
      shares[type] = raw.map((x) => x / total);
      cumulative[type] = [0];
      for (let b = 0; b < BLOCKS; b++) cumulative[type].push(cumulative[type][b] + shares[type][b]);
    }

    const periods = (dayProfile.periods || []).map((p) => {
      const w = Sim.parseWindow(`${p.from}-${p.to === '24:00' ? '00:00' : p.to}`);
      return { ...p, start: w[0], end: w[1] };
    });

    const demand = {
      profile: dayProfile,
      shares,
      // Share of the day's vehicles of this type that arrive between two instants (seconds of the day).
      windowShare(type, from, to) {
        let total = 0;
        for (let t = from; t < to; ) {
          const tod = ((t % DAY_S) + DAY_S) % DAY_S;
          const b = Math.floor(tod / BLOCK_S);
          const blockEnd = t - tod + (b + 1) * BLOCK_S;
          const until = Math.min(to, blockEnd);
          total += (shares[type][b] * (until - t)) / BLOCK_S;
          t = until;
        }
        return total;
      },
      // Whole number of vehicles of one approach and type in block b (0..95) of the day.
      blockCount(daily, type, b) {
        const c = cumulative[type];
        const i = ((b % BLOCKS) + BLOCKS) % BLOCKS;
        return Math.round(daily * c[i + 1]) - Math.round(daily * c[i]);
      },
      // Expected vehicles per hour (all approaches given), for the day chart.
      hourlyTotals(daily) {
        const out = new Array(24).fill(0);
        for (const byType of Object.values(daily)) {
          for (const type of TYPES) {
            const n = byType[type] || 0;
            for (let b = 0; b < BLOCKS; b++) out[Math.floor(b / 4)] += n * shares[type][b];
          }
        }
        return out;
      },
      // Period of the day (name, peak or not) at a time of day.
      periodAt(seconds) {
        const tod = ((seconds % DAY_S) + DAY_S) % DAY_S;
        for (const p of periods) if (tod >= p.start && tod < p.end) return p;
        return periods[periods.length - 1] || { name: '', peak: false };
      },
      periods,
    };

    // Daily totals from a counts.json site (test data): each profile ("peak"/"offpeak") is a count of
    // its time window; when both exist, the two daily estimates are averaged.
    demand.dailyFromCounts = function (siteCounts) {
      const daily = {};
      if (!siteCounts || !siteCounts.profiles) return daily;
      for (const [prof, p] of Object.entries(siteCounts.profiles)) {
        const w = Sim.parseWindow(p.time) || Sim.parseWindow((dayProfile.default_windows || {})[prof]);
        if (!w) continue;
        for (const [ap, c] of Object.entries(p.approaches || {})) {
          for (const type of TYPES) {
            if (typeof c[type] !== 'number') continue;
            const share = demand.windowShare(type, w[0], w[1]);
            if (!(share > 0)) continue;
            ((daily[ap] ??= {})[type] ??= []).push(c[type] / share);
          }
        }
      }
      const out = {};
      for (const [ap, byType] of Object.entries(daily)) {
        out[ap] = {};
        for (const type of TYPES) {
          const list = byType[type] || [];
          out[ap][type] = list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : 0;
        }
      }
      return out;
    };

    return demand;
  };
})();
