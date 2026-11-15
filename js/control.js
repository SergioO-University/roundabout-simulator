// control.js
// CYCLE STEP 2: control. Decides who may enter the roundabout according to the active mode.
//  - current: priority rule. Vehicles on the ring have right of way; entering vehicles wait for a gap.
//             Nobody checks whether their exit is clear, so a vehicle can end up stuck across the ring.
//  - signal:  green, yellow and all-red phases. With green on an approach, the ring stops before it.
//  - officer: fixed turns given by a traffic officer, one approach at a time, with a transition time.
//             If prevent_blocking is true, the officer does not let in vehicles whose exit has no room.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  // Display names (Spanish, shown in the UI).
  Sim.MODES = {
    current: 'Actual (prelación)',
    signal: 'Semáforo virtual',
    officer: 'Alternativa (turnos de agente)',
  };

  Sim.createControl = function (geo, params, mode) {
    const c = { mode, index: 0, time: 0, phase: 'green', problems: [] };

    let phases = [];
    if (mode === 'signal') {
      phases = geo.phases && geo.phases.length ? geo.phases : Sim.automaticPhases(geo);
      c.problems = Sim.validatePhases(geo, phases);
    } else if (mode === 'officer') {
      // By default the officer lets one approach go at a time, in ring order.
      // If the field team sees two opposite approaches going together, they can set "groups" in parameters.json.
      const groups = params.officer.groups && params.officer.groups[geo.key];
      phases = groups || geo.angularOrder.map((id) => [id]);
      c.problems = Sim.validatePhases(geo, phases);
    }
    c.phases = phases;
    c.usesGapAcceptance = mode === 'current';

    function greenDuration(i) {
      if (mode === 'signal') {
        const g = params.signal.green_s;
        return Array.isArray(g) ? g[i] ?? g[g.length - 1] : g;
      }
      return params.officer.turn_s;
    }
    const yellowDuration = () => (mode === 'signal' ? params.signal.yellow_s : 0);
    const allRedDuration = () => (mode === 'signal' ? params.signal.all_red_s : params.officer.transition_s);

    c.currentPhaseDuration = function () {
      if (c.phase === 'green') return greenDuration(c.index);
      if (c.phase === 'yellow') return yellowDuration();
      return allRedDuration();
    };

    c.update = function (dt) {
      if (!phases.length) return;
      c.time += dt;
      for (let i = 0; i < 6; i++) {
        const limit = c.currentPhaseDuration();
        if (c.time + 1e-9 < limit) break;
        c.time -= limit;
        if (c.phase === 'green') c.phase = 'yellow';
        else if (c.phase === 'yellow') c.phase = 'all_red';
        else {
          c.phase = 'green';
          c.index = (c.index + 1) % phases.length;
        }
      }
    };

    // Signal seen by an approach: 'green' | 'yellow' | 'red', or null in current mode (no signal).
    c.signalFor = function (id) {
      if (!phases.length) return null;
      if (c.phase === 'all_red') return 'red';
      return phases[c.index].includes(id) ? c.phase : 'red';
    };

    // Approaches with green or yellow right now (used to check there are no conflicts).
    c.greens = function () {
      if (!phases.length || c.phase === 'all_red') return [];
      return phases[c.index];
    };

    // Must vehicles circulating on the ring stop before this approach?
    c.ringRedAt = function (id) {
      const s = c.signalFor(id);
      return s === 'green' || s === 'yellow';
    };

    // Does the control let this vehicle go? (Physical room on the ring is checked separately.)
    c.allowsEntry = function (id, v, e) {
      if (mode === 'current') return true;
      const s = c.signalFor(id);
      if (s === 'green') {
        if (mode === 'officer' && params.officer.prevent_blocking) return Sim.exitHasRoom(e, v);
        return true;
      }
      if (s === 'yellow') return v.speed > 3; // too close to stop
      return false;
    };

    return c;
  };
})();
