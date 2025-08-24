// ====== SAFE SELECTORS ======
const header = document.querySelector(".header");
const toggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");
const hero = document.querySelector(".hero");
const heroInner = document.querySelector(".hero-inner");
const cards = document.querySelectorAll(".feature-card");

// ====== NAV TOGGLE (Mobile) ======
if (toggle && nav) {
  // ARIA
  toggle.setAttribute("aria-controls", "site-nav");
  nav.id = nav.id || "site-nav";
  toggle.setAttribute("aria-expanded", "false");

  const closeNav = () => {
    nav.classList.remove("show");
    toggle.setAttribute("aria-expanded", "false");
  };
  const openNav = () => {
    nav.classList.add("show");
    toggle.setAttribute("aria-expanded", "true");
  };

  toggle.addEventListener("click", () => {
    nav.classList.contains("show") ? closeNav() : openNav();
  });

  // Đóng khi bấm ra ngoài / bấm link / ESC
  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("show")) return;
    if (!nav.contains(e.target) && !toggle.contains(e.target)) closeNav();
  });
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeNav();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNav();
  });

  // Reset khi resize về desktop
  const DESKTOP_BP = 1024;
  let resizeTimer;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > DESKTOP_BP) closeNav();
      }, 120);
    },
    { passive: true }
  );
}

// ====== HEADER ELEVATION ON SCROLL ======
if (header) {
  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY > 50) header.classList.add("scrolled");
      else header.classList.remove("scrolled");
    },
    { passive: true }
  );
}

// ====== HERO: Fade-in on load ======
if (heroInner) {
  window.requestAnimationFrame(() => {
    heroInner.classList.add("is-ready");
  });
}

// ====== HERO: Parallax nhẹ bằng CSS var ======
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (hero && !prefersReduced) {
  let ticking = false;
  const parallax = () => {
    const rect = hero.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      const offset = Math.round((window.scrollY || window.pageYOffset) * 0.18);
      hero.style.setProperty("--bg-offset", `${offset}px`);
      // Lưu ý: trong CSS nên có: background-position: center calc(var(--bg-offset, 0px) * -1);
    }
    ticking = false;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(parallax);
        ticking = true;
      }
    },
    { passive: true }
  );
  parallax();
}

// ====== FEATURE CARD REVEAL ======
if ("IntersectionObserver" in window && cards.length) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-inview");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  cards.forEach((card) => io.observe(card));
} else {
  cards.forEach((card) => card.classList.add("is-inview"));
}

// ====== Service Worker register (cache tĩnh + SWR API) ======
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    // Ưu tiên relative path (hợp site đặt trong thư mục con), fallback về gốc domain.
    const candidates = ["sw.js", "/sw.js"];
    for (const url of candidates) {
      try {
        await navigator.serviceWorker.register(url);
        break;
      } catch (err) {
        // Thử ứng viên tiếp theo
      }
    }
  });
}

// ===== Prewarm dữ liệu Shop ở nền – an toàn, tôn trọng Save-Data/kết nối chậm =====
(function prewarmShopSilently() {
  // Không hâm nóng nếu đang ở trang shop/products
  const isShopPage = /(shop|products)\.html?$/i.test(location.pathname) || location.pathname.endsWith("/shop");
  if (isShopPage) return;

  // Offline / tiết kiệm dữ liệu / mạng quá chậm -> bỏ qua
  if (!navigator.onLine) return;
  const conn = navigator.connection || {};
  if (conn.saveData) return;
  const type = (conn.effectiveType || "").toLowerCase();
  if (type.includes("2g")) return;

  // Polyfill requestIdleCallback
  const ric =
    window.requestIdleCallback ||
    ((cb) =>
      setTimeout(() => cb({ timeRemaining: () => 50 }), 500));

  // Dùng cùng cache key như shop.js
  const API_URL =
    "https://script.google.com/macros/s/AKfycbxE5c-0KmEuSGeSJulcfSvRmoVWFOE0UzxECVMBey7KNXk7CgSVNfpLUEiypzq24QbV/exec?all=true";
  const CACHE_KEY = "cachedProducts:v3";
  const CACHE_TIME = "cachedTime:v3";

  // Chỉ hâm nóng mỗi 2 giờ để tiết kiệm
  const last = +localStorage.getItem("prewarmAt") || 0;
  if (Date.now() - last < 2 * 60 * 60 * 1000) return;

  ric(async () => {
    try {
      const res = await fetch(API_URL + "&_ts=" + Date.now(), { credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TIME, String(Date.now()));
      localStorage.setItem("prewarmAt", String(Date.now()));

      // Chạm nhẹ asset trang sản phẩm để SW (nếu có) cache
      ["shop.html", "css/shop.css", "js/shop.js"].forEach((p) => {
        fetch(p, { mode: "no-cors" }).catch(() => {});
      });
    } catch {
      // im lặng
    }
  });
})();

// ====== FOOTER: Proximity hover + tooltip ======
(() => {
  const wrap = document.querySelector('.footer .social-links');
  if (!wrap) return;

  // Tắt nếu người dùng giảm chuyển động
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  const icons = Array.from(wrap.querySelectorAll('.social-icon'));
  if (!icons.length) return;

  // Bán kính ảnh hưởng (px) – chỉnh theo ý
  let R = 120;

  // Hiệu năng: gom mouse/pointer events về 1 rAF
  let mx = -9999, my = -9999, hasPointer = false, ticking = false;

  // Tính “độ gần” 0..1 và bơm vào CSS var --near + data-near
  const update = () => {
    ticking = false;
    const wRect = wrap.getBoundingClientRect();

    let nearest = 0;
    for (const el of icons) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - wRect.left;
      const cy = r.top  + r.height / 2 - wRect.top;

      const d = Math.hypot(mx - cx, my - cy);
      const near = Math.max(0, 1 - d / R); // 0..1
      el.style.setProperty('--near', near.toFixed(3));
      if (near > 0.85) {
        el.setAttribute('data-near', '1');
        nearest = Math.max(nearest, near);
      } else {
        el.removeAttribute('data-near');
      }
    }
  };

  const onMove = (x, y) => {
    hasPointer = true;
    mx = x; my = y;
    if (!ticking) {
      requestAnimationFrame(() => {
        update();
      });
      ticking = true;
    }
  };

  // Pointer Events (ưu tiên) + fallback mousemove
  wrap.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
  wrap.addEventListener('mousemove',     (e) => onMove(e.clientX, e.clientY), { passive: true });

  // Rời vùng – reset
  const clear = () => {
    icons.forEach(el => {
      el.style.removeProperty('--near');
      el.removeAttribute('data-near');
    });
  };
  wrap.addEventListener('pointerleave', clear, { passive: true });
  wrap.addEventListener('mouseleave',   clear, { passive: true });

  // Thay đổi layout/zoom -> cập nhật bán kính nhẹ
  window.addEventListener('resize', () => {
    // Scales theo chiều rộng icon trung bình
    const sample = icons[0]?.getBoundingClientRect();
    if (sample) R = Math.max(100, Math.min(160, sample.width * 3.2));
    if (hasPointer) {
      // ép vẽ lại nếu con trỏ đang trong vùng
      ticking = false;
      requestAnimationFrame(update);
    }
  }, { passive: true });
})();

// ===== Header modern UX: auto-hide on scroll, toggle morph, scroll progress =====
(() => {
  const hdr = document.querySelector('.header');
  const toggleBtn = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  if (!hdr) return;

  // a) Thanh tiến trình cuộn (không cần đổi HTML)
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const updateProgress = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const p = max > 0 ? (h.scrollTop / max) * 100 : 0;
    bar.style.width = p + '%';
  };

  // b) Thu nhỏ & auto-hide header khi kéo xuống
  let lastY = window.scrollY, hidden = false;
  const onScroll = () => {
    const y = window.scrollY;

    // toggle .scrolled (đã dùng trước đó)
    if (y > 50) hdr.classList.add('scrolled');
    else hdr.classList.remove('scrolled');

    // auto-hide khi lăn xuống, hiện khi kéo lên
    if (!prefersReduced) {
      const goingDown = y > lastY;
      const threshold = 80;
      if (goingDown && y > threshold && !hidden) {
        hdr.classList.add('header--hidden');
        hidden = true;
      } else if (!goingDown && hidden) {
        hdr.classList.remove('header--hidden');
        hidden = false;
      }
      lastY = y;
    }

    updateProgress();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  updateProgress();

  // c) Nút menu: đổi icon “☰/✕” + hiệu ứng xoay
  if (toggleBtn && nav) {
    const setState = () => {
      const open = nav.classList.contains('show');
      toggleBtn.classList.toggle('is-open', open);
      // đổi ký tự cho dễ nhận biết
      toggleBtn.textContent = open ? '✕' : '☰';
    };
    // đồng bộ ngay lần đầu
    setState();
    // hook vào hành vi có sẵn
    const orig = toggleBtn.onclick;
    toggleBtn.addEventListener('click', () => {
      // chờ class .show được JS hiện tại add/remove xong 1 tick
      setTimeout(setState, 0);
    });
  }
})();
