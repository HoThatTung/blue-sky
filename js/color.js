const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let currentColor = "#000000";
let img = new Image();
let isDrawing = false;

let mode = "fill"; // fill | brush | eraser
let brushSize = 7.5;

let undoStack = [];
let redoStack = [];

let originalImageName = "";

const colors = [
  "#CD0000", "#FF6633", "#FF9933", "#FF00FF", "#FFD700",
  "#FFFF00", "#000000", "#808080", "#C0C0C0", "#FFFFFF",
  "#0000FF", "#9370DB", "#00CCFF", "#00FFFF", "#006241",
  "#008000", "#00FF00", "#99FF66", "#800080", "#8B5F65"
];

// Tạo bảng màu
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

// Chế độ tô
document.getElementById("fillModeBtn").addEventListener("click", () => {
  mode = "fill";
  updateModeButtons();
});
document.getElementById("brushModeBtn").addEventListener("click", () => {
  mode = "brush";
  updateModeButtons();
});
document.getElementById("eraserModeBtn").addEventListener("click", () => {
  mode = "eraser";
  updateModeButtons();
});

function updateModeButtons() {
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
  document.getElementById("fillModeBtn").classList.toggle("active", mode === "fill");
  document.getElementById("brushModeBtn").classList.toggle("active", mode === "brush");
  document.getElementById("eraserModeBtn").classList.toggle("active", mode === "eraser");

  document.getElementById("brushSizeSelect").style.display =
    mode === "brush" || mode === "eraser" ? "inline-block" : "none";
}

// Đổi cỡ cọ
document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

// Tải ảnh mẫu
document.getElementById("imageSelect").addEventListener("change", function () {
  const selectedImage = this.value;
  img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = selectedImage;

  document.getElementById("uploadInput").value = "";
  undoStack = [];
  redoStack = [];
  originalImageName = selectedImage.split('/').pop();
  updateSelectStyle();
});

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

function drawAt(e) {
  const { x, y } = getCanvasCoords(e);
  ctx.fillStyle = mode === "eraser" ? "#ffffff" : currentColor;
  ctx.beginPath();
  ctx.arc(x, y, brushSize, 0, Math.PI * 2);
  ctx.fill();
}

// Desktop vẽ
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
canvas.addEventListener("mouseup", () => {
  isDrawing = false;
});
canvas.addEventListener("mouseleave", () => {
  isDrawing = false;
});

// Mobile vẽ
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

canvas.addEventListener("touchend", () => {
  isDrawing = false;
});

// Fill mode
canvas.addEventListener("click", (e) => {
  if (mode === "fill") {
    const { x, y } = getCanvasCoords(e);
    saveState();
    floodFill(x, y, hexToRgba(currentColor));
  }
});

// Flood fill
function hexToRgba(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

function floodFill(x, y, fillColor) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const stack = [[x, y]];
  const baseIdx = (y * width + x) * 4;
  const startColor = data.slice(baseIdx, baseIdx + 4);
  const tolerance = 48;

  const matchColor = (i) => {
    for (let j = 0; j < 4; j++) {
      if (Math.abs(data[i + j] - startColor[j]) > tolerance) return false;
    }
    return true;
  };

  const colorPixel = (i) => {
    for (let j = 0; j < 4; j++) {
      data[i + j] = fillColor[j];
    }
  };

  const visited = new Uint8Array(width * height);

  while (stack.length) {
    const [cx, cy] = stack.pop();
    const idx = (cy * width + cx) * 4;
    const visitedIdx = cy * width + cx;

    if (visited[visitedIdx]) continue;
    visited[visitedIdx] = 1;

    if (!matchColor(idx)) continue;
    colorPixel(idx);

    if (cx > 0) stack.push([cx - 1, cy]);
    if (cx < width - 1) stack.push([cx + 1, cy]);
    if (cy > 0) stack.push([cx, cy - 1]);
    if (cy < height - 1) stack.push([cx, cy + 1]);
  }

  ctx.putImageData(imageData, 0, 0);
}

// Undo / Redo
function saveState() {
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  redoStack = [];
}
document.getElementById("undoBtn").addEventListener("click", () => {
  if (undoStack.length > 0) {
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const prev = undoStack.pop();
    ctx.putImageData(prev, 0, 0);
  }
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoStack.length > 0) {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const next = redoStack.pop();
    ctx.putImageData(next, 0, 0);
  }
});

// Lưu ảnh (fix iOS popup block)

document.getElementById("downloadBtn").addEventListener("click", () => {
  const logo = new Image();
  logo.src = "images/logo.png";
  logo.crossOrigin = "anonymous";

  logo.onload = () => {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");

    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    // Vẽ ảnh gốc và chèn tên + logo
    tempCtx.drawImage(canvas, 0, 0);
    tempCtx.font = "16px Arial";
    tempCtx.fillStyle = "black";
    tempCtx.textBaseline = "top";
    tempCtx.fillText(originalImageName, 10, 10);

    const logoHeight = 40;
    const scale = logoHeight / logo.height;
    const logoWidth = logo.width * scale;
    const x = canvas.width - logoWidth - 10;
    const y = canvas.height - logoHeight - 10;
    tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

    const isMobile = /iPad|iPhone|iPod|Android/.test(navigator.userAgent);

    if (isMobile) {
      // Mobile: hiển thị ảnh trong tab mới bằng dataURL
      const dataUrl = tempCanvas.toDataURL("image/png");
      const newTab = window.open();
      if (newTab) {
        newTab.document.body.style.margin = "0";
        newTab.document.body.innerHTML = `<img src="${dataUrl}" style="width:100%">`;
        alert("👉 Ảnh đã mở. Nhấn giữ ảnh và chọn 'Lưu hình ảnh' để tải về.");
      } else {
        alert("Vui lòng bật pop-up trong trình duyệt để lưu ảnh.");
      }
    } else {
      // Desktop: cho phép tải file trực tiếp
      tempCanvas.toBlob((blob) => {
        if (!blob) {
          alert("Không thể lưu ảnh. Trình duyệt không hỗ trợ Blob.");
          return;
        }
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

  logo.onerror = () => {
    alert("Không thể tải logo từ images/logo.png");
  };
});






// Upload ảnh người dùng
document.getElementById("uploadInput").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = e.target.result;

    document.getElementById("imageSelect").selectedIndex = 0;
    undoStack = [];
    redoStack = [];
    originalImageName = file.name;
    updateSelectStyle();
  };

  reader.readAsDataURL(file);
});

// Placeholder select
const selectEl = document.getElementById("imageSelect");
function updateSelectStyle() {
  if (!selectEl.value) {
    selectEl.classList.add("placeholder");
  } else {
    selectEl.classList.remove("placeholder");
  }
}
selectEl.addEventListener("change", updateSelectStyle);
selectEl.addEventListener("focus", () => {
  selectEl.classList.remove("placeholder");
});
selectEl.addEventListener("blur", () => {
  if (!selectEl.value) {
    selectEl.classList.add("placeholder");
  }
});

// Tự động load ảnh từ URL nếu có
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const imgParam = params.get("img");

  const defaultImage = "images/color/color/bluesky.jpg";
  const imagePath = imgParam || defaultImage;

  img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };

  img.onerror = () => {
    alert("Không thể tải ảnh tô màu từ URL: " + imagePath);
  };

  img.src = imagePath;
  originalImageName = imagePath.split('/').pop();

  updateSelectStyle();
});

// Menu nav toggle
const menuToggle = document.getElementById("menuToggle");
const navMenu = document.getElementById("mainNav");
menuToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  navMenu.classList.toggle("show");
});
document.addEventListener("click", (e) => {
  if (!navMenu.contains(e.target) && !menuToggle.contains(e.target)) {
    navMenu.classList.remove("show");
  }
});
