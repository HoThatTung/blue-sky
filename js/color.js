// ====================== Canvas Coloring (1-layer, finalized + anti-aliased lines, mobile/desktop optimized) ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Ngăn cuộn/zoom mặc định trên mobile khi vẽ
if (canvas && canvas.style) {
  canvas.style.touchAction = "none";
}

// ---------- Config cho chuẩn hoá & bảo vệ nét ----------
const T_HIGH = 165;
const T_LOW  = 220;
const DILATE_RADIUS = 0;

// ✅ cấu hình mịn nét (anti-alias)
const AA_SCALE = 2;

// ---------- State ----------
// === Recolor mode (tự động, không thêm UI) ===
let imageProcessingMode = "lineart";
let fillTolerance = 70;
let edgeStop = 22;
const PRESERVE_LIGHTNESS = true;

let currentColor = "#000000";
let isDrawing = false;
let mode = "fill";
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];
let redoStack = [];

let originalImageName = "";

let lineMask = null;
let lastPt = null;
let originalImageData = null;


const colors = [
  // Hàng 1
  { hex: "#CD0000", name: "Đỏ đậm" },
  { hex: "#FF4500", name: "Cam lửa" },
  { hex: "#D2691E", name: "Cam đất" },
  { hex: "#FFA500", name: "Cam cà rốt" },
  { hex: "#FFD700", name: "Vàng nghệ" },
  { hex: "#FFFF00", name: "Vàng tươi" },
  { hex: "#FF3366", name: "Đỏ hồng" },
  { hex: "#FF00FF", name: "Hồng" },

  // Hàng 2
  { hex: "#008000", name: "Xanh lá đậm" },
  { hex: "#00FF00", name: "Xanh lá neon" },
  { hex: "#CCFFCC", name: "Xanh minơ" },
  { hex: "#0000FF", name: "Xanh dương" },
  { hex: "#0099FF", name: "Xanh ngọc" },
  { hex: "#00FFFF", name: "Xanh galaxy" },
  { hex: "#6600CC", name: "Xanh tím" },
  { hex: "#800080", name: "Tím" },

  // Hàng 3
  { hex: "#000000", name: "Đen" },
  { hex: "#708090", name: "Xám xanh" },
  { hex: "#C0C0C0", name: "Xám bạc" },
  { hex: "#FFFFFF", name: "Trắng" },
  { hex: "#A0522D", name: "Nâu đất" },
  { hex: "#8B5F65", name: "Hồng nâu" },
  { hex: "#CCC1DA", name: "Tím calilac" },
  { hex: "#FFB6C1", name: "Hồng nhạt" },
];


const palette = document.getElementById("colorPalette");
const colorInfo = document.getElementById("colorInfo");
const colorInfoText = document.getElementById("colorInfoText");


colors.forEach((c, i) => {

  const div = document.createElement("div");

  div.className = "color";

  div.style.background = c.hex;

  div.dataset.color = c.hex;
  div.dataset.name = c.name;

  div.title = `${c.name} (${c.hex})`;

  if (i === 0) {

    div.classList.add("selected");

    setCurrentColor(c.hex);

    updateColorInfo(
      c.hex,
      c.name
    );
  }

  palette.appendChild(div);
});


function setCurrentColor(hex) {

  const val =
    hex.startsWith("#")
      ? hex.slice(1)
      : hex;

  if (/^0{6}$/i.test(val)) {

    currentColor = "#111111";

  } else {

    currentColor =
      "#" + val.toUpperCase();

  }
}


function getContrastTextColor(hex) {

  if (!hex)
    return "#111111";

  const v =
    hex.replace("#", "");

  if (v.length !== 6)
    return "#111111";


  const r =
    parseInt(v.slice(0,2),16);

  const g =
    parseInt(v.slice(2,4),16);

  const b =
    parseInt(v.slice(4,6),16);


  const luminance =
    0.299*r +
    0.587*g +
    0.114*b;


  return luminance > 160
    ? "#111111"
    : "#FFFFFF";
}


function updateColorInfo(
  hex,
  name
) {

  if (
    !colorInfo ||
    !colorInfoText
  )
    return;


  if (
    !hex ||
    !name
  ) {

    colorInfo.style.background =
      "#f3f4f6";

    colorInfo.style.color =
      "#111111";

    colorInfoText.textContent =
      "Chosen color (Vietnamese): Chưa chọn";

    return;
  }


  colorInfo.style.background =
    hex;


  colorInfo.style.color =
    getContrastTextColor(hex);


  colorInfoText.textContent =
    `Chosen color (Vietnamese): ${name}`;

}


document
.querySelectorAll(".color")
.forEach(el => {

  el.addEventListener(
    "click",
    () => {

      document
      .querySelectorAll(".color")
      .forEach(c =>
        c.classList.remove("selected")
      );


      el.classList.add(
        "selected"
      );


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

        if (content)
          content.style.color =
            currentColor;

      }

    }
  );

});


// ==================================================
// BẢNG CHỌN MÀU MỞ RỘNG – KIỂU WORD
// ==================================================

const extendedColors = [

  // Hàng 1
  "#FFFFFF",
  "#E7E6E6",
  "#D0CECE",
  "#A5A5A5",
  "#7F7F7F",
  "#595959",
  "#3F3F3F",
  "#000000",

  // Hàng 2
  "#F4CCCC",
  "#EA9999",
  "#E06666",
  "#CC0000",
  "#FCE5CD",
  "#F9CB9C",
  "#F6B26B",
  "#E69138",

  // Hàng 3
  "#FFF2CC",
  "#FFE599",
  "#FFD966",
  "#F1C232",
  "#D9EAD3",
  "#B6D7A8",
  "#93C47D",
  "#6AA84F",

  // Hàng 4
  "#D0E0E3",
  "#A2C4C9",
  "#76A5AF",
  "#45818E",
  "#CFE2F3",
  "#9FC5E8",
  "#6FA8DC",
  "#3D85C6",

  // Hàng 5
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

  if (customColorPreview)
    customColorPreview.style.background =
      hex;


  if (customColorButtonSwatch)
    customColorButtonSwatch.style.background =
      hex;


  if (customColorInput)
    customColorInput.value =
      hex;

}



function applyExtendedColor(hex) {

  if (!hex)
    return;


  // bỏ selected của bảng màu tròn
  document
  .querySelectorAll(".color")
  .forEach(c =>
    c.classList.remove("selected")
  );


  // bỏ selected của bảng mở rộng
  document
  .querySelectorAll(
    ".extended-color-swatch"
  )
  .forEach(c =>
    c.classList.remove("selected")
  );


  // đặt màu đang sử dụng
  setCurrentColor(hex);


  const actualHex =
    currentColor.toUpperCase();


  // cập nhật Chosen Color
  updateColorInfo(
    actualHex,
    `Màu tùy chọn (${actualHex})`
  );


  // cập nhật ô preview
  updateCustomColorPreview(
    actualHex
  );


  // tìm màu đang chọn trong bảng
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


  if (matchedSwatch)
    matchedSwatch
      .classList
      .add("selected");


  // nếu đang chỉnh text
  if (
    mode === "text" &&
    currentTextBox
  ) {

    const content =
      currentTextBox.querySelector(
        ".text-content"
      );

    if (content)
      content.style.color =
        currentColor;

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



// TẠO CÁC Ô MÀU
if (customColorGrid) {

  extendedColors.forEach(
    hex => {

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
        `Chọn màu ${hex}`
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

    }
  );

}



// NÚT CHỌN MÀU
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
    e => e.stopPropagation()
  );


  document.addEventListener(
    "click",
    () =>
      setCustomColorPanel(false)
  );


  document.addEventListener(
    "keydown",
    e => {

      if (e.key === "Escape")
        setCustomColorPanel(false);

    }
  );

}



// COLOR PICKER HỆ THỐNG
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



// Khi quay lại chọn màu tròn
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


// preview mặc định
updateCustomColorPreview(
  currentColor
);


// ==================================================
// MODE BUTTON
// ==================================================

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

    mode = "text";

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


// ==================================================
// IMAGE SELECT / UPLOAD
// ==================================================

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


          if (kiteLabel)
            kiteLabel.style.display =
              "block";

        };


      localImg.src =
        selectedImage;


      const up =
        document.getElementById(
          "uploadInput"
        );


      if (up)
        up.value = "";

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


            if (imageSelect)
              imageSelect.selectedIndex =
                0;


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


// ==================================================
// COORDINATES
// ==================================================

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


// ==================================================
// BRUSH / ERASER
// ==================================================

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


// DESKTOP

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


canvas.addEventListener(
  "mousemove",
  e => {

    if (
      isDrawing &&
      (
        mode === "brush" ||
        mode === "eraser"
      )
    ) {

      drawAt(e);

    }

  }
);


canvas.addEventListener(
  "mouseup",
  () => {

    isDrawing =
      false;

    lastPt =
      null;

  }
);


canvas.addEventListener(
  "mouseleave",
  () => {

    isDrawing =
      false;

    lastPt =
      null;

  }
);


// MOBILE

canvas.addEventListener(
  "touchstart",
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


      e.preventDefault();

    }

  },
  {
    passive:false
  }
);


canvas.addEventListener(
  "touchmove",
  e => {

    if (
      isDrawing &&
      (
        mode === "brush" ||
        mode === "eraser"
      )
    ) {

      drawAt(e);

      e.preventDefault();

    }

  },
  {
    passive:false
  }
);


canvas.addEventListener(
  "touchend",
  () => {

    isDrawing =
      false;

    lastPt =
      null;

  }
);


// ==================================================
// FILL
// ==================================================

canvas.addEventListener(
  "click",
  e => {

    if (
      mode !== "fill"
    )
      return;


    ensureInitialized();


    const {
      x,
      y
    } =
      getCanvasCoords(e);


    saveState();


    const color =
      hexToRgba(
        currentColor
      );


    if (
      imageProcessingMode ===
      "lineart"
    ) {

      floodFillSingleLayer(
        x,
        y,
        color
      );

    }

    else {

      floodFillWithEdgeGuard(
        x,
        y,
        color,
        fillTolerance,
        edgeStop,
        PRESERVE_LIGHTNESS
      );

    }

  }
);


function hexToRgba(hex) {

  const bigint =
    parseInt(
      hex.slice(1),
      16
    );


  return [

    (bigint >> 16) & 255,

    (bigint >> 8) & 255,

    bigint & 255,

    255

  ];

}


function isLinePixel(
  x,
  y,
  w,
  h
) {

  if (!lineMask)
    return false;


  if (
    x < 0 ||
    y < 0 ||
    x >= w ||
    y >= h
  )
    return false;


  return (
    lineMask[
      y*w+x
    ] === 1
  );

}


function floodFillSingleLayer(
  x,
  y,
  fillColor
) {

  const w =
    canvas.width;


  const h =
    canvas.height;


  if (
    w === 0 ||
    h === 0
  )
    return;


  let imageData;


  try {

    imageData =
      ctx.getImageData(
        0,
        0,
        w,
        h
      );

  }

  catch(err) {

    console.error(err);

    alert(
      "Không thể tô màu do ảnh bị chặn đọc pixel (CORS). Hãy dùng ảnh cùng domain hoặc bật CORS/crossOrigin='anonymous'."
    );

    return;

  }


  const data =
    imageData.data;


  if (
    isLinePixel(
      x,
      y,
      w,
      h
    )
  )
    return;


  const idx0 =
    (
      y*w+x
    )*4;


  const startR =
    data[idx0];


  const startG =
    data[idx0+1];


  const startB =
    data[idx0+2];


  const tolerance =
    fillTolerance;


  const visited =
    new Uint8Array(
      w*h
    );


  const stack = [
    [x,y]
  ];


  const match =
    (
      cx,
      cy,
      i
    ) => {

      if (
        isLinePixel(
          cx,
          cy,
          w,
          h
        )
      )
        return false;


      const r =
        data[i];


      const g =
        data[i+1];


      const b =
        data[i+2];


      return (

        Math.abs(
          r-startR
        ) <= tolerance

        &&

        Math.abs(
          g-startG
        ) <= tolerance

        &&

        Math.abs(
          b-startB
        ) <= tolerance

      );

    };


  while (
    stack.length
  ) {

    const [
      cx,
      cy
    ] =
      stack.pop();


    if (
      cx < 0 ||
      cy < 0 ||
      cx >= w ||
      cy >= h
    )
      continue;


    const i =
      (
        cy*w+cx
      )*4;


    const vi =
      cy*w+cx;


    if (
      visited[vi]
    )
      continue;


    visited[vi] =
      1;


    if (
      !match(
        cx,
        cy,
        i
      )
    )
      continue;


    data[i] =
      fillColor[0];


    data[i+1] =
      fillColor[1];


    data[i+2] =
      fillColor[2];


    data[i+3] =
      255;


    stack.push(

      [cx-1,cy],

      [cx+1,cy],

      [cx,cy-1],

      [cx,cy+1]

    );

  }


  ctx.putImageData(
    imageData,
    0,
    0
  );

}
