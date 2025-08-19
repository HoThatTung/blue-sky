// ====================== Canvas Coloring (2-layer, finalized) ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ---------- NEW: 2 offscreen layers ----------
const baseCanvas = document.createElement("canvas");      // lineart (black/white)
const baseCtx = baseCanvas.getContext("2d");
const paintCanvas = document.createElement("canvas");     // painting layer
const paintCtx = paintCanvas.getContext("2d");

// ---------- Config for binarize & stroke ----------
const THRESH = 200;        // 0..255: lower => more black. Tùy chỉnh theo ảnh nguồn
const STROKE_DILATE = 1;   // 0 = không nở nét; 1..2 thường là ổn

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
    setCurrentColor(color); // dùng hàm chặn đen tuyệt đối
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
    loadImageIntoLayers(localImg);
    undoStack = [];
    redoStack = [];
    originalImageName = selectedImage.split('/').pop();
    updateSelectStyle();

    // show optional label if exists
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
      loadImageIntoLayers(upImg);
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

// ----------------- Drawing (brush / eraser) -----------------
function drawAt(e) {
  ensureLayersInitialized(); // đảm bảo layer có kích thước
  const { x, y } = getCanvasCoords(e);
  paintCtx.save();
  if (mode === "eraser") {
    paintCtx.globalCompositeOperation = "destination-out";
    paintCtx.fillStyle = "rgba(0,0,0,1)";
  } else {
    paintCtx.globalCompositeOperation = "source-over";
    paintCtx.fillStyle = currentColor;
  }
  paintCtx.beginPath();
  paintCtx.arc(x, y, brushSize, 0, Math.PI * 2);
  paintCtx.fill();
  paintCtx.restore();
  composite();
}

canvas.addEventListener("mousedown", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    drawAt(e);
  }
});
canvas.addEventListener("mousemove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
    drawAt(e);
  }
});
canvas.addEventListener("mouseup", () => isDrawing = false);
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
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
    drawAt(e);
    e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener("touchend", () => isDrawing = false);

// ----------------- Fill -----------------
canvas.addEventListener("click", (e) => {
  if (mode === "fill") {
    ensureLayersInitialized(); // đảm bảo layer đã sẵn sàng
    const { x, y } = getCanvasCoords(e);
    saveState(); // lưu paint layer
    floodFillMasked(x, y, hexToRgba(currentColor)); // fill vào paint, bỏ qua nét đen
  }
});

function hexToRgba(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

// Flood-fill trên paint layer, dựa trên màu composite và KHÔNG tô vào pixel đen của base
function floodFillMasked(x, y, fillColor) {
  ensureLayersInitialized();

  const w = paintCanvas.width, h = paintCanvas.height;
  if (w === 0 || h === 0) return;

  let baseID, paintID;
  try {
    baseID = baseCtx.getImageData(0, 0, w, h);
    paintID = paintCtx.getImageData(0, 0, w, h);
  } catch (err) {
    console.error(err);
    alert("Không thể tô màu do ảnh bị chặn đọc pixel (CORS). Hãy dùng ảnh cùng domain hoặc bật CORS/crossOrigin='anonymous'.");
    return;
  }

  const baseData = baseID.data;
  const pData = paintID.data;

  const idx0 = (y * w + x) * 4;

  // Nếu click ngay trên nét đen (base) thì bỏ qua
  if (baseData[idx0] === 0 && baseData[idx0 + 1] === 0 && baseData[idx0 + 2] === 0) return;

  // Lấy màu gốc từ composite-like: ưu tiên paint nếu có alpha
  function getCompositeRGB(i) {
    const pa = pData[i + 3];
    if (pa > 0) return [pData[i], pData[i + 1], pData[i + 2], pa];
    return [baseData[i], baseData[i + 1], baseData[i + 2], baseData[i + 3]];
  }

  const startColor = getCompositeRGB(idx0);
  const tolerance = 48;

  const matchColor = (i) => {
    // Không tô vào pixel có nét đen ở base
    if (baseData[i] === 0 && baseData[i + 1] === 0 && baseData[i + 2] === 0) return false;

    const c = getCompositeRGB(i);
    for (let k = 0; k < 3; k++) {
      if (Math.abs(c[k] - startColor[k]) > tolerance) return false;
    }
    return true;
  };

  const visited = new Uint8Array(w * h);
  const stack = [[x, y]];

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;

    const idx = (cy * w + cx) * 4;
    const vi = cy * w + cx;

    if (visited[vi]) continue;
    visited[vi] = 1;
    if (!matchColor(idx)) continue;

    // tô vào paint layer
    pData[idx] = fillColor[0];
    pData[idx + 1] = fillColor[1];
    pData[idx + 2] = fillColor[2];
    pData[idx + 3] = 255;

    stack.push([cx - 1, cy]);
    stack.push([cx + 1, cy]);
    stack.push([cx, cy - 1]);
    stack.push([cx, cy + 1]);
  }

  paintCtx.putImageData(paintID, 0, 0);
  composite();
}

// ----------------- Undo / Redo (lưu paint layer) -----------------
function saveState() {
  ensureLayersInitialized();
  if (paintCanvas.width === 0 || paintCanvas.height === 0) return;
  try {
    undoStack.push(paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height));
    redoStack = [];
  } catch (e) {
    console.warn("saveState failed:", e);
  }
}

document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    try {
      const current = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
      redoStack.push(current);
      const prev = undoStack.pop();
      paintCtx.putImageData(prev, 0, 0);
      composite();
    } catch (e) {
      console.warn("undo failed:", e);
    }
  }
});

document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    try {
      const current = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
      undoStack.push(current);
      const next = redoStack.pop();
      paintCtx.putImageData(next, 0, 0);
      composite();
    } catch (e) {
      console.warn("redo failed:", e);
    }
  }
});

// ----------------- Download (re-composite + text + logo) -----------------
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

    // 1) Re-composite: paint dưới, base trên
    tempCtx.drawImage(paintCanvas, 0, 0);
    tempCtx.drawImage(baseCanvas, 0, 0);

    // 2) Vẽ text-box DOM lên
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

  isTyping = true;

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

  // đảm bảo có layer trắng để vẽ ngay cả khi chưa load ảnh
  ensureLayersInitialized();

  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get("img");

  if (imageUrl) {
    const imgFromUrl = new Image();
    imgFromUrl.crossOrigin = "anonymous"; // cần nếu ảnh từ ngoài domain
    imgFromUrl.onload = () => {
      loadImageIntoLayers(imgFromUrl);
      undoStack = [];
      redoStack = [];
      originalImageName = imageUrl.split("/").pop();
    };
    imgFromUrl.src = imageUrl;
  }
});

// ======================  Helpers cho 2-layer & binarize  ======================
function resizeLayers(w, h) {
  [canvas, baseCanvas, paintCanvas].forEach(c => { c.width = w; c.height = h; });
}

function composite() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(paintCanvas, 0, 0);
  ctx.drawImage(baseCanvas, 0, 0);
}

// NEW: đảm bảo layer đã khởi tạo kích thước để vẽ/fill được ngay
function ensureLayersInitialized() {
  if (paintCanvas.width === 0 || paintCanvas.height === 0) {
    const w = +(
      canvas.width ||
      canvas.getAttribute('width') ||
      canvas.clientWidth ||
      1024
    );
    const h = +(
      canvas.height ||
      canvas.getAttribute('height') ||
      canvas.clientHeight ||
      768
    );
    resizeLayers(w, h);

    // Base trắng tuyệt đối
    baseCtx.fillStyle = "#FFFFFF";
    baseCtx.fillRect(0, 0, w, h);

    composite();
  }
}

function loadImageIntoLayers(image) {
  resizeLayers(image.width, image.height);

  // tắt smoothing để không làm mềm mép
  baseCtx.imageSmoothingEnabled = false;
  paintCtx.imageSmoothingEnabled = false;

  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);

  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.drawImage(image, 0, 0);
  toPureBWAndThicken(baseCtx, baseCanvas.width, baseCanvas.height);

  composite();
}

// Biến ảnh thành nền trắng tuyệt đối & nét đen tuyệt đối; có thể nở nét
function toPureBWAndThicken(ctxSrc, w, h) {
  const id = ctxSrc.getImageData(0, 0, w, h);
  const d = id.data;

  // 1) Binarize: trắng #FFFFFF hoặc đen #000000
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (y < THRESH) {
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = 255;
    } else {
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }

  // 2) Dilate nét đen (8-neighbor)
  if (STROKE_DILATE > 0) {
    const bin = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      bin[p] = (d[i] === 0) ? 1 : 0;
    }
    const out = new Uint8Array(bin);
    const R = STROKE_DILATE;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (bin[idx]) continue;
        let touch = false;
        for (let dy = -R; dy <= R && !touch; dy++) {
          for (let dx = -R; dx <= R && !touch; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (bin[ny * w + nx]) touch = true;
          }
        }
        if (touch) out[idx] = 1;
      }
    }
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (out[p]) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; }
    }
  }

  ctxSrc.putImageData(id, 0, 0);
}
