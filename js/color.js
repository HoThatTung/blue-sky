document.getElementById("downloadBtn").addEventListener("click", () => {
  const isMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) {
    // Bước 1: mở tab NGAY LẬP TỨC
    const newTab = window.open("about:blank", "_blank");
    if (!newTab) {
      alert("Vui lòng bật pop-up trong trình duyệt để lưu ảnh.");
      return;
    }

    // Bước 2: tạo canvas phụ có logo và tên ảnh
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    const logo = new Image();
    logo.src = "images/logo.png";
    logo.crossOrigin = "anonymous";

    logo.onload = () => {
      const logoHeight = 40;
      const scale = logoHeight / logo.height;
      const logoWidth = logo.width * scale;
      const x = canvas.width - logoWidth - 10;
      const y = canvas.height - logoHeight - 10;

      tempCtx.drawImage(logo, x, y, logoWidth, logoHeight);
      tempCtx.font = "16px Arial";
      tempCtx.fillStyle = "black";
      tempCtx.textBaseline = "top";
      tempCtx.fillText(originalImageName, 10, 10);

      // Bước 3: chuyển sang ảnh base64 rồi hiển thị ở tab mới
      const dataURL = tempCanvas.toDataURL("image/png");

      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Ảnh đã tô màu</title></head>
          <body style="margin:0;text-align:center;background:#fff;">
            <img src="${dataURL}" style="max-width:100%;height:auto;" />
            <p style="font-family:sans-serif;">👉 Nhấn giữ ảnh và chọn 'Lưu hình ảnh'</p>
          </body>
        </html>
      `;
      newTab.document.open();
      newTab.document.write(html);
      newTab.document.close();
    };

    logo.onerror = () => {
      alert("Không thể tải logo từ images/logo.png");
    };

    return;
  }

  // ----- PHẦN DESKTOP GIỮ NGUYÊN -----
  const logo = new Image();
  logo.src = "images/logo.png";
  logo.crossOrigin = "anonymous";

  logo.onload = () => {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");

    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    tempCtx.drawImage(canvas, 0, 0);
    tempCtx.font = "16px Arial";
    tempCtx.fillStyle = "black";
    tempCtx.textBaseline = "top";
    tempCtx.fillText(originalImageName, 10, 10);

    const logoHeight = 40;
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
    alert("Không thể tải logo từ images/logo.png");
  };
});
