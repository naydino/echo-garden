// =====================
// GLOBAL STATE
// =====================

let masks = [];
let maskIdx = 0;
let prevIdx = 0;

let fading = false;
let fadeT = 0;

let wordsG;   // layer for mosaic text
let bgG;      // cached gradient background

// bands of text
let posLines = [];
let neuLines = [];
let negLines = [];

let bandOffset = { pos: 0, neu: 0, neg: 0 }; // scrolling offsets
// drift speed is now NEGATIVE so text flows left -> right
let bandDriftSpeed = { pos: -0.15, neu: -0.1, neg: -0.2 };

// UI refs
let thoughtInput;
let plantBtn;
let pauseBtn;
let switchBtn;

// tuneables
let zoom = 1;
let gridStep = 9;         // smaller step = tighter spacing, sharper silhouette
let maskCutoff = 58;      // bright vs dark cutoff for where text appears
let reveal = 0.8;         // per-cell noise gate
let easingSpeed = 0.04;
let isPaused = false;

// perf
let mosaicCooldown = 0;   // only rebuild heavy mosaic every N frames

// pulse animation for recent submissions
// pulseWords: { text, bornTime, bucket, x, y }
let pulseWords = [];
let pulseDuration = 2000; // ms visible (longer, calmer)

// wave motion
// how wavy / how slow
let waveAmp = 3;          // px vertical wiggle amplitude
let waveFreq = 0.15;      // frequency for sin()
let waveSpeed = 0.4;      // how fast wave moves


// =====================
// PRELOAD
// =====================
function preload() {
  for (let i = 1; i <= 4; i++) {
    masks.push(loadImage(`GardenMask_${i}.png`));
  }
}

// =====================
// SETUP
// =====================
function setup() {
  createCanvas(windowWidth, windowHeight);
  textAlign(CENTER, CENTER);

  wordsG = createGraphics(width, height);

  bgG = createGraphics(width, height);
  rebuildBackgroundGradient();

  // Placeholder text so wall is never empty
  posLines = [
    "i'm still here",
    "you are safe here",
    "gentle breath in",
    "this moment belongs to you",
    "light is allowed to stay"
  ];
  neuLines = [
    "echo garden",
    "shifting roots",
    "between memory and now",
    "listening",
    "we are present"
  ];
  negLines = [
    "the quiet ache",
    "it is okay to feel it",
    "let it out of your body",
    "you can rest here",
    "stay with me"
  ];

  bandOffset.pos = 0;
  bandOffset.neu = 120;
  bandOffset.neg = 240;

  // hook existing DOM buttons/field
  const allInputs = selectAll('input');
  if (allInputs.length > 0) {
    // assume the bottom bar input is last
    thoughtInput = allInputs[allInputs.length - 1];
  }

  const allButtons = selectAll('button');
  allButtons.forEach(btn => {
    const label = (btn.html() || '').toLowerCase();
    if (label.includes('plant')) {
      plantBtn = btn;
    } else if (label.includes('pause')) {
      pauseBtn = btn;
    } else if (label.includes('switch')) {
      switchBtn = btn;
    }
  });

  if (plantBtn) {
    plantBtn.mousePressed(handlePlant);
  }
  if (pauseBtn) {
    pauseBtn.mousePressed(() => {
      isPaused = !isPaused;
    });
  }
  if (switchBtn) {
    switchBtn.mousePressed(() => {
      cycleGarden();
    });
  }
}

// =====================
// DRAW
// =====================
function draw() {
  if (isPaused) return;

  // drift offsets (negative = left->right reading direction feeling)
  bandOffset.pos += bandDriftSpeed.pos;
  bandOffset.neu += bandDriftSpeed.neu;
  bandOffset.neg += bandDriftSpeed.neg;

  image(bgG, 0, 0);

  if (mosaicCooldown <= 0) {
    drawWordsMosaic();
    mosaicCooldown = 2;
  } else {
    mosaicCooldown--;
  }

  // place mosaic
  image(wordsG, 0, 0);

  // overlay planted-word pulse bloom
  drawPulses();

  // invite prompt / future QR call-to-action
  drawPromptHUD();

  if (fading) {
    fadeT = min(1, fadeT + easingSpeed);
    if (fadeT >= 1) fading = false;
  }
}

// =====================
// EVENT: PLANT WORD
// =====================
function handlePlant() {
  if (!thoughtInput) return;
  const txt = thoughtInput.value().trim();
  if (!txt.length) return;

  thoughtInput.value('');

  // classify to band (soft rule)
  let bucket = 'neu';
  const lower = txt.toLowerCase();
  if (lower.match(/love|hope|light|thank|grateful|beautiful|peace|calm|ok|safe|tudo bem/)) {
    bucket = 'pos';
  } else if (lower.match(/hurt|tired|alone|angry|sad|scared|fear|pain|ache|medo/)) {
    bucket = 'neg';
  }

  if (bucket === 'pos') {
    posLines.push(txt);
    bandOffset.pos += txt.length;
  } else if (bucket === 'neg') {
    negLines.push(txt);
    bandOffset.neg += txt.length;
  } else {
    neuLines.push(txt);
    bandOffset.neu += txt.length;
  }

  // pick a calm anchored pulse position in the band
  const { px, py } = pickBandAnchor(bucket);

  pulseWords.push({
    text: txt,
    bornTime: millis(),
    bucket: bucket,
    x: px,
    y: py
  });

  cycleGarden();
}

// =====================
// PICK BAND ANCHOR FOR PULSE (CALMER THAN RANDOM EVERY FRAME)
// =====================
function pickBandAnchor(bucket) {
  let yMin, yMax;
  if (bucket === 'pos') {
    yMin = 0.05 * height;
    yMax = 0.35 * height;
  } else if (bucket === 'neg') {
    yMin = 0.70 * height;
    yMax = 0.95 * height;
  } else {
    yMin = 0.40 * height;
    yMax = 0.70 * height;
  }
  const px = random(width * 0.2, width * 0.8);
  const py = random(yMin, yMax);
  return { px, py };
}

// =====================
// SWITCH MASK
// =====================
function cycleGarden() {
  prevIdx = maskIdx;
  maskIdx = (maskIdx + 1) % masks.length;
  fading = true;
  fadeT = 0;
}

// =====================
// DRAW MOSAIC
// =====================
function drawWordsMosaic() {
  const curr = readyMask(masks[maskIdx]);
  if (!curr) return;

  curr.loadPixels();

  let prevPixels = null;
  if (fading && masks[prevIdx]) {
    masks[prevIdx].loadPixels();
    prevPixels = masks[prevIdx].pixels;
  }

  const currPixels = curr.pixels;

  wordsG.clear();
  wordsG.textAlign(CENTER, CENTER);

  const colsPerRow = floor(width / gridStep);

  // --- CENTERING MATH ---
  // We want to draw the mask centered in the canvas instead of pinned top-left.
  // We'll map each canvas cell (xCanvas,yCanvas) to a sample point (xImg,yImg)
  // inside the mask image, scaled and centered.
  const maskImg = curr;
  const aspectCanvas = width / height;
  const aspectMask   = maskImg.width / maskImg.height;

  let drawW, drawH;
  if (aspectMask > aspectCanvas) {
    // mask is "wider" -> fit to width
    drawW = width * 0.9;
    drawH = drawW / aspectMask;
  } else {
    // mask is "taller" -> fit to height
    drawH = height * 0.6;
    drawW = drawH * aspectMask;
  }

  const offsetX = (width  - drawW) * 0.5;
  const offsetY = (height - drawH) * 0.4; // a little toward upper/middle

  for (let yCanvas = 0, row = 0; yCanvas < height; yCanvas += gridStep, row++) {
    for (let xCanvas = 0, col = 0; xCanvas < width; xCanvas += gridStep, col++) {

      // find relative position within the centered mask rectangle
      let xNorm = (xCanvas - offsetX) / drawW;
      let yNorm = (yCanvas - offsetY) / drawH;

      // convert to pixel coords in source mask
      let xImg = floor(xNorm * maskImg.width);
      let yImg = floor(yNorm * maskImg.height);

      // clamp so out-of-bounds zones just read as "background sky" brightness
      xImg = constrain(xImg, 0, maskImg.width  - 1);
      yImg = constrain(yImg, 0, maskImg.height - 1);

      // brightness lookup with optional fade between prev and curr mask images
      let b = getBrightnessFast(maskImg, xImg, yImg, currPixels);

      if (fading && prevPixels) {
        let bp = getBrightnessFast(masks[prevIdx], xImg, yImg, prevPixels);
        b = lerp(bp, b, fadeT);
      }

      // we draw TEXT in bright areas (sky), skip dark silhouette
      if (b > maskCutoff) {
        // per-cell reveal noise, same as before
        const gate = noise(xCanvas * 0.03, yCanvas * 0.03, 7.77);
        if (gate > reveal) continue;

        // choose the band text based on vertical % (BUT use the final on-screen y)
        const ch = charForCell(yCanvas / height, row, col, colsPerRow);

        // wave offset: very gentle vertical wobble
        const wave =
          sin((frameCount * waveSpeed + xCanvas * waveFreq) * 0.1) * waveAmp;

        wordsG.textSize(gridStep * 0.9 * zoom); // slightly tighter than before

        // subtle shadow
        wordsG.fill(0, 180);
        wordsG.text(ch, xCanvas + 1, yCanvas + 1 + wave);

        // main glyph
        wordsG.fill(240);
        wordsG.text(ch, xCanvas, yCanvas + wave);
      }
    }
  }
}

// choose which band (pos/neu/neg) and which char from that band
// uses bandOffset which is drifting every frame
function charForCell(yNorm, row, col, colsPerRow) {
  let lines;
  let key;

  if (yNorm < 0.40 && posLines.length) {
    lines = posLines;
    key = 'pos';
  } else if (yNorm > 0.70 && negLines.length) {
    lines = negLines;
    key = 'neg';
  } else {
    lines = neuLines;
    key = 'neu';
  }

  const s = lines.join("  ");
  if (!s.length) return " ";

  // bandOffset[key] drifts NEGATIVE now,
  // so reading direction feels left -> right.
  const idxFloat =
    (row * colsPerRow + col + bandOffset[key]) % s.length;

  // JS modulo of negative can be negative, so wrap safely:
  let idx = floor(idxFloat);
  if (idx < 0) idx += s.length;

  return s.charAt(idx);
}

// =====================
// PULSE EFFECT
// =====================
function drawPulses() {
  const now = millis();
  const repeatsPerPulse = 1; // no more seizure burst, just 1 anchored glow

  textAlign(CENTER, CENTER);
  noStroke();

  pulseWords = pulseWords.filter(p => now - p.bornTime < pulseDuration);

  for (let p of pulseWords) {
    const age = now - p.bornTime;
    const t = constrain(age / pulseDuration, 0, 1);

    const alpha = map(t, 0, 1, 255, 0);

    const sizeStart = gridStep * 2.2;  // smaller than before
    const sizeEnd   = gridStep * 1.0;
    const sizeNow   = lerp(sizeStart, sizeEnd, t);

    for (let i = 0; i < repeatsPerPulse; i++) {
      fill(0, alpha * 0.6);
      textSize(sizeNow);
      text(p.text, p.x + 2, p.y + 2);

      fill(255, alpha);
      text(p.text, p.x, p.y);
    }
  }
}

// =====================
// HUD PROMPT
// =====================
function drawPromptHUD() {
  // Dimensions for the prompt box
  const boxPaddingX = 12;
  const boxPaddingY = 8;
  const lineH = 16;

  const textLine1 = "ADD A THOUGHT →";
  const textLine2 = "type below or scan QR";

  textSize(14);
  textAlign(LEFT, TOP);

  // measure text width for background box
  const w1 = textWidth(textLine1);
  const w2 = textWidth(textLine2);
  const boxW = max(w1, w2) + boxPaddingX * 2;
  const boxH = lineH * 2 + boxPaddingY * 2;

  // place it just above the input bar, left side
  // your input bar seems ~50px tall incl. buttons, so we float above that
  const marginLeft = 20;
  const marginBottomFromCanvas = 150; // tweak up/down visually
  const boxX = marginLeft;
  const boxY = height - marginBottomFromCanvas;

  // background bubble
  push();
  noStroke();
  fill(0, 180); // translucent dark backdrop
  rect(boxX, boxY, boxW, boxH, 6); // rounded corners

  // text
  fill(255);
  text(textLine1, boxX + boxPaddingX, boxY + boxPaddingY);
  fill(200);
  text(textLine2, boxX + boxPaddingX, boxY + boxPaddingY + lineH);
  pop();
}

// =====================
// HELPERS
// =====================
function readyMask(img) {
  return img && img.width > 0 ? img : null;
}

function getBrightnessFast(img, x, y, pixelsArr) {
  const idx = 4 * (y * img.width + x);
  const r = pixelsArr[idx];
  const g = pixelsArr[idx + 1];
  const b = pixelsArr[idx + 2];
  return (r + g + b) / 3;
}

function rebuildBackgroundGradient() {
  for (let y = 0; y < height; y++) {
    const c = lerpColor(color(9, 28, 32), color(22, 60, 66), y / height);
    bgG.stroke(c);
    bgG.line(0, y, width, y);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  bgG = createGraphics(width, height);
  rebuildBackgroundGradient();
  wordsG = createGraphics(width, height);
}
