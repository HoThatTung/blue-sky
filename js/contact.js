document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".contact-form");
  if (!form) return;

  const successMsg = form.querySelector(".success-message");
  const errorMsg = form.querySelector(".error-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.querySelector("#name").value.trim();
    const email = form.querySelector("#email").value.trim();
    const message = form.querySelector("#message").value.trim();

    if (!name || !email || !message) {
      errorMsg.textContent = "⚠️ Vui lòng điền đầy đủ thông tin.";
      errorMsg.style.display = "block";
      successMsg.style.display = "none";
      return;
    }

    const data = {
      type: "contact",
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
      const res = await fetch("https://script.google.com/macros/s/AKfycbychBZSym3iXVsFBNc0pl3kYFuraRnb_YoIh7NfJ7gPk81t-iZJIPSTf7g6hRpvFBbv/exec", {
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
        successMsg.style.display = "block";
        errorMsg.style.display = "none";
        form.reset();
        return;
      }

      if (result.result === "success") {
        successMsg.style.display = "block";
        errorMsg.style.display = "none";
        form.reset();
      } else {
        errorMsg.textContent = "❌ Gửi thất bại: " + (result.message || "Không rõ lý do.");
        errorMsg.style.display = "block";
        successMsg.style.display = "none";
      }

    } catch (err) {
      console.error("Lỗi gửi:", err);
      errorMsg.textContent = "⚠️ Lỗi khi gửi liên hệ. Vui lòng thử lại sau.";
      errorMsg.style.display = "block";
      successMsg.style.display = "none";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
});
