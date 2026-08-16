// ====================== Canvas Coloring (1-layer, finalized + anti-aliased lines, mobile/desktop optimized) ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Prevent default scrolling/zooming on mobile while drawing
if (canvas && canvas.style) {
  canvas.style.touchAction = "none";
}

// ---------- Line normalization & protection config ----------
const T_HIGH = 165;
const T_LOW  = 220;
const DILATE_RADIUS = 0;

// Anti-aliasing scale
const AA_SCALE = 2;


// ======================================================
// STATE
// ======================================================

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


// ======================================================
// DESKTOP TOOL CURSOR
// ======================================================

let toolCursorPreview = null;
let toolCursorCenter = null;


/*
Create the Brush / Eraser preview circle.

Fill does not need a custom HTML cursor because
the browser's small crosshair cursor is more precise.
*/
function createToolCursorPreview() {

  if (!canvas) return;

  const wrapper =
    canvas.closest(".canvas-wrapper");

  if (!wrapper) return;


  toolCursorPreview =
    document.createElement("div");

  toolCursorPreview.className =
    "tool-cursor-preview";


  toolCursorCenter =
    document.createElement("div");

  toolCursorCenter.className =
    "tool-cursor-center";


  toolCursorPreview.appendChild(
    toolCursorCenter
  );


  wrapper.appendChild(
    toolCursorPreview
  );
}


/*
Check whether the current device has
a desktop-style fine pointer such as a mouse.

IMPORTANT:
Use "any-pointer: fine" instead of
"(hover: hover) and (pointer: fine)".

This allows laptops / hybrid devices with both
touch screen and mouse to still use the desktop
brush / eraser cursor whenever a mouse is available.
*/
function hasFinePointer() {

  return window.matchMedia(
    "(any-pointer: fine)"
  ).matches;

}


/*
Update the cursor style whenever the user
changes between Fill, Brush, Eraser and Text.
*/
function updateCanvasCursorMode() {

  if (!canvas) return;


  canvas.classList.remove(
    "cursor-fill",
    "cursor-brush",
    "cursor-eraser",
    "cursor-text"
  );


  if (mode === "fill") {

    canvas.classList.add(
      "cursor-fill"
    );

  }

  else if (mode === "brush") {

    canvas.classList.add(
      "cursor-brush"
    );

  }

  else if (mode === "eraser") {

    canvas.classList.add(
      "cursor-eraser"
    );

  }

  else if (mode === "text") {

    canvas.classList.add(
      "cursor-text"
    );

  }


  /*
  The preview circle is only needed
  for Brush and Eraser.
  */
  if (
    toolCursorPreview &&
    mode !== "brush" &&
    mode !== "eraser"
  ) {

    toolCursorPreview.style.display =
      "none";

  }

}


/*
Calculate the visible brush diameter on screen.

brushSize is stored in canvas pixels, while the
canvas may be scaled down by CSS. Therefore the
preview circle must use the current display scale.
*/
function getVisibleBrushDiameter() {

  if (!canvas) {
    return brushSize * 2;
  }


  const rect =
    canvas.getBoundingClientRect();


  if (
    !rect.width ||
    !canvas.width
  ) {

    return brushSize * 2;

  }


  const scaleX =
    rect.width /
    canvas.width;


  /*
  paintCircleOnMain() uses brushSize as radius,
  therefore the visible diameter is radius × 2.
  */
  return Math.max(
    4,
    brushSize * 2 * scaleX
  );

}


/*
Update the size and visual style of
the Brush / Eraser cursor.
*/
function updateToolCursorSize() {

  if (!toolCursorPreview) return;


  const diameter =
    getVisibleBrushDiameter();


  toolCursorPreview.style.width =
    `${diameter}px`;

  toolCursorPreview.style.height =
    `${diameter}px`;


  toolCursorPreview.dataset.mode =
    mode;

}


/*
Move the preview circle to the exact mouse
position relative to the canvas wrapper.
*/
function moveToolCursorPreview(e) {

  if (
    !hasFinePointer() ||
    !toolCursorPreview ||
    (
      mode !== "brush" &&
      mode !== "eraser"
    )
  ) {

    return;

  }


  const wrapper =
    canvas.closest(".canvas-wrapper");

  if (!wrapper) return;


  const wrapperRect =
    wrapper.getBoundingClientRect();


  const canvasRect =
    canvas.getBoundingClientRect();


  /*
  Only show the preview while the pointer
  is actually inside the canvas.
  */
  const insideCanvas =
    e.clientX >= canvasRect.left &&
    e.clientX <= canvasRect.right &&
    e.clientY >= canvasRect.top &&
    e.clientY <= canvasRect.bottom;


  if (!insideCanvas) {

    toolCursorPreview.style.display =
      "none";

    return;

  }


  const x =
    e.clientX -
    wrapperRect.left;


  const y =
    e.clientY -
    wrapperRect.top;


  updateToolCursorSize();


  toolCursorPreview.style.left =
    `${x}px`;

  toolCursorPreview.style.top =
    `${y}px`;

  toolCursorPreview.style.display =
    "block";

}


/*
Hide the custom cursor when the mouse
leaves the canvas.
*/
function hideToolCursorPreview() {

  if (toolCursorPreview) {

    toolCursorPreview.style.display =
      "none";

  }

}


// Track desktop mouse movement
canvas.addEventListener(
  "mousemove",
  moveToolCursorPreview
);


canvas.addEventListener(
  "mouseenter",
  e => {

    if (
      mode === "brush" ||
      mode === "eraser"
    ) {

      moveToolCursorPreview(e);

    }

  }
);


canvas.addEventListener(
  "mouseleave",
  hideToolCursorPreview
);


// Keep the preview correct if the browser
// window or canvas display size changes.
window.addEventListener(
  "resize",
  () => {

    if (
      toolCursorPreview &&
      toolCursorPreview.style.display !==
      "none"
    ) {

      updateToolCursorSize();

    }

  }
);


// ======================================================
// COLORS
// ======================================================

const colors = [

  // Row 1
  { hex: "#CD0000", name: "Dark Red" },
  { hex: "#FF4500", name: "Orange Red" },
  { hex: "#D2691E", name: "Chocolate" },
  { hex: "#FFA500", name: "Orange" },
  { hex: "#FFD700", name: "Gold" },
  { hex: "#FFFF00", name: "Yellow" },
  { hex: "#FF3366", name: "Rose Red" },
  { hex: "#FF00FF", name: "Magenta" },

  // Row 2
  { hex: "#008000", name: "Dark Green" },
  { hex: "#00FF00", name: "Lime" },
  { hex: "#CCFFCC", name: "Mint Green" },
  { hex: "#0000FF", name: "Blue" },
  { hex: "#0099FF", name: "Sky Blue" },
  { hex: "#00FFFF", name: "Cyan" },
  { hex: "#6600CC", name: "Blue Violet" },
  { hex: "#800080", name: "Purple" },

  // Row 3
  { hex: "#000000", name: "Black" },
  { hex: "#708090", name: "Slate Gray" },
  { hex: "#C0C0C0", name: "Silver" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#A0522D", name: "Sienna" },
  { hex: "#8B5F65", name: "Dusty Rose" },
  { hex: "#CCC1DA", name: "Lilac" },
  { hex: "#FFB6C1", name: "Light Pink" }

];


const palette =
  document.getElementById(
    "colorPalette"
  );


const colorInfo =
  document.getElementById(
    "colorInfo"
  );


const colorInfoText =
  document.getElementById(
    "colorInfoText"
  );


colors.forEach(
  (c, i) => {

    const div =
      document.createElement(
        "div"
      );


    div.className =
      "color";


    div.style.background =
      c.hex;


    div.dataset.color =
      c.hex;


    div.dataset.name =
      c.name;


    div.title =
      `${c.name} (${c.hex})`;


    if (i === 0) {

      div.classList.add(
        "selected"
      );


      setCurrentColor(
        c.hex
      );


      updateColorInfo(
        c.hex,
        c.name
      );

    }


    palette.appendChild(
      div
    );

  }
);


// Prevent the actual fill color
// from being absolute pure black.
function setCurrentColor(hex) {

  const val =
    hex.startsWith("#")
      ? hex.slice(1)
      : hex;


  if (
    /^0{6}$/i.test(val)
  ) {

    currentColor =
      "#111111";

  }

  else {

    currentColor =
      "#" +
      val.toUpperCase();

  }

}


// Choose black or white text depending
// on the selected background color.
function getContrastTextColor(hex) {

  if (!hex) {
    return "#111111";
  }


  const v =
    hex.replace(
      "#",
      ""
    );


  if (
    v.length !== 6
  ) {

    return "#111111";

  }


  const r =
    parseInt(
      v.slice(0, 2),
      16
    );


  const g =
    parseInt(
      v.slice(2, 4),
      16
    );


  const b =
    parseInt(
      v.slice(4, 6),
      16
    );


  const luminance =
    0.299 * r +
    0.587 * g +
    0.114 * b;


  return luminance > 160
    ? "#111111"
    : "#FFFFFF";

}


// Update currently selected color display
function updateColorInfo(
  hex,
  name
) {

  if (
    !colorInfo ||
    !colorInfoText
  ) {

    return;

  }


  if (
    !hex ||
    !name
  ) {

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
    getContrastTextColor(
      hex
    );


  colorInfoText.textContent =
    `Chosen color: ${name}`;

}


// Select one of the 24 standard colors
document
  .querySelectorAll(".color")
  .forEach(
    el => {

      el.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".color"
            )
            .forEach(
              c =>
                c.classList.remove(
                  "selected"
                )
            );


          el.classList.add(
            "selected"
          );


          const hex =
            el.dataset.color;


          const name =
            el.dataset.name || "";


          setCurrentColor(
            hex
          );


          updateColorInfo(
            hex,
            name
          );


          if (
            mode === "text" &&
            currentTextBox
          ) {

            const content =
              currentTextBox
                .querySelector(
                  ".text-content"
                );


            if (content) {

              content.style.color =
                currentColor;

            }

          }

        }
      );

    }
  );


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


function updateCustomColorPreview(
  hex
) {

  if (
    customColorPreview
  ) {

    customColorPreview.style.background =
      hex;

  }


  if (
    customColorButtonSwatch
  ) {

    customColorButtonSwatch.style.background =
      hex;

  }


  if (
    customColorInput
  ) {

    customColorInput.value =
      hex;

  }

}


function applyExtendedColor(
  hex
) {

  if (!hex) return;


  document
    .querySelectorAll(
      ".color"
    )
    .forEach(
      c =>
        c.classList.remove(
          "selected"
        )
    );


  document
    .querySelectorAll(
      ".extended-color-swatch"
    )
    .forEach(
      c =>
        c.classList.remove(
          "selected"
        )
    );


  setCurrentColor(
    hex
  );


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


  if (
    matchedSwatch
  ) {

    matchedSwatch.classList.add(
      "selected"
    );

  }


  if (
    mode === "text" &&
    currentTextBox
  ) {

    const content =
      currentTextBox
        .querySelector(
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
  ) {

    return;

  }


  customColorPanel.hidden =
    !open;


  customColorBtn.setAttribute(
    "aria-expanded",
    open ? "true" : "false"
  );

}


// Build extended color swatches
if (customColorGrid) {

  extendedColors.forEach(
    hex => {

      const btn =
        document.createElement(          "button"
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


      if (
        hex.toUpperCase() ===
        currentColor.toUpperCase()
      ) {

        btn.classList.add(
          "selected"
        );

      }


      btn.addEventListener(
        "click",
        () => {

          applyExtendedColor(
            hex
          );


          document
            .querySelectorAll(
              ".extended-color-swatch"
            )
            .forEach(
              swatch =>
                swatch.classList.remove(
                  "selected"
                )
            );


          btn.classList.add(
            "selected"
          );

        }
      );


      customColorGrid.appendChild(
        btn
      );

    }
  );

}


// ======================================================
// CUSTOM COLOR BUTTON / PANEL EVENTS
// ======================================================

if (
  customColorBtn &&
  customColorPanel
) {

  customColorBtn.addEventListener(
    "click",
    e => {

      e.stopPropagation();

      const isOpen =
        !customColorPanel.hidden;

      setCustomColorPanel(
        !isOpen
      );

    }
  );

}


if (customColorPanel) {

  customColorPanel.addEventListener(
    "click",
    e => {

      e.stopPropagation();

    }
  );

}


if (customColorInput) {

  customColorInput.addEventListener(
    "input",
    function () {

      const hex =
        this.value;

      updateCustomColorPreview(
        hex
      );

    }
  );


  customColorInput.addEventListener(
    "change",
    function () {

      const hex =
        this.value;

      applyExtendedColor(
        hex
      );

    }
  );

}


// Close custom color panel
// when clicking outside
document.addEventListener(
  "click",
  e => {

    if (
      !customColorPanel ||
      customColorPanel.hidden
    ) {

      return;

    }


    const picker =
      customColorBtn
        ? customColorBtn.closest(
            ".custom-color-picker"
          )
        : null;


    if (
      picker &&
      !picker.contains(
        e.target
      )
    ) {

      setCustomColorPanel(
        false
      );

    }

  }
);


// ESC closes the custom color panel
document.addEventListener(
  "keydown",
  e => {

    if (
      e.key === "Escape" &&
      customColorPanel &&
      !customColorPanel.hidden
    ) {

      setCustomColorPanel(
        false
      );

    }

  }
);


// ======================================================
// DRAWING MODE
// ======================================================

function updateModeButtons(
  newMode
) {

  mode =
    newMode;


  document
    .querySelectorAll(
      ".mode-btn"
    )
    .forEach(
      btn => {

        btn.classList.remove(
          "active"
        );

      }
    );


  const fillBtn =
    document.getElementById(
      "fillModeBtn"
    );


  const brushBtn =
    document.getElementById(
      "brushModeBtn"
    );


  const eraserBtn =
    document.getElementById(
      "eraserModeBtn"
    );


  const textBtn =
    document.getElementById(
      "textModeBtn"
    );


  if (
    mode === "fill" &&
    fillBtn
  ) {

    fillBtn.classList.add(
      "active"
    );

  }


  else if (
    mode === "brush" &&
    brushBtn
  ) {

    brushBtn.classList.add(
      "active"
    );

  }


  else if (
    mode === "eraser" &&
    eraserBtn
  ) {

    eraserBtn.classList.add(
      "active"
    );

  }


  else if (
    mode === "text" &&
    textBtn
  ) {

    textBtn.classList.add(
      "active"
    );

  }


  /*
  Update the desktop mouse cursor whenever
  the active drawing tool changes.
  */
  updateCanvasCursorMode();


  /*
  Keep Brush / Eraser preview size synchronized.
  */
  updateToolCursorSize();

}


// ======================================================
// MODE BUTTON EVENTS
// ======================================================

const fillModeBtn =
  document.getElementById(
    "fillModeBtn"
  );


if (fillModeBtn) {

  fillModeBtn.addEventListener(
    "click",
    () => {

      updateModeButtons(
        "fill"
      );

    }
  );

}


const textModeBtn =
  document.getElementById(
    "textModeBtn"
  );


if (textModeBtn) {

  textModeBtn.addEventListener(
    "click",
    () => {

      updateModeButtons(
        "text"
      );


      addTextBoxCentered();

    }
  );

}


const brushModeBtn =
  document.getElementById(
    "brushModeBtn"
  );


if (brushModeBtn) {

  brushModeBtn.addEventListener(
    "click",
    () => {

      updateModeButtons(
        "brush"
      );

    }
  );

}


const eraserModeBtn =
  document.getElementById(
    "eraserModeBtn"
  );


if (eraserModeBtn) {

  eraserModeBtn.addEventListener(
    "click",
    () => {

      updateModeButtons(
        "eraser"
      );

    }
  );

}


// ======================================================
// BRUSH SIZE
// ======================================================

const brushSizeSelect =
  document.getElementById(
    "brushSizeSelect"
  );


if (brushSizeSelect) {

  brushSizeSelect.addEventListener(
    "change",
    function () {

      brushSize =
        parseFloat(
          this.value
        );


      /*
      Update Brush / Eraser preview
      immediately when size changes.
      */
      updateToolCursorSize();

    }
  );

}


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


      if (
        !selectedImage
      ) {

        return;

      }


      const localImg =
        new Image();


      localImg.onload =
        () => {

          loadImageToMainCanvas(
            localImg
          );


          undoStack =
            [];


          redoStack =
            [];


          originalImageName =
            selectedImage
              .split("/")
              .pop();


          updateSelectStyle();


          const kiteLabel =
            document.getElementById(
              "kite-label-input"
            );


          if (
            kiteLabel
          ) {

            kiteLabel.style.display =
              "block";

          }


          /*
          Canvas size may have changed.
          Recalculate cursor preview size.
          */
          updateToolCursorSize();

        };


      localImg.src =
        selectedImage;


      const up =
        document.getElementById(
          "uploadInput"
        );


      if (
        up
      ) {

        up.value =
          "";

      }

    }
  );

}


// ======================================================
// UPLOAD IMAGE
// ======================================================

const uploadInput =
  document.getElementById(
    "uploadInput"
  );


if (uploadInput) {

  uploadInput.addEventListener(
    "change",
    function (e) {

      const file =
        e.target.files[0];


      if (
        !file
      ) {

        return;

      }


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


              undoStack =
                [];


              redoStack =
                [];


              originalImageName =
                file.name;


              if (
                imageSelect
              ) {

                imageSelect.selectedIndex =
                  0;

              }


              updateSelectStyle();


              /*
              Canvas display ratio may have changed.
              Recalculate Brush / Eraser cursor.
              */
              updateToolCursorSize();

            };


          upImg.src =
            event.target.result;

        };


      reader.readAsDataURL(
        file
      );

    }
  );

}


// ======================================================
// COORDINATE HELPERS
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


  return {

    x:
      Math.floor(
        (
          e.clientX -
          rect.left
        ) *
        scaleX
      ),

    y:
      Math.floor(
        (
          e.clientY -
          rect.top
        ) *
        scaleY
      )

  };

}


// ======================================================
// HEX COLOR → RGBA
// ======================================================

function hexToRgba(hex) {

  const bigint =
    parseInt(
      hex.slice(1),
      16
    );


  return [

    (
      bigint >> 16
    ) & 255,

    (
      bigint >> 8
    ) & 255,

    bigint & 255,

    255

  ];

}


// ======================================================
// LINE MASK CHECK
// ======================================================

function isLinePixel(
  x,
  y,
  w,
  h
) {

  if (
    !lineMask
  ) {

    return false;

  }


  if (
    x < 0 ||
    y < 0 ||
    x >= w ||
    y >= h
  ) {

    return false;

  }


  return (
    lineMask[
      y * w + x
    ] === 1
  );

}


// ======================================================
// FLOOD FILL — LINE ART
// ======================================================

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
  ) {

    return;

  }


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

  catch (err) {

    console.error(
      err
    );


    alert(
      "Unable to fill color because pixel data cannot be read. Please use an image from the same domain or upload the image directly."
    );


    return;

  }


  const data =
    imageData.data;


  /*
  Do not fill when clicking
  directly on a protected line.
  */
  if (
    isLinePixel(
      x,
      y,
      w,
      h
    )
  ) {

    return;

  }


  const idx0 =
    (
      y * w +
      x
    ) * 4;


  const startR =
    data[idx0];


  const startG =
    data[
      idx0 + 1
    ];


  const startB =
    data[
      idx0 + 2
    ];


  const tolerance =
    fillTolerance;


  const visited =
    new Uint8Array(
      w * h
    );


  const stack =
    [
      [
        x,
        y
      ]
    ];


  const match =
    (
      cx,
      cy,
      i
    ) => {

      /*
      Protect the line mask.
      */
      if (
        isLinePixel(
          cx,
          cy,
          w,
          h
        )
      ) {

        return false;

      }


      const r =
        data[i];


      const g =
        data[
          i + 1
        ];


      const b =
        data[
          i + 2
        ];


      return (

        Math.abs(
          r -
          startR
        ) <= tolerance &&

        Math.abs(
          g -
          startG
        ) <= tolerance &&

        Math.abs(
          b -
          startB
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
    ) {

      continue;

    }


    const i =
      (
        cy * w +
        cx
      ) * 4;
	      const vi =
      cy * w +
      cx;


    if (
      visited[vi]
    ) {

      continue;

    }


    visited[vi] =
      1;


    if (
      !match(
        cx,
        cy,
        i
      )
    ) {

      continue;

    }


    data[i] =
      fillColor[0];


    data[
      i + 1
    ] =
      fillColor[1];


    data[
      i + 2
    ] =
      fillColor[2];


    data[
      i + 3
    ] =
      255;


    stack.push(
      [
        cx - 1,
        cy
      ],
      [
        cx + 1,
        cy
      ],
      [
        cx,
        cy - 1
      ],
      [
        cx,
        cy + 1
      ]
    );

  }


  ctx.putImageData(
    imageData,
    0,
    0
  );

}


// ======================================================
// RECOLOR WITH EDGE GUARD
// ======================================================

function floodFillWithEdgeGuard(
  x,
  y,
  newColor,
  tolerance = 48,
  edgeStop = 22,
  preserveLightness = true
) {

  const w =
    canvas.width;

  const h =
    canvas.height;


  let id;


  try {

    id =
      ctx.getImageData(
        0,
        0,
        w,
        h
      );

  }

  catch {

    alert(
      "Unable to apply color because of CORS restrictions. Please use an image from the same domain or upload a local file."
    );

    return;

  }


  const d =
    id.data;


  const seed =
    (
      y * w + x
    ) * 4;


  const sR =
    d[seed];

  const sG =
    d[seed + 1];

  const sB =
    d[seed + 2];


  const Y =
    new Float32Array(
      w * h
    );


  for (
    let p = 0,
        i = 0;
    p < w * h;
    p++,
    i += 4
  ) {

    Y[p] =
      0.299 * d[i] +
      0.587 * d[i + 1] +
      0.114 * d[i + 2];

  }


  const sobelMag =
    (
      cx,
      cy
    ) => {

      if (
        cx <= 0 ||
        cy <= 0 ||
        cx >= w - 1 ||
        cy >= h - 1
      ) {

        return 999;

      }


      const i =
        cy * w + cx;


      const gx =
        -Y[i - w - 1]
        -2 * Y[i - 1]
        -Y[i + w - 1]
        +Y[i - w + 1]
        +2 * Y[i + 1]
        +Y[i + w + 1];


      const gy =
        -Y[i - w - 1]
        -2 * Y[i - w]
        -Y[i - w + 1]
        +Y[i + w - 1]
        +2 * Y[i + w]
        +Y[i + w + 1];


      return (
        Math.hypot(
          gx,
          gy
        ) / 4
      );

    };


  const visited =
    new Uint8Array(
      w * h
    );


  const stack = [
    [x, y]
  ];


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
    ) {

      continue;

    }


    const pi =
      cy * w + cx;


    if (
      visited[pi]
    ) {

      continue;

    }


    visited[pi] =
      1;


    if (
      sobelMag(
        cx,
        cy
      ) > edgeStop
    ) {

      continue;

    }


    const i4 =
      pi * 4;


    const r =
      d[i4];

    const g =
      d[i4 + 1];

    const b =
      d[i4 + 2];


    if (
      Math.abs(r - sR) > tolerance ||
      Math.abs(g - sG) > tolerance ||
      Math.abs(b - sB) > tolerance
    ) {

      continue;

    }


    if (
      preserveLightness
    ) {

      const out =
        recolorPreserveLightness(
          [r, g, b],
          newColor
        );


      d[i4] =
        out[0];

      d[i4 + 1] =
        out[1];

      d[i4 + 2] =
        out[2];

      d[i4 + 3] =
        255;

    }

    else {

      d[i4] =
        newColor[0];

      d[i4 + 1] =
        newColor[1];

      d[i4 + 2] =
        newColor[2];

      d[i4 + 3] =
        255;

    }


    stack.push(
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1]
    );

  }


  ctx.putImageData(
    id,
    0,
    0
  );

}


// ======================================================
// HSV HELPERS
// ======================================================

function rgb2hsv(
  r,
  g,
  b
) {

  r /= 255;
  g /= 255;
  b /= 255;


  const max =
    Math.max(
      r,
      g,
      b
    );


  const min =
    Math.min(
      r,
      g,
      b
    );


  const d =
    max - min;


  let h =
    0;


  if (
    d !== 0
  ) {

    if (
      max === r
    ) {

      h =
        (
          (g - b) /
          d
        ) % 6;

    }

    else if (
      max === g
    ) {

      h =
        (
          (b - r) /
          d
        ) + 2;

    }

    else {

      h =
        (
          (r - g) /
          d
        ) + 4;

    }


    h *= 60;


    if (
      h < 0
    ) {

      h += 360;

    }

  }


  const s =
    max === 0
      ? 0
      : d / max;


  const v =
    max;


  return [
    h,
    s,
    v
  ];

}


function hsv2rgb(
  h,
  s,
  v
) {

  const c =
    v * s;


  const x =
    c *
    (
      1 -
      Math.abs(
        (
          h / 60
        ) % 2 - 1
      )
    );


  const m =
    v - c;


  let r = 0;
  let g = 0;
  let b = 0;


  if (
    0 <= h &&
    h < 60
  ) {

    r = c;
    g = x;
    b = 0;

  }

  else if (
    60 <= h &&
    h < 120
  ) {

    r = x;
    g = c;
    b = 0;

  }

  else if (
    120 <= h &&
    h < 180
  ) {

    r = 0;
    g = c;
    b = x;

  }

  else if (
    180 <= h &&
    h < 240
  ) {

    r = 0;
    g = x;
    b = c;

  }

  else if (
    240 <= h &&
    h < 300
  ) {

    r = x;
    g = 0;
    b = c;

  }

  else {

    r = c;
    g = 0;
    b = x;

  }


  return [

    (r + m) * 255,

    (g + m) * 255,

    (b + m) * 255

  ];

}


function recolorPreserveLightness(
  srcRGB,
  targetRGB
) {

  const [
    sr,
    sg,
    sb
  ] =
    srcRGB;


  const [
    tr,
    tg,
    tb
  ] =
    targetRGB;


  const [
    hT,
    sT
  ] =
    (
      function () {

        const [
          h,
          s
        ] =
          rgb2hsv(
            tr,
            tg,
            tb
          );


        return [
          h,
          Math.max(
            0.05,
            s
          )
        ];

      }
    )();


  const vS =
    rgb2hsv(
      sr,
      sg,
      sb
    )[2];


  const [
    r,
    g,
    b
  ] =
    hsv2rgb(
      hT,
      sT,
      vS
    );


  return [
    r | 0,
    g | 0,
    b | 0
  ];

}


// ======================================================
// BRUSH / ERASER PIXEL PAINTING
// ======================================================
// BRUSH / ERASER PIXEL PAINTING
// ======================================================

function paintCircleOnMain(
  x,
  y,
  radius,
  rgba,
  isErase = false
) {

  const w =
    canvas.width;

  const h =
    canvas.height;


  const x0 =
    Math.max(
      0,
      Math.floor(
        x - radius
      )
    );


  const x1 =
    Math.min(
      w - 1,
      Math.ceil(
        x + radius
      )
    );


  const y0 =
    Math.max(
      0,
      Math.floor(
        y - radius
      )
    );


  const y1 =
    Math.min(
      h - 1,
      Math.ceil(
        y + radius
      )
    );


  let imageData;


  try {

    imageData =
      ctx.getImageData(
        x0,
        y0,
        x1 - x0 + 1,
        y1 - y0 + 1
      );

  }

  catch (err) {

    console.error(err);

    alert(
      "Unable to draw because the image pixels cannot be read (CORS). Please use an image from the same domain or enable CORS/crossOrigin='anonymous'."
    );

    return;

  }


  const d =
    imageData.data;


  const rr =
    radius * radius;


  for (
    let yy = y0;
    yy <= y1;
    yy++
  ) {

    for (
      let xx = x0;
      xx <= x1;
      xx++
    ) {

      const dx =
        xx - x;

      const dy =
        yy - y;


      if (
        dx * dx +
        dy * dy >
        rr
      ) {

        continue;

      }


      if (
        isLinePixel(
          xx,
          yy,
          w,
          h
        )
      ) {

        continue;

      }


      const i =
        (
          (
            yy - y0
          ) *
          (
            x1 - x0 + 1
          )
          +
          (
            xx - x0
          )
        ) * 4;


      if (
        isErase
      ) {

        d[i] =
          255;

        d[i + 1] =
          255;

        d[i + 2] =
          255;

        d[i + 3] =
          255;

      }

      else {

        d[i] =
          rgba[0];

        d[i + 1] =
          rgba[1];

        d[i + 2] =
          rgba[2];

        d[i + 3] =
          255;

      }

    }

  }


  ctx.putImageData(
    imageData,
    x0,
    y0
  );

}


// ======================================================
// UNDO / REDO
// ======================================================

function saveState() {

  ensureInitialized();


  if (
    canvas.width === 0 ||
    canvas.height === 0
  ) {

    return;

  }


  try {

    undoStack.push(
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      )
    );


    redoStack =
      [];

  }

  catch (e) {

    console.warn(
      "saveState failed:",
      e
    );

  }

}


document
  .getElementById(
    "undoBtn"
  )
  .addEventListener(
    "click",
    () => {

      if (
        undoStack.length > 0
      ) {

        try {

          const current =
            ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );


          redoStack.push(
            current
          );


          const prev =
            undoStack.pop();


          ctx.putImageData(
            prev,
            0,
            0
          );

        }

        catch (e) {

          console.warn(
            "undo failed:",
            e
          );

        }

      }

    }
  );


document
  .getElementById(
    "redoBtn"
  )
  .addEventListener(
    "click",
    () => {

      if (
        redoStack.length > 0
      ) {

        try {

          const current =
            ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );


          undoStack.push(
            current
          );
		            const next =
            redoStack.pop();


          ctx.putImageData(
            next,
            0,
            0
          );

        }

        catch (e) {

          console.warn(
            "redo failed:",
            e
          );

        }

      }

    }
  );


// ======================================================
// SAVE IMAGE HELPERS
// ======================================================

function isIOSDevice() {

  const ua =
    navigator.userAgent ||
    navigator.vendor ||
    window.opera ||
    "";


  const iOSUA =
    /iPad|iPhone|iPod/i
      .test(ua);


  const iPadOS13Plus =
    (
      navigator.platform ===
      "MacIntel"
      &&
      navigator.maxTouchPoints > 1
    );


  return (
    iOSUA ||
    iPadOS13Plus
  );

}


function saveCanvasPNG(
  tempCanvas,
  filename
) {

  const dataURL =
    tempCanvas.toDataURL(
      "image/png"
    );


  if (
    tempCanvas.toBlob
  ) {

    tempCanvas.toBlob(
      blob => {

        if (
          !blob
        ) {

          const a =
            document.createElement(
              "a"
            );


          a.href =
            dataURL;


          a.download =
            filename ||
            "colored-image.png";


          a.rel =
            "noreferrer noopener";


          document.body.appendChild(
            a
          );


          a.click();


          a.remove();


          return;

        }


        const url =
          URL.createObjectURL(
            blob
          );


        const a =
          document.createElement(
            "a"
          );


        a.href =
          url;


        a.download =
          filename ||
          "colored-image.png";


        a.rel =
          "noreferrer noopener";


        document.body.appendChild(
          a
        );


        a.click();


        a.remove();


        URL.revokeObjectURL(
          url
        );

      },
      "image/png"
    );

  }

  else {

    const a =
      document.createElement(
        "a"
      );


    a.href =
      dataURL;


    a.download =
      filename ||
      "colored-image.png";


    a.rel =
      "noreferrer noopener";


    document.body.appendChild(
      a
    );


    a.click();


    a.remove();

  }

}


function showToast(msg) {

  try {

    const t =
      document.createElement(
        "div"
      );


    t.textContent =
      msg;


    t.style.cssText =
      "position:fixed;" +
      "left:50%;" +
      "bottom:24px;" +
      "transform:translateX(-50%);" +
      "background:rgba(0,0,0,.85);" +
      "color:#fff;" +
      "padding:8px 12px;" +
      "border-radius:10px;" +
      "font-size:14px;" +
      "z-index:9999";


    document.body.appendChild(
      t
    );


    setTimeout(
      () => {
        t.remove();
      },
      1800
    );

  }

  catch {}

}


function openInlineViewer(
  dataURL
) {

  const wrap =
    document.createElement(
      "div"
    );


  wrap.style.cssText =
    "position:fixed;" +
    "inset:0;" +
    "background:rgba(0,0,0,.85);" +
    "display:flex;" +
    "align-items:center;" +
    "justify-content:center;" +
    "z-index:99999;" +
    "padding:16px;";


  wrap.innerHTML = `
    <div style="
      max-width:100%;
      max-height:100%;
      text-align:center
    ">

      <p style="
        color:#fff;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        margin:0 0 8px;
      ">
        Press and hold the image to save it
      </p>

      <img
        src="${dataURL}"
        style="
          max-width:100%;
          max-height:calc(100vh - 80px);
          display:block;
          margin:0 auto;
          border-radius:8px
        "
      />

      <button style="
        margin-top:10px;
        padding:8px 12px;
        border-radius:8px;
        border:0;
        background:#fff;
        cursor:pointer
      ">
        Close
      </button>

    </div>
  `;


  wrap
    .querySelector("button")
    .onclick =
      () => wrap.remove();


  document.body.appendChild(
    wrap
  );

}


// ======================================================
// DOWNLOAD IMAGE
// ======================================================

document
  .getElementById(
    "downloadBtn"
  )
  .addEventListener(
    "click",
    evt => {

      evt.preventDefault();


      const isIOS =
        isIOSDevice();


      let iosWin =
        null;


      if (
        isIOS
      ) {

        iosWin =
          window.open(
            "about:blank",
            "_blank"
          );


        if (
          iosWin &&
          !iosWin.closed
        ) {

          iosWin.document.write(
            `
            <meta
              name="viewport"
              content="width=device-width,initial-scale=1"
            />

            <div style="
              font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
              text-align:center;
              padding:16px;
              color:#444
            ">
              Preparing image...
            </div>
            `
          );


          iosWin.document.close();

        }

      }

      const logo =
        new Image();


      logo.crossOrigin =
        "anonymous";


      const logoCandidates = [

        "images/html/logo.webp",

        "images/html/logo.png",

        "images/logo.webp"

      ];


      let logoTry =
        0;


      let logoReady =
        false;


      const logoDone =
        new Promise(
          resolve => {

            logo.onload =
              () => {

                logoReady =
                  true;

                resolve();

              };


            logo.onerror =
              () => {

                if (
                  ++logoTry <
                  logoCandidates.length
                ) {

                  logo.src =
                    logoCandidates[
                      logoTry
                    ];

                }

                else {

                  logoReady =
                    false;

                  resolve();

                }

              };

          }
        );


      logo.src =
        logoCandidates[0];


      const fontsReady =
        (
          document.fonts &&
          document.fonts.ready
        )
        ?
        document.fonts.ready
        :
        Promise.resolve();


      Promise
        .all([
          logoDone,
          fontsReady
        ])
        .then(
          () => {

            const tempCanvas =
              document.createElement(
                "canvas"
              );


            const tempCtx =
              tempCanvas.getContext(
                "2d"
              );


            tempCanvas.width =
              canvas.width;


            tempCanvas.height =
              canvas.height;


            // Draw the main image
            tempCtx.drawImage(
              canvas,
              0,
              0
            );


            // Draw text boxes
            document
              .querySelectorAll(
                ".text-box"
              )
              .forEach(
                box => {

                  const content =
                    box.querySelector(
                      ".text-content"
                    );


                  const text =
                    content?.innerText ??
                    "";


                  if (
                    !text.trim()
                  ) {

                    return;

                  }


                  const canvasRect =
                    canvas.getBoundingClientRect();


                  const boxRect =
                    box.getBoundingClientRect();


                  const scaleX =
                    canvas.width /
                    canvasRect.width;


                  const scaleY =
                    canvas.height /
                    canvasRect.height;


                  const centerX =
                    (
                      boxRect.left +
                      boxRect.width / 2 -
                      canvasRect.left
                    ) *
                    scaleX;


                  const centerY =
                    (
                      boxRect.top +
                      boxRect.height / 2 -
                      canvasRect.top
                    ) *
                    scaleY;


                  const cs =
                    getComputedStyle(
                      content
                    );


                  const fontSize =
                    Math.max(
                      1,
                      parseFloat(
                        cs.fontSize
                      ) *
                      scaleY
                    );


                  const fontFamily =
                    cs.fontFamily ||
                    "Inter, sans-serif";


                  const fontWeight =
                    cs.fontWeight ||
                    "normal";


                  const textColor =
                    cs.color ||
                    "#000";


                  const rotation =
                    parseFloat(
                      box.dataset.rotation ||
                      "0"
                    );


                  const scaleBoxX =
                    parseFloat(
                      box.dataset.scaleX ||
                      "1"
                    );


                  const scaleBoxY =
                    parseFloat(
                      box.dataset.scaleY ||
                      "1"
                    );


                  tempCtx.save();


                  tempCtx.translate(
                    centerX,
                    centerY
                  );


                  tempCtx.rotate(
                    rotation *
                    Math.PI /
                    180
                  );


                  tempCtx.scale(
                    scaleBoxX,
                    scaleBoxY
                  );


                  tempCtx.font =
                    `${fontWeight} ${fontSize}px ${fontFamily}`;


                  tempCtx.fillStyle =
                    textColor;


                  tempCtx.textAlign =
                    "center";


                  tempCtx.textBaseline =
                    "middle";


                  tempCtx.fillText(
                    text,
                    0,
                    0
                  );


                  tempCtx.restore();

                }
              );


            // Draw logo
            if (
              logoReady
            ) {

              const desiredH =
                Math.max(
                  24,
                  Math.round(
                    tempCanvas.height *
                    0.035
                  )
                );


              const s =
                desiredH /
                logo.height;


              const lw =
                Math.round(
                  logo.width * s
                );


              const lh =
                Math.round(
                  logo.height * s
                );


              const pad =
                Math.max(
                  8,
                  Math.round(
                    tempCanvas.width *
                    0.01
                  )
                );


              const x =
                tempCanvas.width -
                lw -
                pad;


              const y =
                tempCanvas.height -
                lh -
                pad;


              try {

                tempCtx.drawImage(
                  logo,
                  x,
                  y,
                  lw,
                  lh
                );

              }

              catch {}

            }


            const filename =
              (
                originalImageName ||
                "colored-image.png"
              )
              .replace(
                /\.[a-z0-9]+$/i,
                ".png"
              );


            const dataURL =
              tempCanvas.toDataURL(
                "image/png"
              );


            if (
              isIOS
            ) {

              if (
                iosWin &&
                !iosWin.closed
              ) {

                try {

                  iosWin.document.open();


                  iosWin.document.write(
                    `
                    <meta
                      name="viewport"
                      content="width=device-width,initial-scale=1"
                    />

                    <p style="
                      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
                      text-align:center;
                      margin:8px 0
                    ">
                      Press and hold the image to save it
                    </p>

                    <img
                      src="${dataURL}"
                      style="
                        max-width:100%;
                        height:auto;
                        display:block;
                        margin:8px auto;
                      "
                    />
                    `
                  );


                  iosWin.document.close();

                }

                catch {

                  openInlineViewer(
                    dataURL
                  );

                }

              }

              else {

                openInlineViewer(
                  dataURL
                );

              }

            }

            else {

              saveCanvasPNG(
                tempCanvas,
                filename
              );

            }

          }
        );

    }
  );


// ======================================================
// TEXT BOX
// ======================================================

function addTextBoxCentered() {

  if (!canvas) {
    return;
  }


  const rect =
    canvas.getBoundingClientRect();


  const container =
    document.querySelector(
      ".canvas-wrapper"
    );


  const box =
    document.createElement(
      "div"
    );


  box.className =
    "text-box";


  box.style.left =
    `${
      (
        rect.width / 2
      ) - 100
    }px`;


  box.style.top =
    `${
      (
        rect.height / 2
      ) - 20
    }px`;


  const content =
    document.createElement(
      "div"
    );


  content.className =
    "text-content";


  content.contentEditable =
    "true";


  content.spellcheck =
    false;


  content.style.minWidth =
    "1ch";


  content.style.width =
    "100%";


  box.appendChild(
    content
  );


  container.appendChild(
    box
  );


  content.focus();


  content.style.color =
    currentColor;


  makeTextBoxDraggable(
    box
  );


  enableResize(
    box
  );


  enableRotate(
    box
  );


  currentTextBox =
    box;


  box.addEventListener(
    "click",
    () => {

      currentTextBox =
        box;


      if (
        mode === "text" &&
        currentTextBox
      ) {

        const content =
          currentTextBox.querySelector(
            ".text-content"
          );


        if (
          content
        ) {

          content.style.color =
            currentColor;

        }

      }

    }
  );


  content.addEventListener(
    "keydown",
    e => {

      if (
        e.key === "Enter"
      ) {

        e.preventDefault();
		      }

    }
  );

}


// ======================================================
// TEXT BOX DRAG
// ======================================================

function makeTextBoxDraggable(
  box
) {

  let isDragging =
    false;


  let hasMoved =
    false;


  let offsetX =
    0;


  let offsetY =
    0;


  // Desktop
  box.addEventListener(
    "mousedown",
    e => {

      if (
        e.target !== box
      ) {

        return;

      }


      isDragging =
        true;


      hasMoved =
        false;


      offsetX =
        e.offsetX;


      offsetY =
        e.offsetY;


      e.preventDefault();

    }
  );


  // Mobile
  box.addEventListener(
    "touchstart",
    e => {

      if (
        e.target !== box
      ) {

        return;

      }


      isDragging =
        true;


      hasMoved =
        false;


      const touch =
        e.touches[0];

      const rect =
        box.getBoundingClientRect();


      offsetX =
        touch.clientX -
        rect.left;


      offsetY =
        touch.clientY -
        rect.top;


      e.preventDefault();

    },
    {
      passive: false
    }
  );


  function handleMove(
    clientX,
    clientY
  ) {

    const wrapperRect =
      document
        .querySelector(
          ".canvas-wrapper"
        )
        .getBoundingClientRect();


    box.style.left =
      `${
        clientX -
        wrapperRect.left -
        offsetX
      }px`;


    box.style.top =
      `${
        clientY -
        wrapperRect.top -
        offsetY
      }px`;

  }


  document.addEventListener(
    "mousemove",
    e => {

      if (
        !isDragging
      ) {

        return;

      }


      hasMoved =
        true;


      handleMove(
        e.clientX,
        e.clientY
      );

    }
  );


  document.addEventListener(
    "touchmove",
    e => {

      if (
        !isDragging
      ) {

        return;

      }


      hasMoved =
        true;


      const touch =
        e.touches[0];


      handleMove(
        touch.clientX,
        touch.clientY
      );


      e.preventDefault();

    },
    {
      passive: false
    }
  );


  document.addEventListener(
    "mouseup",
    () => {

      if (
        isDragging &&
        !hasMoved
      ) {

        box.focus();

      }


      isDragging =
        false;

    }
  );


  document.addEventListener(
    "touchend",
    () => {

      if (
        isDragging &&
        !hasMoved
      ) {

        box.focus();

      }


      isDragging =
        false;

    }
  );

}


// ======================================================
// TEXT RESIZE
// ======================================================

function enableResize(
  textBox
) {

  const resizer =
    document.createElement(
      "div"
    );


  resizer.className =
    "resizer";


  textBox.appendChild(
    resizer
  );


  let isResizing =
    false;


  let startX;
  let startY;


  let startWidth;
  let startHeight;


  let startScaleX;
  let startScaleY;


  let rotation;


  textBox.style.transformOrigin =
    "center center";


  textBox.dataset.scaleX =
    textBox.dataset.scaleX ||
    "1";


  textBox.dataset.scaleY =
    textBox.dataset.scaleY ||
    "1";


  textBox.dataset.rotation =
    textBox.dataset.rotation ||
    "0";


  const onResizeStart =
    e => {

      e.preventDefault();


      isResizing =
        true;


      const clientX =
        e.clientX ||
        e.touches?.[0]?.clientX;


      const clientY =
        e.clientY ||
        e.touches?.[0]?.clientY;


      startX =
        clientX;


      startY =
        clientY;


      const rect =
        textBox.getBoundingClientRect();


      startWidth =
        rect.width;


      startHeight =
        rect.height;


      startScaleX =
        parseFloat(
          textBox.dataset.scaleX ||
          "1"
        );


      startScaleY =
        parseFloat(
          textBox.dataset.scaleY ||
          "1"
        );


      rotation =
        parseFloat(
          textBox.dataset.rotation ||
          "0"
        );

    };


  const onResizeMove =
    e => {

      if (
        !isResizing
      ) {

        return;

      }


      const clientX =
        e.clientX ||
        e.touches?.[0]?.clientX;


      const clientY =
        e.clientY ||
        e.touches?.[0]?.clientY;


      const dx =
        clientX -
        startX;


      const dy =
        clientY -
        startY;


      const angleRad =
        rotation *
        Math.PI /
        180;


      const deltaW =
        dx *
        Math.cos(
          angleRad
        )
        +
        dy *
        Math.sin(
          angleRad
        );


      const deltaH =
        dy *
        Math.cos(
          angleRad
        )
        -
        dx *
        Math.sin(
          angleRad
        );


      let scaleX =
        (
          startWidth +
          deltaW
        ) /
        startWidth *
        startScaleX;


      let scaleY =
        (
          startHeight +
          deltaH
        ) /
        startHeight *
        startScaleY;


      scaleX =
        Math.max(
          0.2,
          Math.min(
            scaleX,
            5
          )
        );


      scaleY =
        Math.max(
          0.2,
          Math.min(
            scaleY,
            5
          )
        );


      textBox.dataset.scaleX =
        scaleX.toFixed(
          3
        );


      textBox.dataset.scaleY =
        scaleY.toFixed(
          3
        );


      applyTransform(
        textBox
      );

    };


  const onResizeEnd =
    () => {

      isResizing =
        false;

    };


  resizer.addEventListener(
    "mousedown",
    onResizeStart
  );


  document.addEventListener(
    "mousemove",
    onResizeMove
  );


  document.addEventListener(
    "mouseup",
    onResizeEnd
  );


  resizer.addEventListener(
    "touchstart",
    onResizeStart,
    {
      passive: false
    }
  );


  document.addEventListener(
    "touchmove",
    onResizeMove,
    {
      passive: false
    }
  );


  document.addEventListener(
    "touchend",
    onResizeEnd
  );

}


function applyTransform(
  box
) {

  const angle =
    parseFloat(
      box.dataset.rotation ||
      "0"
    );


  const scaleX =
    parseFloat(
      box.dataset.scaleX ||
      "1"
    );


  const scaleY =
    parseFloat(
      box.dataset.scaleY ||
      "1"
    );


  box.style.transform =
    `rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;

}


// ======================================================
// TEXT ROTATE
// ======================================================

function enableRotate(
  textBox
) {

  const rotateHandle =
    document.createElement(
      "div"
    );


  rotateHandle.className =
    "rotate-handle";


  textBox.appendChild(
    rotateHandle
  );


  let isRotating =
    false;


  let centerX;
  let centerY;
  let startAngle;


  const getCenter =
    () => {

      const rect =
        textBox.getBoundingClientRect();


      return {

        x:
          rect.left +
          rect.width / 2,

        y:
          rect.top +
          rect.height / 2

      };

    };


  const getAngle =
    (
      cx,
      cy,
      x,
      y
    ) => {

      return (
        Math.atan2(
          y - cy,
          x - cx
        ) *
        (
          180 /
          Math.PI
        )
      );

    };


  const startRotate =
    (
      clientX,
      clientY
    ) => {

      isRotating =
        true;


      const center =
        getCenter();


      centerX =
        center.x;


      centerY =
        center.y;


      startAngle =
        getAngle(
          centerX,
          centerY,
          clientX,
          clientY
        )
        -
        parseFloat(
          textBox.dataset.rotation ||
          "0"
        );

    };


  const rotate =
    (
      clientX,
      clientY
    ) => {

      if (
        !isRotating
      ) {

        return;

      }


      const angle =
        getAngle(
          centerX,
          centerY,
          clientX,
          clientY
        )
        -
        startAngle;


      textBox.dataset.rotation =
        angle.toFixed(
          2
        );


      applyTransform(
        textBox
      );

    };


  const stopRotate =
    () => {

      isRotating =
        false;

    };


  rotateHandle.addEventListener(
    "mousedown",
    e => {

      e.stopPropagation();


      startRotate(
        e.clientX,
        e.clientY
      );

    }
  );


  document.addEventListener(
    "mousemove",
    e => {

      if (
        isRotating
      ) {

        rotate(
          e.clientX,
          e.clientY
        );

      }

    }
  );


  document.addEventListener(
    "mouseup",
    stopRotate
  );


  rotateHandle.addEventListener(
    "touchstart",
    e => {

      if (
        e.touches.length === 1
      ) {

        const touch =
          e.touches[0];


        startRotate(
          touch.clientX,
          touch.clientY
        );


        e.preventDefault();

      }

    },
    {
      passive: false
    }
  );


  document.addEventListener(
    "touchmove",
    e => {

      if (
        isRotating &&
        e.touches.length === 1
      ) {

        const touch =
          e.touches[0];


        rotate(
          touch.clientX,
          touch.clientY
        );


        e.preventDefault();

      }

    },
    {
      passive: false
    }
  );


  document.addEventListener(
    "touchend",
    stopRotate
  );

}


// ======================================================
// TEXT SELECTION / BOLD / DELETE
// ======================================================

function handleTextBoxSelection(
  e
) {

  const box =
    e.target.closest(
      ".text-box"
    );


  if (
    box
  ) {

    currentTextBox =
      box;


    const content =
      currentTextBox.querySelector(
        ".text-content"
      );


    if (
      content
    ) {

      content.style.color =
        currentColor;

    }

  }

}


document.addEventListener(
  "click",
  handleTextBoxSelection
);


document.addEventListener(
  "touchstart",
  handleTextBoxSelection,
  {
    passive: true
  }
);


document
  .getElementById(
    "boldBtn"
  )
  .addEventListener(
    "click",
    () => {

      if (
        currentTextBox
      ) {

        const content =
          currentTextBox.querySelector(
            ".text-content"
          );


        const isBold =
          content.style.fontWeight ===
          "bold";


        content.style.fontWeight =
          isBold
            ? "normal"
            : "bold";

      }

    }
  );


document
  .getElementById(
    "deleteTextBtn"
  )
  .addEventListener(
    "click",
    () => {

      if (
        currentTextBox
      ) {

        currentTextBox.remove();


        currentTextBox =
          null;

      }

    }
  );


// ======================================================
// IMAGE SELECT STYLE
// ======================================================

function updateSelectStyle() {

  const el =
    document.getElementById(
      "imageSelect"
    );


  if (
    !el
  ) {

    return;

  }


  const isPlaceholder =
    el.selectedIndex === 0;


  if (
    isPlaceholder
  ) {

    el.style.color =
      "#1565c0";


    el.style.fontWeight =
      "700";


    el.style.fontStyle =
      "italic";
	    }

  else {

    el.style.color =
      "#111";


    el.style.fontWeight =
      "400";


    el.style.fontStyle =
      "normal";

  }


  if (
    !isPlaceholder
  ) {

    el.classList.add(
      "selected-kite"
    );

  }

  else {

    el.classList.remove(
      "selected-kite"
    );

  }

}


function enhanceImageSelect() {

  const select =
    document.getElementById(
      "imageSelect"
    );


  if (
    !select ||
    select.dataset.enhanced
  ) {

    return;

  }


  select.dataset.enhanced =
    "1";


  const wrapper =
    document.createElement(
      "div"
    );


  wrapper.className =
    "fancy-select";


  select.parentNode.insertBefore(
    wrapper,
    select
  );


  wrapper.appendChild(
    select
  );


  select.classList.add(
    "fs-native"
  );


  const trigger =
    document.createElement(
      "button"
    );


  trigger.type =
    "button";


  trigger.className =
    "fs-trigger";


  trigger.setAttribute(
    "aria-haspopup",
    "listbox"
  );


  trigger.setAttribute(
    "aria-expanded",
    "false"
  );


  const label =
    document.createElement(
      "span"
    );


  label.className =
    "fs-label";


  trigger.appendChild(
    label
  );


  wrapper.appendChild(
    trigger
  );


  const panel =
    document.createElement(
      "div"
    );


  panel.className =
    "fs-panel";


  panel.setAttribute(
    "role",
    "listbox"
  );


  panel.setAttribute(
    "tabindex",
    "-1"
  );


  wrapper.appendChild(
    panel
  );


  const syncLabelStyle =
    () => {

      const isPlaceholder =
        select.selectedIndex ===
        0;


      if (
        isPlaceholder
      ) {

        trigger.style.color =
          "#fff";


        trigger.style.fontWeight =
          "700";


        trigger.style.fontStyle =
          "italic";


        trigger.style.background =
          "linear-gradient(135deg,#00c6ff,#0072ff)";


        trigger.style.borderColor =
          "transparent";

      }

      else {

        trigger.style.color =
          "#111";


        trigger.style.fontWeight =
          "400";


        trigger.style.fontStyle =
          "normal";


        trigger.style.background =
          "linear-gradient(135deg,#3a7bd5,#00d2ff)";


        trigger.style.borderColor =
          "#1976d2";

      }

    };


  const buildOptions =
    () => {

      panel.innerHTML =
        "";


      [
        ...select.options
      ]
        .forEach(
          (
            opt,
            idx
          ) => {

            const isPlaceholder =
              opt.disabled &&
              opt.hidden;


            if (
              isPlaceholder
            ) {

              return;

            }


            const item =
              document.createElement(
                "div"
              );


            item.className =
              "fs-option";


            item.textContent =
              opt.textContent;


            item.setAttribute(
              "role",
              "option"
            );


            if (
              idx ===
              select.selectedIndex
            ) {

              item.setAttribute(
                "aria-selected",
                "true"
              );

            }


            item.addEventListener(
              "click",
              () => {

                select.selectedIndex =
                  idx;


                select.dispatchEvent(
                  new Event(
                    "change",
                    {
                      bubbles: true
                    }
                  )
                );


                label.textContent =
                  opt.textContent;


                [
                  ...panel.children
                ]
                  .forEach(
                    c =>
                      c.removeAttribute(
                        "aria-selected"
                      )
                  );


                item.setAttribute(
                  "aria-selected",
                  "true"
                );


                close();

              }
            );


            panel.appendChild(
              item
            );

          }
        );


      label.textContent =
        select.options[
          select.selectedIndex
        ]?.textContent || "";


      syncLabelStyle();

    };


  const open =
    () => {

      panel.classList.add(
        "open"
      );


      trigger.classList.add(
        "open"
      );


      trigger.setAttribute(
        "aria-expanded",
        "true"
      );


      const sel =
        panel.querySelector(
          '.fs-option[aria-selected="true"]'
        )
        ||
        panel.firstChild;


      sel?.scrollIntoView({
        block: "nearest"
      });


      panel.focus();

    };


  const close =
    () => {

      panel.classList.remove(
        "open"
      );


      trigger.classList.remove(
        "open"
      );


      trigger.setAttribute(
        "aria-expanded",
        "false"
      );

    };


  trigger.addEventListener(
    "click",
    () => {

      panel.classList.contains(
        "open"
      )
        ? close()
        : open();

    }
  );


  document.addEventListener(
    "click",
    e => {

      if (
        !wrapper.contains(
          e.target
        )
      ) {

        close();

      }

    }
  );


  select.addEventListener(
    "change",
    buildOptions
  );


  trigger.addEventListener(
    "keydown",
    e => {

      if (
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === " "
      ) {

        e.preventDefault();

        open();

      }

    }
  );


  panel.addEventListener(
    "keydown",
    e => {

      const opts =
        [
          ...panel.querySelectorAll(
            ".fs-option"
          )
        ];


      let i =
        opts.findIndex(
          o =>
            o.getAttribute(
              "aria-selected"
            ) === "true"
        );


      if (
        e.key === "ArrowDown"
      ) {

        e.preventDefault();


        opts[
          Math.min(
            i + 1,
            opts.length - 1
          )
        ]?.click();

      }


      if (
        e.key === "ArrowUp"
      ) {

        e.preventDefault();


        opts[
          Math.max(
            i - 1,
            0
          )
        ]?.click();

      }


      if (
        e.key === "Escape"
      ) {

        e.preventDefault();


        close();


        trigger.focus();

      }

    }
  );


  buildOptions();

}


window.addEventListener(
  "DOMContentLoaded",
  updateSelectStyle
);


if (
  imageSelect
) {

  imageSelect.addEventListener(
    "change",
    () => {

      imageSelect.classList.add(
        "pop"
      );


      setTimeout(
        () =>
          imageSelect.classList.remove(
            "pop"
          ),
        200
      );

    }
  );

}


// ======================================================
// INITIALIZATION
// ======================================================

window.addEventListener(
  "DOMContentLoaded",
  () => {

    ensureInitialized();


    // Create the Brush / Eraser cursor preview.
    createToolCursorPreview();


    // Apply the initial Fill cursor.
    updateCanvasCursorMode();


    // Prepare initial preview size.
    updateToolCursorSize();


    const params =
      new URLSearchParams(
        window.location.search
      );


    const imageUrl =
      params.get(
        "img"
      );


    if (
      imageUrl
    ) {

      const imgFromUrl =
        new Image();


      imgFromUrl.crossOrigin =
        "anonymous";


      imgFromUrl.onload =
        () => {

          loadImageToMainCanvas(
            imgFromUrl
          );


          undoStack =
            [];


          redoStack =
            [];


          originalImageName =
            imageUrl
              .split("/")
              .pop();


          updateToolCursorSize();

        };


      imgFromUrl.src =
        imageUrl;

    }


    const toggle =
      document.querySelector(
        ".menu-toggle"
      );


    const nav =
      document.getElementById(
        "site-nav"
      );


    if (
      toggle &&
      nav
    ) {

      toggle.addEventListener(
        "click",
        e => {

          e.stopPropagation();


          const expanded =
            toggle.getAttribute(
              "aria-expanded"
            ) === "true";


          toggle.setAttribute(
            "aria-expanded",
            String(
              !expanded
            )
          );


          toggle.classList.toggle(
            "is-open"
          );


          nav.classList.toggle(
            "show"
          );

        }
      );


      document.addEventListener(
        "click",
        e => {

          if (
            !nav.contains(
              e.target
            )
            &&
            !toggle.contains(
              e.target
            )
          ) {

            nav.classList.remove(
              "show"
            );


            toggle.classList.remove(
              "is-open"
            );


            toggle.setAttribute(
              "aria-expanded",
              "false"
            );

          }

        }
      );

    }


    enhanceImageSelect();

  }
);


// ======================================================
// IMAGE CLASSIFICATION
// ======================================================

function snapshotSmall(
  ctx,
  w,
  h,
  maxEdge = 768
) {

  const scale =
    Math.min(
      1,
      maxEdge /
      Math.max(
        w,
        h
      )
    );


  const sw =
    Math.max(
      1,
      Math.round(
        w * scale
      )
    );


  const sh =
    Math.max(
      1,
      Math.round(
        h * scale
      )
    );


  const c =
    document.createElement(
      "canvas"
    );


  c.width =
    sw;


  c.height =
    sh;


  const sctx =
    c.getContext(
      "2d"
    );


  sctx.imageSmoothingEnabled =
    true;


  sctx.drawImage(
    ctx.canvas,
    0,
    0,
    w,
    h,
    0,
    0,
    sw,
    sh
  );


  const id =
    sctx.getImageData(
      0,
      0,
      sw,
      sh
    );


  return {
    sw,
    sh,
    data: id.data
  };

}


function classifyImageTypeQuick(
  ctx,
  w,
  h
) {

  try {

    const {
      sw,
      sh,
      data
    } =
      snapshotSmall(
        ctx,
        w,
        h,
        768
      );


    let satSum =
      0;


    let grayCnt =
      0;


    let total =
      0;


    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {

      const r =
        data[i];


      const g =
        data[i + 1];


      const b =
        data[i + 2];


      const max =
        Math.max(
          r,
          g,
          b
        );


      const min =
        Math.min(
          r,
          g,
          b
        );


      const sat =
        max === 0
          ? 0
          : (
              max - min
            ) /
            max;


      satSum +=
        sat;


      total++;


      if (
        sat < 0.08
      ) {

        grayCnt++;

      }

    }


    const satAvg =
      satSum /
      Math.max(
        1,
        total
      );


    const grayRatio =
      grayCnt /
      Math.max(
        1,
        total
      );


    const Y =
      new Float32Array(
        sw * sh
      );


    const S =
      new Float32Array(
        sw * sh
      );


    for (
      let p = 0,
          i = 0;
      p < sw * sh;
      p++,
      i += 4
    ) {

      const r =
        data[i];


      const g =
        data[i + 1];


      const b =
        data[i + 2];


      Y[p] =
        0.299 * r +
        0.587 * g +
        0.114 * b;


      const mx =
        Math.max(
          r,
          g,
          b
        );


      const mn =
  Math.min(
    r,
    g,
    b
  );


      S[p] =
        mx === 0
          ? 0
          : (
              mx - mn
            ) /
            mx;

    }


    let edgeCnt =
      0;


    let chromEdgeCnt =
      0;


    const EDGE_TH =
      20;


    for (
      let y = 1;
      y < sh - 1;
      y++
    ) {

      for (
        let x = 1;
        x < sw - 1;
        x++
      ) {

        const i =
          y * sw + x;


        const gx =
          -Y[i - sw - 1]
          -2 * Y[i - 1]
          -Y[i + sw - 1]
          +Y[i - sw + 1]
          +2 * Y[i + 1]
          +Y[i + sw + 1];


        const gy =
          -Y[i - sw - 1]
          -2 * Y[i - sw]
          -Y[i - sw + 1]
          +Y[i + sw - 1]
          +2 * Y[i + sw]
          +Y[i + sw + 1];


        const mag =
          Math.hypot(
            gx,
            gy
          ) / 4;


        if (
          mag > EDGE_TH
        ) {

          edgeCnt++;


          if (
            S[i] > 0.2
          ) {

            chromEdgeCnt++;

          }

        }

      }

    }


    const edgeDensity =
      edgeCnt /
      Math.max(
        1,
        (
          sw - 2
        ) *
        (
          sh - 2
        )
      );


    const chromaticEdgeRatio =
      edgeCnt
        ?
        (
          chromEdgeCnt /
          edgeCnt
        )
        :
        0;


    const isLineart =
      (
        satAvg < 0.08 &&
        grayRatio > 0.70 &&
        chromaticEdgeRatio < 0.20
      )
      ||
      (
        satAvg < 0.10 &&
        edgeDensity > 0.05 &&
        chromaticEdgeRatio < 0.25
      );


    return isLineart
      ?
      {
        label: "lineart",
        confidence: 0.7
      }
      :
      {
        label: "filled_color",
        confidence: 0.7
      };

  }

  catch {

    return {
      label: "filled_color",
      confidence: 0.5
    };

  }

}


// ======================================================
// INITIALIZE CANVAS
// ======================================================

function ensureInitialized() {

  if (
    canvas.width === 0 ||
    canvas.height === 0
  ) {

    const w =
      +(
        canvas.getAttribute(
          "width"
        )
        ||
        canvas.clientWidth
        ||
        1024
      );


    const h =
      +(
        canvas.getAttribute(
          "height"
        )
        ||
        canvas.clientHeight
        ||
        768
      );


    canvas.width =
      w;

    canvas.height =
      h;


    ctx.fillStyle =
      "#FFFFFF";


    ctx.fillRect(
      0,
      0,
      w,
      h
    );

  }

}


// ======================================================
// LOAD IMAGE
// ======================================================

function loadImageToMainCanvas(
  image
) {

  /*
  FIX LOAD IMAGE:
  The old code used isMobile(), but color.js
  does not define that function.

  Detect the device directly here so the image
  can continue loading normally.
  */
  const isMobileDevice =
    window.matchMedia(
      "(max-width: 768px), (hover: none) and (pointer: coarse)"
    ).matches;


  const MAX_EDGE =
    isMobileDevice
      ? 1600
      : 3000;


  const srcW =
    image.width;


  const srcH =
    image.height;


  const scale =
    Math.min(
      1,
      MAX_EDGE /
      Math.max(
        srcW,
        srcH
      )
    );


  const w =
    Math.max(
      1,
      Math.round(
        srcW * scale
      )
    );


  const h =
    Math.max(
      1,
      Math.round(
        srcH * scale
      )
    );


  canvas.width =
    w;


  canvas.height =
    h;


  ctx.imageSmoothingEnabled =
    true;


  ctx.clearRect(
    0,
    0,
    w,
    h
  );


  ctx.drawImage(
    image,
    0,
    0,
    srcW,
    srcH,
    0,
    0,
    w,
    h
  );


  ctx.imageSmoothingEnabled =
    false;


  try {

    originalImageData =
      ctx.getImageData(
        0,
        0,
        w,
        h
      );

  }

  catch {

    originalImageData =
      null;

  }


  const {
    label
  } =
    classifyImageTypeQuick(
      ctx,
      w,
      h
    );


  imageProcessingMode =
    label === "lineart"
      ? "lineart"
      : "recolor";


  if (
    imageProcessingMode ===
    "lineart"
  ) {

    normalizeLineartBW(
      ctx,
      w,
      h,
      false
    );

  }

  else {

    lineMask =
      null;

  }


  // Recalculate the on-screen Brush/Eraser preview
  // after the canvas receives a new image size.
  updateToolCursorSize();

}


// ======================================================
// LINE ART NORMALIZATION
// ======================================================

function normalizeLineartBW(
  ctx,
  w,
  h,
  renderAA = true
) {

  let id;


  try {

    id =
      ctx.getImageData(
        0,
        0,
        w,
        h
      );

  }

  catch (err) {

    console.error(
      err
    );


    alert(
      "Unable to process the image (CORS). Please use an image from the same domain or enable CORS/crossOrigin='anonymous'."
    );


    return;

  }


  const d =
    id.data;


  const hardBlack =
    new Uint8Array(
      w * h
    );


  const hardWhite =
    new Uint8Array(
      w * h
    );


  for (
    let p = 0,
        i = 0;
    p < w * h;
    p++,
    i += 4
  ) {

    const r =
      d[i];


    const g =
      d[i + 1];


    const b =
      d[i + 2];


    const y =
      0.299 * r +
      0.587 * g +
      0.114 * b;


    if (
      y < T_HIGH
    ) {

      hardBlack[p] =
        1;

    }

    else if (
      y > T_LOW
    ) {

      hardWhite[p] =
        1;

    }

  }


  const outBlack =
    new Uint8Array(
      hardBlack
    );


  const N = [
    [1,0],
    [-1,0],
    [0,1],
    [0,-1],
    [1,1],
    [1,-1],
    [-1,1],
    [-1,-1]
  ];


  for (
    let y = 0;
    y < h;
    y++
  ) {

    for (
      let x = 0;
      x < w;
      x++
    ) {

      const p =
        y * w + x;


      if (
        hardBlack[p] ||
        hardWhite[p]
      ) {

        continue;

      }


      for (
        const [
          dx,
          dy
        ] of N
      ) {

        const nx =
          x + dx;


        const ny =
          y + dy;


        if (
          nx < 0 ||
          ny < 0 ||
          nx >= w ||
          ny >= h
        ) {

          continue;

        }


        if (
          hardBlack[
            ny * w + nx
          ]
        ) {

          outBlack[p] =
            1;

          break;

        }

      }

    }

  }


  if (
    DILATE_RADIUS > 0
  ) {

    const src =
      outBlack;


    const out =
      new Uint8Array(
        src
      );


    const R =
      DILATE_RADIUS;


    for (
      let y = 0;
      y < h;
      y++
    ) {

      for (
        let x = 0;
        x < w;
        x++
      ) {

        const p =
          y * w + x;


        if (
          src[p]
        ) {

          continue;

        }


        let touch =
          false;


        for (
          let dy = -R;
          dy <= R &&
          !touch;
          dy++
        ) {

          for (
            let dx = -R;
            dx <= R &&
            !touch;
            dx++
          ) {

            const nx =
              x + dx;


            const ny =
              y + dy;


            if (
              nx < 0 ||
              ny < 0 ||
              nx >= w ||
              ny >= h
            ) {

              continue;

            }


            if (
              src[
                ny * w + nx
              ]
            ) {

              touch =
                true;

            }

          }

        }


        if (
          touch
        ) {

          out[p] =
            1;

        }

      }

    }


    outBlack.set(
      out
    );

  }


  lineMask =
    outBlack;


  if (
    renderAA
  ) {

    renderLineartAAFromMask(
      lineMask,
      w,
      h,
      AA_SCALE
    );

  }

}


// ======================================================
// ANTI-ALIASED LINE RENDERING
// ======================================================

function renderLineartAAFromMask(
  mask,
  w,
  h,
  scale = 2
) {

  const src =
    document.createElement(
      "canvas"
    );


  src.width =
    w;


  src.height =
    h;


  const sctx =
    src.getContext(
      "2d"
    );


  const id =
    sctx.createImageData(
      w,
      h
    );


  const dd =
    id.data;


  for (
    let p = 0,
        i = 0;
    p < w * h;
    p++,
    i += 4
  ) {

    const black =
      mask[p] === 1;


    dd[i] =
      black
        ? 0
        : 255;


    dd[i + 1] =
      black
        ? 0
        : 255;


    dd[i + 2] =
      black
        ? 0
        : 255;


    dd[i + 3] =
      255;

  }


  sctx.putImageData(
    id,
    0,
    0
  );


  const up =
    document.createElement(
      "canvas"
    );


  up.width =
    w * scale;


  up.height =
    h * scale;


  const uctx =
    up.getContext(
      "2d"
    );


  uctx.imageSmoothingEnabled =
    false;


  uctx.drawImage(
    src,
    0,
    0,
    up.width,
    up.height
  );


  ctx.imageSmoothingEnabled =
    true;


  ctx.clearRect(
    0,
    0,
    w,
    h
  );


  ctx.fillStyle =
    "#FFFFFF";


  ctx.fillRect(
    0,
    0,
    w,
    h
  );


  ctx.drawImage(
    up,
    0,
    0,
    w,
    h
  );


  ctx.imageSmoothingEnabled =
    false;

}
		
