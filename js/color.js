// ====================== Canvas Coloring (1-layer, finalized + anti-aliased lines, mobile/desktop optimized) ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Ngăn cuộn/zoom mặc định trên mobile khi vẽ
if (canvas && canvas.style) {
  canvas.style.touchAction = "none";
}

// ---------- Config cho chuẩn hoá & bảo vệ nét ----------
const T_HIGH = 165;      // pixel tối hơn => chắc chắn là "đen"
const T_LOW  = 220;      // pixel sáng hơn => chắc chắn là "trắng"
const DILATE_RADIUS = 0; // nở nét 0..2 (1 thường là ổn)

// ✅ cấu hình mịn nét (anti-alias)
const AA_SCALE = 2;      // 2 hoặc 3 (2 thường là đủ mịn)

// ---------- State ----------
// === Recolor mode (tự động, không thêm UI) ===
let imageProcessingMode = "lineart"; // "lineart" | "recolor"
let fillTolerance = 70;              // 10..80 (dung sai giống màu)
let edgeStop = 22;                   // 10..40 (độ nhạy biên Sobel)
const PRESERVE_LIGHTNESS = true;     // giữ sáng/tối khi đổi màu

let currentColor = "#000000";
let isDrawing = false;
let mode = "fill"; // fill | brush | eraser | text
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];
let redoStack = [];

let originalImageName = "";

// ✅ mặt nạ nét (1 = pixel thuộc đường nét; 0 = nền/vùng tô)
let lineMask = null;

// ✅ lưu điểm trước đó để nội suy nét brush
let lastPt = null;

let originalImageData = null;  // bản gốc (đã scale) để hiển thị & xuất

const colors = [
  // Hàng 1
  { hex: "#CD0000", name: "Dark Red" },
  { hex: "#FF4500", name: "Orange Red" },
  { hex: "#D2691E", name: "Chocolate" },
  { hex: "#FFA500", name: "Orange" },
  { hex: "#FFD700", name: "Gold" },
  { hex: "#FFFF00", name: "Yellow" },
  { hex: "#FF3366", name: "Rose Red" },
  { hex: "#FF00FF", name: "Magenta" },

  // Hàng 2
  { hex: "#008000", name: "Dark Green" },
  { hex: "#00FF00", name: "Lime" },
  { hex: "#CCFFCC", name: "Mint Green" },
  { hex: "#0000FF", name: "Blue" },
  { hex: "#0099FF", name: "Sky Blue" },
  { hex: "#00FFFF", name: "Cyan" },
  { hex: "#6600CC", name: "Blue Violet" },
  { hex: "#800080", name: "Purple" },

  // Hàng 3
  { hex: "#000000", name: "Black" },
  { hex: "#708090", name: "Slate Gray" },
  { hex: "#C0C0C0", name: "Silver" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#A0522D", name: "Sienna" },
  { hex: "#8B5F65", name: "Dusty Rose" },
  { hex: "#CCC1DA", name: "Lilac" },
  { hex: "#FFB6C1", name: "Light Pink" },
];


const palette = document.getElementById("colorPalette");
const colorInfo   = document.getElementById("colorInfo");
const colorInfoText = document.getElementById("colorInfoText");


colors.forEach((c, i) => {
  const div = document.createElement("div");
  div.className = "color";
  div.style.background = c.hex;
  div.dataset.color = c.hex;
  div.dataset.name  = c.name;
  div.title = `${c.name} (${c.hex})`;

  if (i === 0) {
    div.classList.add("selected");
    setCurrentColor(c.hex);
    updateColorInfo(c.hex, c.name);
  }

  palette.appendChild(div);
});


// Không cho màu tô là đen tuyệt đối
function setCurrentColor(hex) {
  const val = hex.startsWith('#') ? hex.slice(1) : hex;

  if (/^0{6}$/i.test(val)) {
    currentColor = "#111111";
  } else {
    currentColor = "#" + val.toUpperCase();
  }
}


// Chọn màu chữ đen / trắng cho dễ đọc trên nền màu được chọn
function getContrastTextColor(hex) {
  if (!hex) return "#111111";

  const v = hex.replace("#", "");

  if (v.length !== 6) return "#111111";

  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);

  const luminance =
    0.299 * r +
    0.587 * g +
    0.114 * b;

  return luminance > 160
    ? "#111111"
    : "#FFFFFF";
}


// Cập nhật màu hiện tại
function updateColorInfo(hex, name) {

  if (!colorInfo || !colorInfoText)
    return;

  if (!hex || !name) {

    colorInfo.style.background =
      "#f3f4f6";

    colorInfo.style.color =
      "#111111";

    colorInfoText.textContent =
      "Chosen color: Not selected";

    return;
  }

  colorInfo.style.background =
    hex;

  colorInfo.style.color =
    getContrastTextColor(hex);

  colorInfoText.textContent =
    `Chosen color: ${name}`;
}


// Click 24 màu có sẵn
document.querySelectorAll(".color").forEach(el => {

  el.addEventListener("click", () => {

    document
      .querySelectorAll(".color")
      .forEach(c =>
        c.classList.remove("selected")
      );

    el.classList.add("selected");

    const hex =
      el.dataset.color;

    const name =
      el.dataset.name || "";

    setCurrentColor(hex);

    updateColorInfo(
      hex,
      name
    );

    if (
      mode === "text" &&
      currentTextBox
    ) {

      const content =
        currentTextBox.querySelector(
          ".text-content"
        );

      if (content) {
        content.style.color =
          currentColor;
      }
    }

  });

});


// ======================================================
// EXTENDED COLOR PALETTE — WORD STYLE
// ======================================================

const extendedColors = [

  // Row 1: grayscale / neutral
  "#FFFFFF",
  "#E7E6E6",
  "#D0CECE",
  "#A5A5A5",
  "#7F7F7F",
  "#595959",
  "#3F3F3F",
  "#000000",

  // Row 2: red / orange
  "#F4CCCC",
  "#EA9999",
  "#E06666",
  "#CC0000",
  "#FCE5CD",
  "#F9CB9C",
  "#F6B26B",
  "#E69138",

  // Row 3: yellow / green
  "#FFF2CC",
  "#FFE599",
  "#FFD966",
  "#F1C232",
  "#D9EAD3",
  "#B6D7A8",
  "#93C47D",
  "#6AA84F",

  // Row 4: teal / blue
  "#D0E0E3",
  "#A2C4C9",
  "#76A5AF",
  "#45818E",
  "#CFE2F3",
  "#9FC5E8",
  "#6FA8DC",
  "#3D85C6",

  // Row 5: purple / pink
  "#D9D2E9",
  "#B4A7D6",
  "#8E7CC3",
  "#674EA7",
  "#EAD1DC",
  "#D5A6BD",
  "#C27BA0",
  "#A64D79"

];


const customColorBtn =
  document.getElementById(
    "customColorBtn"
  );

const customColorPanel =
  document.getElementById(
    "customColorPanel"
  );

const customColorGrid =
  document.getElementById(
    "customColorGrid"
  );

const customColorInput =
  document.getElementById(
    "customColorInput"
  );

const customColorPreview =
  document.getElementById(
    "customColorPreview"
  );

const customColorButtonSwatch =
  document.getElementById(
    "customColorButtonSwatch"
  );


function updateCustomColorPreview(hex) {

  if (customColorPreview) {
    customColorPreview.style.background =
      hex;
  }

  if (customColorButtonSwatch) {
    customColorButtonSwatch.style.background =
      hex;
  }

  if (customColorInput) {
    customColorInput.value =
      hex;
  }

}


function applyExtendedColor(hex) {

  if (!hex)
    return;

  document
    .querySelectorAll(".color")
    .forEach(c =>
      c.classList.remove("selected")
    );

  document
    .querySelectorAll(
      ".extended-color-swatch"
    )
    .forEach(c =>
      c.classList.remove("selected")
    );

  setCurrentColor(hex);

  const actualHex =
    currentColor.toUpperCase();

  updateColorInfo(
    actualHex,
    `Custom color (${actualHex})`
  );

  updateCustomColorPreview(
    actualHex
  );

  const matchedSwatch =
    Array
      .from(
        document.querySelectorAll(
          ".extended-color-swatch"
        )
      )
      .find(
        el =>
          (
            el.dataset.color || ""
          ).toUpperCase()
          ===
          hex.toUpperCase()
      );

  if (matchedSwatch) {
    matchedSwatch.classList.add(
      "selected"
    );
  }

  if (
    mode === "text" &&
    currentTextBox
  ) {

    const content =
      currentTextBox.querySelector(
        ".text-content"
      );

    if (content) {
      content.style.color =
        currentColor;
    }
  }

}


function setCustomColorPanel(open) {

  if (
    !customColorBtn ||
    !customColorPanel
  )
    return;

  customColorPanel.hidden =
    !open;

  customColorBtn.setAttribute(
    "aria-expanded",
    open ? "true" : "false"
  );

}


// Tạo các ô màu mở rộng
if (customColorGrid) {

  extendedColors.forEach(hex => {

    const btn =
      document.createElement(
        "button"
      );

    btn.type =
      "button";

    btn.className =
      "extended-color-swatch";

    btn.dataset.color =
      hex;

    btn.style.background =
      hex;

    btn.title =
      hex;

    btn.setAttribute(
      "aria-label",
      `Choose color ${hex}`
    );

    btn.addEventListener(
      "click",
      () => {

        applyExtendedColor(
          hex
        );

        setCustomColorPanel(
          false
        );

      }
    );

    customColorGrid
      .appendChild(btn);

  });

}


// Nút Choose Color
if (
  customColorBtn &&
  customColorPanel
) {

  customColorBtn.addEventListener(
    "click",
    e => {

      e.stopPropagation();

      setCustomColorPanel(
        customColorPanel.hidden
      );

    }
  );


  customColorPanel.addEventListener(
    "click",
    e =>
      e.stopPropagation()
  );


  document.addEventListener(
    "click",
    () =>
      setCustomColorPanel(false)
  );


  document.addEventListener(
    "keydown",
    e => {

      if (e.key === "Escape") {
        setCustomColorPanel(false);
      }

    }
  );

}


// Native color picker
if (customColorInput) {

  customColorInput.addEventListener(
    "input",
    e => {

      applyExtendedColor(
        e.target.value
      );

    }
  );


  customColorInput.addEventListener(
    "change",
    () => {

      setCustomColorPanel(
        false
      );

    }
  );

}


// Khi quay lại chọn 24 màu mặc định
document
  .querySelectorAll(".color")
  .forEach(el => {

    el.addEventListener(
      "click",
      () => {

        updateCustomColorPreview(
          currentColor
        );

        document
          .querySelectorAll(
            ".extended-color-swatch"
          )
          .forEach(c =>
            c.classList.remove(
              "selected"
            )
          );

      }
    );

  });


// Preview mặc định
updateCustomColorPreview(
  currentColor
);


// ======================================================
// MODE BUTTONS
// ======================================================

document
  .getElementById("fillModeBtn")
  .addEventListener(
    "click",
    () => {

      updateModeButtons(
        "fill"
      );

    }
  );


function updateModeButtons(
  newMode = null
) {

  mode =
    newMode;

  document
    .querySelectorAll(
      ".mode-btn"
    )
    .forEach(
      btn =>
        btn.classList.remove(
          "active"
        )
    );


  if (mode === "fill") {

    document
      .getElementById(
        "fillModeBtn"
      )
      .classList.add(
        "active"
      );

  }

  else if (
    mode === "brush"
  ) {

    document
      .getElementById(
        "brushModeBtn"
      )
      .classList.add(
        "active"
      );

  }

  else if (
    mode === "eraser"
  ) {

    document
      .getElementById(
        "eraserModeBtn"
      )
      .classList.add(
        "active"
      );

  }

  else if (
    mode === "text"
  ) {

    document
      .getElementById(
        "textModeBtn"
      )
      .classList.add(
        "active"
      );

  }

}


document
  .getElementById("textModeBtn")
  .addEventListener(
    "click",
    () => {

      mode =
        "text";

      updateModeButtons();

      addTextBoxCentered();

    }
  );


document
  .getElementById("brushModeBtn")
  .addEventListener(
    "click",
    () => {

      updateModeButtons(
        "brush"
      );

    }
  );


document
  .getElementById("eraserModeBtn")
  .addEventListener(
    "click",
    () => {

      updateModeButtons(
        "eraser"
      );

    }
  );


document
  .getElementById("brushSizeSelect")
  .addEventListener(
    "change",
    function () {

      brushSize =
        parseFloat(
          this.value
        );

    }
  );


// ======================================================
// IMAGE SELECT / UPLOAD
// ======================================================

const imageSelect =
  document.getElementById(
    "imageSelect"
  );


if (imageSelect) {

  imageSelect.addEventListener(
    "change",
    function () {

      const selectedImage =
        this.value;

      if (!selectedImage)
        return;

      const localImg =
        new Image();

      localImg.onload =
        () => {

          loadImageToMainCanvas(
            localImg
          );

          undoStack = [];
          redoStack = [];

          originalImageName =
            selectedImage
              .split("/")
              .pop();

          updateSelectStyle();

          const kiteLabel =
            document.getElementById(
              "kite-label-input"
            );

          if (kiteLabel) {
            kiteLabel.style.display =
              "block";
          }

        };

      localImg.src =
        selectedImage;

      const up =
        document.getElementById(
          "uploadInput"
        );

      if (up) {
        up.value = "";
      }

    }
  );

}


document
  .getElementById("uploadInput")
  .addEventListener(
    "change",
    function (e) {

      const file =
        e.target.files[0];

      if (!file)
        return;

      const reader =
        new FileReader();

      reader.onload =
        function (event) {

          const upImg =
            new Image();

          upImg.onload =
            function () {

              loadImageToMainCanvas(
                upImg
              );

              undoStack = [];
              redoStack = [];

              originalImageName =
                file.name;

              if (imageSelect) {
                imageSelect.selectedIndex =
                  0;
              }

              updateSelectStyle();

            };

          upImg.src =
            event.target.result;

        };

      reader.readAsDataURL(
        file
      );

    }
  );


// ======================================================
// COORDINATES
// ======================================================

function getCanvasCoords(e) {

  const rect =
    canvas.getBoundingClientRect();

  const scaleX =
    canvas.width /
    rect.width;

  const scaleY =
    canvas.height /
    rect.height;

  let clientX;
  let clientY;


  if (
    e.touches &&
    e.touches[0]
  ) {

    clientX =
      e.touches[0].clientX;

    clientY =
      e.touches[0].clientY;

  }

  else {

    clientX =
      e.clientX;

    clientY =
      e.clientY;

  }


  const x =
    Math.floor(
      (
        clientX -
        rect.left
      ) *
      scaleX
    );


  const y =
    Math.floor(
      (
        clientY -
        rect.top
      ) *
      scaleY
    );


  return {
    x,
    y
  };

}


// ======================================================
// BRUSH / ERASER
// ======================================================

function isMobile() {

  return /Android|webOS|iPhone|iPad|iPod|Windows Phone|BlackBerry/i
    .test(
      navigator.userAgent
    );

}


function strokeFromTo(
  x0,
  y0,
  x1,
  y1,
  radius,
  rgba,
  isErase = false
) {

  const dx =
    x1 - x0;

  const dy =
    y1 - y0;

  const dist =
    Math.hypot(
      dx,
      dy
    );


  if (dist === 0) {

    paintCircleOnMain(
      x1,
      y1,
      radius,
      rgba,
      isErase
    );

    return;

  }


  const STEP_FACTOR =
    isMobile()
      ? 0.6
      : 0.5;


  const step =
    Math.max(
      1,
      radius *
      STEP_FACTOR
    );


  const n =
    Math.ceil(
      dist /
      step
    );


  for (
    let i = 1;
    i <= n;
    i++
  ) {

    const t =
      i / n;

    const x =
      x0 +
      dx * t;

    const y =
      y0 +
      dy * t;

    paintCircleOnMain(
      x,
      y,
      radius,
      rgba,
      isErase
    );

  }

}


function drawAt(e) {

  ensureInitialized();

  const {
    x,
    y
  } =
    getCanvasCoords(e);


  const isErase =
    mode === "eraser";


  const rgba =
    isErase
      ?
      [255,255,255,255]
      :
      hexToRgba(
        currentColor
      );


  if (!lastPt) {

    paintCircleOnMain(
      x,
      y,
      brushSize,
      rgba,
      isErase
    );

    lastPt = {
      x,
      y
    };

  }

  else {

    strokeFromTo(
      lastPt.x,
      lastPt.y,
      x,
      y,
      brushSize,
      rgba,
      isErase
    );

    lastPt = {
      x,
      y
    };

  }

}


// Desktop drawing
canvas.addEventListener(
  "mousedown",
  e => {

    if (
      mode === "brush" ||
      mode === "eraser"
    ) {

      isDrawing =
        true;

      saveState();

      lastPt =
        null;

      drawAt(e);

    }

  }
);
