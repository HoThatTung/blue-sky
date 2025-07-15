// File: js/zoom.js

const ZOOM_KEY = "zoomLevelGlobal"; // ✅ Dùng chung toàn site

function applyZoom(scale) {
  document.documentElement.style.zoom = scale;
}

function getCurrentZoom() {
  const saved = localStorage.getItem(ZOOM_KEY);
  return saved ? parseFloat(saved) : 1;
}

function setZoom(scale) {
  const fixed = Math.max(0.5, Math.min(2, scale)); // Giới hạn 50%–200%
  localStorage.setItem(ZOOM_KEY, fixed.toFixed(2));
  applyZoom(fixed);
}

// Áp dụng khi tải trang
window.addEventListener("DOMContentLoaded", () => {
  const zoom = getCurrentZoom();
  applyZoom(zoom);
});

// Phím Ctrl + [+]/[-]/=
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && ['+', '-', '='].includes(e.key)) {
    e.preventDefault();
    let zoom = getCurrentZoom();
    zoom += (e.key === '-' ? -0.1 : 0.1);
    setZoom(zoom);
  }
});
