// ===== Canvas Painter (2-LAYER: Lineart + Paint) =====
// - Lineart (baseCanvas/baseCtx): giữ ảnh gốc, không bao giờ sửa -> viền luôn an toàn
// - Paint (paintCanvas/paintCtx): mọi tô/brush/eraser/fill diễn ra ở lớp này (RGBA, trong suốt)
// - Render: ctx = base + paint (+ text + logo)
// - FloodFill: duyệt theo màu hiện tại của ảnh "tổng hợp" (base nếu pixel paint trong suốt, ngược lại dùng paint),
//              bị chặn bởi lineArtMask (đã closing + dilate) để không vượt qua viền; hậu fill có nở vùng để lấp AA.

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Offscreen layers
const baseCanvas = document.createElement("canvas");  // lineart immutable
const baseCtx = baseCanvas.getContext("2d");
const paintCanvas = document.createElement("canvas"); // paint layer (editable)
const paintCtx = paintCanvas.getContext("2d");

let currentColor = "#000000";
let img = new Image();
let isDrawing = false;
let mode = "fill"; // fill | brush | eraser | text
let isTyping = false;
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];   // store PAINT layer only
let redoStack = [];

let originalImageName = "";

// ===== bảo vệ viền đen =====
let lineArtMask = null;     // Uint8Array: 1 = pixel thuộc viền gốc
let baseImageData = null;   // ImageData của lineart (để đọc màu nền)
const LINE_PROTECT = {
  enabled: true,
  blackThreshold: 40,       // R,G,B < 40 coi là gần đen
  luminanceThreshold: 65,   // Y < 65 coi là tối (bắt cả viền xám)
  maskGrow: 1,              // nở mask thêm nếu viền mảnh
  closeGapsRadius: 1        // đóng khe 1px ở nét đứt (closing)
};

// ===== tinh chỉnh fill để lấp khe trắng sát viền =====
const FILL_TOLERANCE = 80;          // ăn dải anti-alias tốt
const EDGE_GROW_AFTER_FILL = 2;     // nở vùng đã tô (1–3 tuỳ ảnh)

const colors = [
  "#CD0000", "#FF6633", "#FF9933", "#FF00FF", "#FFD700",
  "#FFFF00", "#000000", "#808080", "#C0C0C0", "#FFFFFF",
  "#0000FF", "#6600CC", "#0099FF", "#00FFFF", "#006241",
  "#008000", "#00FF00", "#CCFFCC", "#800080", "#8B5F65"
];

// ===== Palette =====
const palette = document.getElementById("colorPalette");
colors.forEach((color, i) => {
  const div = document.createElement("div");
  div.className = "color";
  div.style.background = color;
  div.dataset.color = color;
  if (i === 0) {
    div.classList.add("selected");
    currentColor = color;
  }
  palette.appendChild(div);
});
document.querySelectorAll(".color").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".color").forEach(c => c.classList.remove("selected"));
    el.classList.add("selected");
    currentColor = el.dataset.color;
  });
});

// ===== Mode buttons =====
document.getElementById("fillModeBtn").addEventListener("click", () => {
  updateModeButtons("fill");
});
document.getElementById("textModeBtn").addEventListener("click", () => {
  updateModeButtons("text");
  addTextBoxCentered();
});
document.getElementById("brushModeBtn").addEventListener("click", () => {
  updateModeButtons("brush");
});
document.getElementById("eraserModeBtn").addEventListener("click", () => {
  updateModeButtons("eraser");
});

function updateModeButtons(newMode = null) {
  mode = newMode;
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
  if (mode === "fill")   document.getElementById("fillModeBtn").classList.add("active");
  else if (mode === "brush")  document.getElementById("brushModeBtn").classList.add("active");
  else if (mode === "eraser") document.getElementById("eraserModeBtn").classList.add("active");
  else if (mode === "text")   document.getElementById("textModeBtn").classList.add("active");
}

// ===== Brush size =====
document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

// ===== Image select / upload =====
const imageSelect = document.getElementById("imageSelect");
imageSelect.addEventListener("change", function () {
  const selectedImage = this.value;
  loadImage(selectedImage, selectedImage.split('/').pop());
  document.getElementById("uploadInput").value = "";
  undoStack = [];
  redoStack = [];
  updateSelectStyle();
  const kiteLabel = document.getElementById("kite-label-input");
  if (kiteLabel) kiteLabel.style.display = "block";
  imageSelect.classList.add("pop");
  setTimeout(() => imageSelect.classList.remove("pop"), 200);
});

document.getElementById("uploadInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (event) {
    loadImage(event.target.result, file.name);
    imageSelect.selectedIndex = 0;
    updateSelectStyle();
    undoStack = [];
    redoStack = [];
  };
  reader.readAsDataURL(file);
});

function loadImage(src, nameForDownload) {
  img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    // Resize both canvases
    [canvas, baseCanvas, paintCanvas].forEach(c => { c.width = img.width; c.height = img.height; });

    // Draw to base (immutable)
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(img, 0, 0);
    baseImageData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);

    // Clear paint layer
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);

    // Build line art mask (closing + dilate)
    captureLineArtFromBase();

    // First render
    renderComposite();

    originalImageName = nameForDownload || "to_mau.png";
  };
  img.src = src;
}

function renderComposite() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseCanvas, 0, 0);   // lineart always on top of paint? -> draw base first
  ctx.drawImage(paintCanvas, 0, 0);  // color sits above white areas but viền vẫn là base
}

// ===== Helpers =====
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  let clientX, clientY;

  if (e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = Math.floor((clientX - rect.left) * scaleX);
  const y = Math.floor((clientY - rect.top) * scaleY);
  return { x, y };
}

function hexToRgba(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

function saveState() {
  try {
    const id = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
    undoStack.push(id);
    redoStack = [];
  } catch (err) {
    console.warn("saveState failed:", err);
  }
}

// ===== Brush / Eraser drawing on PAINT layer =====
function drawDotOnPaint(x, y) {
  paintCtx.beginPath();
  paintCtx.arc(x, y, brushSize, 0, Math.PI * 2);
  paintCtx.fill();
}

canvas.addEventListener("mousedown", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    const { x, y } = getCanvasCoords(e);
    if (mode === "eraser") {
      paintCtx.save();
      paintCtx.globalCompositeOperation = "destination-out";
      drawDotOnPaint(x, y);
      paintCtx.restore();
    } else {
      paintCtx.fillStyle = currentColor;
      drawDotOnPaint(x, y);
    }
    renderComposite();
  }
});
canvas.addEventListener("mousemove", (e) => {
  if (!isDrawing) return;
  if (mode === "brush" || mode === "eraser") {
    const { x, y } = getCanvasCoords(e);
    if (mode === "eraser") {
      paintCtx.save();
      paintCtx.globalCompositeOperation = "destination-out";
      drawDotOnPaint(x, y);
      paintCtx.restore();
    } else {
      paintCtx.fillStyle = currentColor;
      drawDotOnPaint(x, y);
    }
    renderComposite();
  }
});
canvas.addEventListener("mouseup", () => { isDrawing = false; });
canvas.addEventListener("mouseleave", () => { isDrawing = false; });

canvas.addEventListener("touchstart", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    const { x, y } = getCanvasCoords(e);
    if (mode === "eraser") {
      paintCtx.save();
      paintCtx.globalCompositeOperation = "destination-out";
      drawDotOnPaint(x, y);
      paintCtx.restore();
    } else {
      paintCtx.fillStyle = currentColor;
      drawDotOnPaint(x, y);
    }
    renderComposite();
    e.preventDefault();
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (!isDrawing) return;
  if (mode === "brush" || mode === "eraser") {
    const { x, y } = getCanvasCoords(e);
    if (mode === "eraser") {
      paintCtx.save();
      paintCtx.globalCompositeOperation = "destination-out";
      drawDotOnPaint(x, y);
      paintCtx.restore();
    } else {
      paintCtx.fillStyle = currentColor;
      drawDotOnPaint(x, y);
    }
    renderComposite();
    e.preventDefault();
  }
}, { passive: false });

canvas.addEventListener("touchend", () => { isDrawing = false; });

// ===== Fill on PAINT layer (respect lineArtMask) =====
canvas.addEventListener("click", (e) => {
  if (mode !== "fill") return;
  const { x, y } = getCanvasCoords(e);
  saveState();
  floodFillCompositeAware(x, y, hexToRgba(currentColor));
  renderComposite();
});

// Return composite pixel [r,g,b,a] at (x,y):
// - if PAINT alpha > 0 -> use PAINT pixel
// - else use BASE pixel
function getCompositeRGBA(paintData, baseData, w, x, y) {
  const idx = (y * w + x) * 4;
  const a = paintData[idx + 3];
  if (a > 0) {
    return [paintData[idx], paintData[idx+1], paintData[idx+2], a];
  } else {
    return [baseData[idx], baseData[idx+1], baseData[idx+2], baseData[idx+3]];
  }
}

function colorClose(a, b, tol) {
  return Math.abs(a[0]-b[0]) <= tol &&
         Math.abs(a[1]-b[1]) <= tol &&
         Math.abs(a[2]-b[2]) <= tol;
}

function floodFillCompositeAware(x, y, fillColor) {
  const w = paintCanvas.width, h = paintCanvas.height;
  const startIdx = y * w + x;

  if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[startIdx]) return; // click trúng viền

  // ImageData for PAINT (mutable) and BASE (readonly)
  const paintDataObj = paintCtx.getImageData(0, 0, w, h);
  const paintData = paintDataObj.data;
  const baseData  = baseImageData.data;

  const startCol = getCompositeRGBA(paintData, baseData, w, x, y);
  const tol = FILL_TOLERANCE;

  const stack = [[x, y]];
  const visited = new Uint8Array(w * h);
  const filled  = new Uint8Array(w * h);

  const paintPixel = (i) => {
    const p = i * 4;
    paintData[p]   = fillColor[0];
    paintData[p+1] = fillColor[1];
    paintData[p+2] = fillColor[2];
    paintData[p+3] = 255; // fully opaque on PAINT layer
  };

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;

    const i1d = cy * w + cx;
    if (visited[i1d]) continue;
    visited[i1d] = 1;

    // chặn viền gốc
    if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[i1d]) continue;

    // so màu trên ảnh COMPOSITE hiện tại
    const col = getCompositeRGBA(paintData, baseData, w, cx, cy);
    if (!colorClose(col, startCol, tol)) continue;

    paintPixel(i1d);
    filled[i1d] = 1;

    stack.push([cx - 1, cy]);
    stack.push([cx + 1, cy]);
    stack.push([cx, cy - 1]);
    stack.push([cx, cy + 1]);
  }

  // NỞ VÙNG để lấp AA (tôn trọng viền)
  const neighbors8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let iter = 0; iter < EDGE_GROW_AFTER_FILL; iter++) {
    const toGrow = [];
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i1d = yy * w + xx;
        if (filled[i1d]) continue;
        if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[i1d]) continue;
        let near = false;
        for (const [dx,dy] of neighbors8) {
          const nx = xx + dx, ny = yy + dy;
          if (nx>=0 && ny>=0 && nx<w && ny<h && filled[ny*w + nx]) { near = true; break; }
        }
        if (near) toGrow.push(i1d);
      }
    }
    for (const i1d of toGrow) {
      paintPixel(i1d);
      filled[i1d] = 1;
    }
  }

  // write back
  paintCtx.putImageData(paintDataObj, 0, 0);
}

// ===== UNDO / REDO (PAINT layer only) =====
document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    const cur = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
    redoStack.push(cur);
    const prev = undoStack.pop();
    paintCtx.putImageData(prev, 0, 0);
    renderComposite();
  }
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    const cur = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
    undoStack.push(cur);
    const next = redoStack.pop();
    paintCtx.putImageData(next, 0, 0);
    renderComposite();
  }
});

// ===== Download (composite base + paint + texts + logo) =====
document.getElementById("downloadBtn").addEventListener("click", () => {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const logo = new Image();
  logo.src = "images/logo.webp";
  logo.crossOrigin = "anonymous";

  logo.onload = () => {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    // 1) base + 2) paint
    tempCtx.drawImage(baseCanvas, 0, 0);
    tempCtx.drawImage(paintCanvas, 0, 0);

    // 3) rasterize text-boxes
    document.querySelectorAll(".text-box").forEach(box => {
      const content = box.querySelector(".text-content");
      const text = content?.innerText ?? "";
      if (!text.trim()) return;

      const canvasRect = canvas.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      const scaleX = canvas.width / canvasRect.width;
      const scaleY = canvas.height / canvasRect.height;

      const cx = (boxRect.left + boxRect.width / 2 - canvasRect.left) * scaleX;
      const cy = (boxRect.top + boxRect.height / 2 - canvasRect.top) * scaleY;

      const cs = getComputedStyle(content);
      const fontSize = parseFloat(cs.fontSize) * scaleY;
      const fontFamily = cs.fontFamily;
      const fontWeight = cs.fontWeight;
      const textColor = cs.color;

      const rotation = parseFloat(box.dataset.rotation || "0");
      const scaleBoxX = parseFloat(box.dataset.scaleX || "1");
      const scaleBoxY = parseFloat(box.dataset.scaleY || "1");

      tempCtx.save();
      tempCtx.translate(cx, cy);
      tempCtx.rotate(rotation * Math.PI / 180);
      tempCtx.scale(scaleBoxX, scaleBoxY);
      tempCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      tempCtx.fillStyle = textColor;
      tempCtx.textAlign = "center";
      tempCtx.textBaseline = "middle";
      tempCtx.fillText(text, 0, 0);
      tempCtx.restore();
    });

    // 4) logo
    const logoHeight = 30;
    const scale = logoHeight / logo.height;
    const logoWidth = logo.width * scale;
    const x = canvas.width - logoWidth - 10;
    const y = canvas.height - logoHeight - 10;
    tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

    // 5) save
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

// ===== Text boxes (giữ nguyên) =====
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
      const c = currentTextBox.querySelector(".text-content");
      if (c) c.style.color = currentColor;
    }
  });

  isTyping = true;
  content.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
}

function makeTextBoxDraggable(box) {
  let isDragging = false;
  let hasMoved = false;
  let offsetX = 0, offsetY = 0;

  box.addEventListener("mousedown", (e) => {
    if (e.target !== box) return;
    isDragging = true; hasMoved = false;
    offsetX = e.offsetX; offsetY = e.offsetY; e.preventDefault();
  });
  box.addEventListener("touchstart", (e) => {
    if (e.target !== box) return;
    isDragging = true; hasMoved = false;
    const t = e.touches[0], r = box.getBoundingClientRect();
    offsetX = t.clientX - r.left; offsetY = t.clientY - r.top; e.preventDefault();
  }, { passive: false });

  function move(clientX, clientY) {
    const w = document.querySelector(".canvas-wrapper").getBoundingClientRect();
    box.style.left = `${clientX - w.left - offsetX}px`;
    box.style.top  = `${clientY - w.top  - offsetY}px`;
  }
  document.addEventListener("mousemove", (e) => { if (!isDragging) return; hasMoved = true; move(e.clientX, e.clientY); });
  document.addEventListener("touchmove", (e) => { if (!isDragging) return; hasMoved = true; const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
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
    const r = textBox.getBoundingClientRect();
    startWidth = r.width; startHeight = r.height;
    startScaleX = parseFloat(textBox.dataset.scaleX || "1");
    startScaleY = parseFloat(textBox.dataset.scaleY || "1");
    rotation = parseFloat(textBox.dataset.rotation || "0");
  };
  const onResizeMove = (e) => {
    if (!isResizing) return;
    const cx = e.clientX || e.touches?.[0]?.clientX; const cy = e.clientY || e.touches?.[0]?.clientY;
    const dx = cx - startX, dy = cy - startY;
    const ang = rotation * Math.PI / 180;
    const deltaW = dx * Math.cos(ang) + dy * Math.sin(ang);
    const deltaH = dy * Math.cos(ang) - dx * Math.sin(ang);
    let sx = (startWidth  + deltaW) / startWidth  * startScaleX;
    let sy = (startHeight + deltaH) / startHeight * startScaleY;
    sx = Math.max(0.2, Math.min(sx, 5)); sy = Math.max(0.2, Math.min(sy, 5));
    textBox.dataset.scaleX = sx.toFixed(3);
    textBox.dataset.scaleY = sy.toFixed(3);
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
  const angle = parseFloat(box.dataset.rotation || "0");
  const scaleX = parseFloat(box.dataset.scaleX || "1");
  const scaleY = parseFloat(box.dataset.scaleY || "1");
  box.style.transform = `rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;
}

function enableRotate(textBox) {
  const rotateHandle = document.createElement("div");
  rotateHandle.className = "rotate-handle";
  textBox.appendChild(rotateHandle);

  let isRotating = false, centerX, centerY, startAngle;
  const center = () => {
    const r = textBox.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const ang = (cx, cy, x, y) => Math.atan2(y - cy, x - cx) * (180 / Math.PI);

  const start = (x, y) => { isRotating = true; const c = center(); centerX = c.x; centerY = c.y; startAngle = ang(centerX, centerY, x, y) - parseFloat(textBox.dataset.rotation || "0"); };
  const move  = (x, y) => { if (!isRotating) return; const a = ang(centerX, centerY, x, y) - startAngle; textBox.dataset.rotation = a.toFixed(2); applyTransform(textBox); };
  const stop  = () => { isRotating = false; };

  rotateHandle.addEventListener("mousedown", (e) => { e.stopPropagation(); start(e.clientX, e.clientY); });
  document.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
  document.addEventListener("mouseup", stop);
  rotateHandle.addEventListener("touchstart", (e) => { if (e.touches.length === 1) { const t = e.touches[0]; start(t.clientX, t.clientY); e.preventDefault(); }}, { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.touches.length === 1) { const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }}, { passive: false });
  document.addEventListener("touchend", stop);
}

// ===== Build lineart mask from BASE image =====
function captureLineArtFromBase() {
  if (!LINE_PROTECT.enabled) { lineArtMask = null; return; }
  const w = baseCanvas.width, h = baseCanvas.height;
  const d = baseImageData.data;
  const N = w * h;

  // initial mask by RGB + luminance
  let mask = new Uint8Array(N);
  const thr = LINE_PROTECT.blackThreshold;
  const lthr = LINE_PROTECT.luminanceThreshold;

  for (let i = 0; i < N; i++) {
    const p = i * 4;
    const r = d[p], g = d[p+1], b = d[p+2];
    const nearBlack = (r < thr && g < thr && b < thr);
    const Y = 0.2126*r + 0.7152*g + 0.0722*b;
    if (nearBlack || Y < lthr) mask[i] = 1;
  }

  // closing: dilate then erode to close small gaps (nét đứt)
  mask = dilate(mask, w, h, LINE_PROTECT.closeGapsRadius);
  mask = erode(mask,  w, h, LINE_PROTECT.closeGapsRadius);

  // grow for safety
  if (LINE_PROTECT.maskGrow > 0) mask = dilate(mask, w, h, LINE_PROTECT.maskGrow);

  lineArtMask = mask;
}

// morphology helpers
function dilate(mask, w, h, r = 1) {
  if (r <= 0) return mask;
  let out = mask;
  for (let iter = 0; iter < r; iter++) {
    const m2 = new Uint8Array(w*h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y*w + x;
        if (out[i]) { m2[i] = 1; continue; }
        for (let dy=-1; dy<=1 && !m2[i]; dy++) {
          for (let dx=-1; dx<=1 && !m2[i]; dx++) {
            if (!dx && !dy) continue;
            const nx = x+dx, ny = y+dy;
            if (nx>=0 && ny>=0 && nx<w && ny<h && out[ny*w + nx]) m2[i] = 1;
          }
        }
      }
    }
    out = m2;
  }
  return out;
}
function erode(mask, w, h, r = 1) {
  if (r <= 0) return mask;
  let out = mask;
  for (let iter = 0; iter < r; iter++) {
    const m2 = new Uint8Array(w*h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let allOn = true;
        for (let dy=-1; dy<=1 && allOn; dy++) {
          for (let dx=-1; dx<=1 && allOn; dx++) {
            if (!dx && !dy) continue;
            const nx = x+dx, ny = y+dy;
            if (nx<0 || ny<0 || nx>=w || ny>=h || !out[ny*w + nx]) allOn = false;
          }
        }
        const i = y*w + x;
        m2[i] = (out[i] && allOn) ? 1 : 0;
      }
    }
    out = m2;
  }
  return out;
}

// ===== Misc UI =====
function updateSelectStyle() {
  const isPlaceholder = imageSelect.selectedIndex === 0;
  imageSelect.style.color = isPlaceholder ? "rgba(0,0,0,0.5)" : "#000";
  imageSelect.style.fontStyle = isPlaceholder ? "italic" : "normal";
}
imageSelect.addEventListener("change", updateSelectStyle);
window.addEventListener("DOMContentLoaded", updateSelectStyle);
imageSelect.addEventListener("change", () => {
  imageSelect.classList.add("pop");
  setTimeout(() => imageSelect.classList.remove("pop"), 200);
});

document.getElementById("boldBtn").addEventListener("click", () => {
  if (currentTextBox) {
    const content = currentTextBox.querySelector(".text-content");
    const isBold = content.style.fontWeight === "bold";
    content.style.fontWeight = isBold ? "normal" : "bold";
  }
});
document.getElementById("fontSelect").addEventListener("change", (e) => {
  if (currentTextBox) {
    const content = currentTextBox.querySelector(".text-content");
    content.style.fontFamily = e.target.value;
  }
});
document.getElementById("deleteTextBtn").addEventListener("click", () => {
  if (currentTextBox) {
    currentTextBox.remove();
    currentTextBox = null;
  }
});

function initMenuButton() {
  const menuBtn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  if (menuBtn && nav && !menuBtn.dataset.bound) {
    menuBtn.addEventListener("click", () => { nav.classList.toggle("open"); });
    menuBtn.dataset.bound = "true";
  }
}
window.addEventListener("DOMContentLoaded", initMenuButton);
window.onload = () => {
  initMenuButton();
  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get("img");
  if (imageUrl) {
    loadImage(imageUrl, imageUrl.split("/").pop());
    undoStack = [];
    redoStack = [];
  }
};

window.initMenuButton = initMenuButton;
