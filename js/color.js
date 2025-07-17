document.getElementById("downloadBtn").addEventListener("click", () => {
  const logo = new Image();
  logo.src = "images/logo.png";
  logo.crossOrigin = "anonymous";

  logo.onload = () => {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");

    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    // Vẽ hình chính
    tempCtx.drawImage(canvas, 0, 0);

    // Ghi tên ảnh
    tempCtx.font = "16px Arial";
    tempCtx.fillStyle = "black";
    tempCtx.textBaseline = "top";
    tempCtx.fillText(originalImageName, 10, 10);

    // Vẽ logo
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

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        // MOBILE → Mở ảnh trong tab mới để nhấn giữ và lưu
        const reader = new FileReader();
        reader.onloadend = () => {
          const newTab = window.open();
          if (newTab) {
            newTab.document.write(`<img src="${reader.result}" style="width:100%">`);
            alert("👉 Ảnh đã mở. Nhấn giữ ảnh và chọn 'Lưu hình ảnh' để tải về.");
          } else {
            alert("Vui lòng bật cửa sổ popup để lưu ảnh.");
          }
        };
        reader.readAsDataURL(blob);
      } else {
        // DESKTOP → Tải xuống trực tiếp
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = originalImageName || "to_mau.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  };

  logo.onerror = () => {
    alert("Không thể tải logo từ images/logo.png");
  };
});
