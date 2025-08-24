;(() => {
  const STORAGE_KEY = 'siteZoom';
  const MIN = 0.5;
  const MAX = 2.0;
  const STEP = 0.1;
  const DEFAULT_ZOOM = 1.0;

  const clamp = (v) => Math.min(MAX, Math.max(MIN, v));
  const roundToStep = (v) => {
    const n = Math.round(v / STEP) * STEP;
    return parseFloat(n.toFixed(2));
  };

  function getSavedZoom() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(v) ? clamp(v) : DEFAULT_ZOOM;
  }

  function setCssZoom(z) {
    document.documentElement.style.setProperty('--site-zoom', String(z));
  }

  function dispatchChange(z) {
    // Cho phép UI khác nghe: window.addEventListener('sitezoomchange', e => e.detail.zoom)
    window.dispatchEvent(new CustomEvent('sitezoomchange', { detail: { zoom: z, percent: Math.round(z * 100) } }));
  }

  function applyZoom(v) {
    const z = roundToStep(clamp(v));
    setCssZoom(z);
    localStorage.setItem(STORAGE_KEY, String(z));
    dispatchChange(z);
    return z;
  }

  function onKeydown(e) {
    const isModifier = e.ctrlKey || e.metaKey; // Ctrl (Win/Linux) hoặc Cmd (macOS)
    if (!isModifier) return;

    const k = e.key;         // ví dụ '=', '+', '-', '0', 'Add', 'Subtract', 'NumpadAdd', ...
    const code = e.code;     // ví dụ 'NumpadAdd', 'NumpadSubtract', 'Digit0'

    // Zoom In
    if (k === '=' || k === '+' || code === 'NumpadAdd') {
      e.preventDefault();
      applyZoom(getSavedZoom() + STEP);
      return;
    }
    // Zoom Out
    if (k === '-' || code === 'NumpadSubtract') {
      e.preventDefault();
      applyZoom(getSavedZoom() - STEP);
      return;
    }
    // Reset
    if (k === '0' || code === 'Digit0' || code === 'Numpad0') {
      e.preventDefault();
      applyZoom(DEFAULT_ZOOM);
      return;
    }
  }

  // Ctrl/⌘ + wheel => dùng zoom site, không zoom trình duyệt
  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY); // +1 lăn xuống, -1 lăn lên
    const current = getSavedZoom();
    const next = delta > 0 ? current - STEP : current + STEP;
    applyZoom(next);
  }

  // Đồng bộ giữa các tab (clamp + áp CSS + phát event)
  function onStorage(ev) {
    if (ev.key !== STORAGE_KEY || ev.newValue == null) return;
    const z = clamp(parseFloat(ev.newValue));
    if (!Number.isFinite(z)) return;
    setCssZoom(z);
    dispatchChange(z);
  }

  // In ấn: zoom = 1 khi in, sau đó khôi phục
  function onBeforePrint() {
    setCssZoom(1);
  }
  function onAfterPrint() {
    setCssZoom(getSavedZoom());
  }

  function init() {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, String(DEFAULT_ZOOM));
    }
    applyZoom(getSavedZoom());

    window.addEventListener('keydown', onKeydown, { passive: false });
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('storage', onStorage);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // API công khai
  window.SiteZoom = {
    get: getSavedZoom,
    set: (z) => applyZoom(z),
    in: () => applyZoom(getSavedZoom() + STEP),
    out: () => applyZoom(getSavedZoom() - STEP),
    reset: () => applyZoom(DEFAULT_ZOOM),
  };
})();
