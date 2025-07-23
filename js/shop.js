const API_URL = "https://script.google.com/macros/s/AKfycbxE5c-0KmEuSGeSJulcfSvRmoVWFOE0UzxECVMBey7KNXk7CgSVNfpLUEiypzq24QbV/exec?all=true";
const MAX_VISIBLE = 3;

let allProducts = {};
let groupNames = [];
let groupRendered = {};

function formatPrice(val) {
  return (+val).toLocaleString("vi-VN");
}

document.addEventListener("DOMContentLoaded", async () => {
  const heading = document.querySelector("h2");
  const loadingSpan = document.createElement("span");
  loadingSpan.textContent = " ...loading";
  loadingSpan.style.fontSize = "14px";
  heading.appendChild(loadingSpan);

  try {
    const cacheKey = "cachedProducts";
    const cacheTimeKey = "cachedTime";
    const cacheMaxAge = 1000 * 60 * 60; // 1 giờ (có thể chỉnh)

    const now = Date.now();
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);

    if (cachedData && cachedTime && now - cachedTime < cacheMaxAge) {
      // ⏱️ Dùng cache nếu chưa hết hạn
      allProducts = JSON.parse(cachedData);
      console.log("⚡ Tải từ cache");
    } else {
      // 🌐 Tải mới từ API nếu chưa có hoặc cache hết hạn
      const res = await fetch(API_URL);
      allProducts = await res.json();
      localStorage.setItem(cacheKey, JSON.stringify(allProducts));
      localStorage.setItem(cacheTimeKey, now);
      console.log("🌐 Tải từ API");
    }

    groupNames = Object.keys(allProducts);
    const groupContainer = document.getElementById("product-groups");

    groupNames.forEach((groupName) => {
      const groupId = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`;
      const groupHTML = `
        <h3 class="product-category clickable" data-group="${groupName}" data-target="${groupId}">
          ${groupName} <span class="group-loading" style="font-size:10px; display:none">...loading</span>
        </h3>
        <div class="product-wrapper">
          <div class="product-grid" id="${groupId}"></div>
          <div class="toggle-container" style="display:flex; justify-content:space-between; gap: 12px; margin-top:16px;"></div>
        </div>
      `;
      groupContainer.insertAdjacentHTML("beforeend", groupHTML);
    });

    heading.removeChild(loadingSpan);
    renderGroup(groupNames[0]);

    let index = 1;
    function renderNextGroup() {
      if (index >= groupNames.length) return;
      renderGroup(groupNames[index]);
      index++;
      setTimeout(renderNextGroup, 100);
    }
    setTimeout(renderNextGroup, 200);

  } catch (err) {
    console.error("❌ Lỗi khi tải dữ liệu sản phẩm:", err);
    heading.removeChild(loadingSpan);
  }
});


async function renderGroup(groupName) {
  if (groupRendered[groupName]) return;
  groupRendered[groupName] = true;

  const groupId = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`;
  const groupTitle = document.querySelector(`[data-group="${groupName}"]`);
  const loadingSpan = groupTitle.querySelector(".group-loading");
  const container = document.getElementById(groupId);
  const wrapper = container.parentElement;
  const toggleContainer = wrapper.querySelector(".toggle-container");

  loadingSpan.style.display = "inline";
  const data = allProducts[groupName] || [];

  // Gom theo tên sản phẩm
  const grouped = {};
  data.forEach(row => {
    const name = String(row.productname || "Không tên");
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(row);
  });

  const productList = Object.entries(grouped);
  let renderedCount = 0;

  function renderProducts() {
    const fragment = document.createDocumentFragment();
    const toShow = productList.slice(renderedCount, renderedCount + MAX_VISIBLE);

    toShow.forEach(([productName, sizes]) => {
      const first = sizes[0];
      const sizeOptions = sizes.map(s => `
        <option value="${s.sizes}" data-img="${s.imgs}" data-price="${s.prices}" data-sale="${s.sales}" data-color-img="${s.colorimgs}">
          ${s.sizes}
        </option>`).join("");

      const orderOptions = sizes.map(s => `
        <option value="${s.sizes}">${s.sizes} - ${formatPrice(s.sales)}đ</option>
      `).join("");

      const div = document.createElement("div");
      div.className = "product fade-in";
      div.innerHTML = `
        <img src="${first.imgs || 'images/default.png'}" class="product-img" alt="${productName}">
        <div class="product-top-row">
          <h3 class="product-title">${productName}</h3>
          <div class="size-row">
            <label>Size:</label>
            <select class="size-select">${sizeOptions}</select>
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
          <input type="tel" class="order-phone" placeholder="Số điện thoại" />
          <input type="text" class="order-address" placeholder="Địa chỉ" />
          <textarea class="order-note" placeholder="Ghi chú"></textarea>
          <div class="form-actions">
            <button class="confirm-order">Xác nhận đặt hàng</button>
            <button class="cancel-order">Hủy</button>
          </div>
        </div>
      `;

      // Tối ưu truy cập DOM
      const sizeSelect = div.querySelector(".size-select");
      const priceRow = div.querySelector(".price-row");
      const img = div.querySelector(".product-img");
      const orderForm = div.querySelector(".order-form");
      const orderBtn = div.querySelector(".order-btn");
      const cancelBtn = div.querySelector(".cancel-order");
      const confirmBtn = div.querySelector(".confirm-order");
      const colorBtn = div.querySelector(".color-btn");
      const inputCustomer = div.querySelector(".order-customer");
      const inputPhone = div.querySelector(".order-phone");
      const inputAddress = div.querySelector(".order-address");
      const inputNote = div.querySelector(".order-note");
      const inputName = div.querySelector(".order-name");
      const inputSize = div.querySelector(".order-size");

      function updateDetails() {
        const selected = sizeSelect.selectedOptions[0];
        const price = +selected.dataset.price || 0;
        const sale = +selected.dataset.sale || 0;
        const newImg = selected.dataset.img;

        if (!price && !sale) {
 priceRow.innerHTML = `
  <a class="contact-label" href="tel:0903082089" title="Gọi ngay">
    📞 Liên hệ trực tiếp
  </a>
`;

          priceRow.classList.remove("hidden");
        } else {
          const priceHTML = price ? `<span class="price-original">${sale ? `<s>Giá: ${formatPrice(price)}đ</s>` : `Giá: ${formatPrice(price)}đ`}</span>` : "";
          const saleHTML = sale ? `<span class="price-sale">Khuyến mãi: ${formatPrice(sale)}đ</span>` : "";
          priceRow.innerHTML = priceHTML + saleHTML;
          priceRow.classList.remove("hidden");
        }

        if (newImg) img.src = newImg;
      }

      sizeSelect.addEventListener("change", updateDetails);
      updateDetails();

      orderBtn.addEventListener("click", () => {
        orderForm.classList.toggle("hidden");
      });

      cancelBtn.addEventListener("click", () => {
        orderForm.classList.add("hidden");
      });

      confirmBtn.addEventListener("click", () => {
        const customer = inputCustomer.value.trim();
        const phone = inputPhone.value.trim();
        const address = inputAddress.value.trim();
        const note = inputNote.value.trim();
        const productName = inputName.value;
        const size = inputSize.value;

        if (!customer || !phone) {
          alert("⚠️ Vui lòng nhập đầy đủ họ tên và số điện thoại.");
          return;
        }

        const payload = { productName, size, customer, phone, address, note };
        const formData = new URLSearchParams(payload);

        fetch("https://script.google.com/macros/s/AKfycbxw3zd3miC7Sp1iIJcjVdlYzrwDjxcMJJvECB3hyK8bOkbo5b0aFSNieshY0R7P35w1/exec", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formData
        })
          .then(res => res.json())
          .then(response => {
            if (response.success || response.result === "success") {
              alert("✅ Đơn hàng đã được gửi thành công!");
              orderForm.classList.add("hidden");
            } else {
              alert("❌ Gửi đơn hàng thất bại: " + (response.message || "Không rõ nguyên nhân."));
            }
          })
          .catch(err => {
            alert("❌ Có lỗi xảy ra khi gửi đơn hàng.");
          });
      });

      colorBtn.addEventListener("click", () => {
        const selected = sizeSelect.selectedOptions[0];
        const colorImgUrl = selected.dataset.colorImg;
        if (!colorImgUrl) {
          alert("Không có ảnh tô màu cho sản phẩm này.");
          return;
        }
        window.location.href = `color.html?img=${encodeURIComponent(colorImgUrl)}`;
      });

      fragment.appendChild(div);
    });

    container.appendChild(fragment);
    renderedCount += toShow.length;
    updateToggleButtons();
  }

  function updateToggleButtons() {
    toggleContainer.innerHTML = "";

    if (renderedCount < productList.length) {
      const showMoreBtn = document.createElement("button");
      showMoreBtn.className = "toggle-btn show-more";
      showMoreBtn.textContent = "Xem thêm";
      showMoreBtn.onclick = renderProducts;
      toggleContainer.appendChild(showMoreBtn);
    }

    if (renderedCount > MAX_VISIBLE) {
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "toggle-btn collapse";
      collapseBtn.textContent = "🔼 Thu gọn";
      collapseBtn.onclick = () => {
        container.innerHTML = "";
        renderedCount = 0;
        renderProducts();
      };
      toggleContainer.appendChild(collapseBtn);
    }
  }

  groupTitle.addEventListener("click", () => {
    const isVisible = container.children.length > 0;
    container.innerHTML = "";
    toggleContainer.innerHTML = "";
    if (!isVisible) {
      renderedCount = 0;
      renderProducts();
    }
  });

  renderProducts();
  loadingSpan.style.display = "none";
}
