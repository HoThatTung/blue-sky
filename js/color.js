const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let currentColor = "#000000";
let img = new Image();
let isDrawing = false;
let mode = "fill"; // fill | brush | eraser | text
let isTyping = false;
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];
let redoStack = [];

let originalImageName = "";

// ===== BẢO VỆ VIỀN =====
let lineArtMask = null;     // Uint8Array: 1 = pixel thuộc viền gốc
let lineArtPixels = null;   // Uint8ClampedArray: RGBA gốc để phục hồi
const LINE_PROTECT = {
  enabled: true,
  blackThreshold: 40,       // R,G,B < 40 coi là gần đen
  luminanceThreshold: 65,   // Y < 65 coi là tối (bắt cả viền xám)
  maskGrow: 1               // nở mask thêm (0–2) nếu viền mảnh
};

// ===== Chống viền trắng khi tô =====
const FILL_TOLERANCE = 85;          // ăn hết dải anti-alias
const EDGE_GROW_AFTER_FILL = 3;     // nở vùng tô 3 vòng (dừng ở viền)
const CLOSE_GAPS_RADIUS = 1;        // đóng khe 1px trên viền (nét đứt)

// ===== PALETTE =====
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

document.getElementById("fillModeBtn").addEventListener("click", () => {
  updateModeButtons("fill");
});
function updateModeButtons(newMode = null) {
  mode = newMode;
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
  if (mode === "fill")   document.getElementById("fillModeBtn").classList.add("active");
  else if (mode === "brush")  document.getElementById("brushModeBtn").classList.add("active");
  else if (mode === "eraser") document.getElementById("eraserModeBtn").classList.add("active");
  else if (mode === "text")   document.getElementById("textModeBtn").classList.add("active");
}
document.getElementById("textModeBtn").addEventListener("click", () => {
  mode = "text";
  updateModeButtons();
  addTextBoxCentered();
});
document.getElementById("brushModeBtn").addEventListener("click", () => {
  updateModeButtons("brush");
});
document.getElementById("eraserModeBtn").addEventListener("click", () => {
  updateModeButtons("eraser");
});

document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

document.getElementById("imageSelect").addEventListener("change", function () {
  const selectedImage = this.value;
  img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    captureLineArt(); // ✅ chụp viền gốc
  };
  img.src = selectedImage;
  document.getElementById("uploadInput").value = "";
  undoStack = [];
  redoStack = [];
  originalImageName = selectedImage.split('/').pop();
  updateSelectStyle();
  document.getElementById("kite-label-input").style.display = "block";
});

document.getElementById("uploadInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (event) {
    img = new Image();
    img.onload = function () {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      captureLineArt(); // ✅ chụp viền gốc
      undoStack = [];
      redoStack = [];
      originalImageName = file.name;
      document.getElementById("imageSelect").selectedIndex = 0;
      updateSelectStyle();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// ===== Helpers =====
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

function drawAt(e) {
  const { x, y } = getCanvasCoords(e);
  ctx.fillStyle = mode === "eraser" ? "#ffffff" : currentColor;
  ctx.beginPath();
  ctx.arc(x, y, brushSize, 0, Math.PI * 2);
  ctx.fill();
}

canvas.addEventListener("mousedown", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    drawAt(e);
  }
});
canvas.addEventListener("mousemove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) drawAt(e);
});
canvas.addEventListener("mouseup", () => { isDrawing = false; reapplyLineArt(); });
canvas.addEventListener("mouseleave", () => isDrawing = false);

canvas.addEventListener("touchstart", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    drawAt(e);
    e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) { drawAt(e); e.preventDefault(); }
}, { passive: false });
canvas.addEventListener("touchend", () => { isDrawing = false; reapplyLineArt(); });

canvas.addEventListener("click", (e) => {
  if (mode === "fill") {
    const { x, y } = getCanvasCoords(e);
    saveState();
    floodFill(x, y, hexToRgba(currentColor));
    reapplyLineArt(); // ✅ phục hồi viền sau khi fill
  }
});

function hexToRgba(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

// ===== FILL: chặn viền + lấp khe trắng =====
function floodFill(x, y, fillColor) {
  const w = canvas.width, h = canvas.height;
  const startIdx = y * w + x;

  // Bấm đúng vào viền gốc → bỏ qua
  if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[startIdx]) return;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const base = (y * w + x) * 4;
  const startColor = data.slice(base, base + 4);
  const tol = FILL_TOLERANCE;

  const sameAsStart = (p) => {
    for (let j = 0; j < 4; j++) {
      if (Math.abs(data[p + j] - startColor[j]) > tol) return false;
    }
    return true;
  };
  const paint = (p) => {
    data[p]   = fillColor[0];
    data[p+1] = fillColor[1];
    data[p+2] = fillColor[2];
    data[p+3] = 255;
  };

  const stack = [[x, y]];
  const visited = new Uint8Array(w * h);
  const filled  = new Uint8Array(w * h);

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const i1d = cy * w + cx;
    const p = i1d * 4;

    if (visited[i1d]) continue;
    visited[i1d] = 1;

    // Không đè lên viền gốc
    if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[i1d]) continue;
    if (!sameAsStart(p)) continue;

    paint(p);
    filled[i1d] = 1;

    if (cx > 0)        stack.push([cx - 1, cy]);
    if (cx < w - 1)    stack.push([cx + 1, cy]);
    if (cy > 0)        stack.push([cx, cy - 1]);
    if (cy < h - 1)    stack.push([cx, cy + 1]);
  }

  // NỞ VÙNG SAU KHI TÔ (lấp khe trắng nhưng không vượt qua viền)
  const neighbors8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let iter = 0; iter < EDGE_GROW_AFTER_FILL; iter++) {
    const toGrow = [];
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = yy * w + xx;
        if (filled[idx]) continue;
        if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[idx]) continue;
        let nearFilled = false;
        for (const [dx, dy] of neighbors8) {
          const nx = xx + dx, ny = yy + dy;
          if (nx>=0 && ny>=0 && nx<w && ny<h && filled[ny*w + nx]) { nearFilled = true; break; }
        }
        if (nearFilled) toGrow.push(idx);
      }
    }
    for (const idx of toGrow) {
      const p2 = idx * 4;
      paint(p2);
      filled[idx] = 1;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ===== UNDO / REDO =====
function saveState() {
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  redoStack = [];
}
document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const prev = undoStack.pop();
    ctx.putImageData(prev, 0, 0);
    reapplyLineArt();
  }
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const next = redoStack.pop();
    ctx.putImageData(next, 0, 0);
    reapplyLineArt();
  }
});

// ===== DOWNLOAD =====
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

    tempCtx.drawImage(canvas, 0, 0);

    document.querySelectorAll(".text-box").forEach(box => {
      const content = box.querySelector(".text-content");
      const text = content.innerText;
      if (!text.trim()) return;

      const canvasRect = canvas.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      const scaleX = canvas.width / canvasRect.width;
      const scaleY = canvas.height / canvasRect.height;
      const centerX = (boxRect.left + boxRect.width / 2 - canvasRect.left) * scaleX;
      const centerY = (boxRect.top + boxRect.height / 2 - canvasRect.top) * scaleY;

      const cs = getComputedStyle(content);
      const fontSize = parseFloat(cs.fontSize) * scaleY;
      const fontFamily = cs.fontFamily;
      const fontWeight = cs.fontWeight;
      const textColor = cs.color;

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

    const logoHeight = 30;
    const scale = logoHeight / logo.height;
    const logoWidth = logo.width * scale;
    const x = canvas.width - logoWidth - 10;
    const y = canvas.height - logoHeight - 10;
    tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

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

// ===== TEXT BOXES =====
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
  let offsetX = 0;
  let offsetY = 0;

  box.addEventListener("mousedown", (e) => {
    if (e.target !== box) return;
    isDragging = true;
    hasMoved = false;
    offsetX = e.offsetX;
    offsetY = e.offsetY;
    e.preventDefault();
  });

  box.addEventListener("touchstart", (e) => {
    if (e.target !== box) return;
    isDragging = true;
    hasMoved = false;
    const touch = e.touches[0];
    const rect = box.getBoundingClientRect();
    offsetX = touch.clientX - rect.left;
    offsetY = touch.clientY - rect.top;
    e.preventDefault();
  }, { passive: false });

  function handleMove(clientX, clientY) {
    const wrapperRect = document.querySelector(".canvas-wrapper").getBoundingClientRect();
    box.style.left = `${clientX - wrapperRect.left - offsetX}px`;
    box.style.top = `${clientY - wrapperRect.top - offsetY}px`;
  }

  document.addEventListener("mousemove", (e) => { if (isDragging) { hasMoved = true; handleMove(e.clientX, e.clientY); }});
  document.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    hasMoved = true;
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("mouseup", () => { if (isDragging && !hasMoved) box.focus(); isDragging = false; });
  document.addEventListener("touchend", () => { if (isDragging && !hasMoved) box.focus(); isDragging = false; });
}

function enableResize(textBox) {
  const resizer = document.createElement("div");
  resizer.className = "resizer";
  textBox.appendChild(resizer);

  let isResizing = false;
  let startX, startY;
  let startWidth, startHeight;
  let startScaleX, startScaleY;
  let rotation;

  textBox.style.transformOrigin = "center center";
  textBox.dataset.scaleX = textBox.dataset.scaleX || "1";
  textBox.dataset.scaleY = textBox.dataset.scaleY || "1";
  textBox.dataset.rotation = textBox.dataset.rotation || "0";

  const onResizeStart = (e) => {
    e.preventDefault();
    isResizing = true;

    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;

    startX = clientX;
    startY = clientY;

    const rect = textBox.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;

    startScaleX = parseFloat(textBox.dataset.scaleX || "1");
    startScaleY = parseFloat(textBox.dataset.scaleY || "1");
    rotation = parseFloat(textBox.dataset.rotation || "0");
  };

  const onResizeMove = (e) => {
    if (!isResizing) return;

    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;

    const dx = clientX - startX;
    const dy = clientY - startY;

    const angleRad = rotation * Math.PI / 180;
    const deltaW = dx * Math.cos(angleRad) + dy * Math.sin(angleRad);
    const deltaH = dy * Math.cos(angleRad) - dx * Math.sin(angleRad);

    let scaleX = (startWidth + deltaW) / startWidth * startScaleX;
    let scaleY = (startHeight + deltaH) / startHeight * startScaleY;

    scaleX = Math.max(0.2, Math.min(scaleX, 5));
    scaleY = Math.max(0.2, Math.min(scaleY, 5));

    textBox.dataset.scaleX = scaleX.toFixed(3);
    textBox.dataset.scaleY = scaleY.toFixed(3);

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

  let isRotating = false;
  let centerX, centerY, startAngle;

  const getCenter = () => {
    const rect = textBox.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const getAngle = (cx, cy, x, y) => Math.atan2(y - cy, x - cx) * (180 / Math.PI);

  const startRotate = (clientX, clientY) => {
    isRotating = true;
    const c = getCenter(); centerX = c.x; centerY = c.y;
    startAngle = getAngle(centerX, centerY, clientX, clientY) - parseFloat(textBox.dataset.rotation || "0");
  };
  const rotate = (clientX, clientY) => {
    if (!isRotating) return;
    const angle = getAngle(centerX, centerY, clientX, clientY) - startAngle;
    textBox.dataset.rotation = angle.toFixed(2);
    applyTransform(textBox);
  };
  const stopRotate = () => { isRotating = false; };

  rotateHandle.addEventListener("mousedown", (e) => { e.stopPropagation(); startRotate(e.clientX, e.clientY); });
  document.addEventListener("mousemove", (e) => { if (isRotating) rotate(e.clientX, e.clientY); });
  document.addEventListener("mouseup", stopRotate);

  rotateHandle.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      startRotate(t.clientX, t.clientY);
      e.preventDefault();
    }
  }, { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (isRotating && e.touches.length === 1) {
      const t = e.touches[0];
      rotate(t.clientX, t.clientY);
      e.preventDefault();
    }
  }, { passive: false });
  document.addEventListener("touchend", stopRotate);
}

// ===== Chụp & phục hồi lineart =====
function captureLineArt() {
  if (!LINE_PROTECT.enabled) return;
  try {
    const w = canvas.width, h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const N = w * h;

    // Lưu RGBA gốc
    lineArtPixels = new Uint8ClampedArray(d.length);
    lineArtPixels.set(d);

    // Tạo mask theo ngưỡng RGB & luminance
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

    // === Đóng khe (closing): dilate rồi erode cùng bán kính ===
    mask = dilate(mask, w, h, CLOSE_GAPS_RADIUS);
    mask = erode(mask,  w, h, CLOSE_GAPS_RADIUS);

    // Nở thêm nếu cần để viền dày (tuỳ cấu hình)
    if (LINE_PROTECT.maskGrow > 0) {
      mask = dilate(mask, w, h, LINE_PROTECT.maskGrow);
    }

    lineArtMask = mask;
  } catch (e) {
    console.warn("captureLineArt failed:", e);
    lineArtMask = null;
    lineArtPixels = null;
  }
}

function reapplyLineArt() {
  if (!LINE_PROTECT.enabled || !lineArtMask || !lineArtPixels) return;
  try {
    const w = canvas.width, h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const N = w * h;

    for (let i = 0; i < N; i++) {
      if (lineArtMask[i]) {
        const p = i * 4;
        d[p]   = lineArtPixels[p];
        d[p+1] = lineArtPixels[p+1];
        d[p+2] = lineArtPixels[p+2];
        d[p+3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    console.warn("reapplyLineArt failed:", e);
  }
}

// ==== Morphology helpers (8-neighbors) ====
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

// ===== FONT / UI =====
const imageSelect = document.getElementById("imageSelect");
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
    const imgFromUrl = new Image();
    imgFromUrl.crossOrigin = "anonymous";
    imgFromUrl.onload = () => {
      canvas.width = imgFromUrl.width;
      canvas.height = imgFromUrl.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgFromUrl, 0, 0);
      captureLineArt(); // ✅
      undoStack = [];
      redoStack = [];
      originalImageName = imageUrl.split("/").pop();
    };
    imgFromUrl.src = imageUrl;
  }
};

window.initMenuButton = initMenuButton;
