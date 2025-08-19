// ====================== Canvas Coloring (1-layer, finalized + anti-aliased lines, cleaned) ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ---------- Config cho chuẩn hoá & bảo vệ nét ----------
const T_HIGH = 165;      // pixel tối hơn => chắc chắn là "đen"
const T_LOW  = 220;      // pixel sáng hơn => chắc chắn là "trắng"
const DILATE_RADIUS = 0; // nở nét 0..2 (1 thường là ổn)

// ✅ cấu hình mịn nét (anti-alias)
const AA_SCALE = 2;      // 2 hoặc 3 (2 thường là đủ mịn)

// ---------- State ----------
let currentColor = "#000000";
let isDrawing = false;
let mode = "fill"; // fill | brush | eraser | text
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];
let redoStack = [];

let originalImageName = "";

// ✅ mặt nạ nét (1 = pixel thuộc đường nét; 0 = nền/vùng tô)
let lineMask = null;

// ✅ lưu điểm trước đó để nội suy nét brush
let lastPt = null;

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
    setCurrentColor(color); // chặn đen tuyệt đối
  }
  palette.appendChild(div);
});

// Không cho màu tô là đen tuyệt đối
function setCurrentColor(hex) {
  const val = hex.startsWith('#') ? hex.slice(1) : hex;
  if (/^0{6}$/i.test(val)) {
    currentColor = "#111111"; // thay thế an toàn
  } else {
    currentColor = "#" + val.toUpperCase();
  }
}

// Gán click cho mỗi ô màu trong palette
document.querySelectorAll(".color").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".color").forEach(c => c.classList.remove("selected"));
    el.classList.add("selected");
    setCurrentColor(el.dataset.color);

    // Nếu đang ở mode text và có text-box đang chọn, đổi màu ngay
    if (mode === "text" && currentTextBox) {
      const content = currentTextBox.querySelector(".text-content");
      if (content) content.style.color = currentColor;
    }
  });
});

// ----------------- Mode buttons -----------------
document.getElementById("fillModeBtn").addEventListener("click", () => {
  updateModeButtons("fill");
});

function updateModeButtons(newMode = null) {
  mode = newMode;
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));

  if (mode === "fill") {
    document.getElementById("fillModeBtn").classList.add("active");
  } else if (mode === "brush") {
    document.getElementById("brushModeBtn").classList.add("active");
  } else if (mode === "eraser") {
    document.getElementById("eraserModeBtn").classList.add("active");
  } else if (mode === "text") {
    document.getElementById("textModeBtn").classList.add("active");
  }
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

// ----------------- Image select / upload -----------------
const imageSelect = document.getElementById("imageSelect");

document.getElementById("imageSelect").addEventListener("change", function () {
  const selectedImage = this.value;
  if (!selectedImage) return;

  const localImg = new Image();
  localImg.onload = () => {
    loadImageToMainCanvas(localImg);
    undoStack = [];
    redoStack = [];
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
      loadImageToMainCanvas(upImg);
      undoStack = [];
      redoStack = [];
      originalImageName = file.name;
      document.getElementById("imageSelect").selectedIndex = 0;
      updateSelectStyle();
    };
    upImg.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// ----------------- Coordinate helpers -----------------
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

// ----------------- Brush / Eraser – nội suy để không hở nét -----------------

function strokeFromTo(x0, y0, x1, y1, radius, rgba, isErase=false) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    paintCircleOnMain(x1, y1, radius, rgba, isErase);
    return;
  }
  const step = Math.max(1, radius * 0.5); // giảm xuống 0.4*radius nếu muốn mượt hơn
  const n = Math.ceil(dist / step);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    paintCircleOnMain(x, y, radius, rgba, isErase);
  }
}

function drawAt(e) {
  ensureInitialized();
  const { x, y } = getCanvasCoords(e);
  const isErase = (mode === "eraser");
  const rgba = isErase ? [255, 255, 255, 255] : hexToRgba(currentColor);

  if (!lastPt) {
    paintCircleOnMain(x, y, brushSize, rgba, isErase);
    lastPt = { x, y };
  } else {
    strokeFromTo(lastPt.x, lastPt.y, x, y, brushSize, rgba, isErase);
    lastPt = { x, y };
  }
}

// Handlers vẽ (reset lastPt để bắt đầu nét mới)
canvas.addEventListener("mousedown", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    lastPt = null; // reset
    drawAt(e);
  }
});
canvas.addEventListener("mousemove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
    drawAt(e);
  }
});
canvas.addEventListener("mouseup", () => { isDrawing = false; lastPt = null; });
canvas.addEventListener("mouseleave", () => { isDrawing = false; lastPt = null; });

canvas.addEventListener("touchstart", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    lastPt = null; // reset
    drawAt(e);
    e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
    drawAt(e);
    e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener("touchend", () => { isDrawing = false; lastPt = null; });

// ----------------- Fill – bảo vệ nét bằng lineMask -----------------
canvas.addEventListener("click", (e) => {
  if (mode === "fill") {
    ensureInitialized();
    const { x, y } = getCanvasCoords(e);
    saveState();
    floodFillSingleLayer(x, y, hexToRgba(currentColor));
  }
});

function hexToRgba(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

function isLinePixel(x, y, w, h) {
  if (!lineMask) return false;
  // ✅ bảo vệ mép 1px lân cận nét
  const s = 1; // bán kính bảo vệ
  for (let yy = -s; yy <= s; yy++) {
    for (let xx = -s; xx <= s; xx++) {
      const nx = x + xx, ny = y + yy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (lineMask[ny * w + nx] === 1) return true;
    }
  }
  return false;
}

// Flood-fill trực tiếp trên canvas chính, KHÔNG tô vào pixel thuộc lineMask
function floodFillSingleLayer(x, y, fillColor) {
  const w = canvas.width, h = canvas.height;
  if (w === 0 || h === 0) return;

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch (err) {
    console.error(err);
    alert("Không thể tô màu do ảnh bị chặn đọc pixel (CORS). Hãy dùng ảnh cùng domain hoặc bật CORS/crossOrigin='anonymous'.");
    return;
  }
  const data = imageData.data;

  if (isLinePixel(x, y, w, h)) return; // click trên nét -> bỏ

  const idx0 = (y * w + x) * 4;
  const startR = data[idx0], startG = data[idx0 + 1], startB = data[idx0 + 2];

  const tolerance = 48;
  const visited = new Uint8Array(w * h);
  const stack = [[x, y]];

  const match = (cx, cy, i) => {
    if (isLinePixel(cx, cy, w, h)) return false; // bảo vệ nét dù đã anti-aliased
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return (Math.abs(r - startR) <= tolerance &&
            Math.abs(g - startG) <= tolerance &&
            Math.abs(b - startB) <= tolerance);
  };

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;

    const i = (cy * w + cx) * 4;
    const vi = (cy * w + cx);

    if (visited[vi]) continue;
    visited[vi] = 1;
    if (!match(cx, cy, i)) continue;

    data[i] = fillColor[0];
    data[i + 1] = fillColor[1];
    data[i + 2] = fillColor[2];
    data[i + 3] = 255;

    stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
  }

  ctx.putImageData(imageData, 0, 0);
}

// Brush/Eraser theo pixel trên canvas chính, KHÔNG đè lên lineMask
function paintCircleOnMain(x, y, radius, rgba, isErase = false) {
  const w = canvas.width, h = canvas.height;
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(w - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(h - 1, Math.ceil(y + radius));

  let imageData;
  try {
    imageData = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  } catch (err) {
    console.error(err);
    alert("Không thể vẽ do ảnh bị chặn đọc pixel (CORS). Hãy dùng ảnh cùng domain hoặc bật CORS/crossOrigin='anonymous'.");
    return;
  }
  const d = imageData.data;
  const rr = radius * radius;

  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - x, dy = yy - y;
      if (dx * dx + dy * dy > rr) continue;

      // Bảo vệ nét theo mask (kèm mép 1px)
      if (isLinePixel(xx, yy, w, h)) continue;

      const i = ((yy - y0) * (x1 - x0 + 1) + (xx - x0)) * 4;
      if (isErase) {
        // Eraser = trả về trắng tuyệt đối
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      } else {
        d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, x0, y0);
}

// ----------------- Undo / Redo (lưu snapshot canvas) -----------------
function saveState() {
  ensureInitialized();
  if (canvas.width === 0 || canvas.height === 0) return;
  try {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    redoStack = [];
  } catch (e) {
    console.warn("saveState failed:", e);
  }
}

document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    try {
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      redoStack.push(current);
      const prev = undoStack.pop();
      ctx.putImageData(prev, 0, 0);
    } catch (e) {
      console.warn("undo failed:", e);
    }
  }
});

document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    try {
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoStack.push(current);
      const next = redoStack.pop();
      ctx.putImageData(next, 0, 0);
    } catch (e) {
      console.warn("redo failed:", e);
    }
  }
});

// ----------------- Download (canvas + text + logo) -----------------
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

    // 1) Vẽ ảnh chính (đã gồm nét + tô)
    tempCtx.drawImage(canvas, 0, 0);

    // 2) Vẽ các text-box DOM
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
    const x = canvas.width - logoWidth - 10;
    const y = canvas.height - logoHeight - 10;
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

// ----------------- Text box DOM (giữ nguyên tính năng) -----------------
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

  content.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
}

function makeTextBoxDraggable(box) {
  let isDragging = false;
  let hasMoved = false;
  let offsetX = 0;
  let offsetY = 0;

  // Desktop
  box.addEventListener("mousedown", (e) => {
    if (e.target !== box) return;
    isDragging = true;
    hasMoved = false;
    offsetX = e.offsetX;
    offsetY = e.offsetY;
    e.preventDefault();
  });

  // Mobile
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

  // Move
  function handleMove(clientX, clientY) {
    const wrapperRect = document.querySelector(".canvas-wrapper").getBoundingClientRect();
    box.style.left = `${clientX - wrapperRect.left - offsetX}px`;
    box.style.top = `${clientY - wrapperRect.top - offsetY}px`;
  }

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    hasMoved = true;
    handleMove(e.clientX, e.clientY);
  });

  document.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    hasMoved = true;
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("mouseup", () => {
    if (isDragging && !hasMoved) box.focus();
    isDragging = false;
  });

  document.addEventListener("touchend", () => {
    if (isDragging && !hasMoved) box.focus();
    isDragging = false;
  });
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

  const onResizeEnd = () => {
    isResizing = false;
  };

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
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  };

  const getAngle = (cx, cy, x, y) => {
    return Math.atan2(y - cy, x - cx) * (180 / Math.PI);
  };

  const startRotate = (clientX, clientY) => {
    isRotating = true;
    const center = getCenter();
    centerX = center.x;
    centerY = center.y;
    startAngle = getAngle(centerX, centerY, clientX, clientY) - parseFloat(textBox.dataset.rotation || "0");
  };

  const rotate = (clientX, clientY) => {
    if (!isRotating) return;
    const angle = getAngle(centerX, centerY, clientX, clientY) - startAngle;
    textBox.dataset.rotation = angle.toFixed(2);
    applyTransform(textBox);
  };

  const stopRotate = () => {
    isRotating = false;
  };

  rotateHandle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    startRotate(e.clientX, e.clientY);
  });

  document.addEventListener("mousemove", (e) => {
    if (isRotating) rotate(e.clientX, e.clientY);
  });

  document.addEventListener("mouseup", stopRotate);

  rotateHandle.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      startRotate(touch.clientX, touch.clientY);
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("touchmove", (e) => {
    if (isRotating && e.touches.length === 1) {
      const touch = e.touches[0];
      rotate(touch.clientX, touch.clientY);
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("touchend", stopRotate);
}

// Khi click vào textbox, cập nhật currentTextBox
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

// ----------------- Select style (1 bản duy nhất) -----------------
function updateSelectStyle() {
  const el = document.getElementById("imageSelect");
  if (!el) return;
  const isPlaceholder = el.selectedIndex === 0;
  el.style.color = isPlaceholder ? "rgba(0,0,0,0.5)" : "#000";
  el.style.fontStyle = isPlaceholder ? "italic" : "normal";

  if (!isPlaceholder) {
    el.classList.add("selected-kite");
  } else {
    el.classList.remove("selected-kite");
  }
}

imageSelect.addEventListener("change", updateSelectStyle);
window.addEventListener("DOMContentLoaded", updateSelectStyle);

imageSelect.addEventListener("change", () => {
  imageSelect.classList.add("pop");
  setTimeout(() => imageSelect.classList.remove("pop"), 200);
});

// ----------------- Menu init + load by ?img= -----------------
function initMenuButton() {
  const menuBtn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  if (menuBtn && nav && !menuBtn.dataset.bound) {
    menuBtn.addEventListener("click", () => {
      nav.classList.toggle("open");
    });
    menuBtn.dataset.bound = "true";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initMenuButton();

  // đảm bảo có nền trắng để vẽ ngay cả khi chưa load ảnh
  ensureInitialized();

  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get("img");

  if (imageUrl) {
    const imgFromUrl = new Image();
    imgFromUrl.crossOrigin = "anonymous"; // cần nếu ảnh từ ngoài domain
    imgFromUrl.onload = () => {
      loadImageToMainCanvas(imgFromUrl);
      undoStack = [];
      redoStack = [];
      originalImageName = imageUrl.split("/").pop();
    };
    imgFromUrl.src = imageUrl;
  }
});

// ======================  Helpers: chuẩn hoá & init  ======================

// Khởi tạo nền trắng nếu chưa có kích thước
function ensureInitialized() {
  if (canvas.width === 0 || canvas.height === 0) {
    const w = +(
      canvas.getAttribute('width') ||
      canvas.clientWidth ||
      1024
    );
    const h = +(
      canvas.getAttribute('height') ||
      canvas.clientHeight ||
      768
    );
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
  }
}

// Vẽ ảnh vào canvas chính và chuẩn hoá thành đen/trắng + mịn nét
function loadImageToMainCanvas(image) {
  canvas.width = image.width;
  canvas.height = image.height;

  ctx.imageSmoothingEnabled = false; // không mượt khi lấy pixel nguồn
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);

  normalizeLineartBW(ctx, canvas.width, canvas.height);
}

// Chuẩn hoá: gom xám sát viền vào đen, (tuỳ chọn) nở nét, tạo lineMask, rồi vẽ mịn (AA)
function normalizeLineartBW(ctx, w, h) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  // 1) phân loại sơ bộ: đen chắc / trắng chắc
  const hardBlack = new Uint8Array(w * h);
  const hardWhite = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y < T_HIGH) hardBlack[p] = 1;
    else if (y > T_LOW) hardWhite[p] = 1;
  }

  // 2) vùng xám: nếu kề đen chắc thì nhập vào đen (hysteresis)
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

  // 3) (tuỳ chọn) nở nét 1px để bịt khe cực nhỏ
  if (DILATE_RADIUS > 0) {
    const src = outBlack;
    const out = new Uint8Array(src);
    const R = DILATE_RADIUS;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (src[p]) continue;
        let touch = false;
        for (let dy = -R; dy <= R && !touch; dy++) {
          for (let dx = -R; dx <= R && !touch; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (src[ny * w + nx]) touch = true;
          }
        }
        if (touch) out[p] = 1;
      }
    }
    outBlack.set(out);
  }

  // 4) lưu lineMask & vẽ nét mịn bằng supersampling
  lineMask = outBlack;
  renderLineartAAFromMask(lineMask, w, h, AA_SCALE);
}

// === Vẽ mịn từ lineMask: upsample (no smoothing) -> downsample (smoothing) ===
function renderLineartAAFromMask(mask, w, h, scale = 2) {
  // temp canvas ở kích thước gốc để đổ mask nhị phân
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

  // phóng to không làm mượt
  const up = document.createElement('canvas');
  up.width = w * scale;
  up.height = h * scale;
  const uctx = up.getContext('2d');
  uctx.imageSmoothingEnabled = false;
  uctx.drawImage(src, 0, 0, up.width, up.height);

  // vẽ về kích thước gốc có smoothing => cạnh mịn
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(up, 0, 0, w, h);

  // 🔧 reset smoothing để các thao tác sau không bị ảnh hưởng
  ctx.imageSmoothingEnabled = false;
}
