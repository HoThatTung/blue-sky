document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".contact-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.querySelector("#name").value.trim();
    const email = form.querySelector("#email").value.trim();
    const message = form.querySelector("#message").value.trim();

    if (!name || !email || !message) {
      alert("Vui lòng điền đầy đủ thông tin.");
      return;
    }

    const data = {
      type: "contact", // ✅ quan trọng để xử lý đúng ở doPost
      name,
      email,
      message
    };

    const formData = new URLSearchParams();
    for (const key in data) {
      formData.append(key, data[key]);
    }

    const submitBtn = form.querySelector(".btn-submit");
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Đang gửi...";

    try {
      const res = await fetch("https://script.google.com/macros/s/AKfycbxdmJg_8-z8lLEWcF1dQLCau10arTkFpg2TjrIntAm7P8SjkGD49CBwyXO6IZC7bpLt/exec", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: formData
      });

      const text = await res.text();
      let result;

      try {
        result = JSON.parse(text);
      } catch (err) {
        console.warn("Phản hồi không phải JSON:", text);
        alert("✔️ Gửi thành công (chưa phân tích được phản hồi).");
        form.reset();
        return;
      }

      if (result.status === "success") {
        alert("✅ Gửi liên hệ thành công!");
        form.reset();
      } else {
        alert("❌ Gửi thất bại: " + result.message);
      }

    } catch (err) {
      console.error("Lỗi gửi:", err);
      alert("⚠️ Lỗi khi gửi liên hệ. Vui lòng thử lại sau.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
});
