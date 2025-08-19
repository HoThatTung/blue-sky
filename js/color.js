// ===== Canvas Painter (Phương án B: giữ nguyên màu viền gốc) =====
// CHỈ SỬA các phần: load/vẽ lại ảnh (mask + lineOnly), fill, render
// CÁC TÍNH NĂNG KHÁC giữ nguyên hành vi (palette, brush, eraser, text, undo/redo, download, menu...)

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// --- Lớp ẩn chỉ đọc ảnh gốc (không render ra màn hình)
const baseCanvas = document.createElement("canvas");
const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });

// --- Lớp tô (mọi thao tác brush/eraser/fill sẽ ghi lên đây)
const paintCanvas = document.createElement("canvas");
const paintCtx = paintCanvas.getContext("2d");

// --- Lớp chỉ chứa đường viền (nền trong suốt), GIỮ NGUYÊN MÀU VIỀN GỐC
const lineOnlyCanvas = document.createElement("canvas");
const lineOnlyCtx = lineOnlyCanvas.getContext("2d");

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

// ====== Cấu hình nhận diện viền (Adaptive + Sobel) & Fill ======
const ADAPTIVE = {
  win: 21,            // (lẻ) 15–31: cửa sổ tính trung bình cục bộ
  C: 10,              // bù trừ: Y < meanLocal - C -> viền tối
  sobelThr: 50,       // ngưỡng biên độ Sobel để bắt biên mạnh/màu
  closeGapsRadius: 1, // closing để bịt khe li ti
  maskGrow: 2         // nở mask 1–2 px để bảo vệ viền
};

const FILL_TOLERANCE = 80;       // độ giống màu cho flood (ăn dải AA)
const EDGE_GROW_AFTER_FILL = 3;  // nở vùng sau fill để lấp khe sát viền

// Mask viền (1 = pixel thuộc/kề viền), và dữ liệu ảnh gốc
let lineArtMask = null;  // Uint8Array
let baseImageData = null;

// ===== Palette =====
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

// Chọn màu (giữ nguyên hành vi)
document.querySelectorAll(".color").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".color").forEach(c => c.classList.remove("selected"));
    el.classList.add("selected");
    currentColor = el.dataset.color;
  });
});

// ===== Mode buttons (giữ nguyên) =====
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

// ===== Brush size (giữ nguyên) =====
document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

// ===== Image select / upload (SỬA load: dùng pipeline mới) =====
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

// ====== LOAD ẢNH (SỬA MỚI): tạo mask + lineOnly (giữ màu viền), không render base ======
function loadImage(src, nameForDownload) {
  img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    // Đồng bộ kích thước
    [canvas, baseCanvas, paintCanvas, lineOnlyCanvas].forEach(c => {
      c.width = img.width;
      c.height = img.height;
    });

    // 1) base: chỉ để đọc/tiền xử lý, KHÔNG render ra màn hình
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(img, 0, 0);
    baseImageData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);

    // 2) Tạo mask viền (không phụ thuộc màu), rồi closing + grow
    lineArtMask = buildLineArtMaskAdaptiveB(baseImageData, ADAPTIVE);

    // 3) Sinh lineOnlyCanvas: GIỮ NGUYÊN MÀU viền gốc (nền trong suốt)
    buildLineOnlySpriteFromMaskKeepColor(baseImageData, lineArtMask);

    // 4) Xoá lớp tô, render lần đầu
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    originalImageName = nameForDownload || "to_mau.png";
    renderComposite();
  };
  img.src = src;
}

// ====== RENDER (SỬA MỚI): nền trắng -> paint -> lineOnly ======
function renderComposite() {
  // Tránh nội suy tạo xám khi có scale CSS
  ctx.imageSmoothingEnabled = false;
  paintCtx.imageSmoothingEnabled = false;
  lineOnlyCtx.imageSmoothingEnabled = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(paintCanvas, 0, 0);
  ctx.drawImage(lineOnlyCanvas, 0, 0);
}

// ===== Helpers chung =====
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

// ===== Brush / Eraser (KHÔNG ĐỔI HÀNH VI, nhưng ghi lên paintCanvas) =====
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
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
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
canvas.addEventListener("mouseup", () => isDrawing = false);
canvas.addEventListener("mouseleave", () => isDrawing = false);

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
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
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
canvas.addEventListener("touchend", () => isDrawing = false);

// ===== FILL (SỬA MỚI): chỉ ghi paintCanvas, tôn trọng mask viền, nở vùng sau fill =====
canvas.addEventListener("click", (e) => {
  if (mode !== "fill") return;
  const { x, y } = getCanvasCoords(e);
  saveState();
  floodFillCompositeAware(x, y, hexToRgba(currentColor));
  renderComposite();
});

// Lấy màu ảnh ghép tại (x,y): ưu tiên paint (nếu alpha>0), ngược lại lấy base
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
  return Math.abs(a[0]-b[0])<=tol && Math.abs(a[1]-b[1])<=tol && Math.abs(a[2]-b[2])<=tol;
}

function floodFillCompositeAware(x, y, fillColor) {
  const w = paintCanvas.width, h = paintCanvas.height;
  const startIdx = y * w + x;

  if (lineArtMask && lineArtMask[startIdx]) return; // click trúng viền → bỏ

  const paintObj = paintCtx.getImageData(0, 0, w, h);
  const paintData = paintObj.data;
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
    paintData[p+3] = 255;
  };

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx<0 || cy<0 || cx>=w || cy>=h) continue;

    const i1d = cy * w + cx;
    if (visited[i1d]) continue;
    visited[i1d] = 1;

    // Cấm ghi lên viền
    if (lineArtMask && lineArtMask[i1d]) continue;

    // So màu dựa trên ảnh ghép hiện tại
    const col = getCompositeRGBA(paintData, baseData, w, cx, cy);
    if (!colorClose(col, startCol, tol)) continue;

    paintPixel(i1d);
    filled[i1d] = 1;

    stack.push([cx-1, cy]);
    stack.push([cx+1, cy]);
    stack.push([cx, cy-1]);
    stack.push([cx, cy+1]);
  }

  // NỞ VÙNG để lấp dải AA sát viền (vẫn tôn trọng mask)
  const n8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let iter = 0; iter < EDGE_GROW_AFTER_FILL; iter++) {
    const toGrow = [];
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i1d = yy * w + xx;
        if (filled[i1d]) continue;
        if (lineArtMask && lineArtMask[i1d]) continue;
        let near = false;
        for (const [dx,dy] of n8) {
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

  paintCtx.putImageData(paintObj, 0, 0);
}

// ===== UNDO / REDO (giữ nguyên hành vi, lưu lớp tô) =====
document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    try {
      const cur = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
      redoStack.push(cur);
      const prev = undoStack.pop();
      paintCtx.putImageData(prev, 0, 0);
      renderComposite();
    } catch (err) {
      console.warn("undo failed:", err);
    }
  }
});

document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    try {
      const cur = paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
      undoStack.push(cur);
      const next = redoStack.pop();
      paintCtx.putImageData(next, 0, 0);
      renderComposite();
    } catch (err) {
      console.warn("redo failed:", err);
    }
  }
});

// ===== Download (giữ nguyên logic, nhưng render: trắng + paint + lineOnly) =====
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

    // 1. nền trắng
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // 2. lớp tô + 3. viền (màu gốc)
    tempCtx.drawImage(paintCanvas, 0, 0);
    tempCtx.drawImage(lineOnlyCanvas, 0, 0);

    // 4. Vẽ các text-box (giữ nguyên như trước)
    document.querySelectorAll(".text-box").forEach(box => {
      const content = box.querySelector(".text-content");
      const text = content?.innerText ?? "";
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

    // 5. Logo
    const logoHeight = 30;
    const scale = logoHeight / logo.height;
    const logoWidth = logo.width * scale;
    const x = canvas.width - logoWidth - 10;
    const y = canvas.height - logoHeight - 10;
    tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

    // 6. Xuất
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

// ===== Text boxes (GIỮ NGUYÊN) =====
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
  content.style.minWidth = "1ch"; // tránh co rút
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
    const c = currentTextBox.querySelector(".text-content");
    if (mode === "text" && c) c.style.color = currentColor;
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

  // Di chuyển (cả desktop + mobile)
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

// ===== Select styling (giữ nguyên) =====
function updateSelectStyle() {
  const isPlaceholder = imageSelect.selectedIndex === 0;

  imageSelect.style.color = isPlaceholder ? "rgba(0,0,0,0.5)" : "#000";
  imageSelect.style.fontStyle = isPlaceholder ? "italic" : "normal";

  if (!isPlaceholder) {
    imageSelect.classList.add("selected-kite");
  } else {
    imageSelect.classList.remove("selected-kite");
  }
}
imageSelect.addEventListener("change", updateSelectStyle);
window.addEventListener("DOMContentLoaded", updateSelectStyle);
imageSelect.addEventListener("change", () => {
  imageSelect.classList.add("pop");
  setTimeout(() => imageSelect.classList.remove("pop"), 200);
});

// ===== Menu (giữ nguyên) =====
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
window.addEventListener("DOMContentLoaded", initMenuButton);
window.onload = () => {
  initMenuButton(); // Gọi lại init nếu cần thiết

  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get("img");

  if (imageUrl) {
    loadImage(imageUrl, imageUrl.split("/").pop());
    undoStack = [];
    redoStack = [];
  }
};

window.initMenuButton = initMenuButton;

// ====================================================================
// =============== CÁC HÀM PHỤ TRỢ CHO PHƯƠNG ÁN B ====================
// ====================================================================

// Tạo mask viền bằng Adaptive Threshold + Sobel, không phụ thuộc màu viền
function buildLineArtMaskAdaptiveB(imageData, opt) {
  const { win, C, sobelThr, closeGapsRadius, maskGrow } = opt;
  const w = imageData.width, h = imageData.height;
  const src = imageData.data;
  const N = w * h;

  // 1) Tính luminance Y
  const Y = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    const r = src[p], g = src[p+1], b = src[p+2];
    Y[i] = Math.round(0.2126*r + 0.7152*g + 0.0722*b);
  }

  // 2) Integral image để lấy mean cục bộ nhanh
  const integral = buildIntegralImage(Y, w, h);

  // 3) Adaptive: viền tối so với lân cận
  const half = (win|0) >> 1;
  let mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = rectSum(integral, x0, y0, x1, y1, w);
      const mean = sum / area;
      const i = y * w + x;
      if (Y[i] < mean - C) mask[i] = 1;
    }
  }

  // 4) Sobel magnitude để bắt biên mạnh (kể cả viền sáng/màu)
  const G = sobelMagnitude(Y, w, h);
  for (let i = 0; i < N; i++) {
    if (G[i] >= sobelThr) mask[i] = 1;
  }

  // 5) Closing + grow để bịt khe và tạo dải bảo vệ
  mask = dilate(mask, w, h, closeGapsRadius);
  mask = erode (mask, w, h, closeGapsRadius);
  if (maskGrow > 0) mask = dilate(mask, w, h, maskGrow);

  return mask;
}

// Integral image (prefix sum 2D) cho ảnh đơn kênh Y
function buildIntegralImage(Y, w, h) {
  const S = new Float64Array((w+1)*(h+1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += Y[(y-1)*w + (x-1)];
      S[y*(w+1) + x] = S[(y-1)*(w+1) + x] + rowSum;
    }
  }
  return S;
}
function rectSum(S, x0, y0, x1, y1, w) {
  const W = w + 1;
  const a = S[y0*W + x0];
  const b = S[y0*W + (x1+1)];
  const c = S[(y1+1)*W + x0];
  const d = S[(y1+1)*W + (x1+1)];
  return d - b - c + a;
}

// Sobel magnitude (L1-norm) trên ảnh Y
function sobelMagnitude(Y, w, h) {
  const out = new Uint16Array(w*h);
  const gxK = [-1,0,1, -2,0,2, -1,0,1];
  const gyK = [-1,-2,-1, 0,0,0, 1,2,1];
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      let gx = 0, gy = 0, k = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const v = Y[(y+j)*w + (x+i)];
          gx += v * gxK[k];
          gy += v * gyK[k];
          k++;
        }
      }
      const m = Math.abs(gx) + Math.abs(gy);
      out[y*w + x] = m;
    }
  }
  return out;
}

// Morphology: dilate / erode (3x3, lặp r lần)
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

// Sinh lineOnlyCanvas GIỮ NGUYÊN MÀU viền từ ảnh gốc (nền trong suốt)
function buildLineOnlySpriteFromMaskKeepColor(imageData, mask) {
  const w = imageData.width, h = imageData.height;
  const src = imageData.data;

  lineOnlyCanvas.width = w;
  lineOnlyCanvas.height = h;

  const out = lineOnlyCtx.createImageData(w, h);
  const dst = out.data;

  for (let i = 0; i < w*h; i++) {
    const p = i * 4;
    if (mask[i]) {
      dst[p]   = src[p];
      dst[p+1] = src[p+1];
      dst[p+2] = src[p+2];
      dst[p+3] = 255; // viền đậm 100%
    } else {
      dst[p]   = 0;
      dst[p+1] = 0;
      dst[p+2] = 0;
      dst[p+3] = 0;   // nền trong suốt
    }
  }

  lineOnlyCtx.putImageData(out, 0, 0);
}
