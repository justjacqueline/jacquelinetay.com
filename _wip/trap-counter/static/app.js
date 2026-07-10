const el = {
  status: document.querySelector("#status"),
  batchSelect: document.querySelector("#batchSelect"),
  newBatchBtn: document.querySelector("#newBatchBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),

  dashboardView: document.querySelector("#dashboardView"),
  progressLabel: document.querySelector("#progressLabel"),
  progressFill: document.querySelector("#progressFill"),
  editStrainsBtn: document.querySelector("#editStrainsBtn"),
  dashboardBody: document.querySelector("#dashboardBody"),
  emptyDash: document.querySelector("#emptyDash"),

  reviewView: document.querySelector("#reviewView"),
  backBtn: document.querySelector("#backBtn"),
  reviewContext: document.querySelector("#reviewContext"),
  saveState: document.querySelector("#saveState"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  imageStage: document.querySelector("#imageStage"),
  preview: document.querySelector("#preview"),
  overlay: document.querySelector("#overlay"),
  stageHint: document.querySelector("#stageHint"),
  markDone: document.querySelector("#markDone"),
  reviewedCount: document.querySelector("#reviewedCount"),
  predictedCount: document.querySelector("#predictedCount"),
  markerStyle: document.querySelector("#markerStyle"),
  notes: document.querySelector("#notes"),

  uploadModal: document.querySelector("#uploadModal"),
  uploadForm: document.querySelector("#uploadForm"),
  downloadModal: document.querySelector("#downloadModal"),
  downloadWarn: document.querySelector("#downloadWarn"),
  exportPlateTotals: document.querySelector("#exportPlateTotals"),
  exportCounts: document.querySelector("#exportCounts"),
  exportCoords: document.querySelector("#exportCoords"),
  exportAnnotated: document.querySelector("#exportAnnotated"),
  strainsModal: document.querySelector("#strainsModal"),
  strainList: document.querySelector("#strainList"),
};

const state = {
  batches: [],
  images: [],
  batchId: null,
  image: null,
  points: [],
  selectedId: null,
  draggingId: null,
  dragMoved: false,
  dirty: false,
  saving: false,
  saveTimer: null,
  savePromise: null,
  pollTimer: null,
  groupLabels: {},
  markerStyle: localStorage.getItem("trap-counter-marker-style") === "arrow" ? "arrow" : "bubble",
};

const AUTOSAVE_DELAY = 900;
const DRAFT_PREFIX = "trap-counter-draft:";

function setStatus(message) {
  el.status.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json();
}

// ---------- Confidence filter (only the AI's confident guesses are shown) ----------
function confidenceBand(point) {
  const c = Number(point.confidence ?? 0);
  if (c >= 0.5) return "high";
  if (c >= 0.35) return "check";
  if (c >= 0.15) return "low";
  return "extraLow";
}

function passesFilter(point) {
  if (point.source !== "predicted") return true;
  return confidenceBand(point) === "high";
}

function visiblePoints() {
  return state.points.filter(passesFilter);
}

function markerColor(point) {
  return point.source === "predicted" ? "#050505" : "#0b6f3f";
}

// ---------- Autosave engine ----------
function setSaveState(name) {
  const labels = {
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    error: "Save failed — kept locally, retrying",
    locked: "Done — locked",
  };
  el.saveState.dataset.state = name;
  el.saveState.textContent = labels[name] || name;
}

function draftKey(id) { return `${DRAFT_PREFIX}${id}`; }
function writeDraft() {
  if (!state.image) return;
  try {
    localStorage.setItem(draftKey(state.image.id), JSON.stringify({ points: state.points, notes: el.notes.value, ts: Date.now() }));
  } catch (e) { console.warn(e); }
}
function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) || "null"); } catch { return null; }
}
function clearDraft(id) { try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } }

function reviewPayload() {
  return {
    points: visiblePoints().map((p) => ({ ...p, source: p.source === "predicted" ? "reviewed" : p.source })),
    uncertain: false,
    notes: el.notes.value,
  };
}

function markDirty() {
  if (!state.image) return;
  state.dirty = true;
  writeDraft();
  if (!state.saving) setSaveState("unsaved");
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { state.saveTimer = null; persistReview(); }, AUTOSAVE_DELAY);
}

function persistReview() {
  if (!state.image || state.saving || !state.dirty) return state.savePromise || Promise.resolve();
  state.saving = true;
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  state.savePromise = doPersist();
  return state.savePromise;
}

async function doPersist() {
  const imageId = state.image.id;
  const payload = reviewPayload();
  state.dirty = false;
  setSaveState("saving");
  try {
    const updated = await api(`/api/images/${imageId}/review`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    state.images = state.images.map((im) => (im.id === imageId ? updated : im));
    if (state.image && state.image.id === imageId) state.image = { ...state.image, ...updated };
    if (!state.dirty) clearDraft(imageId);
    setSaveState(state.dirty ? "unsaved" : "saved");
  } catch (error) {
    state.dirty = true;
    console.error("Save failed", error);
    setSaveState("error");
  } finally {
    state.saving = false;
    state.savePromise = null;
    if (state.dirty && state.image && state.image.id === imageId) markDirty();
  }
}

async function flushPendingSave() {
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  let guard = 0;
  while (state.image && (state.dirty || state.saving) && guard++ < 6) {
    if (state.saving && state.savePromise) await state.savePromise;
    else if (state.dirty) await persistReview();
    else break;
  }
}

// ---------- Marker rendering ----------
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
  if (!state.image) { el.overlay.innerHTML = ""; return; }
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
  const hitR = Math.max(16, state.image.width * 0.007);
  for (const point of visiblePoints()) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("point");
    if (point.id === state.selectedId) g.classList.add("selected");
    g.dataset.id = point.id;
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("cx", point.x); hit.setAttribute("cy", point.y);
    hit.setAttribute("r", hitR); hit.setAttribute("fill", "transparent");

    if (state.markerStyle === "bubble") {
      const r = Math.max(34, state.image.width * 0.024);
      const drop = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      drop.setAttribute("cx", point.x); drop.setAttribute("cy", point.y);
      drop.setAttribute("r", r); drop.setAttribute("fill", "url(#waterdrop)");
      if (point.id === state.selectedId) {
        drop.setAttribute("stroke", "#1d7e53"); drop.setAttribute("stroke-opacity", "0.7");
        drop.setAttribute("stroke-width", Math.max(1.5, state.image.width * 0.0008));
      } else { drop.setAttribute("stroke", "none"); }
      g.append(drop, hit);
    } else {
      const gap = Math.max(30, state.image.width * 0.016);
      const head = Math.max(17, state.image.width * 0.008);
      const dir = point.x > state.image.width - (gap + head + 12) ? -1 : 1;
      const endX = point.x + dir * gap;
      const baseX = endX + dir * head;
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrow.setAttribute("points", `${endX},${point.y} ${baseX},${point.y - head * 0.7} ${baseX},${point.y + head * 0.7}`);
      arrow.setAttribute("fill", markerColor(point)); arrow.setAttribute("opacity", "0.98");
      g.append(hit, arrow);
    }
    g.addEventListener("pointerdown", (event) => {
      if (state.image.validated) return;
      event.stopPropagation();
      state.selectedId = point.id;
      state.draggingId = point.id;
      state.dragMoved = false;
      g.setPointerCapture(event.pointerId);
      renderPoints();
    });
    el.overlay.append(g);
  }
}

function svgPoint(event) {
  const p = el.overlay.createSVGPoint();
  p.x = event.clientX; p.y = event.clientY;
  const t = p.matrixTransform(el.overlay.getScreenCTM().inverse());
  return { x: Math.max(0, Math.min(state.image.width, t.x)), y: Math.max(0, Math.min(state.image.height, t.y)) };
}

el.overlay.addEventListener("pointerdown", (event) => {
  if (!state.image || state.image.validated || event.target.closest(".point")) return;
  const p = svgPoint(event);
  const id = `pt_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  state.points.push({ id, x: p.x, y: p.y, source: "manual", confidence: null });
  state.selectedId = id;
  updateReview();
  markDirty();
});

el.overlay.addEventListener("pointermove", (event) => {
  if (!state.draggingId || !state.image) return;
  const point = state.points.find((c) => c.id === state.draggingId);
  if (!point) return;
  const next = svgPoint(event);
  point.x = next.x; point.y = next.y;
  point.source = point.source === "predicted" ? "reviewed" : point.source;
  state.dragMoved = true;
  renderPoints();
});

el.overlay.addEventListener("pointerup", () => {
  if (state.draggingId && state.dragMoved) markDirty();
  state.draggingId = null; state.dragMoved = false;
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (!state.selectedId || !state.image || state.image.validated) return;
  event.preventDefault();
  state.points = state.points.filter((p) => p.id !== state.selectedId);
  state.selectedId = null;
  updateReview();
  markDirty();
});

// ---------- Review view ----------
function pictureNo(image) {
  const peers = state.images
    .filter((im) => strainLabel(im.filename) === strainLabel(image.filename) && im.plate === image.plate)
    .sort((a, b) => (a.image_number || 0) - (b.image_number || 0));
  return peers.findIndex((im) => im.id === image.id) + 1;
}

function updateReview() {
  if (!state.image) return;
  const locked = Boolean(state.image.validated);
  const idx = state.images.findIndex((im) => im.id === state.image.id);
  el.reviewContext.textContent =
    `${strainLabel(state.image.filename)} · plate ${state.image.plate} · picture ${pictureNo(state.image)}  (image ${idx + 1} of ${state.images.length})`;
  el.markDone.textContent = locked ? "Undone (edit)" : "✓ Mark done";
  el.markDone.classList.toggle("primary", !locked);
  el.prevBtn.disabled = idx <= 0;
  el.nextBtn.disabled = idx >= state.images.length - 1;
  el.overlay.style.pointerEvents = locked ? "none" : "";
  el.imageStage.classList.toggle("locked", locked);
  el.stageHint.hidden = locked;
  const shown = visiblePoints();
  el.reviewedCount.textContent = shown.length;
  el.predictedCount.textContent = state.image.predicted_count;
  renderPoints();
}

async function selectImage(imageId) {
  await flushPendingSave();
  showReview();
  state.image = await api(`/api/images/${imageId}`);
  state.selectedId = null;
  el.preview.onload = fitOverlay;
  el.preview.src = state.image.preview_url;

  const draft = readDraft(imageId);
  if (draft && Array.isArray(draft.points) && !state.image.validated) {
    state.points = draft.points.map((p) => ({ ...p }));
    el.notes.value = draft.notes || "";
    state.dirty = true;
    updateReview();
    setSaveState("unsaved");
    markDirty();
    setStatus("Recovered unsaved edits for this image");
    return;
  }
  state.points = state.image.points.map((p) => ({ ...p }));
  el.notes.value = state.image.notes || "";
  state.dirty = false;
  updateReview();
  setSaveState(state.image.validated ? "locked" : "saved");
}

async function goRelative(step) {
  const idx = state.images.findIndex((im) => im.id === state.image.id);
  const next = state.images[idx + step];
  if (next) await selectImage(next.id);
}

el.prevBtn.addEventListener("click", () => goRelative(-1));
el.nextBtn.addEventListener("click", () => goRelative(1));
el.backBtn.addEventListener("click", async () => { await flushPendingSave(); showDashboard(); });

el.markDone.addEventListener("click", async () => {
  if (!state.image) return;
  const next = !state.image.validated;
  if (next) await flushPendingSave();
  state.image = await api(`/api/images/${state.image.id}/validate`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ validated: next }),
  });
  state.points = state.image.points.map((p) => ({ ...p }));
  state.images = state.images.map((im) => (im.id === state.image.id ? state.image : im));
  updateReview();
  setSaveState(next ? "locked" : "saved");
});

el.notes.addEventListener("input", markDirty);

el.markerStyle.value = state.markerStyle;
el.markerStyle.addEventListener("change", () => {
  state.markerStyle = el.markerStyle.value === "arrow" ? "arrow" : "bubble";
  localStorage.setItem("trap-counter-marker-style", state.markerStyle);
  renderPoints();
});

window.addEventListener("resize", fitOverlay);
window.addEventListener("beforeunload", (event) => {
  if (state.dirty || state.saving) { event.preventDefault(); event.returnValue = ""; }
});

// ---------- Dashboard ----------
function strainKey(filename) {
  let s = filename.replace(/\.[^.]+$/, "");
  s = s.replace(/[_-]\d+$/, "");
  s = s.replace(/^\d{4}-\d{2}-\d{2}[_-]/, "");
  s = s.replace(/^trapquant[_-]/i, "");
  return s || filename;
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
  el.reviewView.hidden = true;
  el.dashboardView.hidden = false;
  renderDashboard();
}
function showReview() {
  el.dashboardView.hidden = true;
  el.reviewView.hidden = false;
}

function renderDashboard() {
  const has = state.batchId && state.images.length;
  el.emptyDash.hidden = Boolean(has);
  if (!has) {
    el.progressLabel.textContent = state.batchId ? "No images in this batch." : "No batch selected.";
    el.progressFill.style.width = "0";
    el.dashboardBody.innerHTML = "";
    el.editStrainsBtn.hidden = true;
    return;
  }
  el.editStrainsBtn.hidden = false;
  const done = state.images.filter((im) => im.validated).length;
  el.progressLabel.textContent = `${done} of ${state.images.length} images done`;
  el.progressFill.style.width = `${Math.round((done / state.images.length) * 100)}%`;

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
  for (const plates of strains.values()) for (const imgs of plates.values()) maxImgs = Math.max(maxImgs, imgs.length);

  let html = '<table class="dash-table"><thead><tr><th>plate</th>';
  for (let i = 1; i <= maxImgs; i += 1) html += `<th>picture ${i}</th>`;
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
        if (!image) html += '<td class="dash-cell"><span class="dash-dash">—</span></td>';
        else if (image.validated) html += `<td class="dash-cell dash-click" data-id="${image.id}">${displayCount(image)}</td>`;
        else html += `<td class="dash-cell dash-click" data-id="${image.id}"><span class="dash-bang">!</span></td>`;
      }
      if (imgs.every((im) => im.validated)) {
        const total = imgs.reduce((s, im) => s + displayCount(im), 0);
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
    cell.addEventListener("click", () => selectImage(Number(cell.dataset.id)));
  });
}

// ---------- Detection progress polling ----------
function anyPending() {
  return state.images.some((im) => im.status === "queued" || im.status === "detecting");
}
function scheduleBatchPoll() {
  if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
  if (!state.batchId || !anyPending()) return;
  const n = state.images.filter((im) => im.status === "queued" || im.status === "detecting").length;
  setStatus(`Detecting ${n} image${n === 1 ? "" : "s"}…`);
  state.pollTimer = setTimeout(refreshBatchProgress, 2500);
}
async function refreshBatchProgress() {
  state.pollTimer = null;
  if (!state.batchId) return;
  const batchId = state.batchId;
  let images;
  try { images = await api(`/api/batches/${batchId}/images`); } catch { scheduleBatchPoll(); return; }
  if (state.batchId !== batchId) return;
  state.images = images;
  if (!el.dashboardView.hidden) renderDashboard();
  if (!anyPending()) { setStatus("Ready"); return; }
  scheduleBatchPoll();
}

// ---------- Batches ----------
async function loadBatches(selectId) {
  state.batches = await api("/api/batches");
  el.batchSelect.innerHTML = state.batches.length
    ? state.batches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)} (${b.image_count})</option>`).join("")
    : '<option value="">No batches yet</option>';
  const target = selectId || state.batchId || (state.batches[0] && state.batches[0].id);
  if (target) {
    el.batchSelect.value = String(target);
    await selectBatch(Number(target));
  } else {
    el.downloadBtn.disabled = true;
    renderDashboard();
  }
}

async function selectBatch(batchId) {
  await flushPendingSave();
  state.batchId = batchId;
  state.image = null;
  state.points = [];
  state.groupLabels = {};
  el.downloadBtn.disabled = false;
  setStatus("Loading images");
  state.images = await api(`/api/batches/${batchId}/images`);
  await loadGroups();
  showDashboard();
  setStatus("Ready");
  scheduleBatchPoll();
}

el.batchSelect.addEventListener("change", () => {
  const id = Number(el.batchSelect.value);
  if (id) selectBatch(id);
});

// ---------- Strain names ----------
async function loadGroups() {
  if (!state.batchId) return;
  const groups = await api(`/api/batches/${state.batchId}/groups`);
  for (const g of groups) if (!(g.key in state.groupLabels)) state.groupLabels[g.key] = g.label;
  el.strainList.innerHTML = "";
  for (const g of groups) {
    const total = g.counts.reduce((s, c) => s + Number(c || 0), 0);
    const row = document.createElement("label");
    row.className = "strain-row";
    const cap = document.createElement("span");
    cap.className = "strain-caption";
    cap.textContent = `${g.filenames.length} image${g.filenames.length === 1 ? "" : "s"} · ${total} traps · ${g.key}`;
    const input = document.createElement("input");
    input.type = "text"; input.value = state.groupLabels[g.key]; input.placeholder = g.key;
    input.addEventListener("input", () => { state.groupLabels[g.key] = input.value; if (!el.dashboardView.hidden) renderDashboard(); });
    row.append(cap, input);
    el.strainList.append(row);
  }
}

// ---------- Download links ----------
function labelsQuery() {
  const labels = {};
  for (const [key, value] of Object.entries(state.groupLabels)) {
    if (value && value.trim() && value.trim() !== key) labels[key] = value.trim();
  }
  return Object.keys(labels).length ? `?labels=${encodeURIComponent(JSON.stringify(labels))}` : "";
}
function markerQuery(sep) {
  return `${sep}marker=${state.markerStyle}`;
}
function renderDownloadLinks() {
  if (!state.batchId) return;
  const q = labelsQuery();
  el.exportPlateTotals.href = `/api/batches/${state.batchId}/exports/plate_totals${q}`;
  el.exportCounts.href = `/api/batches/${state.batchId}/exports/counts${q}`;
  el.exportCoords.href = `/api/batches/${state.batchId}/exports/coordinates`;
  el.exportAnnotated.href = `/api/batches/${state.batchId}/exports/annotated.zip${markerQuery("?")}`;
  const notDone = state.images.filter((im) => !im.validated).length;
  el.downloadWarn.hidden = notDone === 0;
  if (notDone > 0) el.downloadWarn.textContent = `${notDone} of ${state.images.length} images are not marked done — their plate totals will be blank.`;
}

// ---------- Modals ----------
function openModal(modal) { modal.hidden = false; }
function closeModal(modal) { modal.hidden = true; }
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest(".modal-backdrop").hidden = true);
});
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.hidden = true; });
});

el.newBatchBtn.addEventListener("click", () => openModal(el.uploadModal));
el.editStrainsBtn.addEventListener("click", () => openModal(el.strainsModal));
el.downloadBtn.addEventListener("click", () => { renderDownloadLinks(); openModal(el.downloadModal); });

el.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(el.uploadForm);
  setStatus("Uploading");
  try {
    const batch = await api("/api/batches", { method: "POST", body: formData });
    el.uploadForm.reset();
    closeModal(el.uploadModal);
    await loadBatches(batch.id);
  } catch (error) {
    console.error(error);
    setStatus("Upload failed");
  }
});

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

loadBatches().catch((error) => { console.error(error); setStatus("Load failed"); });
