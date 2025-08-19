// ===== Canvas Painter (2 layers + line-only overlay) =====

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Lớp gốc (lineart) – chỉ dùng để đọc & tạo mask
const baseCanvas = document.createElement("canvas");
const baseCtx = baseCanvas.getContext("2d");
// Lớp tô
const paintCanvas = document.createElement("canvas");
const paintCtx = paintCanvas.getContext("2d");
// Lớp chỉ chứa VIỀN (nền trong suốt)
const lineOnlyCanvas = document.createElement("canvas");
const lineOnlyCtx = lineOnlyCanvas.getContext("2d");

let currentColor = "#000000";
let img = new Image();
let isDrawing = false;
let mode = "fill"; // fill | brush | eraser | text
let isTyping = false;
let currentTextBox = null;
let brushSize = 7.5;

let undoStack = [];    // lưu PAINT layer
let redoStack = [];

let originalImageName = "";

// ===== tham số bảo vệ viền =====
let lineArtMask = null;     // Uint8Array: 1 = pixel viền
let baseImageData = null;   // ImageData của ảnh gốc
const LINE_PROTECT = {
  enabled: true,
  blackThreshold: 40,
  luminanceThreshold: 65,
  maskGrow: 1,          // nở thêm viền nếu mảnh
  closeGapsRadius: 1    // closing để bịt khe 1px ở nét đứt
};

// ===== chống vệt trắng sát viền =====
const FILL_TOLERANCE = 80;
const EDGE_GROW_AFTER_FILL = 2;

const colors = [
  "#CD0000", "#FF6633", "#FF9933", "#FF00FF", "#FFD700",
  "#FFFF00", "#000000", "#808080", "#C0C0C0", "#FFFFFF",
  "#0000FF", "#6600CC", "#0099FF", "#00FFFF", "#006241",
  "#008000", "#00FF00", "#CCFFCC", "#800080", "#8B5F65"
];

// ===== Palette =====
const palette = document.getElementById("colorPalette");
colors.forEach((color, i) => {
  const div = document.createElement("div");
  div.className = "color";
  div.style.background = color;
  div.dataset.color = color;
  if (i === 0) { div.classList.add("selected"); currentColor = color; }
  palette.appendChild(div);
});
document.querySelectorAll(".color").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".color").forEach(c => c.classList.remove("selected"));
    el.classList.add("selected");
    currentColor = el.dataset.color;
  });
});

// ===== Mode buttons =====
document.getElementById("fillModeBtn").addEventListener("click", () => updateModeButtons("fill"));
document.getElementById("textModeBtn").addEventListener("click", () => { updateModeButtons("text"); addTextBoxCentered(); });
document.getElementById("brushModeBtn").addEventListener("click", () => updateModeButtons("brush"));
document.getElementById("eraserModeBtn").addEventListener("click", () => updateModeButtons("eraser"));

function updateModeButtons(newMode = null) {
  mode = newMode;
  document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
  if (mode === "fill")   document.getElementById("fillModeBtn").classList.add("active");
  else if (mode === "brush")  document.getElementById("brushModeBtn").classList.add("active");
  else if (mode === "eraser") document.getElementById("eraserModeBtn").classList.add("active");
  else if (mode === "text")   document.getElementById("textModeBtn").classList.add("active");
}

// ===== Brush size =====
document.getElementById("brushSizeSelect").addEventListener("change", function () {
  brushSize = parseFloat(this.value);
});

// ===== Image select / upload =====
const imageSelect = document.getElementById("imageSelect");
imageSelect.addEventListener("change", function () {
  const selectedImage = this.value;
  loadImage(selectedImage, selectedImage.split('/').pop());
  document.getElementById("uploadInput").value = "";
  undoStack = []; redoStack = [];
  updateSelectStyle();
  const label = document.getElementById("kite-label-input"); if (label) label.style.display = "block";
  imageSelect.classList.add("pop"); setTimeout(() => imageSelect.classList.remove("pop"), 200);
});

document.getElementById("uploadInput").addEventListener("change", function (e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    loadImage(ev.target.result, file.name);
    imageSelect.selectedIndex = 0; updateSelectStyle();
    undoStack = []; redoStack = [];
  };
  reader.readAsDataURL(file);
});

function loadImage(src, nameForDownload) {
  img = new Image(); img.crossOrigin = "anonymous";
  img.onload = () => {
    // resize 3 canvas
    [canvas, baseCanvas, paintCanvas, lineOnlyCanvas].forEach(c => { c.width = img.width; c.height = img.height; });

    // base = ảnh gốc
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(img, 0, 0);
    baseImageData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);

    // paint = trống
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);

    // tạo mask & sprite viền trong suốt
    buildLineArtMask();
    buildLineOnlySprite();

    // render đầu tiên
    renderComposite();

    originalImageName = nameForDownload || "to_mau.png";
  };
  img.src = src;
}

// ===== RENDER: nền trắng → paint → lineOnly (viền luôn ở trên) =====
function renderComposite() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // nền trắng
  ctx.drawImage(paintCanvas, 0, 0);
  ctx.drawImage(lineOnlyCanvas, 0, 0);
}

// ===== Helpers =====
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches?.[0]?.clientX ?? e.clientX;
  const clientY = e.touches?.[0]?.clientY ?? e.clientY;
  return {
    x: Math.floor((clientX - rect.left) * scaleX),
    y: Math.floor((clientY - rect.top) * scaleY)
  };
}
function hexToRgba(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v>>16)&255, (v>>8)&255, v&255, 255];
}
function saveState() {
  try { undoStack.push(paintCtx.getImageData(0,0,paintCanvas.width,paintCanvas.height)); redoStack = []; }
  catch(e){ console.warn("saveState failed", e); }
}

// ===== Brush / Eraser trên PAINT layer =====
function drawDotOnPaint(x, y) {
  paintCtx.beginPath(); paintCtx.arc(x, y, brushSize, 0, Math.PI*2); paintCtx.fill();
}
canvas.addEventListener("mousedown", (e) => {
  if (mode!=="brush" && mode!=="eraser") return;
  isDrawing = true; saveState();
  const {x,y} = getCanvasCoords(e);
  if (mode==="eraser"){ paintCtx.save(); paintCtx.globalCompositeOperation="destination-out"; drawDotOnPaint(x,y); paintCtx.restore(); }
  else { paintCtx.fillStyle = currentColor; drawDotOnPaint(x,y); }
  renderComposite();
});
canvas.addEventListener("mousemove", (e) => {
  if (!isDrawing) return;
  if (mode==="eraser"){ const {x,y}=getCanvasCoords(e); paintCtx.save(); paintCtx.globalCompositeOperation="destination-out"; drawDotOnPaint(x,y); paintCtx.restore(); }
  else if (mode==="brush"){ const {x,y}=getCanvasCoords(e); paintCtx.fillStyle=currentColor; drawDotOnPaint(x,y); }
  renderComposite();
});
canvas.addEventListener("mouseup",   () => { isDrawing=false; });
canvas.addEventListener("mouseleave",() => { isDrawing=false; });
canvas.addEventListener("touchstart",(e)=>{ if(mode==="brush"||mode==="eraser"){ isDrawing=true; saveState(); const {x,y}=getCanvasCoords(e); if(mode==="eraser"){paintCtx.save();paintCtx.globalCompositeOperation="destination-out";drawDotOnPaint(x,y);paintCtx.restore();} else {paintCtx.fillStyle=currentColor;drawDotOnPaint(x,y);} renderComposite(); e.preventDefault(); }},{passive:false});
canvas.addEventListener("touchmove", (e)=>{ if(!isDrawing)return; const {x,y}=getCanvasCoords(e); if(mode==="eraser"){paintCtx.save();paintCtx.globalCompositeOperation="destination-out";drawDotOnPaint(x,y);paintCtx.restore();} else if(mode==="brush"){paintCtx.fillStyle=currentColor;drawDotOnPaint(x,y);} renderComposite(); e.preventDefault(); },{passive:false});
canvas.addEventListener("touchend",  ()=>{ isDrawing=false; });

// ===== Fill (chỉ ghi lên PAINT, xét màu theo ảnh ghép; chặn viền) =====
canvas.addEventListener("click", (e) => {
  if (mode !== "fill") return;
  const {x,y} = getCanvasCoords(e);
  saveState();
  floodFillCompositeAware(x, y, hexToRgba(currentColor));
  renderComposite();
});

// Lấy màu tại (x,y) theo ảnh ghép: ưu tiên PAINT, nếu alpha=0 thì lấy BASE
function getCompositeRGBA(paintData, baseData, w, x, y) {
  const i = (y*w + x)*4;
  const a = paintData[i+3];
  if (a>0) return [paintData[i], paintData[i+1], paintData[i+2], a];
  return [baseData[i], baseData[i+1], baseData[i+2], baseData[i+3]];
}
function colorClose(a,b,t){ return Math.abs(a[0]-b[0])<=t && Math.abs(a[1]-b[1])<=t && Math.abs(a[2]-b[2])<=t; }

function floodFillCompositeAware(x, y, fillColor) {
  const w = paintCanvas.width, h = paintCanvas.height;
  const startIdx = y*w + x;
  if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[startIdx]) return; // click trúng viền

  const paintObj = paintCtx.getImageData(0,0,w,h);
  const paintData = paintObj.data;
  const baseData  = baseImageData.data;

  const startCol = getCompositeRGBA(paintData, baseData, w, x, y);
  const tol = FILL_TOLERANCE;

  const stack = [[x,y]];
  const visited = new Uint8Array(w*h);
  const filled  = new Uint8Array(w*h);

  const paintPixel = (i) => {
    const p = i*4;
    paintData[p]=fillColor[0]; paintData[p+1]=fillColor[1]; paintData[p+2]=fillColor[2]; paintData[p+3]=255;
  };

  while(stack.length){
    const [cx,cy] = stack.pop();
    if (cx<0||cy<0||cx>=w||cy>=h) continue;
    const i1d = cy*w+cx; if (visited[i1d]) continue; visited[i1d]=1;
    if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[i1d]) continue;
    const col = getCompositeRGBA(paintData, baseData, w, cx, cy);
    if (!colorClose(col, startCol, tol)) continue;

    paintPixel(i1d); filled[i1d]=1;
    stack.push([cx-1,cy]); stack.push([cx+1,cy]); stack.push([cx,cy-1]); stack.push([cx,cy+1]);
  }

  // nở vùng để lấp AA, vẫn tôn trọng mask viền
  const n8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let it=0; it<EDGE_GROW_AFTER_FILL; it++){
    const grow = [];
    for (let yy=0; yy<h; yy++) for (let xx=0; xx<w; xx++){
      const i1d = yy*w+xx; if (filled[i1d]) continue;
      if (LINE_PROTECT.enabled && lineArtMask && lineArtMask[i1d]) continue;
      let near=false; for(const [dx,dy] of n8){const nx=xx+dx, ny=yy+dy; if(nx>=0&&ny>=0&&nx<w&&ny<h&&filled[ny*w+nx]){near=true;break;}}
      if (near) grow.push(i1d);
    }
    for (const i1d of grow){ paintPixel(i1d); filled[i1d]=1; }
  }

  paintCtx.putImageData(paintObj,0,0);
}

// ===== UNDO/REDO (PAINT layer) =====
document.getElementById("undoBtn").addEventListener("click", () => {
  if (!undoStack.length) return;
  const cur = paintCtx.getImageData(0,0,paintCanvas.width,paintCanvas.height);
  redoStack.push(cur);
  const prev = undoStack.pop();
  paintCtx.putImageData(prev,0,0);
  renderComposite();
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (!redoStack.length) return;
  const cur = paintCtx.getImageData(0,0,paintCanvas.width,paintCanvas.height);
  undoStack.push(cur);
  const next = redoStack.pop();
  paintCtx.putImageData(next,0,0);
  renderComposite();
});

// ===== DOWNLOAD: nền trắng + PAINT + LINE =====
document.getElementById("downloadBtn").addEventListener("click", () => {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const logo = new Image(); logo.src = "images/logo.webp"; logo.crossOrigin = "anonymous";

  logo.onload = () => {
    const temp = document.createElement("canvas");
    const tctx = temp.getContext("2d");
    temp.width = canvas.width; temp.height = canvas.height;

    // nền trắng
    tctx.fillStyle = "#fff"; tctx.fillRect(0,0,temp.width,temp.height);
    // paint + line
    tctx.drawImage(paintCanvas,0,0);
    tctx.drawImage(lineOnlyCanvas,0,0);

    // text-box
    document.querySelectorAll(".text-box").forEach(box => {
      const content = box.querySelector(".text-content");
      const text = content?.innerText ?? ""; if (!text.trim()) return;
      const cRect = canvas.getBoundingClientRect(); const bRect = box.getBoundingClientRect();
      const sx = canvas.width / cRect.width; const sy = canvas.height / cRect.height;
      const cx = (bRect.left + bRect.width/2 - cRect.left) * sx;
      const cy = (bRect.top  + bRect.height/2 - cRect.top ) * sy;
      const cs = getComputedStyle(content);
      const fs = parseFloat(cs.fontSize) * sy;
      const ff = cs.fontFamily; const fw = cs.fontWeight; const color = cs.color;
      const rot = parseFloat(box.dataset.rotation || "0");
      const scx = parseFloat(box.dataset.scaleX || "1");
      const scy = parseFloat(box.dataset.scaleY || "1");
      tctx.save(); tctx.translate(cx,cy); tctx.rotate(rot*Math.PI/180); tctx.scale(scx,scy);
      tctx.font = `${fw} ${fs}px ${ff}`; tctx.fillStyle = color; tctx.textAlign="center"; tctx.textBaseline="middle";
      tctx.fillText(text,0,0); tctx.restore();
    });

    // logo
    const h=30, s=h/logo.height, w=logo.width*s, x=temp.width-w-10, y=temp.height-h-10;
    tctx.drawImage(logo,x,y,w,h);

    if (isIOS){
      const win = window.open("about:blank","_blank");
      win.document.write(`<img src="${temp.toDataURL("image/png")}" style="max-width:100%;"/>`);
      win.document.close();
    } else {
      temp.toBlob((blob)=>{
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href=url; a.download = originalImageName || "to_mau.png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      },"image/png");
    }
  };
  logo.onerror = () => alert("Không thể tải logo từ images/logo.webp");
});

// ===== Text boxes (y nguyên) =====
function addTextBoxCentered() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const container = document.querySelector(".canvas-wrapper");
  const box = document.createElement("div");
  box.className = "text-box";
  box.style.left = `${(rect.width/2) - 100}px`;
  box.style.top  = `${(rect.height/2) - 20}px`;

  const content = document.createElement("div");
  content.className = "text-content";
  content.contentEditable = "true";
  content.spellcheck = false;
  content.style.minWidth = "1ch";
  content.style.width = "100%";

  box.appendChild(content);
  container.appendChild(box);

  content.focus();
  content.style.color = currentColor;
  makeTextBoxDraggable(box);
  enableResize(box);
  enableRotate(box);

  currentTextBox = box;
  box.addEventListener("click", () => {
    currentTextBox = box;
    const c = currentTextBox.querySelector(".text-content");
    if (mode === "text" && c) c.style.color = currentColor;
  });

  isTyping = true;
  content.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
}

function makeTextBoxDraggable(box) {
  let isDragging=false, hasMoved=false, offsetX=0, offsetY=0;
  box.addEventListener("mousedown",(e)=>{ if(e.target!==box)return; isDragging=true; hasMoved=false; offsetX=e.offsetX; offsetY=e.offsetY; e.preventDefault(); });
  box.addEventListener("touchstart",(e)=>{ if(e.target!==box)return; isDragging=true; hasMoved=false; const t=e.touches[0], r=box.getBoundingClientRect(); offsetX=t.clientX-r.left; offsetY=t.clientY-r.top; e.preventDefault(); },{passive:false});
  function move(x,y){ const w=document.querySelector(".canvas-wrapper").getBoundingClientRect(); box.style.left=`${x-w.left-offsetX}px`; box.style.top=`${y-w.top-offsetY}px`; }
  document.addEventListener("mousemove",(e)=>{ if(!isDragging)return; hasMoved=true; move(e.clientX,e.clientY); });
  document.addEventListener("touchmove",(e)=>{ if(!isDragging)return; hasMoved=true; const t=e.touches[0]; move(t.clientX,t.clientY); e.preventDefault(); },{passive:false});
  document.addEventListener("mouseup",()=>{ if(isDragging&&!hasMoved) box.focus(); isDragging=false; });
  document.addEventListener("touchend",()=>{ if(isDragging&&!hasMoved) box.focus(); isDragging=false; });
}
function enableResize(textBox){
  const resizer=document.createElement("div"); resizer.className="resizer"; textBox.appendChild(resizer);
  let isResizing=false,startX,startY,startW,startH,startSX,startSY,rot;
  textBox.style.transformOrigin="center center";
  textBox.dataset.scaleX=textBox.dataset.scaleX||"1";
  textBox.dataset.scaleY=textBox.dataset.scaleY||"1";
  textBox.dataset.rotation=textBox.dataset.rotation||"0";
  const onStart=(e)=>{ e.preventDefault(); isResizing=true;
    const cx=e.clientX||e.touches?.[0]?.clientX, cy=e.clientY||e.touches?.[0]?.clientY;
    startX=cx; startY=cy; const r=textBox.getBoundingClientRect();
    startW=r.width; startH=r.height; startSX=parseFloat(textBox.dataset.scaleX||"1"); startSY=parseFloat(textBox.dataset.scaleY||"1");
    rot=parseFloat(textBox.dataset.rotation||"0");
  };
  const onMove=(e)=>{ if(!isResizing)return; const cx=e.clientX||e.touches?.[0]?.clientX, cy=e.clientY||e.touches?.[0]?.clientY;
    const dx=cx-startX, dy=cy-startY, ang=rot*Math.PI/180;
    const dW=dx*Math.cos(ang)+dy*Math.sin(ang), dH=dy*Math.cos(ang)-dx*Math.sin(ang);
    let sx=(startW+dW)/startW*startSX, sy=(startH+dH)/startH*startSY;
    sx=Math.max(0.2,Math.min(sx,5)); sy=Math.max(0.2,Math.min(sy,5));
    textBox.dataset.scaleX=sx.toFixed(3); textBox.dataset.scaleY=sy.toFixed(3); applyTransform(textBox);
  };
  const onEnd=()=>{ isResizing=false; };
  resizer.addEventListener("mousedown",onStart); document.addEventListener("mousemove",onMove); document.addEventListener("mouseup",onEnd);
  resizer.addEventListener("touchstart",onStart,{passive:false}); document.addEventListener("touchmove",onMove,{passive:false}); document.addEventListener("touchend",onEnd);
}
function applyTransform(box){ const a=parseFloat(box.dataset.rotation||"0"); const sx=parseFloat(box.dataset.scaleX||"1"); const sy=parseFloat(box.dataset.scaleY||"1"); box.style.transform=`rotate(${a}deg) scale(${sx}, ${sy})`; }
function enableRotate(textBox){
  const h=document.createElement("div"); h.className="rotate-handle"; textBox.appendChild(h);
  let rotating=false,cx,cy,start;
  const center=()=>{ const r=textBox.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; };
  const ang=(cx,cy,x,y)=>Math.atan2(y-cy,x-cx)*(180/Math.PI);
  const startRot=(x,y)=>{ rotating=true; const c=center(); cx=c.x; cy=c.y; start = ang(cx,cy,x,y)-parseFloat(textBox.dataset.rotation||"0"); };
  const moveRot=(x,y)=>{ if(!rotating)return; const a=ang(cx,cy,x,y)-start; textBox.dataset.rotation=a.toFixed(2); applyTransform(textBox); };
  const stopRot=()=>{ rotating=false; };
  h.addEventListener("mousedown",(e)=>{ e.stopPropagation(); startRot(e.clientX,e.clientY); });
  document.addEventListener("mousemove",(e)=>moveRot(e.clientX,e.clientY));
  document.addEventListener("mouseup",stopRot);
  h.addEventListener("touchstart",(e)=>{ if(e.touches.length===1){ const t=e.touches[0]; startRot(t.clientX,t.clientY); e.preventDefault(); }},{passive:false});
  document.addEventListener("touchmove",(e)=>{ if(e.touches.length===1){ const t=e.touches[0]; moveRot(t.clientX,t.clientY); e.preventDefault(); }},{passive:false});
  document.addEventListener("touchend",stopRot);
}

// ===== Tạo MASK & SPRITE viền (nền trong suốt) =====
function buildLineArtMask() {
  if (!LINE_PROTECT.enabled) { lineArtMask=null; return; }
  const w = baseCanvas.width, h = baseCanvas.height, N = w*h;
  const d = baseImageData.data;
  let mask = new Uint8Array(N);
  const thr = LINE_PROTECT.blackThreshold, lthr = LINE_PROTECT.luminanceThreshold;

  for (let i=0;i<N;i++){
    const p=i*4, r=d[p], g=d[p+1], b=d[p+2];
    const nearBlack = (r<thr && g<thr && b<thr);
    const Y = 0.2126*r + 0.7152*g + 0.0722*b;
    if (nearBlack || Y < lthr) mask[i]=1;
  }

  mask = dilate(mask,w,h,LINE_PROTECT.closeGapsRadius);
  mask = erode (mask,w,h,LINE_PROTECT.closeGapsRadius);
  if (LINE_PROTECT.maskGrow>0) mask = dilate(mask,w,h,LINE_PROTECT.maskGrow);

  lineArtMask = mask;
}
function buildLineOnlySprite() {
  const w = baseCanvas.width, h = baseCanvas.height;
  lineOnlyCanvas.width = w; lineOnlyCanvas.height = h;
  const out = lineOnlyCtx.createImageData(w,h);
  const src = baseImageData.data, dst = out.data;
  for (let i=0;i<w*h;i++){
    const p=i*4;
    if (lineArtMask && lineArtMask[i]) {
      dst[p]=src[p]; dst[p+1]=src[p+1]; dst[p+2]=src[p+2]; dst[p+3]=255; // giữ màu viền (thường là đen)
    } else {
      dst[p]=0; dst[p+1]=0; dst[p+2]=0; dst[p+3]=0; // trong suốt
    }
  }
  lineOnlyCtx.putImageData(out,0,0);
}

// morphology helpers
function dilate(mask,w,h,r=1){ if(r<=0)return mask; let out=mask;
  for(let it=0;it<r;it++){ const m2=new Uint8Array(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=y*w+x; if(out[i]){m2[i]=1;continue;}
      for(let dy=-1;dy<=1 && !m2[i];dy++) for(let dx=-1;dx<=1 && !m2[i];dx++){
        if(!dx && !dy) continue; const nx=x+dx, ny=y+dy;
        if(nx>=0 && ny>=0 && nx<w && ny<h && out[ny*w+nx]) m2[i]=1;
      }
    }
    out=m2;
  } return out;
}
function erode(mask,w,h,r=1){ if(r<=0)return mask; let out=mask;
  for(let it=0;it<r;it++){ const m2=new Uint8Array(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      let allOn=true; for(let dy=-1;dy<=1 && allOn;dy++) for(let dx=-1;dx<=1 && allOn;dx++){
        if(!dx && !dy) continue; const nx=x+dx, ny=y+dy;
        if(nx<0 || ny<0 || nx>=w || ny>=h || !out[ny*w+nx]) allOn=false;
      }
      const i=y*w+x; m2[i]=(out[i] && allOn)?1:0;
    }
    out=m2;
  } return out;
}

// ===== Misc UI =====
function updateSelectStyle() {
  const isPlaceholder = imageSelect.selectedIndex === 0;
  imageSelect.style.color = isPlaceholder ? "rgba(0,0,0,0.5)" : "#000";
  imageSelect.style.fontStyle = isPlaceholder ? "italic" : "normal";
}
imageSelect.addEventListener("change", updateSelectStyle);
window.addEventListener("DOMContentLoaded", updateSelectStyle);
imageSelect.addEventListener("change", () => { imageSelect.classList.add("pop"); setTimeout(() => imageSelect.classList.remove("pop"), 200); });

document.getElementById("boldBtn").addEventListener("click", () => {
  if (!currentTextBox) return;
  const c = currentTextBox.querySelector(".text-content");
  const isBold = c.style.fontWeight === "bold";
  c.style.fontWeight = isBold ? "normal" : "bold";
});
document.getElementById("fontSelect").addEventListener("change", (e) => { if (currentTextBox) currentTextBox.querySelector(".text-content").style.fontFamily = e.target.value; });
document.getElementById("deleteTextBtn").addEventListener("click", () => { if (currentTextBox) { currentTextBox.remove(); currentTextBox=null; } });

function initMenuButton() {
  const menuBtn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  if (menuBtn && nav && !menuBtn.dataset.bound) { menuBtn.addEventListener("click", ()=>nav.classList.toggle("open")); menuBtn.dataset.bound="true"; }
}
window.addEventListener("DOMContentLoaded", initMenuButton);
window.onload = () => {
  initMenuButton();
  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get("img");
  if (imageUrl) {
    loadImage(imageUrl, imageUrl.split("/").pop());
    undoStack = []; redoStack = [];
  }
};
window.initMenuButton = initMenuButton;
