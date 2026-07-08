const state = {
  batches: [],
  images: [],
  batchId: null,
  image: null,
  points: [],
  selectedId: null,
  draggingId: null,
  dirty: false,
  saving: false,
  saveTimer: null,
  lastSaveError: null,
  pollTimer: null,
};

const AUTOSAVE_DELAY = 900;
const DRAFT_PREFIX = "trap-counter-draft:";

const el = {
  status: document.querySelector("#status"),
  uploadForm: document.querySelector("#uploadForm"),
  refreshBatches: document.querySelector("#refreshBatches"),
  batchList: document.querySelector("#batchList"),
  imageList: document.querySelector("#imageList"),
  imageTitle: document.querySelector("#imageTitle"),
  imageMeta: document.querySelector("#imageMeta"),
  preview: document.querySelector("#preview"),
  overlay: document.querySelector("#overlay"),
  emptyState: document.querySelector("#emptyState"),
  imageStage: document.querySelector("#imageStage"),
  deletePoint: document.querySelector("#deletePoint"),
  rerunPrediction: document.querySelector("#rerunPrediction"),
  saveReview: document.querySelector("#saveReview"),
  saveState: document.querySelector("#saveState"),
  markDone: document.querySelector("#markDone"),
  openDashboard: document.querySelector("#openDashboard"),
  dashboardView: document.querySelector("#dashboardView"),
  dashboardBody: document.querySelector("#dashboardBody"),
  dashboardProgress: document.querySelector("#dashboardProgress"),
  workspace: document.querySelector(".workspace"),
  reviewFooter: document.querySelector(".review-footer"),
  uncertain: document.querySelector("#uncertain"),
  notes: document.querySelector("#notes"),
  predictedCount: document.querySelector("#predictedCount"),
  reviewedCount: document.querySelector("#reviewedCount"),
  exports: document.querySelector("#exports"),
  exportPrism: document.querySelector("#exportPrism"),
  exportCounts: document.querySelector("#exportCounts"),
  exportCoords: document.querySelector("#exportCoords"),
  exportExcel: document.querySelector("#exportExcel"),
  exportJson: document.querySelector("#exportJson"),
  exportAnnotated: document.querySelector("#exportAnnotated"),
  groups: document.querySelector("#groups"),
  groupList: document.querySelector("#groupList"),
  refreshGroups: document.querySelector("#refreshGroups"),
  markerStyle: document.querySelector("#markerStyle"),
  showLowConfidence: document.querySelector("#showLowConfidence"),
  counts: document.querySelector("#counts"),
};

state.groupLabels = {};
state.markerStyle = localStorage.getItem("trap-counter-marker-style") === "bubble" ? "bubble" : "arrow";
state.showLowConfidence = localStorage.getItem("trap-counter-show-lowconf") === "1";

// A point is shown/counted/saved when it is a reviewed or manual point, or a
// high-confidence prediction. Low-confidence predictions (check/low/extra-low)
// are hidden unless "show low-confidence" is on — they are mostly false positives.
function passesConfidenceFilter(point) {
  if (point.source !== "predicted") return true;
  if (state.showLowConfidence) return true;
  return confidenceBand(point) === "high";
}

function visiblePoints() {
  return state.points.filter(passesConfidenceFilter);
}

function setStatus(message) {
  el.status.textContent = message;
}

// ---- Autosave: review edits are persisted automatically and mirrored to a
// local draft so nothing is lost on a misclick, crash, or failed request. ----

function setSaveState(name) {
  const labels = {
    idle: "No image",
    saved: "All changes saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    error: "Save failed — kept locally, retrying",
    locked: "Done — locked",
  };
  el.saveState.dataset.state = name;
  el.saveState.textContent = labels[name] || name;
}

function draftKey(imageId) {
  return `${DRAFT_PREFIX}${imageId}`;
}

function writeDraft() {
  if (!state.image) return;
  try {
    localStorage.setItem(
      draftKey(state.image.id),
      JSON.stringify({ points: state.points, uncertain: el.uncertain.checked, notes: el.notes.value, ts: Date.now() })
    );
  } catch (error) {
    console.warn("Could not write local draft", error);
  }
}

function readDraft(imageId) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(imageId)) || "null");
  } catch {
    return null;
  }
}

function clearDraft(imageId) {
  try {
    localStorage.removeItem(draftKey(imageId));
  } catch {
    /* ignore */
  }
}

function reviewPayload() {
  // Save only the points the reviewer actually sees; hidden low-confidence
  // predictions are treated as rejected once the image is reviewed.
  return {
    points: visiblePoints().map((point) => ({ ...point, source: point.source === "predicted" ? "reviewed" : point.source })),
    uncertain: el.uncertain.checked,
    notes: el.notes.value,
  };
}

function markDirty() {
  if (!state.image) return;
  state.dirty = true;
  writeDraft();
  if (!state.saving) setSaveState("unsaved");
  scheduleAutosave();
}

function scheduleAutosave() {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    persistReview();
  }, AUTOSAVE_DELAY);
}

function persistReview() {
  if (!state.image || state.saving || !state.dirty) return state.savePromise || Promise.resolve();
  state.saving = true;
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  state.savePromise = doPersist();
  return state.savePromise;
}

async function doPersist() {
  const imageId = state.image.id;
  const payload = reviewPayload();
  state.dirty = false; // optimistic; markDirty() re-sets it if edits arrive mid-flight
  setSaveState("saving");
  try {
    const updated = await api(`/api/images/${imageId}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.images = state.images.map((image) => (image.id === imageId ? updated : image));
    if (state.image && state.image.id === imageId) {
      state.image = { ...state.image, ...updated };
    }
    if (!state.dirty) clearDraft(imageId); // draft only cleared once the server confirms and no newer edits exist
    state.lastSaveError = null;
    renderImageList();
    loadGroups().catch((error) => console.error(error));
    setSaveState(state.dirty ? "unsaved" : "saved");
  } catch (error) {
    state.dirty = true; // keep the local draft and retry
    state.lastSaveError = error;
    console.error("Save failed", error);
    setSaveState("error");
  } finally {
    state.saving = false;
    state.savePromise = null;
    if (state.dirty && state.image && state.image.id === imageId) scheduleAutosave();
  }
}

// Force any pending/in-flight save to complete (before switching images or unloading).
async function flushPendingSave() {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  let guard = 0;
  while (state.image && (state.dirty || state.saving) && guard++ < 6) {
    if (state.saving && state.savePromise) {
      await state.savePromise;
    } else if (state.dirty) {
      await persistReview();
    } else {
      break;
    }
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

async function loadBatches() {
  setStatus("Loading batches");
  state.batches = await api("/api/batches");
  el.batchList.innerHTML = "";
  for (const batch of state.batches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = batch.id === state.batchId ? "active" : "";
    button.innerHTML = `${escapeHtml(batch.name)}<small>${batch.image_count} images · ${formatDate(batch.created_at)}</small>`;
    button.addEventListener("click", () => selectBatch(batch.id));
    el.batchList.append(button);
  }
  setStatus("Ready");
}

async function selectBatch(batchId) {
  await flushPendingSave(); // preserve unsaved edits before leaving the current image/batch
  state.batchId = batchId;
  state.image = null;
  state.points = [];
  state.groupLabels = {};
  renderReview();
  renderExportLinks();
  await loadBatches();
  setStatus("Loading images");
  state.images = await api(`/api/batches/${batchId}/images`);
  renderImageList();
  await loadGroups();
  showDashboard(); // land on the dashboard (home base), not a single image
  setStatus("Ready");
  scheduleBatchPoll();
}

function renderImageList() {
  el.imageList.innerHTML = "";
  for (const image of state.images) {
    const count = image.reviewed_count ?? image.points.length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.image?.id === image.id ? "active" : "";
    button.innerHTML = `${escapeHtml(image.filename)}<small>${image.status} · ${count} traps${image.uncertain ? " · uncertain" : ""}</small>`;
    button.addEventListener("click", () => selectImage(image.id));
    el.imageList.append(button);
  }
}

async function selectImage(imageId) {
  // Never switch away with unsaved edits still in memory.
  await flushPendingSave();
  el.dashboardView.hidden = true; // leave the dashboard when opening an image
  el.workspace.style.display = "";
  el.reviewFooter.style.display = "";
  state.image = await api(`/api/images/${imageId}`);
  state.selectedId = null;
  el.preview.onload = fitOverlay;
  el.preview.src = state.image.preview_url;

  const draft = readDraft(imageId);
  if (draft && Array.isArray(draft.points)) {
    // A local draft exists that never made it to the server (crash / offline). Restore it.
    state.points = draft.points.map((point) => ({ ...point }));
    el.uncertain.checked = Boolean(draft.uncertain);
    el.notes.value = draft.notes || "";
    renderReview();
    renderImageList();
    state.dirty = true;
    setSaveState("unsaved");
    scheduleAutosave();
    setStatus("Recovered unsaved edits for this image");
    return;
  }

  state.points = state.image.points.map((point) => ({ ...point }));
  el.uncertain.checked = state.image.uncertain;
  el.notes.value = state.image.notes || "";
  state.dirty = false;
  renderReview();
  renderImageList();
  setSaveState(state.image.validated ? "locked" : "saved");
}

function renderReview() {
  const hasImage = Boolean(state.image);
  el.emptyState.style.display = hasImage ? "none" : "block";
  el.preview.style.display = hasImage ? "block" : "none";
  el.overlay.style.display = hasImage ? "block" : "none";
  const locked = hasImage && state.image.validated;
  el.deletePoint.disabled = !state.selectedId || locked;
  el.rerunPrediction.disabled = !hasImage;
  el.saveReview.disabled = !hasImage || locked;
  el.markDone.disabled = !hasImage;
  el.markDone.textContent = locked ? "Undone" : "Mark done";
  el.overlay.style.pointerEvents = locked ? "none" : "";
  el.imageStage.classList.toggle("locked", locked);
  el.imageTitle.textContent = hasImage ? state.image.filename : "No image selected";
  el.imageMeta.textContent = hasImage
    ? `${state.image.width} x ${state.image.height}px · ${state.image.model_version}`
    : "Upload or select a batch to begin.";
  const shown = hasImage ? visiblePoints() : [];
  el.predictedCount.textContent = hasImage ? state.image.predicted_count : "0";
  el.reviewedCount.textContent = hasImage ? shown.length : "0";
  renderPoints();
}

function predictedConfidenceCounts(points) {
  return points.reduce(
    (counts, point) => {
      if (point.source !== "predicted") return counts;
      counts[confidenceBand(point)] += 1;
      return counts;
    },
    { high: 0, check: 0, low: 0, extraLow: 0 }
  );
}

function isHighConfidence(point) {
  return confidenceBand(point) === "high";
}

function confidenceBand(point) {
  const confidence = Number(point.confidence ?? 0);
  if (confidence >= 0.5) return "high";
  if (confidence >= 0.35) return "check";
  if (confidence >= 0.15) return "low";
  return "extraLow";
}

function markerColor(point) {
  if (point.source !== "predicted") return "#0b6f3f";
  const colors = {
    high: "#050505",
    check: "#005fcc",
    low: "#d56b00",
    extraLow: "#7b8087",
  };
  return colors[confidenceBand(point)];
}

function fitOverlay() {
  if (!state.image) return;
  const rect = el.preview.getBoundingClientRect();
  const stageRect = el.imageStage.getBoundingClientRect();
  el.overlay.style.width = `${rect.width}px`;
  el.overlay.style.height = `${rect.height}px`;
  el.overlay.style.left = `${rect.left - stageRect.left}px`;
  el.overlay.style.top = `${rect.top - stageRect.top}px`;
  el.overlay.setAttribute("viewBox", `0 0 ${state.image.width} ${state.image.height}`);
  renderPoints();
}

function renderPoints() {
  if (!state.image) {
    el.overlay.innerHTML = "";
    return;
  }
  // A reusable radial gradient makes each bubble read like a clear water drop:
  // near-invisible in the middle, a faint refractive rim at the edge.
  el.overlay.innerHTML =
    state.markerStyle === "bubble"
      ? '<defs><radialGradient id="waterdrop" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#bcd8f0" stop-opacity="0.03"/>' +
        '<stop offset="66%" stop-color="#bcd8f0" stop-opacity="0.05"/>' +
        '<stop offset="84%" stop-color="#7fb0e0" stop-opacity="0.22"/>' +
        '<stop offset="95%" stop-color="#3f7cc0" stop-opacity="0.55"/>' +
        '<stop offset="100%" stop-color="#3f7cc0" stop-opacity="0.42"/>' +
        "</radialGradient></defs>"
      : "";
  const hitRadius = Math.max(16, state.image.width * 0.007);
  for (const point of visiblePoints()) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("point");
    if (point.id === state.selectedId) group.classList.add("selected");
    group.dataset.id = point.id;

    const color = markerColor(point);
    const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hitArea.setAttribute("cx", point.x);
    hitArea.setAttribute("cy", point.y);
    hitArea.setAttribute("r", hitRadius);
    hitArea.setAttribute("fill", "transparent");

    if (state.markerStyle === "bubble") {
      // Large, very translucent water drop sitting over the whole trap.
      const r = Math.max(34, state.image.width * 0.024);
      const drop = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      drop.setAttribute("cx", point.x);
      drop.setAttribute("cy", point.y);
      drop.setAttribute("r", r);
      drop.setAttribute("fill", "url(#waterdrop)");
      if (point.id === state.selectedId) {
        drop.setAttribute("stroke", "#1d7e53");
        drop.setAttribute("stroke-opacity", "0.7");
        drop.setAttribute("stroke-width", Math.max(1.5, state.image.width * 0.0008));
      } else {
        drop.setAttribute("stroke", "none");
      }
      group.append(drop, hitArea);
    } else {
      // Small arrowhead pointing at the trap from the side, so it never covers it.
      const arrowGap = Math.max(30, state.image.width * 0.016);
      const arrowHead = Math.max(17, state.image.width * 0.008);
      const direction = point.x > state.image.width - (arrowGap + arrowHead + 12) ? -1 : 1;
      const endX = point.x + direction * arrowGap;
      const baseX = endX + direction * arrowHead;
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrow.setAttribute("points", `${endX},${point.y} ${baseX},${point.y - arrowHead * 0.7} ${baseX},${point.y + arrowHead * 0.7}`);
      arrow.setAttribute("fill", color);
      arrow.setAttribute("opacity", "0.98");
      group.append(hitArea, arrow);
    }
    group.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      state.selectedId = point.id;
      state.draggingId = point.id;
      group.setPointerCapture(event.pointerId);
      renderReview();
    });
    el.overlay.append(group);
  }
}

function svgPoint(event) {
  const point = el.overlay.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(el.overlay.getScreenCTM().inverse());
  return {
    x: Math.max(0, Math.min(state.image.width, transformed.x)),
    y: Math.max(0, Math.min(state.image.height, transformed.y)),
  };
}

el.overlay.addEventListener("pointerdown", (event) => {
  if (!state.image || event.target.closest(".point")) return;
  const point = svgPoint(event);
  const id = `pt_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  state.points.push({ id, x: point.x, y: point.y, source: "manual", confidence: null });
  state.selectedId = id;
  renderReview();
  markDirty();
});

el.overlay.addEventListener("pointermove", (event) => {
  if (!state.draggingId || !state.image) return;
  const point = state.points.find((candidate) => candidate.id === state.draggingId);
  if (!point) return;
  const next = svgPoint(event);
  point.x = next.x;
  point.y = next.y;
  point.source = point.source === "predicted" ? "reviewed" : point.source;
  state.dragMoved = true;
  renderReview();
});

el.overlay.addEventListener("pointerup", () => {
  if (state.draggingId && state.dragMoved) markDirty();
  state.draggingId = null;
  state.dragMoved = false;
});

el.deletePoint.addEventListener("click", () => {
  deleteSelectedPoint();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (!state.selectedId) return;
  event.preventDefault();
  deleteSelectedPoint();
});

function deleteSelectedPoint() {
  if (!state.selectedId) return;
  state.points = state.points.filter((point) => point.id !== state.selectedId);
  state.selectedId = null;
  renderReview();
  markDirty();
}

el.saveReview.addEventListener("click", async () => {
  if (!state.image) return;
  state.dirty = true; // "Save now" always forces a write of the current state
  await persistReview();
});

el.markDone.addEventListener("click", async () => {
  if (!state.image) return;
  const next = !state.image.validated;
  if (next) await flushPendingSave(); // lock in the latest edits before freezing
  state.image = await api(`/api/images/${state.image.id}/validate`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ validated: next }),
  });
  state.points = state.image.points.map((point) => ({ ...point }));
  state.images = state.images.map((image) => (image.id === state.image.id ? state.image : image));
  renderReview();
  renderImageList();
  setSaveState(next ? "locked" : "saved");
});

el.openDashboard.addEventListener("click", async () => {
  await flushPendingSave();
  showDashboard();
});

el.notes.addEventListener("input", markDirty);
el.uncertain.addEventListener("change", markDirty);

el.rerunPrediction.addEventListener("click", async () => {
  if (!state.image) return;
  await flushPendingSave(); // don't discard hand edits when replacing with fresh predictions
  setStatus("Running detection");
  state.image = await api(`/api/images/${state.image.id}/predict`, { method: "POST" });
  state.points = state.image.points.map((point) => ({ ...point }));
  state.images = state.images.map((image) => (image.id === state.image.id ? state.image : image));
  clearDraft(state.image.id);
  state.dirty = false;
  renderReview();
  renderImageList();
  setSaveState("saved");
  setStatus("Detection complete");
});

// Last line of defence: warn if the tab is closing with edits not yet on the server.
window.addEventListener("beforeunload", (event) => {
  if (state.dirty || state.saving) {
    event.preventDefault();
    event.returnValue = "";
  }
});

el.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(el.uploadForm);
  setStatus("Uploading");
  const batch = await api("/api/batches", { method: "POST", body: formData });
  el.uploadForm.reset();
  await loadBatches();
  await selectBatch(batch.id);
});

el.refreshBatches.addEventListener("click", loadBatches);
el.refreshGroups.addEventListener("click", () => loadGroups().catch((error) => console.error(error)));
window.addEventListener("resize", fitOverlay);

el.markerStyle.value = state.markerStyle;
el.markerStyle.addEventListener("change", () => {
  state.markerStyle = el.markerStyle.value === "bubble" ? "bubble" : "arrow";
  localStorage.setItem("trap-counter-marker-style", state.markerStyle);
  renderPoints();
});

el.showLowConfidence.checked = state.showLowConfidence;
el.showLowConfidence.addEventListener("change", () => {
  state.showLowConfidence = el.showLowConfidence.checked;
  localStorage.setItem("trap-counter-show-lowconf", state.showLowConfidence ? "1" : "0");
  renderReview();
});

function labelsQuery() {
  const labels = {};
  for (const [key, value] of Object.entries(state.groupLabels)) {
    if (value && value.trim() && value.trim() !== key) labels[key] = value.trim();
  }
  return Object.keys(labels).length ? `?labels=${encodeURIComponent(JSON.stringify(labels))}` : "";
}

function renderExportLinks() {
  if (!state.batchId) {
    el.exports.hidden = true;
    return;
  }
  el.exports.hidden = false;
  const suffix = labelsQuery();
  el.exportPrism.href = `/api/batches/${state.batchId}/exports/prism${suffix}`;
  el.exportExcel.href = `/api/batches/${state.batchId}/exports/excel${suffix}`;
  el.exportCounts.href = `/api/batches/${state.batchId}/exports/counts${suffix}`;
  el.exportCoords.href = `/api/batches/${state.batchId}/exports/coordinates`;
  el.exportJson.href = `/api/batches/${state.batchId}/exports/json`;
  el.exportAnnotated.href = `/api/batches/${state.batchId}/exports/annotated.zip`;
}

function anyPending() {
  return state.images.some((image) => image.status === "queued" || image.status === "detecting");
}

function scheduleBatchPoll() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (!state.batchId || !anyPending()) return;
  const pending = state.images.filter((image) => image.status === "queued" || image.status === "detecting").length;
  setStatus(`Detecting ${pending} image${pending === 1 ? "" : "s"}…`);
  state.pollTimer = setTimeout(refreshBatchProgress, 2500);
}

async function refreshBatchProgress() {
  state.pollTimer = null;
  if (!state.batchId) return;
  const batchId = state.batchId;
  let images;
  try {
    images = await api(`/api/batches/${batchId}/images`);
  } catch {
    scheduleBatchPoll();
    return;
  }
  if (state.batchId !== batchId) return; // user moved on
  state.images = images;
  renderImageList();
  if (!el.dashboardView.hidden) renderDashboard();
  // Reveal fresh predictions on the open image, but only while actually viewing
  // an image (not on the dashboard) and never over an unsaved edit.
  if (el.dashboardView.hidden && state.image && !state.dirty && !state.image.validated) {
    const fresh = images.find((image) => image.id === state.image.id);
    if (fresh && fresh.status === "predicted" && state.image.status !== "predicted") {
      await selectImage(state.image.id);
    }
  }
  if (!anyPending()) {
    setStatus("Ready");
    loadGroups().catch((error) => console.error(error));
    return;
  }
  scheduleBatchPoll();
}

async function loadGroups() {
  if (!state.batchId) {
    el.groups.hidden = true;
    return;
  }
  const groups = await api(`/api/batches/${state.batchId}/groups`);
  el.groups.hidden = false;
  el.groupList.innerHTML = "";
  for (const group of groups) {
    // Preserve any label the reviewer already typed this session.
    if (!(group.key in state.groupLabels)) state.groupLabels[group.key] = group.label;
    const row = document.createElement("label");
    row.className = "group-row";
    const total = group.counts.reduce((sum, count) => sum + Number(count || 0), 0);
    const caption = document.createElement("span");
    caption.className = "group-caption";
    caption.textContent = `${group.filenames.length} image${group.filenames.length === 1 ? "" : "s"} · ${total} traps · ${escapeHtml(group.key)}`;
    const input = document.createElement("input");
    input.type = "text";
    input.value = state.groupLabels[group.key];
    input.placeholder = group.key;
    input.addEventListener("input", () => {
      state.groupLabels[group.key] = input.value;
      renderExportLinks();
    });
    row.append(caption, input);
    el.groupList.append(row);
  }
  renderExportLinks();
}

function strainKey(filename) {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.replace(/[_-]\d+$/, "") || stem;
}

function strainLabel(filename) {
  const key = strainKey(filename);
  const renamed = state.groupLabels[key];
  return renamed && renamed.trim() ? renamed.trim() : key;
}

function displayCount(image) {
  return image.reviewed_count ?? (image.points ? image.points.length : 0);
}

function showDashboard() {
  el.dashboardView.hidden = false;
  el.workspace.style.display = "none";
  el.reviewFooter.style.display = "none";
  el.groups.hidden = true;
  el.exports.hidden = true;
  renderDashboard();
}

function hideDashboard() {
  el.dashboardView.hidden = true;
  el.workspace.style.display = "";
  el.reviewFooter.style.display = "";
  renderExportLinks();
  loadGroups().catch((error) => console.error(error));
}

function renderDashboard() {
  if (!state.batchId || !state.images.length) {
    el.dashboardProgress.textContent = "No images in this batch.";
    el.dashboardBody.innerHTML = "";
    return;
  }
  const done = state.images.filter((image) => image.validated).length;
  el.dashboardProgress.textContent = `${done} of ${state.images.length} images done`;

  const strains = new Map();
  for (const image of state.images) {
    const label = strainLabel(image.filename);
    if (!strains.has(label)) strains.set(label, new Map());
    const plates = strains.get(label);
    const plate = image.plate || 1;
    if (!plates.has(plate)) plates.set(plate, []);
    plates.get(plate).push(image);
  }
  let maxImgs = 3;
  for (const plates of strains.values()) {
    for (const imgs of plates.values()) maxImgs = Math.max(maxImgs, imgs.length);
  }

  let html = '<table class="dash-table"><thead><tr><th>plate</th>';
  for (let i = 1; i <= maxImgs; i += 1) html += `<th>image ${i}</th>`;
  html += '<th class="dash-total-h">plate total</th></tr></thead><tbody>';

  for (const [label, plates] of strains) {
    const plateNos = [...plates.keys()].sort((a, b) => a - b);
    const platesDone = plateNos.filter((p) => plates.get(p).every((im) => im.validated)).length;
    html += `<tr class="dash-strain"><td colspan="${maxImgs + 2}"><span class="dash-strain-name">${escapeHtml(label)}</span><span class="dash-strain-sub">${platesDone} of ${plateNos.length} plates done</span></td></tr>`;
    for (const p of plateNos) {
      const imgs = plates.get(p).slice().sort((a, b) => (a.image_number || 0) - (b.image_number || 0));
      html += `<tr><td class="dash-plate">plate ${p}</td>`;
      for (let i = 0; i < maxImgs; i += 1) {
        const image = imgs[i];
        if (!image) {
          html += '<td class="dash-cell"><span class="dash-dash">—</span></td>';
        } else if (image.validated) {
          html += `<td class="dash-cell dash-click" data-id="${image.id}">${displayCount(image)}</td>`;
        } else {
          html += `<td class="dash-cell dash-click" data-id="${image.id}"><span class="dash-bang">!</span></td>`;
        }
      }
      if (imgs.every((im) => im.validated)) {
        const total = imgs.reduce((sum, im) => sum + displayCount(im), 0);
        html += `<td class="dash-total"><span class="dash-total-ok">${total}</span></td>`;
      } else {
        html += '<td class="dash-total"><span class="dash-total-bad">! incomplete</span></td>';
      }
      html += "</tr>";
    }
  }
  html += "</tbody></table>";
  el.dashboardBody.innerHTML = html;
  el.dashboardBody.querySelectorAll(".dash-click").forEach((cell) => {
    cell.addEventListener("click", () => {
      hideDashboard();
      selectImage(Number(cell.dataset.id));
    });
  });
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadBatches().catch((error) => {
  console.error(error);
  setStatus("Load failed");
});
