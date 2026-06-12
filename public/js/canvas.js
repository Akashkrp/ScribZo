// ============ SCRIBZO canvas engine ============
// Normalized coords (0-1) for cross-screen sync. Supports glow/rainbow pens,
// circle-stamp mode, mirror mode, one-line mode (daily challenges).
const Canvas = (() => {
  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const COLORS = [
    '#141414', '#666666', '#ffffff', '#ef476f', '#ff8c42', '#ffd23f',
    '#06d6a0', '#0fb5ba', '#3a86ff', '#5e60ce', '#9b5de5', '#ff5d8f',
    '#a2845e', '#7a4419', '#ffc4d6', '#b9fbc0'
  ];

  const state = {
    drawing: false,
    canDraw: false,
    tool: 'pen',            // pen | fill | eraser
    color: '#141414',
    size: 6,
    style: 'normal',        // normal | glow | rainbow
    rainbowHue: 0,
    mode: null,             // null | 'circles' | 'oneline' | 'mirror' | 'speedrun'
    lineUsed: false,        // one-line challenge: already drew the stroke
    circleStart: null,      // circles mode: center point while dragging
    lastPoint: null,
    history: []
  };

  let onEmit = null;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    redraw();
  }

  function clearLocal() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  // ---------- rendering primitives ----------
  function applyStyle(style, color) {
    if (style === 'glow') {
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
    } else {
      ctx.shadowBlur = 0;
    }
  }

  function drawSegment(from, to, color, size, style) {
    const { w, h } = cssSize();
    ctx.save();
    applyStyle(style, color);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x * w, from.y * h);
    ctx.lineTo(to.x * w, to.y * h);
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(point, color, size, style) {
    const { w, h } = cssSize();
    ctx.save();
    applyStyle(style, color);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x * w, point.y * h, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCircle(center, radius, color, size, style) {
    const { w, h } = cssSize();
    ctx.save();
    applyStyle(style, color);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.arc(center.x * w, center.y * h, radius * Math.min(w, h), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function floodFill(point, fillColor) {
    const { w, h } = cssSize();
    const dpr = window.devicePixelRatio || 1;
    const px = Math.floor(point.x * w * dpr);
    const py = Math.floor(point.y * h * dpr);
    const W = canvas.width, H = canvas.height;
    if (px < 0 || py < 0 || px >= W || py >= H) return;

    const img = ctx.getImageData(0, 0, W, H);
    const data = img.data;
    const idx = (py * W + px) * 4;
    const target = [data[idx], data[idx + 1], data[idx + 2]];
    const fc = hexToRgb(fillColor);
    if (target[0] === fc.r && target[1] === fc.g && target[2] === fc.b) return;

    const match = (i) =>
      Math.abs(data[i] - target[0]) < 24 &&
      Math.abs(data[i + 1] - target[1]) < 24 &&
      Math.abs(data[i + 2] - target[2]) < 24;

    const stack = [[px, py]];
    while (stack.length) {
      const [x, y] = stack.pop();
      let x1 = x;
      while (x1 >= 0 && match((y * W + x1) * 4)) x1--;
      x1++;
      let spanUp = false, spanDown = false;
      while (x1 < W && match((y * W + x1) * 4)) {
        const i = (y * W + x1) * 4;
        data[i] = fc.r; data[i + 1] = fc.g; data[i + 2] = fc.b; data[i + 3] = 255;
        if (y > 0) {
          const up = match(((y - 1) * W + x1) * 4);
          if (up && !spanUp) { stack.push([x1, y - 1]); spanUp = true; }
          else if (!up) spanUp = false;
        }
        if (y < H - 1) {
          const dn = match(((y + 1) * W + x1) * 4);
          if (dn && !spanDown) { stack.push([x1, y + 1]); spanDown = true; }
          else if (!dn) spanDown = false;
        }
        x1++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // ---------- replay ----------
  function renderEvent(d) {
    if (d.type === 'start') drawDot(d.point, d.color, d.size, d.style);
    else if (d.type === 'move') drawSegment(d.from, d.point, d.color, d.size, d.style);
    else if (d.type === 'fill') floodFill(d.point, d.color);
    else if (d.type === 'circle') drawCircle(d.center, d.radius, d.color, d.size, d.style);
  }

  function applyEvent(d) { renderEvent(d); state.history.push(d); }

  function redraw() {
    clearLocal();
    for (const d of state.history) renderEvent(d);
  }

  function syncHistory(history) { state.history = history.slice(); redraw(); }
  function reset() { state.history = []; clearLocal(); }

  // ---------- input ----------
  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    let x = Math.min(1, Math.max(0, (cx - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (cy - rect.top) / rect.height));
    if (state.mode === 'mirror') x = 1 - x; // mirror challenge: flip brush
    return { x, y };
  }

  function activeColor() {
    if (state.tool === 'eraser') return '#ffffff';
    if (state.style === 'rainbow') {
      state.rainbowHue = (state.rainbowHue + 5) % 360;
      return `hsl(${state.rainbowHue}, 95%, 55%)`;
    }
    return state.color;
  }
  function activeSize() { return state.tool === 'eraser' ? state.size * 2.5 : state.size; }
  function activeStyle() { return state.style === 'glow' ? 'glow' : 'normal'; }

  function onDown(e) {
    if (!state.canDraw) return;
    if (state.mode === 'oneline' && state.lineUsed) return; // one stroke only!
    e.preventDefault();
    const point = getPoint(e);

    if (state.tool === 'fill') {
      const d = { type: 'fill', point, color: state.color };
      floodFill(point, state.color);
      state.history.push(d);
      if (onEmit) onEmit(d);
      return;
    }

    if (state.mode === 'circles') {
      state.circleStart = point;
      state.drawing = true;
      return;
    }

    state.drawing = true;
    state.lastPoint = point;
    const d = { type: 'start', point, color: activeColor(), size: activeSize(), style: activeStyle() };
    drawDot(point, d.color, d.size, d.style);
    state.history.push(d);
    if (onEmit) onEmit(d);
  }

  function onMove(e) {
    if (!state.drawing || !state.canDraw) return;
    e.preventDefault();
    const point = getPoint(e);

    if (state.mode === 'circles' && state.circleStart) {
      // live preview of the circle being sized
      redraw();
      const r = Math.hypot(point.x - state.circleStart.x, point.y - state.circleStart.y);
      drawCircle(state.circleStart, r, state.color, activeSize(), activeStyle());
      state.lastPoint = point;
      return;
    }

    const d = { type: 'move', from: state.lastPoint, point, color: activeColor(), size: activeSize(), style: activeStyle() };
    drawSegment(state.lastPoint, point, d.color, d.size, d.style);
    state.history.push(d);
    state.lastPoint = point;
    if (onEmit) onEmit(d);
  }

  function onUp() {
    if (state.mode === 'circles' && state.circleStart && state.lastPoint) {
      const r = Math.hypot(state.lastPoint.x - state.circleStart.x, state.lastPoint.y - state.circleStart.y);
      if (r > 0.005) {
        const d = { type: 'circle', center: state.circleStart, radius: r, color: state.color, size: activeSize(), style: activeStyle() };
        state.history.push(d);
        redraw();
        if (onEmit) onEmit(d);
      }
      state.circleStart = null;
    }
    if (state.mode === 'oneline' && state.drawing) state.lineUsed = true;
    state.drawing = false;
    state.lastPoint = null;
  }

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp);
  window.addEventListener('resize', resize);

  // ---------- API ----------
  return {
    COLORS,
    init(emitFn) { onEmit = emitFn; resize(); },
    resize, reset, syncHistory, applyEvent,
    setCanDraw(v) { state.canDraw = v; canvas.style.cursor = v ? 'crosshair' : 'default'; },
    setTool(t) { state.tool = t; },
    setColor(c) { state.color = c; },
    setSize(s) { state.size = s; },
    setStyle(s) { state.style = s; },          // normal | glow | rainbow
    getStyle() { return state.style; },
    setMode(m) { state.mode = m; state.lineUsed = false; state.circleStart = null; },
    isLineUsed() { return state.lineUsed; },
    undoLocal() {
      const hist = state.history;
      let i = hist.length - 1;
      while (i >= 0 && !['start', 'fill', 'circle'].includes(hist[i].type)) i--;
      if (i >= 0) { state.history = hist.slice(0, i); redraw(); }
    }
  };
})();
