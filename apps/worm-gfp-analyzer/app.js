const canvas = document.getElementById("imageCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const state = {
  width: 1024,
  height: 1024,
  dic: null,
  gfp: null,
  wormMask: null,
  gfpMask: null,
  gfpBaseMask: null,
  gfpManualAdd: null,
  gfpManualErase: null,
  view: "dic",
  stage: "worm",
  tool: "worm-outline",
  brushSize: 24,
  plane: 1,
  planeCount: 49,
  anchors: [],
  dragTarget: null,
  outlineClosed: false,
  outlineApproved: false,
  gfpApproved: false,
  assistMode: false,
  guidePoints: [],
  debugMode: "threshold",
  debugThreshold: 34,
  debugCleanup: 3,
  debugMasks: null,
  drawing: false,
  dragDirty: false,
  paintDirty: false,
  renderQueued: false,
  gfpMaskTimer: null,
  undoStack: [],
  planeStates: new Map(),
};

const els = {
  gfpThreshold: document.getElementById("gfpThreshold"),
  minObject: document.getElementById("minObject"),
  brushSize: document.getElementById("brushSize"),
  debugThreshold: document.getElementById("debugThreshold"),
  debugCleanup: document.getElementById("debugCleanup"),
  debugStatus: document.getElementById("debugStatus"),
  planeSlider: document.getElementById("planeSlider"),
  planeLabel: document.getElementById("planeLabel"),
  planeDashboard: document.getElementById("planeDashboard"),
  planeProgress: document.getElementById("planeProgress"),
  outlineStatus: document.getElementById("outlineStatus"),
  gfpStatus: document.getElementById("gfpStatus"),
  wormPanel: document.getElementById("wormPanel"),
  gfpPanel: document.getElementById("gfpPanel"),
  wormBadge: document.getElementById("wormBadge"),
  gfpBadge: document.getElementById("gfpBadge"),
  approveGfpBtn: document.getElementById("approveGfpBtn"),
  statusText: document.getElementById("statusText"),
  cursorText: document.getElementById("cursorText"),
  wormArea: document.getElementById("wormArea"),
  gfpArea: document.getElementById("gfpArea"),
  gfpPercent: document.getElementById("gfpPercent"),
  integratedGfp: document.getElementById("integratedGfp"),
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function getGrayPixels(image) {
  const offscreen = document.createElement("canvas");
  offscreen.width = state.width;
  offscreen.height = state.height;
  const off = offscreen.getContext("2d", { willReadFrequently: true });
  off.drawImage(image, 0, 0, state.width, state.height);
  const rgba = off.getImageData(0, 0, state.width, state.height).data;
  const gray = new Uint8ClampedArray(state.width * state.height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    gray[j] = Math.round((rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3);
  }
  return gray;
}

function cloneAnchors() {
  return state.anchors.map((p) => ({
    x: p.x,
    y: p.y,
    in: { ...p.in },
    out: { ...p.out },
  }));
}

function snapshotPlaneState() {
  if (!state.wormMask || !state.gfpMask) return;
  state.planeStates.set(state.plane, {
    anchors: cloneAnchors(),
    wormMask: new Uint8Array(state.wormMask),
    gfpMask: new Uint8Array(state.gfpMask),
    gfpBaseMask: new Uint8Array(state.gfpBaseMask),
    gfpManualAdd: new Uint8Array(state.gfpManualAdd),
    gfpManualErase: new Uint8Array(state.gfpManualErase),
    outlineClosed: state.outlineClosed,
    outlineApproved: state.outlineApproved,
    gfpApproved: state.gfpApproved,
    gfpThreshold: Number(els.gfpThreshold.value),
    minObject: Number(els.minObject.value),
  });
}

function restorePlaneState(plane) {
  const saved = state.planeStates.get(plane);
  if (!saved) return false;
  state.anchors = saved.anchors.map((p) => ({
    x: p.x,
    y: p.y,
    in: { ...p.in },
    out: { ...p.out },
  }));
  state.wormMask = new Uint8Array(saved.wormMask);
  state.gfpMask = new Uint8Array(saved.gfpMask);
  state.gfpBaseMask = new Uint8Array(saved.gfpBaseMask || state.width * state.height);
  state.gfpManualAdd = new Uint8Array(saved.gfpManualAdd || state.width * state.height);
  state.gfpManualErase = new Uint8Array(saved.gfpManualErase || state.width * state.height);
  state.outlineClosed = saved.outlineClosed;
  state.outlineApproved = saved.outlineApproved;
  state.gfpApproved = saved.gfpApproved || false;
  if (saved.gfpThreshold !== undefined) els.gfpThreshold.value = saved.gfpThreshold;
  if (saved.minObject !== undefined) els.minObject.value = saved.minObject;
  return true;
}

function pushUndo() {
  state.undoStack.push({
    wormMask: new Uint8Array(state.wormMask),
    gfpMask: new Uint8Array(state.gfpMask),
    gfpBaseMask: new Uint8Array(state.gfpBaseMask),
    gfpManualAdd: new Uint8Array(state.gfpManualAdd),
    gfpManualErase: new Uint8Array(state.gfpManualErase),
    anchors: cloneAnchors(),
    outlineClosed: state.outlineClosed,
    outlineApproved: state.outlineApproved,
    gfpApproved: state.gfpApproved,
  });
  if (state.undoStack.length > 20) state.undoStack.shift();
}

function restoreUndo() {
  const previous = state.undoStack.pop();
  if (!previous) return;
  state.wormMask = previous.wormMask;
  state.gfpMask = previous.gfpMask;
  state.gfpBaseMask = previous.gfpBaseMask;
  state.gfpManualAdd = previous.gfpManualAdd;
  state.gfpManualErase = previous.gfpManualErase;
  state.anchors = previous.anchors;
  state.outlineClosed = previous.outlineClosed;
  state.outlineApproved = previous.outlineApproved;
  state.gfpApproved = previous.gfpApproved;
  clampGfpToWorm();
  updateOutlineStatus();
  updateGfpStatus();
  render();
}

function autoGfpMask(saveUndo = true) {
  if (saveUndo) pushUndo();
  if (saveUndo) state.gfpApproved = false;
  const threshold = Number(els.gfpThreshold.value);
  const mask = new Uint8Array(state.width * state.height);
  for (let i = 0; i < state.gfp.length; i += 1) {
    mask[i] = state.wormMask[i] && state.gfp[i] >= threshold ? 1 : 0;
  }
  state.gfpBaseMask = removeSmallComponents(mask, Number(els.minObject.value));
  state.gfpMask = applyGfpCorrections(state.gfpBaseMask);
  updateGfpStatus();
  updateWorkflowUi();
  render();
}

function scheduleAutoGfpMask() {
  clearTimeout(state.gfpMaskTimer);
  els.gfpStatus.textContent = "Updating GFP selection...";
  state.gfpMaskTimer = setTimeout(() => {
    state.gfpMaskTimer = null;
    state.gfpApproved = false;
    autoGfpMask(false);
  }, 90);
}

function applyGfpCorrections(baseMask) {
  const corrected = new Uint8Array(baseMask);
  clampGfpCorrectionsToWorm();
  for (let i = 0; i < corrected.length; i += 1) {
    if (state.gfpManualAdd[i] && state.wormMask[i]) corrected[i] = 1;
    if (state.gfpManualErase[i]) corrected[i] = 0;
    if (!state.wormMask[i]) corrected[i] = 0;
  }
  return corrected;
}

function largestComponent(mask) {
  const seen = new Uint8Array(mask.length);
  let best = [];
  const queue = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const current = [];
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;
    for (let q = 0; q < queue.length; q += 1) {
      const idx = queue[q];
      current.push(idx);
      const x = idx % state.width;
      const y = Math.floor(idx / state.width);
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < state.width - 1 ? idx + 1 : -1,
        y > 0 ? idx - state.width : -1,
        y < state.height - 1 ? idx + state.width : -1,
      ];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    if (current.length > best.length) best = current;
  }
  const out = new Uint8Array(mask.length);
  for (const idx of best) out[idx] = 1;
  return out;
}

function removeSmallComponents(mask, minSize) {
  if (minSize <= 0) return mask;
  const seen = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const queue = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const current = [];
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;
    for (let q = 0; q < queue.length; q += 1) {
      const idx = queue[q];
      current.push(idx);
      const x = idx % state.width;
      const y = Math.floor(idx / state.width);
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < state.width - 1 ? idx + 1 : -1,
        y > 0 ? idx - state.width : -1,
        y < state.height - 1 ? idx + state.width : -1,
      ];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    if (current.length >= minSize) {
      for (const idx of current) out[idx] = 1;
    }
  }
  return out;
}

function clampGfpToWorm() {
  for (let i = 0; i < state.gfpMask.length; i += 1) {
    if (!state.wormMask[i]) state.gfpMask[i] = 0;
  }
  if (state.gfpManualAdd && state.gfpManualErase) clampGfpCorrectionsToWorm();
}

function clampGfpCorrectionsToWorm() {
  for (let i = 0; i < state.wormMask.length; i += 1) {
    if (state.wormMask[i]) continue;
    state.gfpManualAdd[i] = 0;
    state.gfpManualErase[i] = 0;
  }
}

function updateGfpStatus() {
  if (!state.outlineApproved) {
    els.gfpStatus.textContent = "Viewing GFP is allowed for choosing the plane. Approve the worm mask before editing or approving GFP.";
    return;
  }
  let thresholdCount = 0;
  let finalCount = 0;
  let addCount = 0;
  let eraseCount = 0;
  for (let i = 0; i < state.gfpManualAdd.length; i += 1) {
    thresholdCount += state.gfpBaseMask[i] && state.wormMask[i] ? 1 : 0;
    finalCount += state.gfpMask[i] && state.wormMask[i] ? 1 : 0;
    addCount += state.gfpManualAdd[i];
    eraseCount += state.gfpManualErase[i];
  }
  const approval = state.gfpApproved ? "YES APPROVED. " : "";
  els.gfpStatus.textContent = `${approval}Threshold selects ${thresholdCount.toLocaleString()} px. Final GFP is ${finalCount.toLocaleString()} px after ${addCount.toLocaleString()} manually added and ${eraseCount.toLocaleString()} manually removed.`;
}

function planeApprovalState(plane) {
  if (plane === state.plane) {
    return { worm: state.outlineApproved, gfp: state.gfpApproved };
  }
  const saved = state.planeStates.get(plane);
  return {
    worm: saved ? saved.outlineApproved : false,
    gfp: saved ? saved.gfpApproved : false,
  };
}

function renderPlaneDashboard() {
  if (!els.planeDashboard) return;
  let complete = 0;
  const tiles = [];
  for (let plane = 1; plane <= state.planeCount; plane += 1) {
    const approval = planeApprovalState(plane);
    if (approval.worm && approval.gfp) complete += 1;
    const classes = ["plane-tile"];
    if (plane === state.plane) classes.push("current");
    if (approval.worm && approval.gfp) classes.push("complete");
    tiles.push(`
      <button class="${classes.join(" ")}" type="button" data-plane="${plane}" data-stage-target="worm" aria-label="Plane ${plane}">
        <span class="plane-num">${plane}</span>
        <span class="plane-lights">
          <span class="plane-light ${approval.worm ? "done" : ""}" data-plane="${plane}" data-stage-target="worm" title="Worm mask"></span>
          <span class="plane-light ${approval.gfp ? "done" : ""}" data-plane="${plane}" data-stage-target="gfp" title="GFP mask"></span>
        </span>
      </button>
    `);
  }
  els.planeDashboard.innerHTML = tiles.join("");
  els.planeProgress.textContent = `${complete} / ${state.planeCount} complete`;
}

function makeAnchor(x, y) {
  return { x, y, in: { x, y }, out: { x, y } };
}

function autoHandles(saveUndo = true) {
  if (state.anchors.length < 2) return;
  if (saveUndo) pushUndo();
  const count = state.anchors.length;
  state.anchors.forEach((anchor, i) => {
    const prev = state.anchors[(i - 1 + count) % count];
    const next = state.anchors[(i + 1) % count];
    if (!state.outlineClosed && i === 0) {
      anchor.in = { x: anchor.x, y: anchor.y };
      anchor.out = {
        x: anchor.x + (next.x - anchor.x) * 0.32,
        y: anchor.y + (next.y - anchor.y) * 0.32,
      };
      return;
    }
    if (!state.outlineClosed && i === count - 1) {
      anchor.in = {
        x: anchor.x + (prev.x - anchor.x) * 0.32,
        y: anchor.y + (prev.y - anchor.y) * 0.32,
      };
      anchor.out = { x: anchor.x, y: anchor.y };
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    anchor.in = { x: anchor.x - dx * 0.16, y: anchor.y - dy * 0.16 };
    anchor.out = { x: anchor.x + dx * 0.16, y: anchor.y + dy * 0.16 };
  });
  updateMaskFromPath(false);
}

function pathFromAnchors() {
  const path = new Path2D();
  if (!state.anchors.length) return path;
  path.moveTo(state.anchors[0].x, state.anchors[0].y);
  for (let i = 0; i < state.anchors.length - 1; i += 1) {
    const a = state.anchors[i];
    const b = state.anchors[i + 1];
    path.bezierCurveTo(a.out.x, a.out.y, b.in.x, b.in.y, b.x, b.y);
  }
  if (state.outlineClosed && state.anchors.length >= 3) {
    const last = state.anchors[state.anchors.length - 1];
    const first = state.anchors[0];
    path.bezierCurveTo(last.out.x, last.out.y, first.in.x, first.in.y, first.x, first.y);
    path.closePath();
  }
  return path;
}

function updateMaskFromPath(saveUndo = false) {
  if (!state.outlineClosed || state.anchors.length < 3) {
    render();
    return;
  }
  if (saveUndo) pushUndo();
  const path = pathFromAnchors();
  const mask = new Uint8Array(state.width * state.height);
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (ctx.isPointInPath(path, x, y)) mask[y * state.width + x] = 1;
    }
  }
  state.wormMask = mask;
  state.outlineApproved = false;
  state.gfpApproved = false;
  clampGfpToWorm();
  autoGfpMask(false);
  updateOutlineStatus();
  render();
}

function closePath() {
  if (state.anchors.length < 3) return;
  pushUndo();
  state.outlineClosed = true;
  autoHandles(false);
  updateMaskFromPath(false);
}

function draftOutline() {
  state.assistMode = true;
  state.guidePoints = [];
  state.outlineApproved = false;
  state.gfpApproved = false;
  setActiveTool("worm-outline");
  els.outlineStatus.textContent = "Body path mode: click tail, optional bends, then head. Click Generate from body path when done.";
  updateCursorText();
  render();
}

function generateGuideOutline() {
  if (state.guidePoints.length < 2) {
    els.outlineStatus.textContent = "Guide needs at least tail and head points.";
    return;
  }
  pushUndo();
  const path = smoothOpenPolyline(resampleOpenPolyline(state.guidePoints, 10), 4);
  const boundary = boundaryFromGuide(path);
  if (boundary.length < 8) {
    els.outlineStatus.textContent = "Could not estimate a boundary from that body path. Try adding one or two bend points.";
    render();
    return;
  }

  state.anchors = anchorsFromBoundary(boundary, 14);
  state.outlineClosed = true;
  state.outlineApproved = false;
  state.gfpApproved = false;
  state.assistMode = false;
  setActiveTool("worm-outline");
  updateMaskFromPath(false);
  els.outlineStatus.textContent = "DIC boundary generated. Drag pink anchors or blue handles, then approve the worm mask.";
  updateCursorText();
}

function boundaryFromGuide(path) {
  const left = [];
  const right = [];
  const frames = [];
  for (let i = 0; i < path.length; i += 1) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    frames.push({ nx: -dy / len, ny: dx / len });
  }
  const plusDistances = smoothNumberSeries(trackDicEdgeDistances(path, frames, 1), 2);
  const minusDistances = smoothNumberSeries(trackDicEdgeDistances(path, frames, -1), 2);
  for (let i = 0; i < path.length; i += 1) {
    const taper = endpointTaper(i, path.length);
    const plus = plusDistances[i] * taper;
    const minus = minusDistances[i] * taper;
    left.push({ x: path[i].x + frames[i].nx * plus, y: path[i].y + frames[i].ny * plus });
    right.push({ x: path[i].x - frames[i].nx * minus, y: path[i].y - frames[i].ny * minus });
  }
  return [...left, ...right.reverse()];
}

function trackDicEdgeDistances(path, frames, side) {
  const candidatesByPoint = path.map((point, i) =>
    dicEdgeCandidates(point, frames[i].nx * side, frames[i].ny * side),
  );
  const scores = [];
  const parents = [];
  for (let i = 0; i < candidatesByPoint.length; i += 1) {
    const candidates = candidatesByPoint[i];
    scores[i] = new Array(candidates.length).fill(-Infinity);
    parents[i] = new Array(candidates.length).fill(-1);
    if (i === 0) {
      for (let c = 0; c < candidates.length; c += 1) {
        scores[i][c] = candidates[c].score - Math.abs(candidates[c].distance - 32) * 0.08;
      }
      continue;
    }
    const previous = candidatesByPoint[i - 1];
    for (let c = 0; c < candidates.length; c += 1) {
      for (let p = 0; p < previous.length; p += 1) {
        const jump = Math.abs(candidates[c].distance - previous[p].distance);
        const smoothnessPenalty = jump * 1.15 + jump * jump * 0.018;
        const score = scores[i - 1][p] + candidates[c].score - smoothnessPenalty;
        if (score > scores[i][c]) {
          scores[i][c] = score;
          parents[i][c] = p;
        }
      }
    }
  }
  const distances = new Array(path.length).fill(30);
  let bestIndex = 0;
  const lastScores = scores[scores.length - 1] || [];
  for (let i = 1; i < lastScores.length; i += 1) {
    if (lastScores[i] > lastScores[bestIndex]) bestIndex = i;
  }
  for (let i = path.length - 1; i >= 0; i -= 1) {
    distances[i] = candidatesByPoint[i][bestIndex].distance;
    bestIndex = parents[i][bestIndex];
    if (bestIndex < 0) bestIndex = 0;
  }
  return distances;
}

function dicEdgeCandidates(point, nx, ny) {
  const candidates = [];
  const center = sampleDic(point.x, point.y);
  for (let d = 8; d <= 96; d += 2) {
    const inner = sampleDic(point.x + nx * Math.max(0, d - 5), point.y + ny * Math.max(0, d - 5));
    const outer = sampleDic(point.x + nx * (d + 5), point.y + ny * (d + 5));
    const before = sampleDic(point.x + nx * Math.max(0, d - 1), point.y + ny * Math.max(0, d - 1));
    const after = sampleDic(point.x + nx * (d + 1), point.y + ny * (d + 1));
    const edgeStrength = Math.abs(outer - inner);
    const localGradient = Math.abs(after - before);
    const outsideShift = Math.abs(outer - center);
    const distancePenalty = Math.abs(d - 34) * 0.07;
    candidates.push({
      distance: d,
      score: edgeStrength * 1.25 + localGradient * 0.75 + outsideShift * 0.1 - distancePenalty,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 18).sort((a, b) => a.distance - b.distance);
}

function sampleDic(x, y) {
  const ix = Math.max(0, Math.min(state.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(state.height - 1, Math.round(y)));
  return state.dic[iy * state.width + ix];
}

function smoothNumberSeries(values, passes) {
  let current = values.slice();
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((value, i) => {
      if (i === 0 || i === current.length - 1) return value;
      return (current[i - 1] + value * 2 + current[i + 1]) / 4;
    });
  }
  return current;
}

function smoothWidths(widths, passes) {
  let current = widths.map((w) => ({ ...w }));
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((item, i) => {
      if (i === 0 || i === current.length - 1) return item;
      return {
        ...item,
        plus: (current[i - 1].plus + item.plus * 2 + current[i + 1].plus) / 4,
        minus: (current[i - 1].minus + item.minus * 2 + current[i + 1].minus) / 4,
      };
    });
  }
  return current;
}

function bestDicBlob(tail, head) {
  const values = Array.from(state.dic);
  values.sort((a, b) => a - b);
  let best = null;
  for (const q of [0.22, 0.28, 0.34, 0.40, 0.48, 0.56, 0.64]) {
    const threshold = values[Math.floor(values.length * q)];
    const mask = new Uint8Array(state.width * state.height);
    for (let i = 0; i < state.dic.length; i += 1) {
      mask[i] = state.dic[i] <= threshold ? 1 : 0;
    }
    closeBinary(mask, 3);
    const components = connectedComponents(mask);
    for (const component of components) {
      if (component.area < 2500 || component.area > state.width * state.height * 0.45) continue;
      const tailDistance = distanceToMask(tail, component.mask, 90);
      const headDistance = distanceToMask(head, component.mask, 90);
      if (tailDistance > 45 || headDistance > 45) continue;
      const width = component.maxX - component.minX + 1;
      const height = component.maxY - component.minY + 1;
      const longSide = Math.max(width, height);
      const shortSide = Math.max(1, Math.min(width, height));
      const elongation = longSide / shortSide;
      const endpointSpan = Math.hypot(tail.x - head.x, tail.y - head.y);
      const spanScore = endpointSpan / Math.max(1, longSide);
      const areaPenalty = Math.abs(component.area - 55000) / 55000;
      const score =
        elongation * 14 +
        Math.min(2, spanScore) * 12 -
        (tailDistance + headDistance) * 0.7 -
        areaPenalty * 6 -
        q * 2;
      if (!best || score > best.score) best = { ...component, score };
    }
  }
  return best;
}

function refreshDebugMasks() {
  const thresholdPercent = Number(els.debugThreshold.value) / 100;
  const cleanupRadius = Number(els.debugCleanup.value);
  const values = Array.from(state.dic);
  values.sort((a, b) => a - b);
  const threshold = values[Math.floor(values.length * thresholdPercent)];
  const thresholdMask = new Uint8Array(state.width * state.height);
  for (let i = 0; i < state.dic.length; i += 1) {
    thresholdMask[i] = state.dic[i] <= threshold ? 1 : 0;
  }
  const cleanedMask = new Uint8Array(thresholdMask);
  if (cleanupRadius > 0) closeBinary(cleanedMask, cleanupRadius);
  const components = connectedComponents(cleanedMask).sort((a, b) => b.area - a.area);
  const selected = components[0] || null;
  const selectedMask = selected ? selected.mask : new Uint8Array(state.width * state.height);
  const contour = contourFromMask(selectedMask);
  state.debugMasks = {
    threshold: thresholdMask,
    cleaned: cleanedMask,
    selected: selectedMask,
    contour,
    thresholdValue: threshold,
    selectedArea: selected ? selected.area : 0,
    componentCount: components.length,
  };
  els.debugStatus.textContent = `threshold ${threshold}, components ${components.length}, selected area ${selected ? selected.area.toLocaleString() : 0}px`;
  render();
}

function connectedComponents(mask) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  const queue = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    let minX = state.width;
    let minY = state.height;
    let maxX = -1;
    let maxY = -1;
    const componentMask = new Uint8Array(mask.length);
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;
    for (let q = 0; q < queue.length; q += 1) {
      const idx = queue[q];
      componentMask[idx] = 1;
      area += 1;
      const x = idx % state.width;
      const y = Math.floor(idx / state.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < state.width - 1 ? idx + 1 : -1,
        y > 0 ? idx - state.width : -1,
        y < state.height - 1 ? idx + state.width : -1,
      ];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    components.push({ mask: componentMask, area, minX, minY, maxX, maxY });
  }
  return components;
}

function closeBinary(mask, radius) {
  dilateBinary(mask, radius);
  erodeBinary(mask, radius);
  fillInternalHoles(mask);
}

function dilateBinary(mask, radius) {
  const source = new Uint8Array(mask);
  const r2 = radius * radius;
  for (let y = radius; y < state.height - radius; y += 1) {
    for (let x = radius; x < state.width - radius; x += 1) {
      const idx = y * state.width + x;
      if (source[idx]) continue;
      for (let yy = -radius; yy <= radius; yy += 1) {
        for (let xx = -radius; xx <= radius; xx += 1) {
          if (xx * xx + yy * yy > r2) continue;
          if (source[idx + yy * state.width + xx]) {
            mask[idx] = 1;
            yy = radius + 1;
            break;
          }
        }
      }
    }
  }
}

function erodeBinary(mask, radius) {
  const source = new Uint8Array(mask);
  const r2 = radius * radius;
  for (let y = radius; y < state.height - radius; y += 1) {
    for (let x = radius; x < state.width - radius; x += 1) {
      const idx = y * state.width + x;
      if (!source[idx]) continue;
      for (let yy = -radius; yy <= radius; yy += 1) {
        for (let xx = -radius; xx <= radius; xx += 1) {
          if (xx * xx + yy * yy > r2) continue;
          if (!source[idx + yy * state.width + xx]) {
            mask[idx] = 0;
            yy = radius + 1;
            break;
          }
        }
      }
    }
  }
}

function fillInternalHoles(mask) {
  const outside = new Uint8Array(mask.length);
  const queue = [];
  for (let x = 0; x < state.width; x += 1) {
    enqueueIfBackground(x, 0);
    enqueueIfBackground(x, state.height - 1);
  }
  for (let y = 0; y < state.height; y += 1) {
    enqueueIfBackground(0, y);
    enqueueIfBackground(state.width - 1, y);
  }
  for (let q = 0; q < queue.length; q += 1) {
    const idx = queue[q];
    const x = idx % state.width;
    const y = Math.floor(idx / state.width);
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < state.width - 1 ? idx + 1 : -1,
      y > 0 ? idx - state.width : -1,
      y < state.height - 1 ? idx + state.width : -1,
    ];
    for (const next of neighbors) {
      if (next >= 0 && !mask[next] && !outside[next]) {
        outside[next] = 1;
        queue.push(next);
      }
    }
  }
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] && !outside[i]) mask[i] = 1;
  }

  function enqueueIfBackground(x, y) {
    const idx = y * state.width + x;
    if (!mask[idx] && !outside[idx]) {
      outside[idx] = 1;
      queue.push(idx);
    }
  }
}

function distanceToMask(point, mask, maxDistance) {
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (px >= 0 && py >= 0 && px < state.width && py < state.height && mask[py * state.width + px]) return 0;
  for (let r = 1; r <= maxDistance; r += 1) {
    for (let y = Math.max(0, py - r); y <= Math.min(state.height - 1, py + r); y += 1) {
      for (let x = Math.max(0, px - r); x <= Math.min(state.width - 1, px + r); x += 1) {
        if ((x !== px - r && x !== px + r && y !== py - r && y !== py + r) || !mask[y * state.width + x]) continue;
        return Math.hypot(x - point.x, y - point.y);
      }
    }
  }
  return maxDistance + 1;
}

function contourFromMask(mask) {
  const points = [];
  for (let y = 1; y < state.height - 1; y += 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      const idx = y * state.width + x;
      if (!mask[idx]) continue;
      if (!mask[idx - 1] || !mask[idx + 1] || !mask[idx - state.width] || !mask[idx + state.width]) {
        points.push({ x, y });
      }
    }
  }
  return orderBoundaryPoints(points);
}

function orderBoundaryPoints(points) {
  if (!points.length) return [];
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

function shortestDicPath(tail, head, mask) {
  const margin = 190;
  const minX = Math.max(0, Math.floor(Math.min(tail.x, head.x) - margin));
  const minY = Math.max(0, Math.floor(Math.min(tail.y, head.y) - margin));
  const maxX = Math.min(state.width - 1, Math.ceil(Math.max(tail.x, head.x) + margin));
  const maxY = Math.min(state.height - 1, Math.ceil(Math.max(tail.y, head.y) + margin));
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const size = w * h;
  const start = localIndex(tail);
  const goal = localIndex(head);
  const dist = new Float64Array(size);
  const parent = new Int32Array(size);
  const visited = new Uint8Array(size);
  dist.fill(Infinity);
  parent.fill(-1);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(start, 0);

  while (heap.size()) {
    const item = heap.pop();
    const idx = item.index;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (idx === goal) break;
    const x = idx % w;
    const y = Math.floor(idx / w);
    for (let yy = -1; yy <= 1; yy += 1) {
      for (let xx = -1; xx <= 1; xx += 1) {
        if (xx === 0 && yy === 0) continue;
        const nx = x + xx;
        const ny = y + yy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (visited[next]) continue;
        const global = (ny + minY) * state.width + nx + minX;
        const step = Math.hypot(xx, yy);
        const intensity = state.dic[global] / 255;
        const maskPenalty = mask[global] ? 0 : 7;
        const cost = step * (1 + intensity * 3.5 + maskPenalty);
        const nextDist = dist[idx] + cost;
        if (nextDist < dist[next]) {
          dist[next] = nextDist;
          parent[next] = idx;
          heap.push(next, nextDist + Math.hypot(nx - (goal % w), ny - Math.floor(goal / w)) * 0.2);
        }
      }
    }
  }

  if (!Number.isFinite(dist[goal])) return [];
  const path = [];
  let current = goal;
  while (current >= 0) {
    path.push({ x: (current % w) + minX, y: Math.floor(current / w) + minY });
    if (current === start) break;
    current = parent[current];
  }
  path.reverse();
  return smoothOpenPolyline(resampleOpenPolyline(path, 10), 4);

  function localIndex(point) {
    const x = Math.max(0, Math.min(w - 1, Math.round(point.x) - minX));
    const y = Math.max(0, Math.min(h - 1, Math.round(point.y) - minY));
    return y * w + x;
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  size() {
    return this.items.length;
  }
  push(index, priority) {
    this.items.push({ index, priority });
    this.bubbleUp(this.items.length - 1);
  }
  pop() {
    const top = this.items[0];
    const end = this.items.pop();
    if (this.items.length) {
      this.items[0] = end;
      this.sinkDown(0);
    }
    return top;
  }
  bubbleUp(n) {
    const item = this.items[n];
    while (n > 0) {
      const parentN = Math.floor((n - 1) / 2);
      const parent = this.items[parentN];
      if (item.priority >= parent.priority) break;
      this.items[parentN] = item;
      this.items[n] = parent;
      n = parentN;
    }
  }
  sinkDown(n) {
    const length = this.items.length;
    const item = this.items[n];
    while (true) {
      const leftN = n * 2 + 1;
      const rightN = leftN + 1;
      let swap = null;
      if (leftN < length && this.items[leftN].priority < item.priority) swap = leftN;
      if (
        rightN < length &&
        this.items[rightN].priority < (swap === null ? item.priority : this.items[leftN].priority)
      ) {
        swap = rightN;
      }
      if (swap === null) break;
      this.items[n] = this.items[swap];
      this.items[swap] = item;
      n = swap;
    }
  }
}

function roughWormMask() {
  const values = Array.from(state.dic);
  values.sort((a, b) => a - b);
  const threshold = values[Math.floor(values.length * 0.34)];
  const mask = new Uint8Array(state.width * state.height);
  for (let i = 0; i < state.dic.length; i += 1) {
    mask[i] = state.dic[i] <= threshold ? 1 : 0;
  }
  return largestComponent(mask);
}

function longestMaskPath(mask) {
  const start = mask.findIndex((v) => v);
  if (start < 0) return [];
  const first = bfsFarthest(mask, start, false);
  const second = bfsFarthest(mask, first.farthest, true);
  const path = [];
  let current = second.farthest;
  while (current >= 0) {
    path.push(indexPoint(current));
    if (current === first.farthest) break;
    current = second.parent[current];
  }
  path.reverse();
  return smoothOpenPolyline(resampleOpenPolyline(path, 12), 5);
}

function bfsFarthest(mask, start, keepParent) {
  const dist = new Int32Array(mask.length);
  dist.fill(-1);
  const parent = keepParent ? new Int32Array(mask.length) : null;
  if (parent) parent.fill(-1);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  let farthest = start;

  while (head < tail) {
    const idx = queue[head++];
    if (dist[idx] > dist[farthest]) farthest = idx;
    const x = idx % state.width;
    const y = Math.floor(idx / state.width);
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < state.width - 1 ? idx + 1 : -1,
      y > 0 ? idx - state.width : -1,
      y < state.height - 1 ? idx + state.width : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || !mask[next] || dist[next] >= 0) continue;
      dist[next] = dist[idx] + 1;
      if (parent) parent[next] = idx;
      queue[tail++] = next;
    }
  }
  return { farthest, parent };
}

function indexPoint(index) {
  return { x: index % state.width, y: Math.floor(index / state.width) };
}

function resampleOpenPolyline(points, step) {
  if (points.length < 2) return points;
  const sampled = [{ ...points[0] }];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    let travelled = step - carry;
    while (travelled <= length) {
      const t = travelled / length;
      sampled.push({ x: a.x + dx * t, y: a.y + dy * t });
      travelled += step;
    }
    carry = length - (travelled - step);
  }
  sampled.push({ ...points[points.length - 1] });
  return sampled;
}

function smoothOpenPolyline(points, passes) {
  let current = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((point, i) => {
      if (i === 0 || i === current.length - 1) return point;
      return {
        x: (current[i - 1].x + point.x * 2 + current[i + 1].x) / 4,
        y: (current[i - 1].y + point.y * 2 + current[i + 1].y) / 4,
      };
    });
  }
  return current;
}

function boundaryFromPath(path, mask) {
  const centers = [];
  const left = [];
  const right = [];
  for (let i = 0; i < path.length; i += 1) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const plus = scanMaskDistance(path[i], nx, ny, mask);
    const minus = scanMaskDistance(path[i], -nx, -ny, mask);
    const cx = path[i].x + nx * ((plus - minus) / 2);
    const cy = path[i].y + ny * ((plus - minus) / 2);
    const radius = Math.max(7, (plus + minus) / 2);
    centers.push({ x: cx, y: cy, nx, ny, radius });
  }

  const smoothedCenters = smoothOpenPolyline(centers, 3);
  for (let i = 0; i < smoothedCenters.length; i += 1) {
    const c = smoothedCenters[i];
    const raw = centers[i];
    const taper = endpointTaper(i, smoothedCenters.length);
    const radius = raw.radius * taper;
    left.push({ x: c.x + raw.nx * radius, y: c.y + raw.ny * radius });
    right.push({ x: c.x - raw.nx * radius, y: c.y - raw.ny * radius });
  }
  return [...left, ...right.reverse()];
}

function scanMaskDistance(point, nx, ny, mask) {
  const max = 120;
  let lastInside = 0;
  for (let d = 1; d <= max; d += 1) {
    const x = Math.round(point.x + nx * d);
    const y = Math.round(point.y + ny * d);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) break;
    if (!mask[y * state.width + x]) break;
    lastInside = d;
  }
  return lastInside;
}

function endpointTaper(index, count) {
  if (count <= 1) return 1;
  const t = index / (count - 1);
  const endDistance = Math.min(t, 1 - t);
  return Math.max(0.32, Math.min(1, endDistance / 0.10));
}

function sampleClosedPoints(points, count) {
  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  const sampled = [];
  for (let s = 0; s < count; s += 1) {
    const target = (total * s) / count;
    let acc = 0;
    for (let i = 0; i < points.length; i += 1) {
      if (acc + lengths[i] >= target) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const t = lengths[i] ? (target - acc) / lengths[i] : 0;
        sampled.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
      }
      acc += lengths[i];
    }
  }
  return sampled;
}

function anchorsFromBoundary(boundary, count) {
  const sampled = sampleClosedPoints(boundary, count);
  const boundaryLookup = sampled.map((point) => nearestBoundaryIndex(boundary, point));
  return sampled.map((point, i) => {
    const prev = sampled[(i - 1 + sampled.length) % sampled.length];
    const next = sampled[(i + 1) % sampled.length];
    const prevDistance = Math.hypot(point.x - prev.x, point.y - prev.y);
    const nextDistance = Math.hypot(next.x - point.x, next.y - point.y);
    const tangent = boundaryTangent(boundary, boundaryLookup[i], 7);
    const tangentLength = Math.min(prevDistance, nextDistance) * 0.34;
    const dx = tangent.x;
    const dy = tangent.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    return {
      x: point.x,
      y: point.y,
      in: { x: point.x - tx * tangentLength, y: point.y - ty * tangentLength },
      out: { x: point.x + tx * tangentLength, y: point.y + ty * tangentLength },
    };
  });
}

function nearestBoundaryIndex(boundary, point) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < boundary.length; i += 1) {
    const distance = Math.hypot(boundary[i].x - point.x, boundary[i].y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function boundaryTangent(boundary, index, span) {
  const count = boundary.length;
  const before = boundary[(index - span + count) % count];
  const after = boundary[(index + span) % count];
  return { x: after.x - before.x, y: after.y - before.y };
}

function updateOutlineStatus() {
  const points = state.anchors.length;
  if (state.outlineApproved) {
    els.outlineStatus.textContent = "YES APPROVED. GFP measurements are using this worm mask.";
  } else if (points < 3) {
    els.outlineStatus.textContent = "Click around the worm, then close the boundary and approve the mask.";
  } else if (!state.outlineClosed) {
    els.outlineStatus.textContent = `${points} anchors placed. Click Close boundary to fill the worm mask.`;
  } else {
    els.outlineStatus.textContent = `${points} anchors placed. Click path to add, drag anchors/handles, double-click anchor to delete.`;
  }
  updateGfpStatus();
  updateWorkflowUi();
}

function setActiveTool(tool) {
  if (tool.startsWith("gfp") && (!state.outlineApproved || state.stage !== "gfp")) {
    els.gfpStatus.textContent = "Approve the DIC worm mask before editing GFP.";
    return;
  }
  if (tool.startsWith("worm") && state.stage !== "worm") return;
  state.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  if (tool.startsWith("gfp")) setActiveView("gfp");
}

function setActiveStage(stage) {
  state.stage = stage;
  if (stage === "worm") {
    state.view = "dic";
    state.tool = "worm-outline";
  } else if (stage === "gfp") {
    state.view = "gfp";
    if (state.outlineApproved && !state.tool.startsWith("gfp")) state.tool = "gfp-add";
    if (!state.outlineApproved) state.tool = "worm-outline";
  } else if (stage === "results") {
    state.view = "mask";
    if (state.tool.startsWith("gfp")) state.tool = "worm-outline";
  }
  updateWorkflowUi();
  render();
}

function setActiveView(view) {
  state.view = view;
  if (state.view === "gfp" && state.outlineApproved && !state.tool.startsWith("gfp")) state.tool = "gfp-add";
  if (state.view === "gfp" && !state.outlineApproved && state.tool.startsWith("gfp")) state.tool = "worm-outline";
  if (state.view !== "gfp" && state.tool.startsWith("gfp")) state.tool = "worm-outline";
  if (state.view === "gfp") state.stage = "gfp";
  else if (state.stage === "gfp") state.stage = "worm";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === state.tool);
  });
  updateWorkflowUi();
  render();
}

function updateWorkflowUi() {
  if (!els.wormPanel) return;
  if (!state.outlineApproved && state.stage === "results") state.stage = "worm";
  if (state.view !== "gfp" && state.tool.startsWith("gfp")) state.tool = "worm-outline";
  if (!state.outlineApproved && state.tool.startsWith("gfp")) state.tool = "worm-outline";
  const inWormStage = state.stage === "worm";
  const inGfpStage = state.stage === "gfp";
  document.querySelectorAll("[data-stage-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.stagePanel !== state.stage;
  });
  document.querySelectorAll("[data-stage-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.stageTab === state.stage);
    button.disabled = button.dataset.stageTab === "results" && !state.outlineApproved;
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === state.tool);
  });
  els.wormPanel.classList.toggle("active-stage", inWormStage);
  els.gfpPanel.classList.toggle("active-stage", inGfpStage);
  els.wormPanel.classList.toggle("approved", state.outlineApproved);
  els.gfpPanel.classList.toggle("locked", !state.outlineApproved && !inGfpStage);
  els.wormBadge.textContent = state.outlineApproved ? "YES APPROVED" : "Needs review";
  els.gfpBadge.textContent = !state.outlineApproved ? (inGfpStage ? "Preview" : "Available") : state.gfpApproved ? "YES APPROVED" : "Needs review";
  els.wormBadge.dataset.state = state.outlineApproved ? "approved" : "review";
  els.gfpBadge.dataset.state = !state.outlineApproved ? (inGfpStage ? "ready" : "locked") : state.gfpApproved ? "approved" : "review";

  document.querySelectorAll(".gfp-tool, #resetGfpEditsBtn, #gfpThreshold, #minObject, #approveGfpBtn").forEach((el) => {
    el.disabled = !state.outlineApproved || !inGfpStage;
  });
  document
    .querySelectorAll(".worm-tool, #makeOutlineBtn, #autoHandlesBtn, #clearCurveBtn, #draftOutlineBtn, #generateGuideBtn, #approveOutlineBtn")
    .forEach((el) => {
      el.disabled = !inWormStage;
    });
  const approveButton = document.getElementById("approveOutlineBtn");
  if (approveButton) {
    approveButton.textContent = state.outlineApproved ? "✓ YES APPROVED" : "Approve worm mask";
    approveButton.classList.toggle("approved", state.outlineApproved);
  }
  if (els.approveGfpBtn) {
    els.approveGfpBtn.textContent = state.gfpApproved ? "✓ YES APPROVED" : "Approve GFP mask";
    els.approveGfpBtn.classList.toggle("approved", state.gfpApproved);
  }
  renderPlaneDashboard();
}

function updateCursorText(point = null) {
  if (state.tool.includes("add") || state.tool.includes("erase")) {
    const prefix = point ? `x ${point.x}, y ${point.y}, ` : "";
    els.cursorText.textContent = `${prefix}brush ${state.brushSize} px`;
  } else if (state.assistMode) {
    els.cursorText.textContent = "Body path clicks";
  } else {
    els.cursorText.textContent = "Boundary editing";
  }
}

function render() {
  state.renderQueued = false;
  if (state.view === "debug") {
    renderDebugView();
    return;
  }
  const image = ctx.createImageData(state.width, state.height);
  const data = image.data;
  let wormArea = 0;
  let gfpArea = 0;
  let integrated = 0;
  for (let i = 0, j = 0; i < state.dic.length; i += 1, j += 4) {
    const dic = state.dic[i];
    const gfp = state.gfp[i];
    const worm = state.wormMask[i];
    const gfpBase = state.gfpBaseMask[i] && worm;
    const gfpHit = state.gfpMask[i] && worm;
    const manualAdd = state.gfpManualAdd[i] && worm;
    const manualErase = state.gfpManualErase[i] && worm;
    if (worm) wormArea += 1;
    if (gfpHit) {
      gfpArea += 1;
      integrated += gfp;
    }
    let r = dic;
    let g = dic;
    let b = dic;
    if (state.view === "gfp") {
      r = 0;
      g = gfp;
      b = Math.round(gfp * 0.18);
    } else if (state.view === "mask") {
      r = worm ? 44 : 18;
      g = worm ? 120 : 18;
      b = worm ? 220 : 18;
    } else if (state.view === "overlay" && worm) {
      r = Math.min(255, dic + 18);
      g = Math.min(255, dic + 28);
      b = Math.min(255, dic + 62);
    }
    if (state.view === "gfp" && gfpBase) {
      r = 255;
      g = Math.max(160, Math.round(gfp * 0.35));
      b = 24;
    }
    if (gfpHit && (state.view === "overlay" || state.view === "mask")) {
      r = 22;
      g = 230;
      b = 78;
    }
    if (state.view === "gfp" && manualAdd) {
      r = 0;
      g = 220;
      b = 255;
    }
    if (state.view === "gfp" && manualErase) {
      r = 255;
      g = 44;
      b = 150;
    }
    data[j] = r;
    data[j + 1] = g;
    data[j + 2] = b;
    data[j + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  drawMaskBoundary();
  drawBezierEditor();
  els.wormArea.textContent = `${wormArea.toLocaleString()} px`;
  els.gfpArea.textContent = `${gfpArea.toLocaleString()} px`;
  els.gfpPercent.textContent = `${wormArea ? ((gfpArea / wormArea) * 100).toFixed(2) : "0.00"}%`;
  els.integratedGfp.textContent = Math.round(integrated).toLocaleString();
  els.statusText.textContent = `${state.view.toUpperCase()} view`;
}

function requestRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(render);
}

function renderDebugView() {
  state.renderQueued = false;
  if (!state.debugMasks) refreshDebugMasks();
  const image = ctx.createImageData(state.width, state.height);
  const data = image.data;
  const mask =
    state.debugMode === "cleaned"
      ? state.debugMasks.cleaned
      : state.debugMode === "selected" || state.debugMode === "contour"
        ? state.debugMasks.selected
        : state.debugMasks.threshold;
  for (let i = 0, j = 0; i < state.dic.length; i += 1, j += 4) {
    const dic = state.dic[i];
    if (mask[i]) {
      data[j] = Math.min(255, dic + 90);
      data[j + 1] = Math.round(dic * 0.35);
      data[j + 2] = 255;
      data[j + 3] = 255;
    } else {
      data[j] = dic;
      data[j + 1] = dic;
      data[j + 2] = dic;
      data[j + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  if (state.debugMode === "contour") {
    ctx.save();
    ctx.fillStyle = "#ff2f92";
    for (const point of state.debugMasks.contour) {
      ctx.fillRect(point.x - 1, point.y - 1, 3, 3);
    }
    ctx.restore();
  }
  drawTraceEndpoints();
  els.statusText.textContent = `DEBUG ${state.debugMode.toUpperCase()}`;
}

function drawMaskBoundary() {
  const image = ctx.getImageData(0, 0, state.width, state.height);
  const data = image.data;
  const color = state.outlineApproved ? [0, 220, 110] : [255, 210, 0];
  for (let y = 1; y < state.height - 1; y += 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      const idx = y * state.width + x;
      if (!state.wormMask[idx]) continue;
      const edge =
        !state.wormMask[idx - 1] ||
        !state.wormMask[idx + 1] ||
        !state.wormMask[idx - state.width] ||
        !state.wormMask[idx + state.width];
      if (!edge) continue;
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          const j = ((y + yy) * state.width + x + xx) * 4;
          data[j] = color[0];
          data[j + 1] = color[1];
          data[j + 2] = color[2];
          data[j + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawBezierEditor() {
  drawGuidePoints();
  if (!state.anchors.length || state.outlineApproved) return;
  ctx.save();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.78)";
  ctx.stroke(pathFromAnchors());
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ff2f92";
  ctx.stroke(pathFromAnchors());

  const activeIndex = state.dragTarget ? state.dragTarget.index : state.anchors.length - 1;
  state.anchors.forEach((anchor, index) => {
    if (index === activeIndex) {
      drawHandle(anchor, anchor.in, true);
      drawHandle(anchor, anchor.out, true);
    }
    ctx.fillStyle = index === activeIndex ? "#ffffff" : "#ff2f92";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, index === activeIndex ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 3;
    ctx.strokeText(String(index + 1), anchor.x + 10, anchor.y - 10);
    ctx.fillText(String(index + 1), anchor.x + 9, anchor.y - 9);
  });
  ctx.restore();
}

function drawGuidePoints() {
  if (!state.guidePoints.length) return;
  ctx.save();
  ctx.fillStyle = "#00e5ff";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 3;
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.beginPath();
  state.guidePoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  state.guidePoints.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const label = index === 0 ? "tail" : index === state.guidePoints.length - 1 ? "head" : `bend ${index}`;
    ctx.strokeText(label, point.x + 11, point.y - 10);
    ctx.fillText(label, point.x + 11, point.y - 10);
  });
  ctx.restore();
}

function drawHandle(anchor, handle, active) {
  if (Math.hypot(anchor.x - handle.x, anchor.y - handle.y) < 3) return;
  ctx.lineWidth = active ? 2.5 : 1.5;
  ctx.strokeStyle = active ? "#00e5ff" : "rgba(0, 229, 255, 0.35)";
  ctx.fillStyle = active ? "#00e5ff" : "rgba(0, 229, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(handle.x, handle.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, active ? 6 : 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#111111";
  ctx.stroke();
}

async function loadPlane(plane) {
  snapshotPlaneState();
  state.plane = plane;
  els.statusText.textContent = `Loading plane ${plane}...`;
  if (els.planeLabel) els.planeLabel.textContent = `Plane ${plane} of ${state.planeCount}`;
  if (els.planeSlider) els.planeSlider.value = plane;
  const planeName = String(plane).padStart(2, "0");
  const [dicImage, gfpImage] = await Promise.all([
    loadImage(`assets/planes/dic/${planeName}.png`),
    loadImage(`assets/planes/gfp/${planeName}.png`),
  ]);
  state.dic = getGrayPixels(dicImage);
  state.gfp = getGrayPixels(gfpImage);
  state.wormMask = new Uint8Array(state.width * state.height);
  state.gfpMask = new Uint8Array(state.width * state.height);
  state.gfpBaseMask = new Uint8Array(state.width * state.height);
  state.gfpManualAdd = new Uint8Array(state.width * state.height);
  state.gfpManualErase = new Uint8Array(state.width * state.height);
  if (!restorePlaneState(plane)) {
    state.anchors = [];
    state.outlineClosed = false;
    state.outlineApproved = false;
    state.gfpApproved = false;
  }
  state.dragTarget = null;
  state.assistMode = false;
  state.guidePoints = [];
  state.debugMasks = null;
  state.undoStack = [];
  updateOutlineStatus();
  updateGfpStatus();
  render();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
  return {
    x: Math.max(0, Math.min(state.width - 1, x)),
    y: Math.max(0, Math.min(state.height - 1, y)),
  };
}

function hitBezierTarget(point) {
  const radius = 14;
  for (let i = state.anchors.length - 1; i >= 0; i -= 1) {
    const anchor = state.anchors[i];
    if (Math.hypot(anchor.x - point.x, anchor.y - point.y) <= radius) return { type: "anchor", index: i };
    if (Math.hypot(anchor.in.x - point.x, anchor.in.y - point.y) <= radius) return { type: "in", index: i };
    if (Math.hypot(anchor.out.x - point.x, anchor.out.y - point.y) <= radius) return { type: "out", index: i };
  }
  return null;
}

function bezierPoint(a, b, t) {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * a.x +
      3 * mt * mt * t * a.out.x +
      3 * mt * t * t * b.in.x +
      t * t * t * b.x,
    y:
      mt * mt * mt * a.y +
      3 * mt * mt * t * a.out.y +
      3 * mt * t * t * b.in.y +
      t * t * t * b.y,
  };
}

function nearestPathSegment(point) {
  if (state.anchors.length < 2) return null;
  let best = { distance: Infinity, insertIndex: state.anchors.length, point };
  const segmentCount = state.outlineClosed ? state.anchors.length : state.anchors.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = state.anchors[i];
    const b = state.anchors[(i + 1) % state.anchors.length];
    let prev = { x: a.x, y: a.y };
    for (let s = 1; s <= 24; s += 1) {
      const current = bezierPoint(a, b, s / 24);
      const distance = pointToSegmentDistance(point, prev, current);
      if (distance < best.distance) {
        best = {
          distance,
          insertIndex: i + 1,
          point: closestPointOnSegment(point, prev, current),
        };
      }
      prev = current;
    }
  }
  return best.distance <= 18 ? best : null;
}

function pointToSegmentDistance(point, a, b) {
  const closest = closestPointOnSegment(point, a, b);
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function mirrorHandle(anchor, movedType) {
  const source = anchor[movedType];
  const targetType = movedType === "in" ? "out" : "in";
  anchor[targetType] = {
    x: anchor.x - (source.x - anchor.x),
    y: anchor.y - (source.y - anchor.y),
  };
}

function paintAt(x, y) {
  if (state.tool === "worm-outline") return;
  const radius = state.brushSize / 2;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(state.width - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(state.height - 1, Math.ceil(y + radius));
  const value = state.tool.endsWith("add") ? 1 : 0;
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy <= r2) {
        const idx = yy * state.width + xx;
        if (state.tool.startsWith("worm")) {
          state.wormMask[idx] = value;
        } else if (state.wormMask[idx]) {
          if (value) {
            state.gfpManualAdd[idx] = 1;
            state.gfpManualErase[idx] = 0;
            state.gfpMask[idx] = 1;
          } else {
            state.gfpManualErase[idx] = 1;
            state.gfpManualAdd[idx] = 0;
            state.gfpMask[idx] = 0;
          }
        }
      }
    }
  }
  if (state.tool.startsWith("worm")) {
    state.outlineApproved = false;
    state.gfpApproved = false;
    updateOutlineStatus();
    autoGfpMask(false);
  } else {
    state.gfpApproved = false;
    state.paintDirty = true;
    requestRender();
  }
}

function downloadBlob(name, type, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function getPlaneExportState(plane) {
  if (plane === state.plane) snapshotPlaneState();
  const saved = state.planeStates.get(plane);
  const empty = new Uint8Array(state.width * state.height);
  return {
    plane,
    anchors: saved ? saved.anchors : [],
    wormMask: saved ? saved.wormMask : empty,
    gfpMask: saved ? saved.gfpMask : empty,
    outlineApproved: saved ? saved.outlineApproved : false,
    gfpApproved: saved ? saved.gfpApproved : false,
    gfpThreshold: saved?.gfpThreshold ?? Number(els.gfpThreshold.value),
    minObject: saved?.minObject ?? Number(els.minObject.value),
  };
}

function measurePlaneMasks(exportState, gfpPixels) {
  let wormArea = 0;
  let gfpArea = 0;
  let integrated = 0;
  for (let i = 0; i < exportState.wormMask.length; i += 1) {
    if (exportState.wormMask[i]) wormArea += 1;
    if (exportState.gfpMask[i] && exportState.wormMask[i]) {
      gfpArea += 1;
      integrated += gfpPixels[i];
    }
  }
  return {
    wormArea,
    gfpArea,
    gfpPercent: wormArea ? (gfpArea / wormArea) * 100 : 0,
    integratedGfp: Math.round(integrated),
  };
}

function hasOutlinedPlane(exportState) {
  return exportState.wormMask.some((value) => value);
}

function createMaskPngBlob(exportState) {
  const image = ctx.createImageData(state.width, state.height);
  const data = image.data;
  for (let i = 0, j = 0; i < exportState.wormMask.length; i += 1, j += 4) {
    data[j] = exportState.wormMask[i] ? 44 : 0;
    data[j + 1] = exportState.gfpMask[i] ? 230 : 0;
    data[j + 2] = exportState.wormMask[i] ? 220 : 0;
    data[j + 3] = exportState.wormMask[i] || exportState.gfpMask[i] ? 255 : 0;
  }
  const offscreen = document.createElement("canvas");
  offscreen.width = state.width;
  offscreen.height = state.height;
  offscreen.getContext("2d").putImageData(image, 0, 0);
  return new Promise((resolve) => offscreen.toBlob(resolve, "image/png"));
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

const crc32Table = makeCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function makeZipBlob(files) {
  const encoder = new TextEncoder();
  const now = dosDateTime(new Date());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 10, now.time);
    writeUint16(localView, 12, now.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, file.bytes.length);
    writeUint32(localView, 22, file.bytes.length);
    writeUint16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    chunks.push(local, file.bytes);

    const directory = new Uint8Array(46 + nameBytes.length);
    const directoryView = new DataView(directory.buffer);
    writeUint32(directoryView, 0, 0x02014b50);
    writeUint16(directoryView, 4, 20);
    writeUint16(directoryView, 6, 20);
    writeUint16(directoryView, 12, now.time);
    writeUint16(directoryView, 14, now.date);
    writeUint32(directoryView, 16, checksum);
    writeUint32(directoryView, 20, file.bytes.length);
    writeUint32(directoryView, 24, file.bytes.length);
    writeUint16(directoryView, 28, nameBytes.length);
    writeUint32(directoryView, 42, offset);
    directory.set(nameBytes, 46);
    central.push(directory);

    offset += local.length + file.bytes.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

async function bytesFromBlob(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function downloadMasks() {
  els.statusText.textContent = "Preparing all mask files...";
  const files = [];
  for (let plane = 1; plane <= state.planeCount; plane += 1) {
    const exportState = getPlaneExportState(plane);
    if (!hasOutlinedPlane(exportState)) continue;
    const blob = await createMaskPngBlob(exportState);
    files.push({
      name: `plane-${String(plane).padStart(2, "0")}-masks.png`,
      bytes: await bytesFromBlob(blob),
    });
  }
  if (!files.length) {
    els.statusText.textContent = "No outlined planes to save";
    return;
  }
  downloadBlob("worm-gfp-masks-all-planes.zip", "application/zip", makeZipBlob(files));
  els.statusText.textContent = `Saved ${files.length} outlined plane mask${files.length === 1 ? "" : "s"}`;
}

async function downloadCsv() {
  els.statusText.textContent = "Preparing all CSV rows...";
  const rows = [
    "sample,plane,outline_approved,gfp_approved,worm_area_px,gfp_area_px,gfp_percent,integrated_gfp,gfp_threshold,min_gfp_object_px,anchor_points",
  ];
  for (let plane = 1; plane <= state.planeCount; plane += 1) {
    const exportState = getPlaneExportState(plane);
    if (!hasOutlinedPlane(exportState)) continue;
    const planeName = String(plane).padStart(2, "0");
    const gfpPixels = plane === state.plane ? state.gfp : getGrayPixels(await loadImage(`assets/planes/gfp/${planeName}.png`));
    const metrics = measurePlaneMasks(exportState, gfpPixels);
    rows.push(
      [
        "cytoGFP_pmk-1",
        plane,
        exportState.outlineApproved ? "yes" : "no",
        exportState.gfpApproved ? "yes" : "no",
        metrics.wormArea,
        metrics.gfpArea,
        metrics.gfpPercent.toFixed(4),
        metrics.integratedGfp,
        exportState.gfpThreshold,
        exportState.minObject,
        exportState.anchors.length,
      ].join(","),
    );
  }
  if (rows.length === 1) {
    els.statusText.textContent = "No outlined planes to export";
    return;
  }
  downloadBlob("worm-gfp-measurements-all-planes.csv", "text/csv", rows.join("\n"));
  els.statusText.textContent = `Exported ${rows.length - 1} outlined plane row${rows.length === 2 ? "" : "s"}`;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);
    });
  });
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTool(button.dataset.tool);
      updateCursorText();
    });
  });
  document.querySelectorAll("[data-stage-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveStage(button.dataset.stageTab);
    });
  });
  els.planeDashboard.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-plane]");
    if (!target) return;
    const plane = Number(target.dataset.plane);
    const requestedStage = target.dataset.stageTarget || "worm";
    if (plane !== state.plane) await loadPlane(plane);
    setActiveStage(requestedStage);
  });
  document.querySelectorAll("[data-debug]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-debug]").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.debugMode = button.dataset.debug;
      setActiveView("debug");
      document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === "debug"));
    });
  });
  els.brushSize?.addEventListener("input", () => {
    state.brushSize = Number(els.brushSize.value);
    updateCursorText();
  });
  els.planeSlider?.addEventListener("input", () => {
    loadPlane(Number(els.planeSlider.value));
  });
  els.debugThreshold?.addEventListener("input", () => {
    state.debugThreshold = Number(els.debugThreshold.value);
    refreshDebugMasks();
  });
  els.debugCleanup?.addEventListener("input", () => {
    state.debugCleanup = Number(els.debugCleanup.value);
    refreshDebugMasks();
  });
  els.gfpThreshold.addEventListener("input", scheduleAutoGfpMask);
  els.minObject.addEventListener("input", scheduleAutoGfpMask);

  document.getElementById("draftOutlineBtn")?.addEventListener("click", draftOutline);
  document.getElementById("generateGuideBtn")?.addEventListener("click", generateGuideOutline);
  document.getElementById("refreshDebugBtn")?.addEventListener("click", refreshDebugMasks);
  document.getElementById("makeOutlineBtn").addEventListener("click", closePath);
  document.getElementById("autoHandlesBtn").addEventListener("click", () => autoHandles());
  document.getElementById("approveOutlineBtn").addEventListener("click", () => {
    if (!state.outlineClosed && state.anchors.length >= 3) closePath();
    if (!state.wormMask.some((value) => value)) {
      els.outlineStatus.textContent = "Create a worm mask before approving.";
      return;
    }
    state.outlineApproved = true;
    updateOutlineStatus();
    setActiveStage("gfp");
  });
  document.getElementById("approveGfpBtn").addEventListener("click", () => {
    if (!state.outlineApproved) return;
    state.gfpApproved = true;
    updateGfpStatus();
    setActiveStage("results");
  });
  document.getElementById("clearCurveBtn").addEventListener("click", () => {
    pushUndo();
    state.anchors = [];
    state.dragTarget = null;
    state.assistMode = false;
    state.guidePoints = [];
    state.outlineClosed = false;
    state.wormMask = new Uint8Array(state.width * state.height);
    state.gfpMask = new Uint8Array(state.width * state.height);
    state.gfpBaseMask = new Uint8Array(state.width * state.height);
    state.gfpManualAdd = new Uint8Array(state.width * state.height);
    state.gfpManualErase = new Uint8Array(state.width * state.height);
    state.outlineApproved = false;
    state.gfpApproved = false;
    updateOutlineStatus();
    updateGfpStatus();
    render();
  });
  document.getElementById("undoBtn").addEventListener("click", restoreUndo);
  document.getElementById("resetGfpEditsBtn").addEventListener("click", () => {
    pushUndo();
    state.gfpApproved = false;
    state.gfpManualAdd = new Uint8Array(state.width * state.height);
    state.gfpManualErase = new Uint8Array(state.width * state.height);
    autoGfpMask(false);
  });
  document.getElementById("downloadMasksBtn").addEventListener("click", downloadMasks);
  document.getElementById("downloadCsvBtn").addEventListener("click", downloadCsv);

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;
    if (isTyping) return;
    if (event.key.toLowerCase() === "c" && state.stage === "worm") {
      event.preventDefault();
      closePath();
    }
  });

  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event);
    if (state.assistMode) {
      state.guidePoints.push(point);
      const count = state.guidePoints.length;
      els.outlineStatus.textContent =
        count === 1
          ? "Body path: tail set. Click bends along the worm, ending with head, then Generate from body path."
          : `Body path: ${count} points set. Last point is treated as head when you generate the boundary.`;
      render();
      return;
    }
    if (state.tool === "worm-outline") {
      const target = hitBezierTarget(point);
      pushUndo();
      if (target) {
        state.dragTarget = target;
        state.dragDirty = false;
        canvas.setPointerCapture(event.pointerId);
      } else if (state.outlineClosed) {
        const insert = nearestPathSegment(point);
        if (insert) {
          state.anchors.splice(insert.insertIndex, 0, makeAnchor(insert.point.x, insert.point.y));
          autoHandles(false);
        }
      } else if (!state.outlineClosed) {
        state.anchors.push(makeAnchor(point.x, point.y));
        if (state.anchors.length >= 2) autoHandles(false);
      }
      state.outlineApproved = false;
      updateOutlineStatus();
      updateMaskFromPath(false);
      return;
    }
    state.drawing = true;
    canvas.setPointerCapture(event.pointerId);
    pushUndo();
    paintAt(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    updateCursorText(point);
    if (state.dragTarget) {
      const anchor = state.anchors[state.dragTarget.index];
      if (state.dragTarget.type === "anchor") {
        const dx = point.x - anchor.x;
        const dy = point.y - anchor.y;
        anchor.x = point.x;
        anchor.y = point.y;
        anchor.in.x += dx;
        anchor.in.y += dy;
        anchor.out.x += dx;
        anchor.out.y += dy;
      } else {
        anchor[state.dragTarget.type] = point;
        mirrorHandle(anchor, state.dragTarget.type);
      }
      state.outlineApproved = false;
      state.gfpApproved = false;
      state.dragDirty = true;
      els.outlineStatus.textContent = "Adjusting boundary. Release to update the worm mask.";
      requestRender();
      return;
    }
    if (state.drawing) paintAt(point.x, point.y);
  });
  canvas.addEventListener("pointerup", () => {
    const shouldUpdateMask = state.dragTarget && state.dragDirty;
    const shouldUpdateGfpStatus = state.drawing && state.paintDirty && state.tool.startsWith("gfp");
    state.drawing = false;
    state.dragTarget = null;
    state.dragDirty = false;
    state.paintDirty = false;
    if (shouldUpdateMask) updateMaskFromPath(false);
    if (shouldUpdateGfpStatus) {
      updateGfpStatus();
      updateWorkflowUi();
      requestRender();
    }
  });
  canvas.addEventListener("pointercancel", () => {
    state.drawing = false;
    state.dragTarget = null;
    state.dragDirty = false;
    state.paintDirty = false;
  });
  canvas.addEventListener("dblclick", (event) => {
    if (state.tool !== "worm-outline") return;
    const point = canvasPoint(event);
    const target = hitBezierTarget(point);
    if (!target || target.type !== "anchor") return;
    pushUndo();
    state.anchors.splice(target.index, 1);
    if (state.anchors.length < 3) {
      state.outlineClosed = false;
      state.wormMask = new Uint8Array(state.width * state.height);
      state.gfpMask = new Uint8Array(state.width * state.height);
    }
    state.outlineApproved = false;
    updateOutlineStatus();
    updateMaskFromPath(false);
  });
}

async function init() {
  bindEvents();
  await loadPlane(1);
}

init().catch((error) => {
  els.statusText.textContent = "Could not load sample images.";
  console.error(error);
});
