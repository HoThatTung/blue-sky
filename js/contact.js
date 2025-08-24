// contact.js — Gửi form liên hệ qua Google Apps Script (hoặc endpoint khác)

// 👉 Sửa lại endpoint nếu bạn dùng Web App khác
const CONTACT_FORM_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbychBZSym3iXVsFBNc0pl3kYFuraRnb_YoIh7NfJ7gPk81t-iZJIPSTf7g6hRpvFBbv/exec";

// ===== Helpers =====
const $$ = (sel, root = document) => root.querySelector(sel);
const emailRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
// Cho số VN cơ bản (0xxxxxxxxx hoặc +84xxxxxxxxx) + fallback số quốc tế 8–14 chữ số
const phoneRE = /^(?:\+?84|0)\d{8,10}$|^\+?\d{8,14}$/;

function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

function show(el) { if (el) el.style.display = "block"; }
function hide(el) { if (el) el.style.display = "none"; }

// ===== Main =====
document.addEventListener("DOMContentLoaded", () => {
  const form = $$(".contact-form");
  if (!form) return;

  const successMsg = $$(".success-message", form);
  const errorMsg   = $$(".error-message", form);
  const btn        = $$(".btn-submit", form);

  // Nhận cả #contact (bản mới) và #email (bản cũ)
  const nameEl    = $$("#name", form);
  const contactEl = $$("#contact", form) || $$("#email", form);
  const messageEl = $$("#message", form);
  const honeypot  = $$("#website", form); // nếu có

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(successMsg); hide(errorMsg);

    // Honeypot: nếu có giá trị -> bỏ qua (bot)
    if (honeypot && honeypot.value.trim()) return;

    const name    = (nameEl?.value || "").trim();
    const contact = (contactEl?.value || "").trim();
    const message = (messageEl?.value || "").trim();

    if (!name || !contact || !message) {
      if (errorMsg) {
        errorMsg.textContent = "⚠️ Vui lòng điền đầy đủ thông tin.";
        show(errorMsg);
      }
      return;
    }

    // Kiểm tra định dạng liên hệ: cho phép email hoặc số điện thoại
    const isEmail = emailRE.test(contact);
    const isPhone = phoneRE.test(contact);
    if (!isEmail && !isPhone) {
      if (errorMsg) {
        errorMsg.textContent = "⚠️ Vui lòng nhập email hoặc số điện thoại hợp lệ.";
        show(errorMsg);
      }
      return;
    }

    // Ngăn double submit
    const oldText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = "Đang gửi…"; }

    try {
      if (!CONTACT_FORM_ENDPOINT) {
        throw new Error("Chưa cấu hình CONTACT_FORM_ENDPOINT.");
      }

      const payload = new URLSearchParams({
        type: "contact",
        name,
        email: contact,      // giữ key 'email' để tương thích Apps Script cũ của bạn
        message,
        page: location.href,
        ua: navigator.userAgent,
        ts: new Date().toISOString(),
      });

      const res = await fetchWithTimeout(
        CONTACT_FORM_ENDPOINT,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: payload.toString(),
        },
        15000
      );

      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch { /* có thể không phải JSON */ }

      const ok = res.ok && (data.result === "success" || data.success === true || text.trim() === "" || text.trim().toLowerCase().includes("success"));
      if (ok) {
        show(successMsg); hide(errorMsg);
        form.reset();
      } else {
        if (errorMsg) {
          errorMsg.textContent = "❌ Gửi thất bại: " + (data.message || `HTTP ${res.status}`);
          show(errorMsg);
        }
      }
    } catch (err) {
      if (errorMsg) {
        errorMsg.textContent = "⚠️ Lỗi khi gửi liên hệ. Vui lòng thử lại sau.";
        show(errorMsg);
      }
      console.error("Lỗi gửi form:", err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
  });
});
