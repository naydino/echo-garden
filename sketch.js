// =====================
// ECHO GARDEN — INSTALLATION BUILD
// =====================

// simple mobile detection for layout decisions (not security, just visuals)
let isMobile = /Mobi|Android/i.test(navigator.userAgent);

// mask images and qr
let masks = [];
let maskIdx = 0;
let prevIdx = 0;
let qrImg;

// fade state between masks
let fading = false;
let fadeT = 0;

// drawing layers
let wordsG;
let bgG;

// text bands
let posLines = [];
let neuLines = [];
let negLines = [];

// scrolling offset so text drifts horizontally
let bandOffset = { pos: 0, neu: 0, neg: 0 };
// negative speeds = drift feels left→right to the eye
let bandDriftSpeed = { pos: -0.15, neu: -0.1, neg: -0.2 };

// DOM handles
let thoughtInput, plantBtn, pauseBtn, switchBtn;

// tuning
let zoom = 1;
let gridStep = 8;          // smaller => denser letters
let maskCutoff = 58;       // brightness threshold to decide sky vs plant
let reveal = 0.8;          // per-cell noise cutoff (0 = full text, 1 = sparse)
let easingSpeed = 0.04;    // fade speed between mask images
let isPaused = false;

// perf
let mosaicCooldown = 0;    // recompute mosaic every few frames instead of every frame

// pulse bloom animation for new submissions
// each: { text, bornTime, bucket, x, y }
let pulseWords = [];
let pulseDuration = 2000;  // ms on screen for the bloom highlight

// organic wobble
let waveAmp = 3;
let waveFreq = 0.15;
let waveSpeed = 0.4;

// Firebase state
let firebaseReady = false;
let lastSeenTs = 0;


// =====================
// PRELOAD
// =====================
function preload() {
  // masks
  masks.push(loadImage('GardenMask_1.png'));
  masks.push(loadImage('GardenMask_2.png'));
  masks.push(loadImage('GardenMask_3.png'));
  masks.push(loadImage('GardenMask_4.png'));

  // qr code for HUD
  qrImg = loadImage('qr.png');
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

  // starting text so the garden is visible right away
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

  // hook up DOM from index.html
  thoughtInput = select('#thoughtInput');
  plantBtn    = select('#plantBtn');
  pauseBtn    = select('#pauseBtn');
  switchBtn   = select('#switchBtn');

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

  // init Firebase listener
  initFirebase();
}


// =====================
// DRAW LOOP
// =====================
function draw() {
  if (isPaused) return;

  // drift bands each frame
  bandOffset.pos += bandDriftSpeed.pos;
  bandOffset.neu += bandDriftSpeed.neu;
  bandOffset.neg += bandDriftSpeed.neg;

  // draw cached background
  image(bgG, 0, 0);

  // heavy mosaic gets updated every few frames to save CPU
  if (mosaicCooldown <= 0) {
    drawWordsMosaic();
    mosaicCooldown = 2;
  } else {
    mosaicCooldown--;
  }

  image(wordsG, 0, 0);

  // bloom of just-planted thoughts
  drawPulses();

  // HUD invite + QR
  drawPromptHUD();

  // finish fade between garden silhouettes
  if (fading) {
    fadeT = min(1, fadeT + easingSpeed);
    if (fadeT >= 1) fading = false;
  }
}


// =====================
// LOCAL INPUT
// =====================
function handlePlant() {
  if (!thoughtInput) return;
  const txt = thoughtInput.value().trim();
  if (!txt.length) return;

  thoughtInput.value('');
  plantExternalText(txt);
}


// =====================
// REMOTE INPUT
// =====================

// Called by Firebase listener when new phone submission arrives
function injectRemoteText(txt, ts) {
  if (ts && ts <= lastSeenTs) return; // prevent re-adding older entries
  if (ts) lastSeenTs = ts;

  plantExternalText(txt);
}

// Shared logic for local + remote “plant”
function plantExternalText(txt) {
  const lower = txt.toLowerCase();

  // lightweight "sentiment routing"
  let bucket = 'neu';
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

  // choose where the pulse appears in that band
  const { px, py } = pickBandAnchor(bucket);
  pulseWords.push({
    text: txt,
    bornTime: millis(),
    bucket: bucket,
    x: px,
    y: py
  });

  // move to next garden silhouette
  cycleGarden();
}


// =====================
// GARDEN STATE
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

function cycleGarden() {
  prevIdx = maskIdx;
  maskIdx = (maskIdx + 1) % masks.length;
  fading = true;
  fadeT = 0;
}


// =====================
// WORD MOSAIC RENDER
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

  wordsG.clear();
  wordsG.textAlign(CENTER, CENTER);

  const colsPerRow = floor(width / gridStep);

  // compute how big we draw the mask and where it sits on screen (centered)
  const maskImg = curr;
  const aspectCanvas = width / height;
  const aspectMask = maskImg.width / maskImg.height;

  let drawW, drawH;
  if (aspectMask > aspectCanvas) {
    drawW = width * 0.9;
    drawH = drawW / aspectMask;
  } else {
    drawH = height * 0.6;
    drawW = drawH * aspectMask;
  }

  const offsetX = (width  - drawW) * 0.5;
  const offsetY = (height - drawH) * 0.4; // a little above vertical center

  const currPixels = curr.pixels;

  for (let yC = 0, row = 0; yC < height; yC += gridStep, row++) {
    for (let xC = 0, col = 0; xC < width; xC += gridStep, col++) {

      // normalize canvas coords into mask image coords
      let xNorm = (xC - offsetX) / drawW;
      let yNorm = (yC - offsetY) / drawH;
      let xImg = floor(xNorm * maskImg.width);
      let yImg = floor(yNorm * maskImg.height);

      xImg = constrain(xImg, 0, maskImg.width  - 1);
      yImg = constrain(yImg, 0, maskImg.height - 1);

      // brightness lookup
      let b = getBrightnessFast(maskImg, xImg, yImg, currPixels);

      if (fading && prevPixels) {
        let bp = getBrightnessFast(masks[prevIdx], xImg, yImg, prevPixels);
        b = lerp(bp, b, fadeT);
      }

      // text goes in the BRIGHT "sky" areas, not in the dark plant silhouette
      if (b > maskCutoff) {
        // noise gate so it's not solid white
        const gate = noise(xC * 0.03, yC * 0.03, 7.77);
        if (gate > reveal) continue;

        const ch = charForCell(yC / height, row, col, colsPerRow);

        // tiny wave motion for organic feel
        const wave =
          sin((frameCount * waveSpeed + xC * waveFreq) * 0.1) * waveAmp;

        wordsG.textSize(gridStep * 0.9 * zoom);

        // drop shadow to make characters pop on projection
        wordsG.fill(0, 180);
        wordsG.text(ch, xC + 1, yC + 1 + wave);

        wordsG.fill(240);
        wordsG.text(ch, xC, yC + wave);
      }
    }
  }
}

function charForCell(yNorm, row, col, colsPerRow) {
  let lines, key;
  if (yNorm < 0.40 && posLines.length) { lines = posLines; key = 'pos'; }
  else if (yNorm > 0.70 && negLines.length) { lines = negLines; key = 'neg'; }
  else { lines = neuLines; key = 'neu'; }

  const s = lines.join("  ");
  if (!s.length) return " ";

  // bandOffset drifts each frame (negative drift = feels like left→right motion)
  const idxFloat = (row * colsPerRow + col + bandOffset[key]) % s.length;

  // modulo in JS can go negative, fix that:
  let idx = floor(idxFloat);
  if (idx < 0) idx += s.length;

  return s.charAt(idx);
}


// =====================
// PULSE BLOOMS
// =====================
function drawPulses() {
  const now = millis();
  pulseWords = pulseWords.filter(p => now - p.bornTime < pulseDuration);

  textAlign(CENTER, CENTER);
  noStroke();

  for (let p of pulseWords) {
    const age = now - p.bornTime;
    const t = constrain(age / pulseDuration, 0, 1);
    const alpha = map(t, 0, 1, 255, 0);
    const sizeNow = lerp(gridStep * 2.2, gridStep * 1.0, t);

    fill(0, alpha * 0.6);
    textSize(sizeNow);
    text(p.text, p.x + 2, p.y + 2);

    fill(255, alpha);
    text(p.text, p.x, p.y);
  }
}


// =====================
// HUD PROMPT + QR (desktop only)
// =====================
function drawPromptHUD() {
  if (isMobile) return;

  const paddingX = 24;
  const paddingY = 16;
  const lineH = 30;

  const textLine1 = "ADD A THOUGHT →";
  const textLine2 = "type below or scan QR";

  textSize(28);
  textAlign(LEFT, TOP);

  const w1 = textWidth(textLine1);
  const w2 = textWidth(textLine2);
  const textBlockW = max(w1, w2);

  const qrSize = 140; // toned down
  const gap = 24;

  const panelW = paddingX * 2 + textBlockW + gap + qrSize;
  const panelH = paddingY * 2 + max(lineH * 2, qrSize * 0.8);

  const panelX = 32;
  const panelY = height - 280; // nudged a bit higher to clear the new bar

  push();
  noStroke();

  // slightly more transparent now
  fill(0, 130);
  rect(panelX, panelY, panelW, panelH, 12);

  fill(255);
  text(textLine1, panelX + paddingX, panelY + paddingY);

  fill(200);
  text(textLine2, panelX + paddingX, panelY + paddingY + lineH);

  if (qrImg) {
    const qrX = panelX + paddingX + textBlockW + gap;
    const qrY = panelY + (panelH - qrSize) / 2;

    // soften brightness a tad
    push();
    tint(255, 180);
    image(qrImg, qrX, qrY, qrSize, qrSize);
    pop();
  }

  pop();
}



// =====================
// FIREBASE SETUP/LISTEN
// =====================

// This runs once in setup()
function initFirebase() {
  // NOTE: Using your actual config values + db URL
  const firebaseConfig = {
    apiKey: "AIzaSyCdXqb4ThSjMV0nVwWwcxpix6xah9Rb9xc",
    authDomain: "echo-garden-15462.firebaseapp.com",
    databaseURL: "https://echo-garden-15462-default-rtdb.firebaseio.com",
    projectId: "echo-garden-15462",
    storageBucket: "echo-garden-15462.firebasestorage.app",
    messagingSenderId: "487946881725",
    appId: "1:487946881725:web:dff84445b0822d5fe145d4"
  };

  firebase.initializeApp(firebaseConfig);
  firebaseReady = true;

  startFirebaseListener();
}

function startFirebaseListener() {
  if (!firebaseReady) return;

  // listen to new submissions coming in
  const ref = firebase.database().ref('echoGarden/submissions');

  ref.on('child_added', snap => {
    const val = snap.val();
    if (val && val.text) {
      injectRemoteText(val.text, val.timestamp);
    }
  });
}


// =====================
// HELPERS
// =====================
function readyMask(img) {
  return img && img.width > 0 ? img : null;
}

function getBrightnessFast(img, x, y, pixels) {
  const idx = 4 * (y * img.width + x);
  const r = pixels[idx];
  const g = pixels[idx + 1];
  const b = pixels[idx + 2];
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
