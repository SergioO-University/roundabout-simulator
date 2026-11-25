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

  // Ring lane a vehicle takes when it enters (two-lane rings): vehicles leaving soon keep to the outer lane (0),
  // the ones going further round take the inner lane (1). On a two-lane approach the lane it queued in decides.
  Sim.chooseRingLane = function (e, a, v, fromLeftLane) {
    if (e.geo.ringLanes < 2) return 0;
    if (a.nIn >= 2) return fromLeftLane ? 1 : 0;
    const dest = e.geo.byId[v.destination];
    let trip = mod(dest.exitArc - a.entryArc, e.geo.C);
    if (trip < 1) trip += e.geo.C;
    return trip > e.geo.C * 0.4 ? 1 : 0;
  };

  // Can vehicle v merge onto the ring now from approach a, into ring lane `lane`?
  // Always checks physical room. With withGap (current mode) it also requires a time gap
  // in front of circulating vehicles: the critical gap, reduced by how aggressive the driver is.
  // Entering the outer lane only conflicts with the outer lane; entering the inner lane crosses both.
  // ignore: a vehicle entering side by side with v (motorcycle next to a car, or the other entry lane).
  Sim.canMerge = function (e, v, a, withGap, ignore, lane = 0) {
    const C = e.geo.C;
    const factor = e.params.roundabout.aggressiveness_factor;
    for (const r of e.ring) {
      if (r === ignore) continue;
      if (lane === 0 && (r.ringLane || 0) !== 0) continue;
      const ahead = mod(r.arc - a.entryArc, C);
      if (ahead <= C / 2) {
        if ((r.ringLane || 0) === lane && ahead - r.length < v.props.minGap) return false; // no room right at the entry
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
      v.s += advance(v, e.speeds.exits[a.id][v.type], free, e.dt);
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
    if (!e.ring.length) return;
    const leaving = [];
    // Each ring lane is its own line of vehicles; a vehicle only follows the one ahead in its lane.
    const lanes = e.geo.ringLanes >= 2 ? [0, 1] : [0];
    for (const lane of lanes) moveRingLane(e, e.ring.filter((v) => (v.ringLane || 0) === lane), leaving);
    if (leaving.length) e.ring = e.ring.filter((v) => !leaving.includes(v));
  }

  function moveRingLane(e, A, leaving) {
    const n = A.length;
    if (!n) return;
    const C = e.geo.C;
    A.sort((x, y) => x.arc - y.arc);

    // Side-by-side pairs (a motorcycle that entered next to a car) ignore each other until one
    // is clearly ahead of the other; from then on they follow each other normally.
    for (const v of A) {
      const p = v.pair;
      if (!p) continue;
      const sep = Math.min(mod(p.arc - v.arc, C), mod(v.arc - p.arc, C));
      if (p.zone !== 'ring' || (p.ringLane || 0) !== (v.ringLane || 0) || sep >= Math.max(v.length + p.props.minGap, p.length + v.props.minGap)) {
        v.pair = null;
        v.ringLat = 0;
      }
    }

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

    for (let j = 0; j < n; j++) {
      const v = A[mod(start - j, n)];
      let free = Infinity;
      if (n > 1) {
        let leader = A[mod(start - j + 1, n)];
        if (leader === v.pair) leader = n > 2 ? A[mod(start - j + 2, n)] : null;
        if (leader && leader !== v) {
          free = mod(leader.arc - v.arc, C) - leader.length - v.props.minGap;
          // If the leader rides side by side with another vehicle, keep distance from both.
          const side = leader.pair;
          if (side && side !== v && side.zone === 'ring') {
            const d = mod(side.arc - v.arc, C);
            if (d < C / 2) free = Math.min(free, d - side.length - v.props.minGap);
          }
        }
      }
      const exitFree = Sim.exitStartIsFree(e, v.destination, v);
      if (!exitFree) free = Math.min(free, v.remaining); // its exit is full: it stops there
      for (const a of redApproaches) {
        const d = mod(a.stopArc - v.arc, C);
        const canStop = (v.speed * v.speed) / (2 * v.props.decel) <= d + 0.5;
        if (d < v.remaining && d < C / 2 && canStop) free = Math.min(free, d);
      }
      const m = advance(v, Math.min(v.props.vmax, e.speeds.ring[v.type]), free, e.dt);
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
  }

  function fitsInFilter(filter, v) {
    for (const f of filter) {
      const clearAhead = f.s - f.length >= v.s + v.props.minGap;
      const clearBehind = f.s + f.props.minGap <= v.s - v.length;
      if (!clearAhead && !clearBehind) return false;
    }
    return true;
  }

  function moveSingleLaneApproach(e, a) {
    const s = e.approaches[a.id];
    const L = a.approachLength;

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
    // Follow-up time: a queued driver needs a moment after the vehicle ahead entered before going too.
    const followUpOk =
      !candidate ||
      e.t - (s.lastEntry ?? -Infinity) >=
        candidate.props.followUp * (1 - e.params.roundabout.aggressiveness_factor * (candidate.aggressiveness || 0)) - 1e-9;
    if (candidate) candidate.targetLane = Sim.chooseRingLane(e, a, candidate, false);
    const allowed =
      !!candidate &&
      followUpOk &&
      e.control.allowsEntry(a.id, candidate, e) &&
      Sim.canMerge(e, candidate, a, e.control.usesGapAcceptance, null, candidate.targetLane);
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
          vmax = Math.min(vmax, e.speeds.ring[v.type]);
        } else {
          free = L - v.s; // stops at the line
        }
        v.s += advance(v, vmax, free, e.dt);

        if (i === 0 && v === candidate && allowed && v.s >= L - 0.01) {
          // Re-check at the line: the ring may have changed while it was approaching.
          if (e.control.allowsEntry(a.id, v, e) && Sim.canMerge(e, v, a, e.control.usesGapAcceptance, null, v.targetLane)) {
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
      // The other head (lane or filter) may follow right behind if one of the two is a motorcycle:
      // in the field, motorcycles enter almost side by side with the car next to them, a fraction
      // of a second later (more aggressive riders, shorter delay).
      const other = s.filter[0] === entering ? s.lane[0] : s.filter[0];
      enterRing(e, a, entering);
      if (
        e.params.roundabout.parallel_motorcycle_entry !== false &&
        other &&
        (entering.type === 'motorcycle' || other.type === 'motorcycle') &&
        entering.type !== 'bus' &&
        other.type !== 'bus' &&
        L - other.s <= 1
      ) {
        const moto = entering.type === 'motorcycle' ? entering : other;
        const [dMin, dMax] = e.params.roundabout.parallel_entry_delay_s || [0.4, 1.0];
        s.pairing = { v: other, partner: entering, at: e.t + dMin + (dMax - dMin) * (1 - (moto.aggressiveness || 0)) };
      }
    } else if (s.pairing && e.t >= s.pairing.at - 1e-9) {
      const { v, partner } = s.pairing;
      s.pairing = null;
      const atHead = s.lane[0] === v || s.filter[0] === v;
      const sep = mod(partner.arc - a.entryArc, e.geo.C);
      v.targetLane = Sim.chooseRingLane(e, a, v, false);
      const sameLane = v.targetLane === (partner.ringLane || 0);
      if (
        atHead &&
        L - v.s <= 1 &&
        partner.zone === 'ring' &&
        sep < partner.length + v.props.minGap &&
        e.control.allowsEntry(a.id, v, e) &&
        Sim.canMerge(e, v, a, e.control.usesGapAcceptance, partner, v.targetLane)
      ) {
        enterRing(e, a, v);
        if (sameLane) {
          // same ring lane: they ride side by side in it until one pulls ahead
          v.pair = partner;
          partner.pair = v;
          const moto = v.type === 'motorcycle' ? v : partner;
          const car = moto === v ? partner : v;
          moto.ringLat = e.geo.drawW * 0.28;
          car.ringLat = -e.geo.drawW * 0.1;
        }
      }
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

  // Two-lane approach on a two-lane ring: two independent queues. The right one (s.lane) enters the
  // outer ring lane and the left one (s.filter) the inner lane, so both can go in at the same time.
  function moveTwoLaneApproach(e, a) {
    const s = e.approaches[a.id];
    const L = a.approachLength;
    const factor = e.params.roundabout.aggressiveness_factor;
    let anyAllowed = false;
    let enteredRight = null;
    for (const [list, left] of [
      [s.lane, false],
      [s.filter, true],
    ]) {
      const head = list[0];
      if (head && head.t_line === null && L - head.s <= 3) head.t_line = e.t;
      let allowed = false;
      if (head && L - head.s <= 30) {
        head.targetLane = left ? 1 : 0;
        const last = left ? s.lastEntryLeft : s.lastEntryRight;
        const followUpOk = e.t - (last ?? -Infinity) >= head.props.followUp * (1 - factor * (head.aggressiveness || 0)) - 1e-9;
        allowed = followUpOk && e.control.allowsEntry(a.id, head, e) && Sim.canMerge(e, head, a, e.control.usesGapAcceptance, enteredRight, head.targetLane);
      }
      anyAllowed = anyAllowed || allowed;
      let entering = null;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        let free;
        let vmax = v.props.vmax;
        if (i > 0) {
          const leader = list[i - 1];
          free = leader.s - leader.length - v.s - v.props.minGap;
        } else if (allowed) {
          free = Infinity;
          vmax = Math.min(vmax, e.speeds.ring[v.type]);
        } else {
          free = L - v.s; // stops at the line
        }
        v.s += advance(v, vmax, free, e.dt);
        if (i === 0 && allowed && v.s >= L - 0.01) {
          if (e.control.allowsEntry(a.id, v, e) && Sim.canMerge(e, v, a, e.control.usesGapAcceptance, enteredRight, v.targetLane)) entering = v;
          else {
            v.s = Math.min(v.s, L);
            v.speed = 0;
          }
        }
        if (v.state === 'approaching' && v.speed < 1.5) {
          v.state = 'queued';
          v.t_queue = e.t;
        }
      }
      if (entering) {
        enterRing(e, a, entering);
        if (left) s.lastEntryLeft = e.t;
        else {
          s.lastEntryRight = e.t;
          enteredRight = entering;
        }
      }
    }
    e.permissions[a.id] = anyAllowed;
  }

  function moveApproach(e, a) {
    if (a.nIn >= 2 && e.geo.ringLanes >= 2) moveTwoLaneApproach(e, a);
    else moveSingleLaneApproach(e, a);
  }

  function enterRing(e, a, v) {
    const s = e.approaches[a.id];
    if (s.filter[0] === v) s.filter.shift();
    else s.lane.shift();
    const dest = e.geo.byId[v.destination];
    v.zone = 'ring';
    v.ringLane = v.targetLane || 0;
    v.arc = a.entryArc;
    v.remaining = mod(dest.exitArc - a.entryArc, e.geo.C);
    if (v.remaining < 1) v.remaining += e.geo.C;
    v.speed = Math.min(v.speed, e.speeds.ring[v.type]);
    v.state = 'crossing';
    v.t_cross = e.t;
    if (v.t_queue === null) v.t_queue = e.t; // never queued: zero wait
    e.ring.push(v);
    s.lastEntry = e.t;
    (s.entryTimes ??= []).push(e.t);
    e.metrics.crossed(v, e);
  }

  // Slip road: plain car following along the road; at its end the vehicle leaves the modelled area.
  function moveBypass(e, b) {
    const s = e.bypass[b.id];
    const list = s.list;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const free = i === 0 ? Infinity : list[i - 1].s - list[i - 1].length - v.s - v.props.minGap;
      const exitSpeeds = e.speeds.exits[b.to];
      v.s += advance(v, Math.min(v.props.vmax, exitSpeeds ? exitSpeeds[v.type] : v.props.vmax), free, e.dt);
    }
    while (list.length && list[0].s >= b.length - 0.05) {
      const v = list.shift();
      v.zone = 'gone';
      v.state = 'exited';
      v.t_exit = e.t;
      e.metrics.bypassed(v, e);
    }
  }

  Sim.moveVehicles = function (e) {
    e.permissions = {};
    for (const b of e.geo.bypasses) moveBypass(e, b);
    for (const a of e.geo.approaches) if (a.hasExit) moveExit(e, a);
    moveRing(e);
    for (const a of e.geo.approaches) if (a.hasEntry) moveApproach(e, a);
  };
})();
