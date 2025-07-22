// color.js - Đã sửa hoàn thiện (gồm cả xử lý lưu ảnh chuẩn iOS và initMenuButton)

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
  };
  img.src = selectedImage;
  document.getElementById("uploadInput").value = "";
  undoStack = [];
  redoStack = [];
  originalImageName = selectedImage.split('/').pop();
  updateSelectStyle();
}); // <-- Kết thúc xử lý imageSelect

// ✅ Thêm đoạn này ngay bên dưới:
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
canvas.addEventListener("click", (e) => {
  if (mode === "fill") {
    const { x, y } = getCanvasCoords(e);
    saveState();
    floodFill(x, y, hexToRgba(currentColor));
  }
});

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

document.getElementById("downloadBtn").addEventListener("click", () => {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isIOS) {
    const win = window.open("about:blank", "_blank");
    if (!win) {
      alert("Vui lòng bật pop-up trong trình duyệt để lưu ảnh.");
      return;
    }

    win.document.write(`<!DOCTYPE html><html><head><title>Đang xử lý...</title></head><body style="text-align:center;font-family:sans-serif;"><p>⏳ Đang tạo ảnh...</p></body></html>`);
    win.document.close();

    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    const logo = new Image();
    logo.src = "images/logo.webp";
    logo.crossOrigin = "anonymous";

 logo.onload = () => {
  const logoHeight = 30;
  const scale = logoHeight / logo.height;
  const logoWidth = logo.width * scale;
  const x = canvas.width - logoWidth - 10;
  const y = canvas.height - logoHeight - 10;
  tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

  const dataURL = tempCanvas.toDataURL("image/png");

  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><title>Ảnh đã tô màu</title></head><body style="margin:0;text-align:center;background:#fff;"><img src="${dataURL}" style="max-width:100%;height:auto;" /><p style="font-family:sans-serif;">👉 Nhấn giữ ảnh và chọn 'Lưu hình ảnh'</p></body></html>`);
  win.document.close();
};


    logo.onerror = () => {
      alert("Không thể tải logo từ images/logo.webp");
    };
    return;
  }

  const logo = new Image();
  logo.src = "images/logo.webp";
  logo.crossOrigin = "anonymous";

logo.onload = () => {
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");

  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCtx.drawImage(canvas, 0, 0);

  const logoHeight = 30;
  const scale = logoHeight / logo.height;
  const logoWidth = logo.width * scale;
  const x = canvas.width - logoWidth - 10;
  const y = canvas.height - logoHeight - 10;
  tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);

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
};


  logo.onerror = () => {
    alert("Không thể tải logo từ images/logo.webp");
  };
});

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
window.initMenuButton = initMenuButton;
