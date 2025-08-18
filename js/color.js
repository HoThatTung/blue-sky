// ===== Canvas Painter (fixed & consolidated) =====
// - Sửa updateModeButtons (không làm rơi mode)
// - Hợp nhất updateSelectStyle (tránh trùng hàm)
// - Eraser dùng destination-out (xóa thật)
// - Mượt nét cọ (nội suy điểm giữa các sự kiện)
// - FloodFill tối ưu (bỏ qua nếu vùng đã là màu đích)
// - Đổi màu WordArt (textbox) ngay khi chọn màu
// - Giới hạn undo để tránh ngốn RAM
// - Loại bỏ biến trùng / thừa
// - Bảo vệ viền đen: chụp lineart từ ảnh gốc và phục hồi sau mỗi thao tác

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
const UNDO_LIMIT = 20; // ✅ giới hạn bộ nhớ

let originalImageName = "";

// ====== BẢO VỆ VIỀN ĐEN (biến toàn cục) ======
let lineArtMask = null;          // Uint8Array đánh dấu pixel viền đen
let lineArtPixels = null;        // Uint8ClampedArray lưu RGBA gốc ở vị trí viền

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

// Gán click cho mỗi ô màu trong palette
// ✅ Nếu đang ở chế độ text & có textbox đang chọn, đổi màu ngay

document.querySelectorAll(".color").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".color").forEach(c => c.classList.remove("selected"));
    el.classList.add("selected");
    currentColor = el.dataset.color;

    if (mode === "text" && currentTextBox) {
      const content = currentTextBox.querySelector(".text-content");
      if (content) content.style.color = currentColor;
    }
  });
});

// ===== Mode buttons =====
document.getElementById("fillModeBtn").addEventListener("click", () => {
  updateModeButtons("fill");
});

document.getElementById("textModeBtn").addEventListener("click", () => {
  updateModeButtons("text"); // ✅ luôn truyền tham số
  addTextBoxCentered();
});

document.getElementById("brushModeBtn").addEventListener("click", () => {
  updateModeButtons("brush");
});

document.getElementById("eraserModeBtn").addEventListener("click", () => {
  updateModeButtons("eraser");
});

function updateModeButtons(newMode) {
  if (newMode) mode = newMode; // ✅ không làm rơi mode về null
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
  if (mode === "fill")   document.getElementById("fillModeBtn").classList.add("active");
  if (mode === "brush")  document.getElementById("brushModeBtn").classList.add("active");
  if (mode === "eraser") document.getElementById("eraserModeBtn").classList.add("active");
  if (mode === "text")   document.getElementById("textModeBtn").classList.add("active");
}

// ===== Brush size =====
document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

// ===== Image select / upload =====
const imageSelect = document.getElementById("imageSelect");

// ✅ HỢP NHẤT: chỉ một hàm updateSelectStyle
function updateSelectStyle() {
  const isPlaceholder = imageSelect.selectedIndex === 0;
  imageSelect.style.color = isPlaceholder ? "rgba(0,0,0,0.5)" : "#000";
  imageSelect.style.fontStyle = isPlaceholder ? "italic" : "normal";
  if (!isPlaceholder) imageSelect.classList.add("selected-kite");
  else imageSelect.classList.remove("selected-kite");
}

imageSelect.addEventListener("change", function () {
  const selectedImage = this.value;
  img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    captureLineArt(); // ✅ chụp lineart ngay sau khi vẽ ảnh
  };
  img.src = selectedImage;
  document.getElementById("uploadInput").value = "";
  undoStack = [];
  redoStack = [];
  originalImageName = selectedImage.split('/').pop();
  updateSelectStyle();

  const kiteLabel = document.getElementById("kite-label-input");
  if (kiteLabel) kiteLabel.style.display = "block"; // nếu có input label

  // hiệu ứng nhỏ
  imageSelect.classList.add("pop");
  setTimeout(() => imageSelect.classList.remove("pop"), 200);
});

window.addEventListener("DOMContentLoaded", updateSelectStyle);

// Upload

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
      captureLineArt(); // ✅ chụp lineart sau khi load ảnh người dùng
      undoStack = [];
      redoStack = [];
      originalImageName = file.name;
      imageSelect.selectedIndex = 0;
      updateSelectStyle();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// ====== THIẾT LẬP CHO FILL & BẢO VỆ VIỀN ĐEN ======
const FILL_OPTIONS = {
  tolerance: 60,        // 50–100 thường ổn cho ảnh có anti-alias
  useDiagonal: true,    // 8-neighbors
  edgeGrow: 0,          // nở viền thêm 1 vòng (0 = tắt)
  protectBlackLine: true,   // ✅ bảo vệ viền đen
  blackThreshold: 40        // R,G,B < 40 coi là “gần đen”
};

function colorDistRGB(a, b) {
  const dr = a[0]-b[0], dg = a[1]-b[1], db = a[2]-b[2];
  return Math.sqrt(dr*dr + dg*dg + db*db);
}

function getAvg3x3(data, w, h, x, y) {
  let r=0,g=0,b=0,c=0;
  for (let j=-1;j<=1;j++){
    for (let i=-1;i<=1;i++){
      const xx = Math.min(w-1, Math.max(0, x+i));
      const yy = Math.min(h-1, Math.max(0, y+j));
      const k = (yy*w+xx)*4;
      r += data[k]; g += data[k+1]; b += data[k+2];
      c++;
    }
  }
  return [Math.round(r/c), Math.round(g/c), Math.round(b/c), 255];
}

function isNearBlack(pix, thr = 40) { // ✅ helper bảo vệ viền đen
  return pix[0] < thr && pix[1] < thr && pix[2] < thr;
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
  } else if (e.clientX != null && e.clientY != null) {
    clientX = e.clientX;
    clientY = e.clientY;
  } else if (e.__direct) { // nội suy: truyền toạ độ trực tiếp
    clientX = e.x;
    clientY = e.y;
  }

  const x = Math.floor((clientX - rect.left) * scaleX);
  const y = Math.floor((clientY - rect.top) * scaleY);
  return { x, y };
}

function saveState() {
  try {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  } catch (err) {
    // Nếu canvas cross-origin không cho getImageData, bỏ qua undo
    console.warn("saveState failed:", err);
  }
}

// ===== Bảo vệ viền đen: chụp & phục hồi =====
function captureLineArt(blackThr = 40) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const N = canvas.width * canvas.height;

  lineArtMask = new Uint8Array(N);
  lineArtPixels = new Uint8ClampedArray(d.length);
  lineArtPixels.set(d);

  for (let i = 0; i < N; i++) {
    const p = i * 4;
    const r = d[p], g = d[p+1], b = d[p+2];
    if (r < blackThr && g < blackThr && b < blackThr) {
      lineArtMask[i] = 1; // đánh dấu là pixel viền (gần đen)
    }
  }
}

function reapplyLineArt() {
  if (!lineArtMask || !lineArtPixels) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const N = canvas.width * canvas.height;

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
}

// ===== Brush / Eraser drawing =====
let lastPt = null;

function drawDot(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, brushSize, 0, Math.PI * 2);
  ctx.fill();
}

function drawAt(e) {
  const { x, y } = getCanvasCoords(e);
  if (mode === "eraser") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out"; // ✅ xóa thực sự
    drawDot(x, y);
    ctx.restore();
  } else {
    ctx.fillStyle = currentColor;
    drawDot(x, y);
  }
}

function drawInterpolated(prev, curr) {
  // Nội suy giữa hai điểm để tránh đứt nét
  const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const step = Math.max(1, Math.floor(dist / (brushSize / 2)));
  for (let i = 1; i <= step; i++) {
    const t = i / step;
    const ix = prev.x + (curr.x - prev.x) * t;
    const iy = prev.y + (curr.y - prev.y) * t;
    if (mode === "eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      drawDot(ix, iy);
      ctx.restore();
    } else {
      ctx.fillStyle = currentColor;
      drawDot(ix, iy);
    }
  }
}

canvas.addEventListener("mousedown", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    lastPt = getCanvasCoords(e);
    drawAt(e);
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
    const curr = getCanvasCoords(e);
    const prev = lastPt || curr;
    drawInterpolated(prev, curr);
    lastPt = curr;
  }
});

canvas.addEventListener("mouseup", () => {
  isDrawing = false;
  lastPt = null;
  reapplyLineArt(); // ✅ phục hồi viền sau khi vẽ
});
canvas.addEventListener("mouseleave", () => {
  isDrawing = false;
  lastPt = null;
});

canvas.addEventListener("touchstart", (e) => {
  if (mode === "brush" || mode === "eraser") {
    isDrawing = true;
    saveState();
    lastPt = getCanvasCoords(e);
    drawAt(e);
    e.preventDefault();
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (isDrawing && (mode === "brush" || mode === "eraser")) {
    const curr = getCanvasCoords(e);
    const prev = lastPt || curr;
    drawInterpolated(prev, curr);
    lastPt = curr;
    e.preventDefault();
  }
}, { passive: false });

canvas.addEventListener("touchend", () => {
  isDrawing = false;
  lastPt = null;
  reapplyLineArt(); // ✅ phục hồi viền sau khi vẽ
});

// ===== Fill (Bucket) =====
canvas.addEventListener("click", (e) => {
  if (mode === "fill") {
    const { x, y } = getCanvasCoords(e);
    saveState();
    floodFill(x, y, hexToRgba(currentColor));
  }
});

function hexToRgba(hex) {
  if (hex.startsWith("rgb")) {
    // rgb(a) -> rgba array
    const nums = hex.match(/\d+/g).map(Number);
    const [r, g, b, a = 255] = nums;
    return [r, g, b, a];
  }
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

function floodFill(x, y, fillColor) {
  const { tolerance, useDiagonal, edgeGrow, protectBlackLine, blackThreshold } = FILL_OPTIONS;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;

  const startColor = getAvg3x3(data, w, h, x, y);

  // Nếu điểm click đã gần giống màu fill → bỏ qua
  if (colorDistRGB(startColor, fillColor) <= 5) return;

  const visited = new Uint8Array(w*h);
  const filled  = new Uint8Array(w*h); // mask vùng đã tô (để nở viền sau)
  const stack = [[x, y]];

  const neighbors4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const neighbors8 = neighbors4.concat([[1,1],[1,-1],[-1,1],[-1,-1]]);
  const neighbors = useDiagonal ? neighbors8 : neighbors4;

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx<0 || cy<0 || cx>=w || cy>=h) continue;
    const idx = cy*w + cx;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const p = idx*4;
    const pix = [data[p], data[p+1], data[p+2], data[p+3]];

    // ✅ bảo vệ viền đen: không tô nếu pixel gần đen
    if (protectBlackLine && isNearBlack(pix, blackThreshold)) {
      continue;
    }

    // so màu theo khoảng cách Euclid
    if (colorDistRGB(pix, startColor) <= tolerance) {
      // tô màu
      data[p] = fillColor[0];
      data[p+1] = fillColor[1];
      data[p+2] = fillColor[2];
      data[p+3] = 255;
      filled[idx] = 1;

      for (const [dx,dy] of neighbors) stack.push([cx+dx, cy+dy]);
    }
  }

  // NỞ VIỀN nhẹ để phủ dải anti-alias sát biên
  for (let iter=0; iter<edgeGrow; iter++) {
    const growList = [];
    for (let yy=0; yy<h; yy++) {
      for (let xx=0; xx<w; xx++) {
        const ii = yy*w + xx;
        if (filled[ii]) continue;

        // nếu kề cận pixel đã tô thì tô thêm pixel này
        let nearFilled = false;
        for (const [dx,dy] of neighbors) {
          const nx = xx+dx, ny = yy+dy;
          if (nx>=0 && ny>=0 && nx<w && ny<h && filled[ny*w+nx]) { nearFilled = true; break; }
        }
        if (nearFilled) growList.push(ii);
      }
    }
    // áp dụng
    for (const ii of growList) {
      const p = ii*4;

      // ✅ bảo vệ viền đen trong bước nở viền
      const pix2 = [data[p], data[p+1], data[p+2], data[p+3]];
      if (protectBlackLine && isNearBlack(pix2, blackThreshold)) continue;

      data[p] = fillColor[0];
      data[p+1] = fillColor[1];
      data[p+2] = fillColor[2];
      data[p+3] = 255;
      filled[ii] = 1;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  reapplyLineArt(); // ✅ phục hồi viền sau khi fill
}

// ===== Undo / Redo =====
document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    try {
      redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      const prev = undoStack.pop();
      ctx.putImageData(prev, 0, 0);
      reapplyLineArt(); // ✅ giữ viền khi undo
    } catch (err) {
      console.warn("undo failed:", err);
    }
  }
});

document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    try {
      undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      const next = redoStack.pop();
      ctx.putImageData(next, 0, 0);
      reapplyLineArt(); // ✅ giữ viền khi redo
    } catch (err) {
      console.warn("redo failed:", err);
    }
  }
});

// ===== Download (rasterize text boxes + logo) =====
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

    // 1. Vẽ nền chính
    tempCtx.drawImage(canvas, 0, 0);

    // 2. Vẽ các text-box
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

    // 3. Vẽ logo
    const logoHeight = 30;
    const scale = logoHeight / logo.height;
    const logoWidth = logo.width * scale;
    const x = canvas.width - logoWidth - 10;
    const y = canvas.height - logoHeight - 10;
    tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

    // 4. Xuất file
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

// ===== Text boxes =====
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
    const c = currentTextBox.querySelector(".text-content");
    if (mode === "text" && c) c.style.color = currentColor;
  });

  isTyping = true;
  content.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
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

function applyTransform(box) {
  const angle = parseFloat(box.dataset.rotation || "0");
  const scaleX = parseFloat(box.dataset.scaleX || "1");
  const scaleY = parseFloat(box.dataset.scaleY || "1");
  box.style.transform = `rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;
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

// Text style controls

document.getElementById("boldBtn").addEventListener("click", () => {
  if (currentTextBox) {
    const content = currentTextBox.querySelector(".text-content");
    const isBold = (getComputedStyle(content).fontWeight === "700" || content.style.fontWeight === "bold");
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

// ===== Menu & deep-link image =====
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
    imgFromUrl.crossOrigin = "anonymous"; // ảnh ngoài domain cần CORS
    imgFromUrl.onload = () => {
      canvas.width = imgFromUrl.width;
      canvas.height = imgFromUrl.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgFromUrl, 0, 0);
      captureLineArt(); // ✅ chụp lineart sau khi load ảnh từ URL
      undoStack = [];
      redoStack = [];
      originalImageName = imageUrl.split("/").pop();
    };
    imgFromUrl.src = imageUrl;
  }
};

// Expose nếu cần ở nơi khác
window.initMenuButton = initMenuButton;
