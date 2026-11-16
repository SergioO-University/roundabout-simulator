// icons.js
// Top-down vehicle icons drawn with canvas paths (no image files, so it works offline).
// The canvas is already translated to the vehicle center and rotated so that +x points forward
// and +y points to the vehicle's right. L and Wd are the drawn length and width in pixels.
var Sim = globalThis.Sim || (globalThis.Sim = {});

(function () {
  // Santa Marta street mix: many yellow taxis, white / silver / red / blue private cars.
  const CAR_COLORS = ['#facc15', '#facc15', '#f8fafc', '#cbd5e1', '#ef4444', '#2563eb', '#f8fafc', '#64748b', '#facc15', '#0ea5e9'];
  const BUS_COLORS = ['#10b981', '#0ea5e9', '#f97316', '#10b981', '#8b5cf6'];
  const HELMET_COLORS = ['#ef4444', '#f8fafc', '#facc15', '#38bdf8', '#f97316', '#22c55e', '#e879f9'];
  const JACKET_COLORS = ['#f97316', '#38bdf8', '#facc15', '#f472b6', '#a3e635', '#fb7185'];

  const pick = (list, id, salt = 0) => list[((id * 2654435761 + salt * 97) >>> 0) % list.length];

  // Lightens (amount > 0) or darkens (amount < 0) a hex color.
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
    const r = mix(n >> 16);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `rgb(${r},${g},${b})`;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  }

  function shadow(ctx, L, Wd, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rr(ctx, -L / 2 + 0.8, -Wd / 2 + 1.2, L, Wd, r);
    ctx.fill();
  }

  function lights(ctx, L, Wd, o, front, rear) {
    // headlights
    ctx.fillStyle = '#fef9c3';
    ctx.fillRect(L / 2 - front.len, -Wd * 0.42, front.len, front.w);
    ctx.fillRect(L / 2 - front.len, Wd * 0.42 - front.w, front.len, front.w);
    // brake lights: bright and glowing while braking or stopped
    ctx.save();
    if (o.braking) {
      ctx.shadowColor = 'rgba(255,40,40,0.9)';
      ctx.shadowBlur = 6;
    }
    ctx.fillStyle = o.braking ? '#ff2a2a' : '#7f1d1d';
    ctx.fillRect(-L / 2, -Wd * 0.42, rear.len, rear.w);
    ctx.fillRect(-L / 2, Wd * 0.42 - rear.w, rear.len, rear.w);
    ctx.restore();
    // right turn signal (the vehicle is about to leave the ring)
    if (o.blinkRight) {
      ctx.save();
      ctx.shadowColor = 'rgba(251,146,60,0.95)';
      ctx.shadowBlur = 7;
      ctx.fillStyle = '#fb923c';
      const s = Math.max(1.5, Wd * 0.2);
      ctx.fillRect(L / 2 - s, Wd / 2 - s, s, s);
      ctx.fillRect(-L / 2, Wd / 2 - s, s, s);
      ctx.restore();
    }
  }

  function drawCar(ctx, v, L, Wd, o) {
    const color = pick(CAR_COLORS, v.id);
    const taxi = color === '#facc15';
    const r = Math.min(Wd * 0.38, L * 0.22);
    shadow(ctx, L, Wd, r);
    ctx.fillStyle = color;
    rr(ctx, -L / 2, -Wd / 2, L, Wd, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // windshield (front) and rear window
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    rr(ctx, L * 0.1, -Wd * 0.38, L * 0.17, Wd * 0.76, Wd * 0.14);
    ctx.fill();
    rr(ctx, -L * 0.4, -Wd * 0.33, L * 0.1, Wd * 0.66, Wd * 0.1);
    ctx.fill();
    // roof
    ctx.fillStyle = shade(color, color === '#f8fafc' ? -0.08 : 0.18);
    rr(ctx, -L * 0.29, -Wd * 0.36, L * 0.38, Wd * 0.72, Wd * 0.16);
    ctx.fill();
    if (taxi && L > 12) {
      // roof "TAXI" sign
      ctx.fillStyle = '#111827';
      ctx.fillRect(-L * 0.12, -Wd * 0.16, L * 0.08, Wd * 0.32);
    }
    lights(ctx, L, Wd, o, { len: Math.max(1, L * 0.05), w: Math.max(1, Wd * 0.2) }, { len: Math.max(1, L * 0.05), w: Math.max(1, Wd * 0.2) });
  }

  function drawBus(ctx, v, L, Wd, o) {
    const color = pick(BUS_COLORS, v.id);
    const r = Math.min(Wd * 0.2, L * 0.08);
    shadow(ctx, L, Wd, r);
    ctx.fillStyle = color;
    rr(ctx, -L / 2, -Wd / 2, L, Wd, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // white roof with a colored stripe, typical of Santa Marta busetas
    ctx.fillStyle = '#f8fafc';
    rr(ctx, -L * 0.44, -Wd * 0.34, L * 0.8, Wd * 0.68, Wd * 0.12);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.15);
    ctx.fillRect(-L * 0.44, -Wd * 0.06, L * 0.8, Wd * 0.12);
    // side windows
    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    const n = Math.max(3, Math.min(7, Math.round(L / 9)));
    const span = L * 0.7;
    const step = span / n;
    for (let i = 0; i < n; i++) {
      const x = -L * 0.42 + i * step + step * 0.12;
      ctx.fillRect(x, -Wd * 0.48, step * 0.76, Wd * 0.12);
      ctx.fillRect(x, Wd * 0.36, step * 0.76, Wd * 0.12);
    }
    // windshield
    rr(ctx, L * 0.37, -Wd * 0.4, L * 0.09, Wd * 0.8, Wd * 0.1);
    ctx.fill();
    lights(ctx, L, Wd, o, { len: Math.max(1, L * 0.025), w: Math.max(1, Wd * 0.16) }, { len: Math.max(1, L * 0.025), w: Math.max(1, Wd * 0.18) });
  }

  function drawMotorcycle(ctx, v, L, Wd, o) {
    // Bright colors and a white outline so motorcycles stand out on dark asphalt.
    const helmet = pick(HELMET_COLORS, v.id);
    const jacket = pick(JACKET_COLORS, v.id, 3);
    // white halo + shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0.8, 1.2, L * 0.52, Wd * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.54, Wd * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    // wheels
    ctx.fillStyle = '#6b7280';
    rr(ctx, L * 0.22, -Wd * 0.16, L * 0.28, Wd * 0.32, Wd * 0.16);
    ctx.fill();
    rr(ctx, -L * 0.5, -Wd * 0.17, L * 0.28, Wd * 0.34, Wd * 0.17);
    ctx.fill();
    // frame (same color as the jacket, a bit darker)
    ctx.fillStyle = shade(jacket, -0.2);
    rr(ctx, -L * 0.3, -Wd * 0.2, L * 0.6, Wd * 0.4, Wd * 0.2);
    ctx.fill();
    // handlebar
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(L * 0.18, -Wd * 0.5, Math.max(1, L * 0.05), Wd);
    // rider: shoulders and helmet
    ctx.fillStyle = jacket;
    ctx.beginPath();
    ctx.ellipse(-L * 0.04, 0, L * 0.13, Wd * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = helmet;
    ctx.beginPath();
    ctx.arc(L * 0.03, 0, Math.max(1.2, Wd * 0.34), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // visor
    ctx.fillStyle = 'rgba(15,23,42,0.8)';
    ctx.beginPath();
    ctx.arc(L * 0.03, 0, Math.max(1, Wd * 0.34), -0.9, 0.9);
    ctx.lineTo(L * 0.03, 0);
    ctx.fill();
    // head and brake light
    ctx.fillStyle = '#fef9c3';
    ctx.fillRect(L / 2 - Math.max(1, L * 0.05), -Wd * 0.1, Math.max(1, L * 0.05), Wd * 0.2);
    ctx.save();
    if (o.braking) {
      ctx.shadowColor = 'rgba(255,40,40,0.9)';
      ctx.shadowBlur = 5;
    }
    ctx.fillStyle = o.braking ? '#ff2a2a' : '#b91c1c';
    ctx.fillRect(-L / 2, -Wd * 0.1, Math.max(1, L * 0.05), Wd * 0.2);
    ctx.restore();
  }

  // o: { braking, blinkRight }
  Sim.drawVehicleIcon = function (ctx, v, L, Wd, o) {
    if (v.type === 'motorcycle') drawMotorcycle(ctx, v, L, Wd, o);
    else if (v.type === 'bus') drawBus(ctx, v, L, Wd, o);
    else drawCar(ctx, v, L, Wd, o);
  };
})();
