// ====================== Canvas Coloring (2-layer, finalized) ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ---------- Config: chuẩn hoá nét & fill ----------
const T_HIGH = 165;          // Y < T_HIGH  => chắc chắn đen
const T_LOW  = 220;          // Y > T_LOW   => chắc chắn trắng
const DILATE_RADIUS = 0;     // nở nét khi chuẩn hoá (0..2)

const WHITE_LUMA = 250;      // luma coi như trắng tuyệt đối khi dựng alpha
// Anti-alias preview cho line layer (không làm xám nền)
const AA_BLUR_PX         = 0.6;
const AA_ALPHA_GAMMA     = 0.50; // <1 => tăng alpha vùng mép
const AA_EDGE_MIN        = 96;   // alpha tối thiểu cho mép (≈38%)
const AA_EDGE_HARDEN_THR = 0.7; // mép > ngưỡng => coi như alpha=1 (đậm)

const FILL_TOLERANCE = 48;       // ngưỡng so màu khi flood-fill
const FILL_GROW_RADIUS = 1;      // nở kết quả fill vào lòng 0..1 px
const FILL_BARRIER_RADIUS = 1;   // nở mask chặn để che khe nhỏ
const ERODE_RADIUS = 1; // 0..2 | 1 = mảnh đi ~1px quanh viền

// Ràng buộc fill theo nét (alpha của line layer)
const BARRIER_ALPHA_THR    = 1;  // >0 coi là “tường”
const UNDERPAINT_ALPHA_THR = 12; // >12 mới tô “dưới nét”

// ---------- State ----------
let currentColor = "#000000";
let isDrawing = false;
let mode = "fill"; // fill | brush | eraser | text
let isTyping = false;
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];
let redoStack = [];
let originalImageName = "";

// Offscreen layers
const colorCanvas = document.createElement("canvas");
const colorCtx = colorCanvas.getContext("2d");
const lineCanvas = document.createElement("canvas");
const lineCtx = lineCanvas.getContext("2d");

// Binary line mask (Uint8Array 0/1)
let lineMask = null;

// Interpolated stroke
let lastPt = null;

// ---------- Palette ----------
const colors = [
  "#CD0000", "#FF6633", "#FF9933", "#FF00FF", "#FFD700",
  "#FFFF00", "#000000", "#808080", "#C0C0C0", "#FFFFFF",
  "#0000FF", "#6600CC", "#0099FF", "#00FFFF", "#006241",
  "#008000", "#00FF00", "#CCFFCC", "#800080", "#8B5F65"
];
const palette = document.getElementById("colorPalette");
colors.forEach((color, i) => {
  const div = document.createElement("div");
  div.className = "color";
  div.style.background = color;
  div.dataset.color = color;
  if (i === 0) {
    div.classList.add("selected");
    setCurrentColor(color);
  }
  palette.appendChild(div);
});

// Không cho màu tô là đen tuyệt đối
function setCurrentColor(hex) {
  const val = hex.startsWith('#') ? hex.slice(1) : hex;
  if (/^0{6}$/i.test(val)) currentColor = "#111111"; else currentColor = "#" + val.toUpperCase();
}

document.addEventListener("click", (e) => {
  const c = e.target.closest(".color");
  if (!c) return;
  document.querySelectorAll(".color").forEach(el => el.classList.remove("selected"));
  c.classList.add("selected");
  setCurrentColor(c.dataset.color);
  if (mode === "text" && currentTextBox) {
    const content = currentTextBox.querySelector(".text-content");
    if (content) content.style.color = currentColor;
  }
});

// ----------------- Mode buttons -----------------
document.getElementById("fillModeBtn").addEventListener("click", () => updateModeButtons("fill"));
document.getElementById("brushModeBtn").addEventListener("click", () => updateModeButtons("brush"));
document.getElementById("eraserModeBtn").addEventListener("click", () => updateModeButtons("eraser"));
document.getElementById("textModeBtn").addEventListener("click", () => {
  mode = "text";
  updateModeButtons();
  addTextBoxCentered();
});

function updateModeButtons(newMode = null) {
  mode = newMode;
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
  if (mode === "fill") document.getElementById("fillModeBtn").classList.add("active");
  else if (mode === "brush") document.getElementById("brushModeBtn").classList.add("active");
  else if (mode === "eraser") document.getElementById("eraserModeBtn").classList.add("active");
  else if (mode === "text") document.getElementById("textModeBtn").classList.add("active");
}

document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

// ----------------- Image select / upload -----------------
const imageSelect = document.getElementById("imageSelect");

imageSelect.addEventListener("change", function () {
  const selectedImage = this.value;
  if (!selectedImage) return;
  const localImg = new Image();
  localImg.onload = () => {
    resetStacks();
    loadImageToLayers(localImg);
    originalImageName = selectedImage.split('/').pop();
    updateSelectStyle();
    const kiteLabel = document.getElementById("kite-label-input");
    if (kiteLabel) kiteLabel.style.display = "block";
  };
  localImg.src = selectedImage;
  document.getElementById("uploadInput").value = "";
});

document.getElementById("uploadInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (event) {
    const upImg = new Image();
    upImg.onload = function () {
      resetStacks();
      loadImageToLayers(upImg);
      originalImageName = file.name;
      document.getElementById("imageSelect").selectedIndex = 0;
      updateSelectStyle();
    };
    upImg.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

function resetStacks() {
  undoStack = [];
  redoStack = [];
}

// ----------------- Coordinates -----------------
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  let clientX, clientY;

  if (e.touches && e.touches[0]) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
  else { clientX = e.clientX; clientY = e.clientY; }

  const x = Math.floor((clientX - rect.left) * scaleX);
  const y = Math.floor((clientY - rect.top) * scaleY);
  return { x, y };
}

// ----------------- Brush / Eraser (vẽ trên color layer) -----------------
function strokeFromTo(x0, y0, x1, y1, radius, rgba) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) { paintCircleOnColor(x1, y1, radius, rgba); return; }
  const step = Math.max(1, radius * 0.5);
  const n = Math.ceil(dist / step);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    paintCircleOnColor(x, y, radius, rgba);
  }
}

function drawAt(e) {
  const { x, y } = getCanvasCoords(e);
  let rgba;
  if (mode === "eraser") rgba = [255, 255, 255, 255];
  else rgba = hexToRgba(currentColor);

  if (!lastPt) { paintCircleOnColor(x, y, brushSize, rgba); lastPt = { x, y }; }
  else { strokeFromTo(lastPt.x, lastPt.y, x, y, brushSize, rgba); lastPt = { x, y }; }

  compositeToMain();
}

function paintCircleOnColor(x, y, radius, rgba) {
  const w = colorCanvas.width, h = colorCanvas.height;
  if (w === 0 || h === 0) return;

  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(w - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(h - 1, Math.ceil(y + radius));

  let imageData;
  try { imageData = colorCtx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1); }
  catch (err) { console.error(err); alert("Không thể vẽ (CORS). Hãy dùng ảnh cùng domain hoặc bật crossOrigin."); return; }

  const d = imageData.data;
  const rr = radius * radius;

  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - x, dy = yy - y;
      if (dx * dx + dy * dy > rr) continue;
      const i = ((yy - y0) * (x1 - x0 + 1) + (xx - x0)) * 4;
      d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = 255;
    }
  }
  colorCtx.putImageData(imageData, x0, y0);
}

// Handlers
canvas.addEventListener("mousedown", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true; saveState(); lastPt = null; drawAt(e);
  }
});
canvas.addEventListener("mousemove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) drawAt(e);
});
canvas.addEventListener("mouseup", () => { isDrawing = false; lastPt = null; });
canvas.addEventListener("mouseleave", () => { isDrawing = false; lastPt = null; });

canvas.addEventListener("touchstart", (e) => {
  if (mode === "brush" || mode === "eraser") { isDrawing = true; saveState(); lastPt = null; drawAt(e); e.preventDefault(); }
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) { drawAt(e); e.preventDefault(); }
}, { passive: false });
canvas.addEventListener("touchend", () => { isDrawing = false; lastPt = null; });

// ----------------- Fill trên color layer (chặn bởi line alpha) -----------------
canvas.addEventListener("click", (e) => {
  if (mode !== "fill") return;
  const { x, y } = getCanvasCoords(e);
  saveState();
  floodFillColorLayer(x, y, hexToRgba(currentColor));
  compositeToMain();
});

function floodFillColorLayer(x, y, fillColor) {
  const w = colorCanvas.width, h = colorCanvas.height;
  if (w === 0 || h === 0) return;

  let img, imgLine;
  try {
    img = colorCtx.getImageData(0, 0, w, h);
    imgLine = lineCtx.getImageData(0, 0, w, h);
  } catch (e) {
    console.error(e);
    alert("Không thể tô màu (CORS). Hãy dùng ảnh cùng domain hoặc bật crossOrigin.");
    return;
  }
  const d = img.data, ld = imgLine.data;

  const idx0 = (y * w + x) * 4;
  const sr = d[idx0], sg = d[idx0 + 1], sb = d[idx0 + 2];

  // Không tô lên pixel đang là “tường” (nằm trong nét)
  if (ld[idx0 + 3] > BARRIER_ALPHA_THR) return;

  const visited = new Uint8Array(w * h);
  const stack = [[x, y]];

  const match = (i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return (Math.abs(r - sr) <= FILL_TOLERANCE &&
            Math.abs(g - sg) <= FILL_TOLERANCE &&
            Math.abs(b - sb) <= FILL_TOLERANCE);
  };

  // barrier mask (alpha line > 0) có thể nở thêm 1px
  const isBarrier = (px, py) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return true;
    for (let dy = -FILL_BARRIER_RADIUS; dy <= FILL_BARRIER_RADIUS; dy++) {
      for (let dx = -FILL_BARRIER_RADIUS; dx <= FILL_BARRIER_RADIUS; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (ld[j + 3] > BARRIER_ALPHA_THR) return true;
      }
    }
    return false;
  };

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;

    const vi = cy * w + cx;
    if (visited[vi]) continue;
    visited[vi] = 1;

    const i = (cy * w + cx) * 4;
    if (isBarrier(cx, cy) || !match(i)) continue;

    d[i] = fillColor[0]; d[i + 1] = fillColor[1]; d[i + 2] = fillColor[2]; d[i + 3] = 255;

    stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
  }

  // (tuỳ chọn) nở lòng 1px
  if (FILL_GROW_RADIUS > 0) {
    growFill(visited, d, w, h, fillColor);
  }

  colorCtx.putImageData(img, 0, 0);

  // Lấp mép “dưới nét” để không còn rãnh trắng
  bleedUnderLine(visited, fillColor, UNDERPAINT_ALPHA_THR);
}

function growFill(visited, data, w, h, fillColor) {
  const N8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!visited[p]) continue;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const pi = (ny * w + nx) * 4;
        data[pi] = fillColor[0]; data[pi + 1] = fillColor[1]; data[pi + 2] = fillColor[2]; data[pi + 3] = 255;
      }
    }
  }
}

function bleedUnderLine(visited, fillColor, alphaThr = 12) {
  const w = colorCanvas.width, h = colorCanvas.height;
  let lineID, colorID;
  try { lineID = lineCtx.getImageData(0, 0, w, h); colorID = colorCtx.getImageData(0, 0, w, h); }
  catch (e) { console.warn(e); return; }

  const ld = lineID.data, cd = colorID.data;
  const N8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!visited[p]) continue;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = (ny * w + nx) * 4;
        if (ld[i + 3] > alphaThr) {
          cd[i] = fillColor[0]; cd[i + 1] = fillColor[1]; cd[i + 2] = fillColor[2]; cd[i + 3] = 255;
        }
      }
    }
  }
  colorCtx.putImageData(colorID, 0, 0);
}

// ----------------- Undo / Redo (snapshot color layer) -----------------
function saveState() {
  if (colorCanvas.width === 0 || colorCanvas.height === 0) return;
  try { undoStack.push(colorCtx.getImageData(0, 0, colorCanvas.width, colorCanvas.height)); redoStack = []; }
  catch (e) { console.warn("saveState failed:", e); }
}
document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length === 0) return;
  try {
    const current = colorCtx.getImageData(0, 0, colorCanvas.width, colorCanvas.height);
    redoStack.push(current);
    const prev = undoStack.pop();
    colorCtx.putImageData(prev, 0, 0);
    compositeToMain();
  } catch (e) { console.warn("undo failed:", e); }
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length === 0) return;
  try {
    const current = colorCtx.getImageData(0, 0, colorCanvas.width, colorCanvas.height);
    undoStack.push(current);
    const next = redoStack.pop();
    colorCtx.putImageData(next, 0, 0);
    compositeToMain();
  } catch (e) { console.warn("redo failed:", e); }
});

// ----------------- Download (color + line + text + logo) -----------------
document.getElementById("downloadBtn").addEventListener("click", () => {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const logo = new Image();
  logo.src = "images/logo.webp";
  logo.crossOrigin = "anonymous";

  logo.onload = () => {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    tempCanvas.width = colorCanvas.width;
    tempCanvas.height = colorCanvas.height;

    // 1) Vẽ color + line
    tempCtx.drawImage(colorCanvas, 0, 0);
    tempCtx.drawImage(lineCanvas, 0, 0);

    // 2) Vẽ các text-box DOM
    document.querySelectorAll(".text-box").forEach(box => {
      const content = box.querySelector(".text-content");
      const text = content.innerText;
      if (!text.trim()) return;

      const canvasRect = canvas.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();

      const scaleX = colorCanvas.width / canvasRect.width;
      const scaleY = colorCanvas.height / canvasRect.height;

      const centerX = (boxRect.left + boxRect.width / 2 - canvasRect.left) * scaleX;
      const centerY = (boxRect.top + boxRect.height / 2 - canvasRect.top) * scaleY;

      const fontSize = parseFloat(getComputedStyle(content).fontSize) * scaleY;
      const fontFamily = getComputedStyle(content).fontFamily;
      const fontWeight = getComputedStyle(content).fontWeight;
      const textColor = getComputedStyle(content).color;

      const rotation = parseFloat(box.dataset.rotation || "0");
      const scaleBoxX = parseFloat(box.dataset.scaleX || "1");
      const scaleBoxY = parseFloat(box.dataset.scaleY || "1");

      tempCtx.save();
      tempCtx.translate(centerX, centerY);
      tempCtx.rotate(rotation * Math.PI / 180);
      tempCtx.scale(scaleBoxX, scaleBoxY);
      tempCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      tempCtx.fillStyle = textColor;
      tempCtx.textAlign = "center";
      tempCtx.textBaseline = "middle";
      tempCtx.fillText(text, 0, 0);
      tempCtx.restore();
    });

    // 3) Vẽ logo
    const logoHeight = 30;
    const scale = logoHeight / logo.height;
    const logoWidth = logo.width * scale;
    const x = tempCanvas.width - logoWidth - 10;
    const y = tempCanvas.height - logoHeight - 10;
    tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

    // 4) Tải về
    if (isIOS) {
      const win = window.open("about:blank", "_blank");
      win.document.write(`<img src="${tempCanvas.toDataURL("image/png")}" style="max-width:100%;"/>`);
      win.document.close();
    } else {
      tempCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = originalImageName || "to_mau.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, "image/png");
    }
  };

  logo.onerror = () => alert("Không thể tải logo từ images/logo.webp");
});

// ----------------- Text box DOM (giữ nguyên) -----------------
function addTextBoxCentered() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const container = document.querySelector(".canvas-wrapper");
  const box = document.createElement("div");
  box.className = "text-box";
  box.style.left = `${(rect.width / 2) - 100}px`;
  box.style.top = `${(rect.height / 2) - 20}px`;

  const content = document.createElement("div");
  content.className = "text-content";
  content.contentEditable = "true";
  content.spellcheck = false;
  content.style.minWidth = "1ch";
  content.style.width = "100%";

  box.appendChild(content);
  container.appendChild(box);

  content.focus();
  content.style.color = currentColor;
  makeTextBoxDraggable(box);
  enableResize(box);
  enableRotate(box);

  currentTextBox = box;
  box.addEventListener("click", () => {
    currentTextBox = box;
    if (mode === "text" && currentTextBox) {
      const content = currentTextBox.querySelector(".text-content");
      if (content) content.style.color = currentColor;
    }
  });

  isTyping = true;
  content.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
}

function makeTextBoxDraggable(box) {
  let isDragging = false, hasMoved = false, offsetX = 0, offsetY = 0;

  box.addEventListener("mousedown", (e) => {
    if (e.target !== box) return;
    isDragging = true; hasMoved = false;
    offsetX = e.offsetX; offsetY = e.offsetY; e.preventDefault();
  });

  box.addEventListener("touchstart", (e) => {
    if (e.target !== box) return;
    isDragging = true; hasMoved = false;
    const t = e.touches[0]; const r = box.getBoundingClientRect();
    offsetX = t.clientX - r.left; offsetY = t.clientY - r.top; e.preventDefault();
  }, { passive: false });

  function move(clientX, clientY) {
    const wr = document.querySelector(".canvas-wrapper").getBoundingClientRect();
    box.style.left = `${clientX - wr.left - offsetX}px`;
    box.style.top  = `${clientY - wr.top  - offsetY}px`;
  }
  document.addEventListener("mousemove", (e) => { if (isDragging) { hasMoved = true; move(e.clientX, e.clientY);} });
  document.addEventListener("touchmove", (e) => {
    if (!isDragging) return; hasMoved = true;
    const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault();
  }, { passive: false });

  document.addEventListener("mouseup", () => { if (isDragging && !hasMoved) box.focus(); isDragging = false; });
  document.addEventListener("touchend", () => { if (isDragging && !hasMoved) box.focus(); isDragging = false; });
}

function enableResize(textBox) {
  const resizer = document.createElement("div");
  resizer.className = "resizer";
  textBox.appendChild(resizer);

  let isResizing = false, startX, startY, startWidth, startHeight, startScaleX, startScaleY, rotation;
  textBox.style.transformOrigin = "center center";
  textBox.dataset.scaleX = textBox.dataset.scaleX || "1";
  textBox.dataset.scaleY = textBox.dataset.scaleY || "1";
  textBox.dataset.rotation = textBox.dataset.rotation || "0";

  const onResizeStart = (e) => {
    e.preventDefault(); isResizing = true;
    const cx = e.clientX || e.touches?.[0]?.clientX; const cy = e.clientY || e.touches?.[0]?.clientY;
    startX = cx; startY = cy;
    const r = textBox.getBoundingClientRect(); startWidth = r.width; startHeight = r.height;
    startScaleX = parseFloat(textBox.dataset.scaleX || "1"); startScaleY = parseFloat(textBox.dataset.scaleY || "1");
    rotation = parseFloat(textBox.dataset.rotation || "0");
  };
  const onResizeMove = (e) => {
    if (!isResizing) return;
    const cx = e.clientX || e.touches?.[0]?.clientX; const cy = e.clientY || e.touches?.[0]?.clientY;
    const dx = cx - startX, dy = cy - startY;
    const ang = rotation * Math.PI / 180;
    const dW = dx * Math.cos(ang) + dy * Math.sin(ang);
    const dH = dy * Math.cos(ang) - dx * Math.sin(ang);
    let sX = (startWidth + dW) / startWidth * startScaleX;
    let sY = (startHeight + dH) / startHeight * startScaleY;
    sX = Math.max(0.2, Math.min(sX, 5)); sY = Math.max(0.2, Math.min(sY, 5));
    textBox.dataset.scaleX = sX.toFixed(3); textBox.dataset.scaleY = sY.toFixed(3);
    applyTransform(textBox);
  };
  const onResizeEnd = () => { isResizing = false; };

  resizer.addEventListener("mousedown", onResizeStart);
  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup", onResizeEnd);

  resizer.addEventListener("touchstart", onResizeStart, { passive: false });
  document.addEventListener("touchmove", onResizeMove, { passive: false });
  document.addEventListener("touchend", onResizeEnd);
}

function applyTransform(box) {
  const a = parseFloat(box.dataset.rotation || "0");
  const sx = parseFloat(box.dataset.scaleX || "1");
  const sy = parseFloat(box.dataset.scaleY || "1");
  box.style.transform = `rotate(${a}deg) scale(${sx}, ${sy})`;
}

function enableRotate(textBox) {
  const handle = document.createElement("div");
  handle.className = "rotate-handle";
  textBox.appendChild(handle);

  let isRotating = false, cx, cy, startAngle;
  const center = () => { const r = textBox.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; };
  const ang = (cx, cy, x, y) => Math.atan2(y - cy, x - cx) * (180 / Math.PI);

  const start = (clientX, clientY) => { isRotating = true; const c = center(); cx = c.x; cy = c.y; startAngle = ang(cx, cy, clientX, clientY) - parseFloat(textBox.dataset.rotation || "0"); };
  const rotate = (clientX, clientY) => { if (!isRotating) return; const a = ang(cx, cy, clientX, clientY) - startAngle; textBox.dataset.rotation = a.toFixed(2); applyTransform(textBox); };
  const stop = () => { isRotating = false; };

  handle.addEventListener("mousedown", (e) => { e.stopPropagation(); start(e.clientX, e.clientY); });
  document.addEventListener("mousemove", (e) => { if (isRotating) rotate(e.clientX, e.clientY); });
  document.addEventListener("mouseup", stop);

  handle.addEventListener("touchstart", (e) => { if (e.touches.length === 1) { const t = e.touches[0]; start(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener("touchmove", (e) => { if (isRotating && e.touches.length === 1) { const t = e.touches[0]; rotate(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener("touchend", stop);
}

// Click chọn textbox -> đổi màu chữ theo palette hiện tại
function handleTextBoxSelection(e) {
  const box = e.target.closest(".text-box");
  if (box) {
    currentTextBox = box;
    const content = currentTextBox.querySelector(".text-content");
    if (content) content.style.color = currentColor;
  }
}
document.addEventListener("click", handleTextBoxSelection);
document.addEventListener("touchstart", handleTextBoxSelection, { passive: true });

document.getElementById("boldBtn").addEventListener("click", () => {
  if (!currentTextBox) return;
  const content = currentTextBox.querySelector(".text-content");
  const isBold = content.style.fontWeight === "bold";
  content.style.fontWeight = isBold ? "normal" : "bold";
});
document.getElementById("fontSelect").addEventListener("change", (e) => {
  if (currentTextBox) currentTextBox.querySelector(".text-content").style.fontFamily = e.target.value;
});
document.getElementById("deleteTextBtn").addEventListener("click", () => {
  if (currentTextBox) { currentTextBox.remove(); currentTextBox = null; }
});

// ----------------- Select style -----------------
function updateSelectStyle() {
  const el = imageSelect;
  if (!el) return;
  const isPlaceholder = el.selectedIndex === 0;
  el.style.color = isPlaceholder ? "rgba(0,0,0,0.5)" : "#000";
  el.style.fontStyle = isPlaceholder ? "italic" : "normal";
  if (!isPlaceholder) el.classList.add("selected-kite"); else el.classList.remove("selected-kite");
}
imageSelect.addEventListener("change", updateSelectStyle);
window.addEventListener("DOMContentLoaded", updateSelectStyle);
imageSelect.addEventListener("change", () => { imageSelect.classList.add("pop"); setTimeout(() => imageSelect.classList.remove("pop"), 200); });

// ----------------- Menu init + load by ?img= -----------------
function initMenuButton() {
  const menuBtn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  if (menuBtn && nav && !menuBtn.dataset.bound) {
    menuBtn.addEventListener("click", () => { nav.classList.toggle("open"); });
    menuBtn.dataset.bound = "true";
  }
}
window.addEventListener("DOMContentLoaded", () => {
  initMenuButton();
  ensureInitialized();

  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get("img");
  if (imageUrl) {
    const imgFromUrl = new Image();
    imgFromUrl.crossOrigin = "anonymous";
    imgFromUrl.onload = () => { resetStacks(); loadImageToLayers(imgFromUrl); originalImageName = imageUrl.split("/").pop(); };
    imgFromUrl.src = imageUrl;
  }
});

// ====================== Helpers: init & line build ======================
function ensureInitialized() {
  if (canvas.width === 0 || canvas.height === 0) {
    const w = +(canvas.getAttribute('width') || canvas.clientWidth || 1024);
    const h = +(canvas.getAttribute('height') || canvas.clientHeight || 768);
    // main canvas dùng hiển thị composite
    canvas.width = w; canvas.height = h;
    // offscreen layers
    colorCanvas.width = w; colorCanvas.height = h;
    lineCanvas.width = w; lineCanvas.height = h;
    // color layer = trắng
    colorCtx.fillStyle = "#FFFFFF"; colorCtx.fillRect(0, 0, w, h);
    // line layer rỗng
    lineCtx.clearRect(0, 0, w, h);
    compositeToMain();
  }
}

function loadImageToLayers(image) {
  // set kích thước các layer theo ảnh
  canvas.width = image.width; canvas.height = image.height;
  colorCanvas.width = image.width; colorCanvas.height = image.height;
  lineCanvas.width = image.width; lineCanvas.height = image.height;

  // reset layers
  colorCtx.fillStyle = "#FFFFFF"; colorCtx.fillRect(0, 0, colorCanvas.width, colorCanvas.height);
  lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);

  // Chuẩn hoá thành line mask nhị phân
  lineMask = buildLineMaskFromImage(image);
if (ERODE_RADIUS > 0) {
  lineMask = erodeMask(lineMask, lineCanvas.width, lineCanvas.height, ERODE_RADIUS);
}

  function erodeMask(mask, w, h, r = 1) {
  if (!mask || r <= 0) return mask;
  const out = new Uint8Array(mask); // copy
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask[p] !== 1) { out[p] = 0; continue; }
      // pixel biên: nếu có hàng xóm 0 trong phạm vi r => xóa (mòn)
      let keep = true;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r && keep; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { keep = false; break; }
          if (mask[ny * w + nx] === 0) keep = false;
        }
      }
      out[p] = keep ? 1 : 0;
    }
  }
  return out;
}

  // Render line layer mượt (alpha chỉ ở mép, nền alpha=0, lõi alpha=1)
  renderLineLayerFromMask(lineMask, lineCanvas.width, lineCanvas.height, 3);

  compositeToMain();
}

function buildLineMaskFromImage(image) {
  const w = image.width, h = image.height;
  const work = document.createElement("canvas");
  work.width = w; work.height = h;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  wctx.imageSmoothingEnabled = false;
  wctx.clearRect(0, 0, w, h);
  wctx.drawImage(image, 0, 0);

  let id;
  try { id = wctx.getImageData(0, 0, w, h); }
  catch (e) { alert("Ảnh bị chặn đọc pixel (CORS). Hãy dùng ảnh cùng domain hoặc bật crossOrigin='anonymous'."); throw e; }
  const d = id.data;

  const hardBlack = new Uint8Array(w * h);
  const hardWhite = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y < T_HIGH) hardBlack[p] = 1;
    else if (y > T_LOW) hardWhite[p] = 1;
  }

  const outBlack = new Uint8Array(hardBlack);
  const N = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (hardBlack[p] || hardWhite[p]) continue;
      for (const [dx, dy] of N) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (hardBlack[ny * w + nx]) { outBlack[p] = 1; break; }
      }
    }
  }

  if (DILATE_RADIUS > 0) {
    const src = outBlack, out = new Uint8Array(src);
    const R = DILATE_RADIUS;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (src[p]) continue;
      let touch = false;
      for (let dy = -R; dy <= R && !touch; dy++) for (let dx = -R; dx <= R && !touch; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (src[ny * w + nx]) touch = true;
      }
      if (touch) out[p] = 1;
    }
    outBlack.set(out);
  }
  return outBlack;
}

// Vẽ line layer mượt từ lineMask (nền alpha=0, lõi alpha=1, mép có alpha)
function renderLineLayerFromMask(mask, w, h, scale = 3) {
  // 1) mask -> canvas nhị phân
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  const id = sctx.createImageData(w, h);
  const dd = id.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const black = mask[p] === 1;
    dd[i] = dd[i+1] = dd[i+2] = black ? 0 : 255;
    dd[i+3] = 255;
  }
  sctx.putImageData(id, 0, 0);

  // 2) Upsample không smoothing
  const up = document.createElement('canvas');
  up.width = w * scale; up.height = h * scale;
  const uctx = up.getContext('2d');
  uctx.imageSmoothingEnabled = false;
  uctx.drawImage(src, 0, 0, up.width, up.height);

  // 3) Blur nhẹ
  const bl = document.createElement('canvas');
  bl.width = up.width; bl.height = up.height;
  const bctx = bl.getContext('2d');
  bctx.filter = `blur(${Math.max(0.6, AA_BLUR_PX * scale)}px)`;
  bctx.drawImage(up, 0, 0);

  // 4) Downsample về lineCanvas (smoothing chất lượng cao)
  lineCtx.clearRect(0, 0, w, h);
  lineCtx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in lineCtx) lineCtx.imageSmoothingQuality = 'high';
  lineCtx.drawImage(bl, 0, 0, w, h);

  // 5) Grayscale -> Alpha (gamma). Nền alpha=0; Lõi mask alpha=1; Mép mượt.
  let lid;
  try { lid = lineCtx.getImageData(0, 0, w, h); }
  catch (e) { console.error(e); return; }
  const ld = lid.data;

  for (let i = 0; i < ld.length; i += 4) {
    const p = (i >> 2);
    const lum = 0.299 * ld[i] + 0.587 * ld[i + 1] + 0.114 * ld[i + 2];
    let a = 1 - (lum / 255);

    if (mask[p] === 1) {
      a = 1; // lõi nét
    } else {
      if (lum >= WHITE_LUMA) a = 0; // nền trắng tuyệt đối
      else {
        a = Math.pow(a, AA_ALPHA_GAMMA);
        if (a > AA_EDGE_HARDEN_THR) a = 1;
        else a = Math.max(AA_EDGE_MIN / 255, a);
      }
    }
    ld[i] = ld[i + 1] = ld[i + 2] = 0;
    ld[i + 3] = Math.round(a * 255);
  }
  lineCtx.putImageData(lid, 0, 0);
  lineCtx.imageSmoothingEnabled = false;

  // cuối cùng: composite để xem
  compositeToMain();
}

// ----------------- Composite to main canvas -----------------
function compositeToMain() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(colorCanvas, 0, 0);
  ctx.drawImage(lineCanvas, 0, 0);
}

// ----------------- Utils -----------------
function hexToRgba(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}
