// ====================== Product Page (fast, resilient, mobile/desktop) ======================
const API_URL = "https://script.google.com/macros/s/AKfycbxE5c-0KmEuSGeSJulcfSvRmoVWFOE0UzxECVMBey7KNXk7CgSVNfpLUEiypzq24QbV/exec?all=true";
const ORDER_API_URL = "https://script.google.com/macros/s/AKfycbxw3zd3miC7Sp1iIJcjVdlYzrwDjxcMJJvECB3hyK8bOkbo5b0aFSNieshY0R7P35w1/exec";
const MAX_VISIBLE = 3;

// Behavior flags
const FORCE_REFRESH = new URLSearchParams(location.search).has("refresh"); // ?refresh=1 bypass cache
const AUTO_COLLAPSE_ON_CLEAR = true;      // Xoá lọc -> thu gọn nhóm
const SCROLL_ON_COLLAPSE = true;          // Thu gọn xong cuộn về tiêu đề nhóm

let allProducts = {};
let groupNames = [];
const groupRendered = Object.create(null);

// ---------- Utils ----------
const nfVI = new Intl.NumberFormat("vi-VN");
const formatPrice = (v) => nfVI.format(+v || 0);
const esc = (s = "") => String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const debounce = (fn, ms = 200) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

function fetchJSON(url, { timeout = 12000, retries = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    fetch(url, { signal: controller.signal })
      .then(async (r) => { clearTimeout(id); if (!r.ok) throw new Error(`HTTP ${r.status}`); resolve(await r.json()); })
      .catch(async (err) => { clearTimeout(id); if (retries > 0) { try { resolve(await fetchJSON(url, { timeout, retries: retries - 1 })); } catch (e) { reject(e); } } else reject(err); });
  });
}
function getCache(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
function setCache(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// Nhanh gọn so sánh cấu trúc 2 object (để phát hiện dữ liệu mới)
function shallowEqual(a, b) {
  try {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) { if ((a[k]||[]).length !== (b[k]||[]).length) return false; }
    return true;
  } catch { return false; }
}

// Thông báo reload khi có dữ liệu mới
function showReloadToast() {
  if (document.querySelector('.reload-toast')) return;
  const el = document.createElement('div');
  el.className = 'reload-toast';
  el.innerHTML = `<span>🔄 Đã có dữ liệu mới</span><button type="button" class="rt-btn">Tải lại</button>`;
  Object.assign(el.style, {
    position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:'18px', zIndex:'9999',
    display:'flex', alignItems:'center', gap:'10px',
    background:'#111', color:'#fff', padding:'10px 14px', borderRadius:'999px',
    boxShadow:'0 10px 22px rgba(0,0,0,.25)'
  });
  el.querySelector('.rt-btn').style.cssText = 'background:#1e88e5;color:#fff;border:none;border-radius:999px;padding:8px 12px;font-weight:700;cursor:pointer';
  el.querySelector('.rt-btn').onclick = () => location.reload();
  document.body.appendChild(el);
}

// Tải dữ liệu mới trong nền; nếu khác cache -> gợi ý reload
async function refreshInBackground() {
  try {
    const fresh = await fetchJSON(`${API_URL}&_ts=${Date.now()}`, { timeout: 6000, retries: 0 });
    const old = getCache('cachedProducts:v3') || {};
    if (!shallowEqual(fresh, old)) {
      setCache('cachedProducts:v3', fresh);
      localStorage.setItem('cachedTime:v3', String(Date.now()));
      showReloadToast();
    }
  } catch {}
}

// Nhóm theo productname => trả về số sản phẩm (distinct theo tên)
function countProductsInGroup(groupName) {
  const rows = Array.isArray(allProducts[groupName]) ? allProducts[groupName] : [];
  const grouped = {};
  for (const row of rows) { const name = String(row.productname || "Không tên"); (grouped[name] ||= []).push(row); }
  return Object.keys(grouped).length;
}

// ---------- URL <-> Filters ----------
function readFiltersFromURL() {
  const p = new URLSearchParams(location.search);
  return { q:p.get("q")||"", group:p.get("group")||"", size:p.get("size")||"", min:p.get("min")||"", max:p.get("max")||"" };
}
function writeFiltersToURL({ q, group, size, min, max }) {
  const p = new URLSearchParams();
  if (q) p.set("q", q); if (group) p.set("group", group); if (size) p.set("size", size);
  if (min) p.set("min", min); if (max) p.set("max", max);
  history.replaceState(null, "", p.toString() ? `${location.pathname}?${p}` : location.pathname);
}

// ---------- Fancy loaders (skeleton + dots) ----------
function createSkeletonGrid(n = 3, isGlobal = false){
  const grid = document.createElement('div');
  grid.className = 'skeleton-grid' + (isGlobal ? ' skeleton-grid--global' : '');
  for (let i = 0; i < n; i++){
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = `
      <div class="sk-thumb"></div>
      <div class="sk-lines">
        <div class="sk-line w-70"></div>
        <div class="sk-line w-40"></div>
        <div class="sk-line w-50"></div>
      </div>
      <div class="sk-ctas">
        <div class="sk-btn"></div>
        <div class="sk-btn"></div>
      </div>
    `;
    grid.appendChild(card);
  }
  return grid;
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", init);

async function init() {
  const heading = document.querySelector("h2");
  // loader chấm nhảy cho tiêu đề trang
  const loadingSpan = document.createElement("span");
  loadingSpan.className = "loading-dots";
  loadingSpan.innerHTML = "<i></i><i></i><i></i>";
  loadingSpan.style.fontSize = "14px";
  heading && heading.appendChild(loadingSpan);

  // skeleton toàn trang trước khi có data
  const groupContainer = document.getElementById("product-groups");
  const globalSkeleton = createSkeletonGrid(6, true);
  groupContainer && groupContainer.appendChild(globalSkeleton);

  try {
    // Cache v3 + tôn trọng ?refresh=1
    const CACHE_KEY  = "cachedProducts:v3";
    const CACHE_TIME = "cachedTime:v3";
    const MAX_AGE    = FORCE_REFRESH ? 0 : 1000 * 60 * 60; // 1h
    const now        = Date.now();

    const cached     = getCache(CACHE_KEY);
    const cachedTime = +localStorage.getItem(CACHE_TIME) || 0;
    const apiUrl     = FORCE_REFRESH ? `${API_URL}&_ts=${now}` : API_URL;

    if (cached && (now - cachedTime) < MAX_AGE) { allProducts = cached; }
    else {
      allProducts = await fetchJSON(apiUrl, { timeout: 15000, retries: 1 });
      setCache(CACHE_KEY, allProducts);
      localStorage.setItem(CACHE_TIME, String(now));
    }

    groupNames = Object.keys(allProducts);

    // ==== Populate filter options (group & size) ====
    const groupSel = document.getElementById("filterGroup");
    const sizeSel  = document.getElementById("filterSize");
    if (groupSel) groupSel.insertAdjacentHTML("beforeend", groupNames.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join(""));
    if (sizeSel) {
      const sizesSet = new Set();
      groupNames.forEach(g => (allProducts[g]||[]).forEach(row => {
        const s = String(row.sizes||"").trim(); if (s) sizesSet.add(s);
      }));
      const sizeOpts = Array.from(sizesSet).sort((a,b)=>a.localeCompare(b,"vi"));
      sizeSel.insertAdjacentHTML("beforeend", sizeOpts.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join(""));
    }

    // ==== Render group headers + badge tổng số ====
    groupNames.forEach((groupName) => {
      const groupId = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`;
      const totalCount = countProductsInGroup(groupName);
      groupContainer.insertAdjacentHTML("beforeend", `
        <h3 class="product-category clickable" data-group="${esc(groupName)}" data-target="${groupId}">
          ${esc(groupName)}
          <span class="pc-badge">${totalCount}</span>
          <span class="group-loading" style="font-size:10px; display:none"></span>
        </h3>
        <div class="product-wrapper">
          <div class="product-grid" id="${groupId}"></div>
          <div class="toggle-container" style="display:flex; justify-content:space-between; gap:12px; margin-top:16px;"></div>
          <div class="load-more-sentinel" aria-hidden="true"></div>
        </div>`);
    });

    // bỏ skeleton toàn trang trước khi render nhóm
    globalSkeleton?.remove();

    // render dần các nhóm
    loadingSpan?.remove();
    if (groupNames.length) renderGroup(groupNames[0]); // nhóm đầu mở sẵn
    let i = 1; (function loop(){ if (i >= groupNames.length) return; renderGroup(groupNames[i++]); setTimeout(loop,120); })();

    // Delegation
    const root = document.getElementById("product-groups");
    root.addEventListener("change", onChange);
    root.addEventListener("click", onClick);

    // Filter listeners + URL sync
    const filterSearch = document.getElementById("filterSearch");
    const filterGroup  = document.getElementById("filterGroup");
    const filterSize   = document.getElementById("filterSize");
    const priceMin     = document.getElementById("priceMin");
    const priceMax     = document.getElementById("priceMax");
    const btnClear     = document.getElementById("filterClear");

    const onFilter = debounce(async () => {
      await applyFilters();
      writeFiltersToURL({
        q: filterSearch?.value.trim() || "",
        group: filterGroup?.value || "",
        size: filterSize?.value || "",
        min: priceMin?.value || "",
        max: priceMax?.value || ""
      });
    }, 120);

    [filterSearch, priceMin, priceMax].forEach(el => el && el.addEventListener("input", onFilter));
    [filterGroup, filterSize].forEach(el => el && el.addEventListener("change", onFilter));

    btnClear && btnClear.addEventListener("click", async () => {
      if (filterSearch) filterSearch.value = "";
      if (filterGroup)  filterGroup.value  = "";
      if (filterSize)   filterSize.value   = "";
      if (priceMin)     priceMin.value     = "";
      if (priceMax)     priceMax.value     = "";
      await applyFilters();
      writeFiltersToURL({ q:"", group:"", size:"", min:"", max:"" });

      // Thu gọn toàn bộ nhóm và reset trạng thái render để tìm kiếm sau đó render lại
      if (AUTO_COLLAPSE_ON_CLEAR) {
        document.querySelectorAll(".product-wrapper").forEach(wrap => {
          const title = wrap.previousElementSibling;
          const gName = title?.dataset.group;
          wrap.querySelector(".product-grid").innerHTML = "";
          wrap.querySelector(".toggle-container").innerHTML = "";
          wrap.style.display = "none";
          title?.removeAttribute("data-open");
          if (gName) groupRendered[gName] = false; // cho phép render lại khi lọc/tìm
          // sync aria-expanded khi thu gọn
          if (title) title.setAttribute('aria-expanded', 'false');
        });
      }
    });

    // Đọc URL để set filter ban đầu
    const initial = readFiltersFromURL();
    if (filterSearch) filterSearch.value = initial.q;
    if (filterGroup)  filterGroup.value  = initial.group;
    if (filterSize)   filterSize.value   = initial.size;
    if (priceMin)     priceMin.value     = initial.min;
    if (priceMax)     priceMax.value     = initial.max;
    if (initial.q || initial.group || initial.size || initial.min || initial.max) {
      await applyFilters();
    }

    // Khi back/forward
    window.addEventListener("popstate", async () => {
      const cur = readFiltersFromURL();
      if (filterSearch) filterSearch.value = cur.q;
      if (filterGroup)  filterGroup.value  = cur.group;
      if (filterSize)   filterSize.value   = cur.size;
      if (priceMin)     priceMin.value     = cur.min;
      if (priceMax)     priceMax.value     = cur.max;
      await applyFilters();
    });

    // ==== Compact filter bar (mobile) ====
    const filterBarEl = document.getElementById('filterBar');
    const sWrap   = document.querySelector('.filter-search');
    const sToggle = document.getElementById('searchToggle');
    const sInput  = document.getElementById('filterSearch');

    if (filterBarEl && sWrap && sToggle && sInput) {
      const MQ = 900;
      const isMobile = () => window.innerWidth < MQ || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

      const collapse = () => { if (isMobile()) filterBarEl.classList.add('is-collapsed'); };
      const expand   = () => { filterBarEl.classList.remove('is-collapsed'); };

      const sync = () => { isMobile() ? collapse() : expand(); };
      sync();

      sToggle.addEventListener('click', (e)=>{ e.stopPropagation(); expand(); sInput.focus(); });
      ['focus','click'].forEach(ev => sInput.addEventListener(ev, expand));

      document.addEventListener('click', (e)=>{ if (isMobile() && !filterBarEl.contains(e.target)) collapse(); });
      document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') collapse(); });
      window.addEventListener('resize', debounce(sync, 120));
    }

    // 🔄 Kiểm tra dữ liệu mới trong nền; nếu có -> gợi ý Tải lại
    setTimeout(refreshInBackground, 1200);

  } catch (err) {
    console.error("❌ Lỗi khi tải dữ liệu sản phẩm:", err);
    try { loadingSpan?.remove(); } catch {}
    alert("Không tải được danh sách sản phẩm. Vui lòng thử lại.");
  }
}

// ---------- Render 1 group ----------
async function renderGroup(groupName) {
  if (!groupName || groupRendered[groupName]) return;
  groupRendered[groupName] = true;

  const groupId   = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`;
  const container = document.getElementById(groupId);
  const wrapper   = container?.parentElement;
  if (!container || !wrapper) return;

  // Bật lại nếu từng ẩn do Thu gọn/Xoá lọc
  wrapper.style.display = "";

  const groupTitle  = document.querySelector(`[data-group="${CSS.escape(groupName)}"]`);
  const loadingSpan = groupTitle?.querySelector(".group-loading");
  if (loadingSpan){
    loadingSpan.classList.add("loading-dots");
    loadingSpan.innerHTML = "<i></i><i></i><i></i>";
    loadingSpan.style.display = "inline-block";
  }

  // NEW: A11Y semantics cho tiêu đề nhóm (nút mở/đóng)
  if (groupTitle) {
    groupTitle.setAttribute('role','button');
    groupTitle.setAttribute('tabindex','0');
    groupTitle.setAttribute('aria-controls', groupId);
    groupTitle.setAttribute('aria-expanded','true');
    if (!groupTitle.dataset.kb) {
      groupTitle.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); groupTitle.click(); }
      }, {passive:false});
      groupTitle.dataset.kb = '1';
    }
  }

  // hiện skeleton cho nhóm nếu rỗng
  if (!container.dataset.skeleton && !container.children.length){
    container.appendChild(createSkeletonGrid(MAX_VISIBLE));
    container.dataset.skeleton = "1";
  }

  // Gom theo tên sản phẩm
  const rows = Array.isArray(allProducts[groupName]) ? allProducts[groupName] : [];
  const grouped = {};
  for (const row of rows) { const name = esc(row.productname || "Không tên"); (grouped[name] ||= []).push(row); }
  const productList = Object.entries(grouped);
  let renderedCount = 0;

  // ---- infinite sentinel ----
  let io;
  const sentinel = wrapper.querySelector(".load-more-sentinel");
  const ensureInfinite = (hasMore) => {
    if (!("IntersectionObserver" in window) || !sentinel) return;
    if (!io) {
      io = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if (entry.isIntersecting) { io.unobserve(sentinel); renderProducts(); } });
      }, { rootMargin: "1200px 0px 1200px 0px" });
    }
    if (hasMore) io.observe(sentinel); else io.unobserve(sentinel);
  };

  // ---- collapse toàn nhóm (chỉ còn tiêu đề) ----
  const collapseNow = () => {
    ensureInfinite(false);
    container.innerHTML = "";
    wrapper.querySelector(".toggle-container").innerHTML = "";
    wrapper.style.display = "none";
    groupTitle?.removeAttribute("data-open");
    groupRendered[groupName] = false; // cho phép render lại khi lọc/tìm
    if (groupTitle) groupTitle.setAttribute('aria-expanded','false'); // NEW: sync aria
    if (SCROLL_ON_COLLAPSE) groupTitle?.scrollIntoView({ behavior:"smooth", block:"start" });
  };

  function renderProducts() {
    const frag  = document.createDocumentFragment();
    const slice = productList.slice(renderedCount, renderedCount + MAX_VISIBLE);

    for (const [productName, sizes] of slice) {
      const first  = sizes[0] || {};
      const imgSrc = first.imgs || "images/html/default.png";

      const optionsSize = sizes.map(s => {
        const size = esc(s.sizes || "");
        const di = esc(s.imgs || "");
        const dp = +s.prices || 0;
        const ds = +s.sales  || 0;
        const dci = esc(s.colorimgs || "");
        return `<option value="${size}" data-img="${di}" data-price="${dp}" data-sale="${ds}" data-color-img="${dci}">${size}</option>`;
      }).join("");

      const orderOptions = sizes.map(s => {
        const size = esc(s.sizes || "");
        const sale = +s.sales || 0;
        return `<option value="${size}">${size} - ${formatPrice(sale)}đ</option>`;
      }).join("");

      // Giá min (phục vụ lọc theo giá)
      let minPrice = Infinity;
      sizes.forEach(s => { const p=+s.prices||0, sl=+s.sales||0, eff=sl||p||0; if (eff && eff<minPrice) minPrice=eff; });
      if (!isFinite(minPrice)) minPrice = 0;

      const card = document.createElement("div");
      card.className = "product fade-in";
      card.dataset.name  = productName.toLowerCase();
      card.dataset.group = groupName;
      card.dataset.sizes = sizes.map(s => String(s.sizes||"").toLowerCase()).join("|");
      card.dataset.price = String(minPrice);

      card.innerHTML = `
        <img src="${imgSrc}" class="product-img" alt="${productName}"
             width="800" height="600" loading="lazy" decoding="async"
             onerror="this.src='images/html/default.png'">
        <div class="product-top-row">
          <h3 class="product-title">${productName}</h3>
          <div class="size-row">
            <label>Size:</label>
            <select class="size-select">${optionsSize}</select>
          </div>
        </div>

        <div class="price-row hidden"></div>

        <div class="product-actions">
          <button class="color-btn">Tô màu</button>
          <button class="order-btn">Đặt hàng</button>
        </div>

        <div class="order-form hidden">
          <input type="text" class="order-name" value="${productName}" readonly />
          <select class="order-size">${orderOptions}</select>
          <input type="text" class="order-customer" placeholder="Họ và tên" />
          <input type="tel" class="order-phone" placeholder="Số điện thoại" inputmode="tel" />
          <input type="text" class="order-address" placeholder="Địa chỉ" />
          <textarea class="order-note" placeholder="Ghi chú"></textarea>
          <div class="form-actions">
            <button class="confirm-order">Xác nhận đặt hàng</button>
            <button class="cancel-order">Hủy</button>
          </div>
        </div>`;
      frag.appendChild(card);
// --- A11Y wiring cho nút Đặt hàng & form ---
const formEl = card.querySelector(".order-form");
const orderBtn = card.querySelector(".order-btn");

// Tạo id duy nhất cho form và liên kết bằng aria-controls
const uid = `order-form-${Math.random().toString(36).slice(2, 9)}`;
formEl.id = uid;

// Gán thuộc tính ARIA
orderBtn.setAttribute("type", "button");
orderBtn.setAttribute("aria-controls", uid);
orderBtn.setAttribute("aria-expanded", "false");
orderBtn.setAttribute("aria-label", `Mở form đặt hàng cho ${card.querySelector(".product-title")?.textContent || "sản phẩm"}`);

// Cải thiện trợ năng cho khu vực form
formEl.setAttribute("role", "region");
formEl.setAttribute("aria-label", `Form đặt hàng: ${card.querySelector(".product-title")?.textContent || "sản phẩm"}`);
// Cho phép focus để đưa con trỏ vào vùng form khi mở
formEl.setAttribute("tabindex", "-1");

      // Shimmer ảnh lần đầu
      const img = card.querySelector(".product-img");
      const clear = () => img.classList.remove("img-loading");
      img.classList.add("img-loading");
      if (img.complete) clear();
      else { img.addEventListener("load", clear, { once:true }); img.addEventListener("error", clear, { once:true }); }

      // set giá & ảnh lần đầu
      updateCardDetails(card);
    }

    // xoá skeleton nhóm nếu có, rồi gắn sản phẩm thật
    const sk = container.querySelector('.skeleton-grid');
    if (sk) sk.remove();
    container.removeAttribute('data-skeleton');

    container.appendChild(frag);
    renderedCount += slice.length;

    // nút Xem thêm / Thu gọn
    updateToggleButtons(wrapper, container, productList.length, renderedCount, {
      more: renderProducts,
      collapse: collapseNow
    });

    // Bật/tắt infinite
    ensureInfinite(renderedCount < productList.length);

    if (loadingSpan) loadingSpan.style.display = "none";
    if (container.children.length > 0) {
      groupTitle?.setAttribute("data-open","1");
      if (groupTitle) groupTitle.setAttribute('aria-expanded','true'); // NEW: sync aria
    }

    // Toggle nhóm khi bấm tiêu đề
    if (!groupTitle.dataset.bound) {
      groupTitle.addEventListener("click", () => {
        const isOpen = (wrapper.style.display !== "none") && container.children.length > 0;
        if (isOpen) collapseNow();
        else { wrapper.style.display = ""; renderedCount = 0; container.innerHTML = ""; renderProducts(); }
      });
      groupTitle.dataset.bound = "1";
    }
  }

  renderProducts.reset = function () { container.innerHTML = ""; renderedCount = 0; renderProducts(); };
  renderProducts.collapse = () => {
    container.innerHTML = "";
    wrapper.querySelector(".toggle-container").innerHTML = "";
    wrapper.style.display = "none";
    groupRendered[groupName] = false;
  };

  renderProducts();
}

// ---------- Price row + ảnh theo size ----------
function updateCardDetails(card) {
  const select = card.querySelector(".size-select");
  const priceRow = card.querySelector(".price-row");
  const img = card.querySelector(".product-img");
  if (!select || !priceRow || !img) return;

  const opt = select.selectedOptions[0];
  const price = +(opt?.dataset.price || 0);
  const sale  = +(opt?.dataset.sale  || 0);
  const newImg = opt?.dataset.img;

if (!price && !sale) {
  const PHONE = window.SHOP_PHONE || '0903082089'; // cấu hình số ở 1 nơi
  const TEL   = PHONE.replace(/\s+/g, '');
  priceRow.innerHTML = `
  <span class="contact-note">Giá: Liên hệ</span>
  <span class="contact-actions">
    <a class="contact-cta call" href="tel:${TEL}" aria-label="Gọi ${PHONE}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
        <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.2-.2.5-.3.8-.2 1 .3 2 .5 3.1.5.4 0 .7.3.7.7V20c0 .6-.5 1-1.1 1C9.2 21 3 14.8 3 7.1 3 6.5 3.4 6 4 6h3.7c.4 0 .7.3.7.7 0 1 .2 2.1.5 3.1.1.3 0 .6-.2.8L6.6 10.8z"/>
      </svg>
    </a>
    <a class="contact-cta zalo" href="https://zalo.me/${TEL}" target="_blank" rel="noopener"
       aria-label="Chat Zalo ${PHONE}">
      💬
    </a>
  </span>
`;

} else {
  const priceHTML = price ? `<span class="price-original">${sale ? `<s>Giá: ${formatPrice(price)}đ</s>` : `Giá: ${formatPrice(price)}đ`}</span>` : "";
  const saleHTML  = sale  ? `<span class="price-sale">Khuyến mãi: ${formatPrice(sale)}đ</span>` : "";
  priceRow.innerHTML = priceHTML + saleHTML;
}

  priceRow.classList.remove("hidden");

  // NEW: cập nhật alt chứa size
  img.alt = `${card.querySelector(".product-title")?.textContent || "Sản phẩm"} - ${opt?.value || "size"}`;

  if (newImg && newImg !== img.src) {
    const clear = () => img.classList.remove("img-loading");
    img.classList.add("img-loading");
    img.addEventListener("load", clear, { once:true });
    img.addEventListener("error", clear, { once:true });
    img.src = newImg;
  }
}

// ---------- Toggle buttons ----------
function updateToggleButtons(wrapper, container, total, renderedCount, handlers) {
  const toggle = wrapper.querySelector(".toggle-container");
  if (!toggle) return;
  toggle.innerHTML = "";

  // Nút "Xem thêm"
  if (renderedCount < total) {
    const more = document.createElement("button");
    more.className = "toggle-btn show-more";
    more.textContent = "Xem thêm";
    more.addEventListener("click", handlers.more);
    toggle.appendChild(more);
  }

  // Nút "Thu gọn nhóm"
  if (container.children.length) {
    const collapse = document.createElement("button");
    collapse.className = "toggle-btn collapse";
    collapse.innerHTML = `<span class="btn-ico">⤴</span> Thu gọn nhóm`;
    collapse.addEventListener("click", () => handlers.collapse?.());
    toggle.appendChild(collapse);
  }
}


// ---------- Delegated handlers ----------
function onChange(e) {
  const sel = e.target.closest(".size-select");
  if (sel) { const card = sel.closest(".product"); updateCardDetails(card); }
}
// ---------- Delegated handlers ----------
function onClick(e) {
  const btn = e.target.closest("button, a");

  // --- Nút Đặt hàng ---
  if (btn?.classList.contains("order-btn")) {
    const card = btn.closest(".product");
    const form = card.querySelector(".order-form");

    // Đóng tất cả form khác đang mở
    document.querySelectorAll(".order-form:not(.hidden)").forEach(f => {
      if (f !== form) {
        f.classList.add("hidden");
        const b = f.closest(".product")?.querySelector(".order-btn");
        b?.setAttribute("aria-expanded", "false");
      }
    });

    // Toggle form hiện tại
    const willOpen = form.classList.contains("hidden");
    form.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", willOpen ? "true" : "false");

    if (willOpen) {
      form.focus({ preventScroll: true });
      form.querySelector(".order-customer")?.focus({ preventScroll: true });
    }
    return;
  }

  // --- Nút Hủy ---
  if (btn?.classList.contains("cancel-order")) {
    const form = btn.closest(".order-form");
    form?.classList.add("hidden");
    const b = form?.closest(".product")?.querySelector(".order-btn");
    b?.setAttribute("aria-expanded", "false");
    return;
  }

  // --- Nút Xác nhận ---
  if (btn?.classList.contains("confirm-order")) {
    const card = btn.closest(".product");
    submitOrder(card);
    return;
  }

  // --- Nút Tô màu ---
  if (btn?.classList.contains("color-btn")) {
    const card = btn.closest(".product");
    const sel = card.querySelector(".size-select")?.selectedOptions[0];
    const colorImg = sel?.dataset.colorImg;
    if (!colorImg) { 
      alert("Không có ảnh tô màu cho sản phẩm này."); 
      return; 
    }
    window.location.href = `coloring.html?img=${encodeURIComponent(colorImg)}`;
  }
}

// ---------- ESC handler: ẩn form khi nhấn ESC ----------
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".order-form:not(.hidden)").forEach(form => {
      form.classList.add("hidden");
      const b = form.closest(".product")?.querySelector(".order-btn");
      b?.setAttribute("aria-expanded", "false");
    });
  }
});



// ---------- Filters ----------
async function applyFilters() {
  const filterSearch = document.getElementById("filterSearch");
  const filterGroup  = document.getElementById("filterGroup");
  const filterSize   = document.getElementById("filterSize");
  const priceMin     = document.getElementById("priceMin");
  const priceMax     = document.getElementById("priceMax");

  const q   = (filterSearch?.value || "").trim().toLowerCase();
  const g   = filterGroup?.value || "";
  const s   = (filterSize?.value || "").toLowerCase();
  const min = parseInt(priceMin?.value || "", 10);
  const max = parseInt(priceMax?.value || "", 10);

  const hasPriceMin = !isNaN(min);
  const hasPriceMax = !isNaN(max);
  const active = q || g || s || hasPriceMin || hasPriceMax;

  // Nếu đang lọc: render lại các nhóm đã bị "đánh dấu chưa render"
  if (active) {
    const pending = groupNames.filter(name => !groupRendered[name]);
    if (pending.length) {
      pending.forEach(name => renderGroup(name));
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const cards = document.querySelectorAll(".product");
  cards.forEach(card => {
    let visible = true;
    if (q) { const name = card.dataset.name || ""; visible = visible && name.includes(q); }
    if (g) visible = visible && card.dataset.group === g;
    if (s) { const sizes = card.dataset.sizes || ""; visible = visible && sizes.split("|").includes(s); }
    if (hasPriceMin) { const p = parseInt(card.dataset.price || "0", 10); visible = visible && p >= min; }
    if (hasPriceMax) { const p = parseInt(card.dataset.price || "0", 10); visible = visible && p <= max; }
    card.classList.toggle("hidden", !visible);
  });

  // Ẩn/hiện wrapper & empty-state
  document.querySelectorAll(".product-wrapper").forEach(wrap => {
    const grid = wrap.querySelector('.product-grid');
    let empty = wrap.querySelector('.empty-state');
    const hasVisible = grid.querySelector(".product:not(.hidden)");
    if (!hasVisible) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Không có sản phẩm phù hợp bộ lọc.';
        empty.style.cssText = 'padding:16px;color:#5b6b7a;text-align:center;';
        wrap.appendChild(empty);
      }
      wrap.style.display = "";
    } else {
      empty?.remove();
      wrap.style.display = "";
    }
    const title = wrap.previousElementSibling;
    if (title) title.style.display = "";
  });

  // ARIA status
  const status = document.getElementById("sr-status");
  if (status) {
    const visible = document.querySelectorAll(".product:not(.hidden)").length;
    status.textContent = `Đang hiển thị ${visible} sản phẩm`;
  }

  // Badge: khi lọc hiển thị "visible/total"
  document.querySelectorAll(".product-wrapper").forEach(wrap => {
    const vis = wrap.querySelectorAll(".product:not(.hidden)").length;
    const total = wrap.querySelectorAll(".product").length;
    const title = wrap.previousElementSibling;
    const badge = title?.querySelector(".pc-badge");
    if (badge) badge.textContent = active ? `${vis}/${total}` : String(total);
  });
}

// ---------- Submit order (thêm chống spam + loading + validate phone) ----------
function submitOrder(card) {
  const btn = card.querySelector('.confirm-order');
  if (btn?.disabled) return;

  const name     = card.querySelector(".order-name")?.value || "";
  const size     = card.querySelector(".order-size")?.value || "";
  const customer = card.querySelector(".order-customer")?.value.trim();
  const phone    = card.querySelector(".order-phone")?.value.trim();
  const address  = card.querySelector(".order-address")?.value.trim();
  const note     = card.querySelector(".order-note")?.value.trim();

  if (!customer || !phone) { alert("⚠️ Vui lòng nhập đầy đủ họ tên và số điện thoại."); return; }
  if (!/^[0-9 +().-]{8,}$/.test(phone)) { alert("⚠️ Số điện thoại chưa hợp lệ."); return; }

  if (btn) {
    btn.disabled = true;
    var oldText = btn.textContent;
    btn.textContent = "Đang gửi…";
  }

  const payload = new URLSearchParams({ productName: name, size, customer, phone, address, note });
  fetch(ORDER_API_URL, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body: payload })
    .then(res => res.json())
    .then(r => {
      if (r.success || r.result === "success") {
        alert("✅ Đơn hàng đã được gửi thành công!");
        card.querySelector(".order-form")?.classList.add("hidden");
      } else {
        alert("❌ Gửi đơn hàng thất bại: " + (r.message || "Không rõ nguyên nhân."));
      }
    })
    .catch(() => alert("❌ Có lỗi xảy ra khi gửi đơn hàng."))
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = oldText; } });
}

// ---------- Prefetch coloring.html khi hover nút "Tô màu" ----------
document.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('.color-btn');
  if (btn && !document.querySelector('link[data-prefetch-coloring]')) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = 'coloring.html';
    link.dataset.prefetchColoring = "1";
    document.head.appendChild(link);
  }
}, {passive:true});
