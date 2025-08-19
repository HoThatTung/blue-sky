// ====================== Product Page (fast, resilient, mobile/desktop) ======================
const API_URL = "https://script.google.com/macros/s/AKfycbxE5c-0KmEuSGeSJulcfSvRmoVWFOE0UzxECVMBey7KNXk7CgSVNfpLUEiypzq24QbV/exec?all=true";
const ORDER_API_URL = "https://script.google.com/macros/s/AKfycbxw3zd3miC7Sp1iIJcjVdlYzrwDjxcMJJvECB3hyK8bOkbo5b0aFSNieshY0R7P35w1/exec";
const MAX_VISIBLE = 3;
const CONTACT_PHONE = "0903082089";

let allProducts = {};
let groupNames = [];
const groupRendered = Object.create(null);

// ---------- Utils ----------
const nfVI = new Intl.NumberFormat("vi-VN");
const formatPrice = (v) => nfVI.format(+v || 0);
const esc = (s="") => String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

function fetchJSON(url, { timeout = 12000, retries = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        clearTimeout(id);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        resolve(await r.json());
      })
      .catch(async (err) => {
        clearTimeout(id);
        if (retries > 0) {
          try { resolve(await fetchJSON(url, { timeout, retries: retries - 1 })); }
          catch (e) { reject(e); }
        } else reject(err);
      });
  });
}

function getCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function setCache(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", init);

async function init() {
  const heading = document.querySelector("h2");
  const loadingSpan = document.createElement("span");
  loadingSpan.textContent = " ...loading";
  loadingSpan.style.fontSize = "14px";
  heading.appendChild(loadingSpan);

  try {
    const CACHE_KEY = "cachedProducts:v2";   // bump version khi thay đổi cấu trúc
    const CACHE_TIME = "cachedTime:v2";
    const MAX_AGE = 1000 * 60 * 60;          // 1h

    const now = Date.now();
    const cached = getCache(CACHE_KEY);
    const cachedTime = +localStorage.getItem(CACHE_TIME) || 0;

    if (cached && now - cachedTime < MAX_AGE) {
      allProducts = cached;
      console.log("⚡ Dùng cache");
    } else {
      allProducts = await fetchJSON(API_URL, { timeout: 15000, retries: 1 });
      setCache(CACHE_KEY, allProducts);
      localStorage.setItem(CACHE_TIME, String(now));
      console.log("🌐 Tải từ API");
    }

    groupNames = Object.keys(allProducts);
    const groupContainer = document.getElementById("product-groups");

    // render khung nhóm
    groupNames.forEach((groupName) => {
      const groupId = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`;
      groupContainer.insertAdjacentHTML(
        "beforeend",
        `
        <h3 class="product-category clickable" data-group="${esc(groupName)}" data-target="${groupId}">
          ${esc(groupName)} <span class="group-loading" style="font-size:10px; display:none">...loading</span>
        </h3>
        <div class="product-wrapper">
          <div class="product-grid" id="${groupId}"></div>
          <div class="toggle-container" style="display:flex; justify-content:space-between; gap:12px; margin-top:16px;"></div>
        </div>`
      );
    });

    // render dần các nhóm (nhẹ máy)
    heading.removeChild(loadingSpan);
    renderGroup(groupNames[0]);
    let i = 1;
    (function loop() {
      if (i >= groupNames.length) return;
      renderGroup(groupNames[i++]);
      setTimeout(loop, 120);
    })();

    // Event delegation cho toàn trang (ít listener, mượt hơn)
    document.getElementById("product-groups").addEventListener("change", onChange);
    document.getElementById("product-groups").addEventListener("click", onClick);
  } catch (err) {
    console.error("❌ Lỗi khi tải dữ liệu sản phẩm:", err);
    try { heading.removeChild(loadingSpan); } catch {}
    alert("Không tải được danh sách sản phẩm. Vui lòng thử lại.");
  }
}

// ---------- Render 1 group ----------
async function renderGroup(groupName) {
  if (!groupName || groupRendered[groupName]) return;
  groupRendered[groupName] = true;

  const groupId = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`;
  const container = document.getElementById(groupId);
  const wrapper = container?.parentElement;
  if (!container || !wrapper) return;

  const groupTitle = document.querySelector(`[data-group="${CSS.escape(groupName)}"]`);
  const loadingSpan = groupTitle?.querySelector(".group-loading");
  if (loadingSpan) loadingSpan.style.display = "inline";

  // Gom theo tên sản phẩm
  const rows = Array.isArray(allProducts[groupName]) ? allProducts[groupName] : [];
  const grouped = {};
  for (const row of rows) {
    const name = esc(row.productname || "Không tên");
    (grouped[name] ||= []).push(row);
  }
  const productList = Object.entries(grouped);
  let renderedCount = 0;

  function renderProducts() {
    const frag = document.createDocumentFragment();
    const slice = productList.slice(renderedCount, renderedCount + MAX_VISIBLE);

    for (const [productName, sizes] of slice) {
      const first = sizes[0] || {};
      const imgSrc = first.imgs || "images/default.png";
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

      const card = document.createElement("div");
      card.className = "product fade-in";
      card.innerHTML = `
        <img src="${imgSrc}" class="product-img" alt="${productName}" loading="lazy" decoding="async" onerror="this.src='images/default.png'">
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
        </div>
      `;
      frag.appendChild(card);

      // set giá & ảnh lần đầu
      updateCardDetails(card);
    }

    container.appendChild(frag);
    renderedCount += slice.length;
    updateToggleButtons(wrapper, container, productList.length, renderedCount, renderProducts);

    if (loadingSpan) loadingSpan.style.display = "none";

    // Toggle nhóm (click vào tiêu đề)
    if (!groupTitle.dataset.bound) {
      groupTitle.addEventListener("click", () => {
        const isOpen = container.children.length > 0;
        container.innerHTML = "";
        wrapper.querySelector(".toggle-container").innerHTML = "";
        if (!isOpen) { renderedCount = 0; renderProducts(); }
      });
      groupTitle.dataset.bound = "1";
    }
  }

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
    priceRow.innerHTML = `
      <a class="contact-label" href="tel:${CONTACT_PHONE}" title="Gọi ngay">📞 Liên hệ trực tiếp</a>
    `;
  } else {
    const priceHTML = price
      ? `<span class="price-original">${sale ? `<s>Giá: ${formatPrice(price)}đ</s>` : `Giá: ${formatPrice(price)}đ`}</span>`
      : "";
    const saleHTML = sale ? `<span class="price-sale">Khuyến mãi: ${formatPrice(sale)}đ</span>` : "";
    priceRow.innerHTML = priceHTML + saleHTML;
  }
  priceRow.classList.remove("hidden");

  if (newImg) img.src = newImg;
}

// ---------- Toggle buttons ----------
function updateToggleButtons(wrapper, container, total, renderedCount, renderMore) {
  const toggle = wrapper.querySelector(".toggle-container");
  toggle.innerHTML = "";

  if (renderedCount < total) {
    const more = document.createElement("button");
    more.className = "toggle-btn show-more";
    more.textContent = "Xem thêm";
    more.onclick = renderMore;
    toggle.appendChild(more);
  }
  if (renderedCount > MAX_VISIBLE) {
    const collapse = document.createElement("button");
    collapse.className = "toggle-btn collapse";
    collapse.textContent = "🔼 Thu gọn";
    collapse.onclick = () => {
      container.innerHTML = "";
      renderMore.reset?.(); // no-op if not present
      // render lại từ đầu
      const parentWrapper = container.parentElement;
      const groupName = parentWrapper.previousElementSibling?.dataset.group;
      if (groupName) renderGroup(groupName); // simple rebuild
    };
    toggle.appendChild(collapse);
  }
}

// ---------- Delegated handlers ----------
function onChange(e) {
  const sel = e.target.closest(".size-select");
  if (sel) {
    const card = sel.closest(".product");
    updateCardDetails(card);
  }
}

function onClick(e) {
  const btn = e.target.closest("button, a");

  // Đặt hàng → mở/đóng form
  if (btn?.classList.contains("order-btn")) {
    const form = btn.closest(".product").querySelector(".order-form");
    form.classList.toggle("hidden");
    return;
  }
  if (btn?.classList.contains("cancel-order")) {
    btn.closest(".order-form").classList.add("hidden");
    return;
  }
  if (btn?.classList.contains("confirm-order")) {
    const card = btn.closest(".product");
    submitOrder(card);
    return;
  }
  if (btn?.classList.contains("color-btn")) {
    const card = btn.closest(".product");
    const sel = card.querySelector(".size-select")?.selectedOptions[0];
    const colorImg = sel?.dataset.colorImg;
    if (!colorImg) { alert("Không có ảnh tô màu cho sản phẩm này."); return; }
    window.location.href = `color.html?img=${encodeURIComponent(colorImg)}`;
  }
}

// ---------- Submit order ----------
function submitOrder(card) {
  const name = card.querySelector(".order-name")?.value || "";
  const size = card.querySelector(".order-size")?.value || "";
  const customer = card.querySelector(".order-customer")?.value.trim();
  const phone = card.querySelector(".order-phone")?.value.trim();
  const address = card.querySelector(".order-address")?.value.trim();
  const note = card.querySelector(".order-note")?.value.trim();

  if (!customer || !phone) {
    alert("⚠️ Vui lòng nhập đầy đủ họ tên và số điện thoại.");
    return;
  }

  const payload = new URLSearchParams({ productName: name, size, customer, phone, address, note });
  fetch(ORDER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload
  })
  .then(res => res.json())
  .then(r => {
    if (r.success || r.result === "success") {
      alert("✅ Đơn hàng đã được gửi thành công!");
      card.querySelector(".order-form")?.classList.add("hidden");
    } else {
      alert("❌ Gửi đơn hàng thất bại: " + (r.message || "Không rõ nguyên nhân."));
    }
  })
  .catch(() => alert("❌ Có lỗi xảy ra khi gửi đơn hàng."));
}
function updateToggleButtons() {
  toggleContainer.innerHTML = "";

  if (renderedCount < productList.length) {
    const showMoreBtn = document.createElement("button");
    showMoreBtn.className = "toggle-btn show-more"; // mặc định là nút đặc (primary)
    showMoreBtn.textContent = "Xem thêm";
    showMoreBtn.onclick = renderProducts;
    toggleContainer.appendChild(showMoreBtn);
  }

  if (renderedCount > MAX_VISIBLE) {
    const collapseBtn = document.createElement("button");
    // ✅ thêm biến thể ghost cho Thu gọn
    collapseBtn.className = "toggle-btn toggle-btn--ghost collapse";
    collapseBtn.textContent = "🔼 Thu gọn";
    collapseBtn.onclick = () => {
      container.innerHTML = "";
      renderedCount = 0;
      renderProducts();
    };
    toggleContainer.appendChild(collapseBtn);
  }
}
