// vehicles.js
// CYCLE STEP 3: movement.
// Braking rule: if the vehicle ahead (or a stop line) is too close, brake;
// if there is room, accelerate up to max speed. A vehicle never moves more than its free space,
// which is why vehicles never overlap.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  const mod = (a, m) => ((a % m) + m) % m;

  // New speed: the highest one that still lets the vehicle stop within its free space,
  // capped by its max speed and by how much it can accelerate in one step.
  function newSpeed(v, vmax, free, dt) {
    if (free <= 0) return 0;
    const brakingSpeed = Math.sqrt(2 * v.props.decel * free);
    const target = Math.min(vmax, brakingSpeed);
    return target > v.speed ? Math.min(target, v.speed + v.props.accel * dt) : target;
  }

  // Moves the vehicle and returns how many meters it advanced.
  function advance(v, vmax, free, dt) {
    const speed = newSpeed(v, vmax, free, dt);
    let move = speed * dt;
    const cap = Math.max(0, free);
    if (move > cap) move = cap;
    v.speed = Math.min(speed, move / dt);
    v.position += move;
    return move;
  }

  // Is there room for one more vehicle at the start of the exit 'destination'?
  Sim.exitStartIsFree = function (e, destination, v) {
    const list = e.approaches[destination].exit;
    const last = list[list.length - 1];
    if (!last) return true;
    return last.s - last.length >= v.props.minGap;
  };

  // What an officer checks before waving a vehicle in: room on its exit, counting vehicles already heading there.
  Sim.exitHasRoom = function (e, v) {
    const dest = e.geo.byId[v.destination];
    let used = 0;
    for (const x of e.approaches[v.destination].exit) used += x.length + x.props.minGap;
    for (const x of e.ring) if (x.destination === v.destination) used += x.length + x.props.minGap;
    return used + v.length + v.props.minGap <= dest.exitLength;
  };

  // Can vehicle v merge onto the ring now from approach a?
  // Always checks physical room. With withGap (current mode) it also requires a time gap
  // in front of circulating vehicles: the critical gap, reduced by how aggressive the driver is.
  Sim.canMerge = function (e, v, a, withGap) {
    const C = e.geo.C;
    const factor = e.params.roundabout.aggressiveness_factor;
    for (const r of e.ring) {
      const ahead = mod(r.arc - a.entryArc, C);
      if (ahead <= C / 2) {
        if (ahead - r.length < v.props.minGap) return false; // no room right at the entry
      } else {
        const behind = C - ahead; // distance from r's front to the entry point
        if (behind < v.length + r.props.minGap) return false;
        if (withGap && r.remaining > behind && r.speed > 0.5) {
          const gap = v.props.criticalGap * (1 - factor * v.aggressiveness);
          if (behind < v.length + r.props.minGap + r.speed * gap) return false;
        }
      }
    }
    return true;
  };

  function moveExit(e, a) {
    const s = e.approaches[a.id];
    const list = s.exit;
    const cap = a.exitCapacity;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      let free;
      if (i === 0) free = cap && e.t < s.nextDischarge ? a.exitLength - v.s : Infinity;
      else {
        const leader = list[i - 1];
        free = leader.s - leader.length - v.s - v.props.minGap;
      }
      v.s += advance(v, v.props.vmax, free, e.dt);
    }
    // End of the exit: if the exit road has limited capacity (for example, congestion downstream),
    // vehicles leave one at a time every few seconds.
    while (list.length && list[0].s >= a.exitLength - 0.05) {
      if (cap && e.t < s.nextDischarge) break;
      const v = list.shift();
      v.zone = 'gone';
      if (cap) {
        s.nextDischarge = e.t + (v.props.pce * 3600) / cap;
        break;
      }
    }
  }

  function moveRing(e) {
    const A = e.ring;
    const n = A.length;
    if (!n) return;
    const C = e.geo.C;
    const ringVmax = e.params.roundabout.max_speed_ms;
    A.sort((x, y) => x.arc - y.arc);

    // Process from the head of the line backwards, so each vehicle sees its leader already moved.
    let start = n - 1;
    let largest = -1;
    if (n > 1) {
      for (let k = 0; k < n; k++) {
        const g = mod(A[(k + 1) % n].arc - A[k].arc, C);
        if (g > largest) {
          largest = g;
          start = k;
        }
      }
    }
    const redApproaches = e.geo.approaches.filter((a) => a.hasEntry && e.control.ringRedAt(a.id));
    const leaving = [];

    for (let j = 0; j < n; j++) {
      const v = A[mod(start - j, n)];
      let free = Infinity;
      if (n > 1) {
        const leader = A[mod(start - j + 1, n)];
        free = mod(leader.arc - v.arc, C) - leader.length - v.props.minGap;
      }
      const exitFree = Sim.exitStartIsFree(e, v.destination, v);
      if (!exitFree) free = Math.min(free, v.remaining); // its exit is full: it stops there
      for (const a of redApproaches) {
        const d = mod(a.stopArc - v.arc, C);
        const canStop = (v.speed * v.speed) / (2 * v.props.decel) <= d + 0.5;
        if (d < v.remaining && d < C / 2 && canStop) free = Math.min(free, d);
      }
      const m = advance(v, Math.min(v.props.vmax, ringVmax), free, e.dt);
      v.arc = mod(v.arc + m, C);
      v.remaining -= m;

      if (v.remaining <= 1e-6) {
        v.remaining = 0;
        if (Sim.exitStartIsFree(e, v.destination, v)) {
          v.zone = 'exit';
          v.s = 0;
          v.state = 'exited';
          v.t_exit = e.t;
          v.blocking = false;
          e.approaches[v.destination].exit.push(v);
          e.metrics.exited(v, e);
          leaving.push(v);
          continue;
        }
      }
      // Blocking: stopped on the ring in front of its full exit, holding up everyone behind it.
      v.blocking = !exitFree && v.remaining < 0.5 && v.speed < 0.1;
      if (v.blocking) v.everBlocked = true;
    }
    if (leaving.length) e.ring = A.filter((v) => !leaving.includes(v));
  }

  function fitsInFilter(filter, v) {
    for (const f of filter) {
      const clearAhead = f.s - f.length >= v.s + v.props.minGap;
      const clearBehind = f.s + f.props.minGap <= v.s - v.length;
      if (!clearAhead && !clearBehind) return false;
    }
    return true;
  }

  function moveApproach(e, a) {
    const s = e.approaches[a.id];
    const L = a.approachLength;
    const ringVmax = e.params.roundabout.max_speed_ms;

    // Who goes next: between the head of the lane and the first motorcycle that filtered,
    // whoever reached the line first.
    const heads = [s.lane[0], s.filter[0]].filter(Boolean);
    for (const h of heads) if (h.t_line === null && L - h.s <= 3) h.t_line = e.t;
    let candidate = null;
    for (const h of heads) {
      if (L - h.s > 30) continue;
      const th = h.t_line ?? Infinity;
      const tc = candidate ? candidate.t_line ?? Infinity : Infinity;
      if (!candidate || th < tc || (th === tc && h.s > candidate.s)) candidate = h;
    }
    const allowed =
      !!candidate && e.control.allowsEntry(a.id, candidate, e) && Sim.canMerge(e, candidate, a, e.control.usesGapAcceptance);
    e.permissions[a.id] = allowed;

    let entering = null;
    for (const list of [s.filter, s.lane]) {
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        let free;
        let vmax = v.props.vmax;
        if (i > 0) {
          const leader = list[i - 1];
          free = leader.s - leader.length - v.s - v.props.minGap;
        } else if (v === candidate && allowed) {
          free = Infinity;
          vmax = Math.min(vmax, ringVmax);
        } else {
          free = L - v.s; // stops at the line
        }
        v.s += advance(v, vmax, free, e.dt);

        if (i === 0 && v === candidate && allowed && v.s >= L - 0.01) {
          // Re-check at the line: the ring may have changed while it was approaching.
          if (e.control.allowsEntry(a.id, v, e) && Sim.canMerge(e, v, a, e.control.usesGapAcceptance)) {
            entering = v;
          } else {
            v.s = Math.min(v.s, L);
            v.speed = 0;
          }
        }
        if (v.state === 'approaching' && v.speed < 1.5) {
          v.state = 'queued';
          v.t_queue = e.t;
        }
      }
    }

    if (entering) {
      if (s.filter[0] === entering) s.filter.shift();
      else s.lane.shift();
      const dest = e.geo.byId[entering.destination];
      entering.zone = 'ring';
      entering.arc = a.entryArc;
      entering.remaining = mod(dest.exitArc - a.entryArc, e.geo.C);
      if (entering.remaining < 1) entering.remaining += e.geo.C;
      entering.speed = Math.min(entering.speed, ringVmax);
      entering.state = 'crossing';
      entering.t_cross = e.t;
      if (entering.t_queue === null) entering.t_queue = e.t; // never queued: zero wait
      e.ring.push(entering);
      e.metrics.crossed(entering, e);
    }

    // Motorcycle filtering: if the car ahead is almost stopped, the motorcycle squeezes between the rows.
    for (let i = 1; i < s.lane.length; i++) {
      const v = s.lane[i];
      if (v.type !== 'motorcycle') continue;
      const leader = s.lane[i - 1];
      if (leader.type === 'motorcycle') continue;
      const space = leader.s - leader.length - v.s;
      if (leader.speed < 2 && v.speed < 3 && space < 8 && fitsInFilter(s.filter, v)) {
        s.lane.splice(i, 1);
        i--;
        v.zone = 'filter';
        let k = 0;
        while (k < s.filter.length && s.filter[k].s > v.s) k++;
        s.filter.splice(k, 0, v);
      }
    }
  }

  Sim.moveVehicles = function (e) {
    e.permissions = {};
    for (const a of e.geo.approaches) if (a.hasExit) moveExit(e, a);
    moveRing(e);
    for (const a of e.geo.approaches) if (a.hasEntry) moveApproach(e, a);
  };
})();
