const state = {
  batches: [],
  images: [],
  batchId: null,
  image: null,
  points: [],
  selectedId: null,
  draggingId: null,
};

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
  uncertain: document.querySelector("#uncertain"),
  notes: document.querySelector("#notes"),
  predictedCount: document.querySelector("#predictedCount"),
  highConfidenceCount: document.querySelector("#highConfidenceCount"),
  checkConfidenceCount: document.querySelector("#checkConfidenceCount"),
  lowConfidenceCount: document.querySelector("#lowConfidenceCount"),
  extraLowConfidenceCount: document.querySelector("#extraLowConfidenceCount"),
  reviewedCount: document.querySelector("#reviewedCount"),
  exports: document.querySelector("#exports"),
  exportCounts: document.querySelector("#exportCounts"),
  exportCoords: document.querySelector("#exportCoords"),
  exportExcel: document.querySelector("#exportExcel"),
  exportJson: document.querySelector("#exportJson"),
  exportAnnotated: document.querySelector("#exportAnnotated"),
};

function setStatus(message) {
  el.status.textContent = message;
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
  state.batchId = batchId;
  state.image = null;
  state.points = [];
  renderReview();
  renderExportLinks();
  await loadBatches();
  setStatus("Loading images");
  state.images = await api(`/api/batches/${batchId}/images`);
  renderImageList();
  if (state.images[0]) {
    await selectImage(state.images[0].id);
  }
  setStatus("Ready");
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
  state.image = await api(`/api/images/${imageId}`);
  state.points = state.image.points.map((point) => ({ ...point }));
  state.selectedId = null;
  el.preview.onload = fitOverlay;
  el.preview.src = state.image.preview_url;
  el.uncertain.checked = state.image.uncertain;
  el.notes.value = state.image.notes || "";
  renderReview();
  renderImageList();
}

function renderReview() {
  const hasImage = Boolean(state.image);
  el.emptyState.style.display = hasImage ? "none" : "block";
  el.preview.style.display = hasImage ? "block" : "none";
  el.overlay.style.display = hasImage ? "block" : "none";
  el.deletePoint.disabled = !state.selectedId;
  el.rerunPrediction.disabled = !hasImage;
  el.saveReview.disabled = !hasImage;
  el.imageTitle.textContent = hasImage ? state.image.filename : "No image selected";
  el.imageMeta.textContent = hasImage
    ? `${state.image.width} x ${state.image.height}px · ${state.image.model_version}`
    : "Upload or select a batch to begin.";
  el.predictedCount.textContent = hasImage ? state.image.predicted_count : "0";
  const confidenceCounts = hasImage
    ? predictedConfidenceCounts(state.points)
    : { high: 0, check: 0, low: 0, extraLow: 0 };
  el.highConfidenceCount.textContent = confidenceCounts.high;
  el.checkConfidenceCount.textContent = confidenceCounts.check;
  el.lowConfidenceCount.textContent = confidenceCounts.low;
  el.extraLowConfidenceCount.textContent = confidenceCounts.extraLow;
  el.reviewedCount.textContent = hasImage ? state.points.length : "0";
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
  el.overlay.innerHTML = "";
  if (!state.image) return;
  for (const point of state.points) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("point");
    if (point.id === state.selectedId) group.classList.add("selected");
    group.dataset.id = point.id;

    const color = markerColor(point);
    const arrowGap = Math.max(30, state.image.width * 0.016);
    const arrowHead = Math.max(17, state.image.width * 0.008);
    const direction = point.x > state.image.width - (arrowGap + arrowHead + 12) ? -1 : 1;
    const endX = point.x + direction * arrowGap;
    const endY = point.y;
    const baseX = endX + direction * arrowHead;
    const baseY = point.y;

    const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hitArea.setAttribute("cx", point.x);
    hitArea.setAttribute("cy", point.y);
    hitArea.setAttribute("r", Math.max(16, state.image.width * 0.007));
    hitArea.setAttribute("fill", "transparent");

    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    head.setAttribute(
      "points",
      `${endX},${endY} ${baseX},${baseY - arrowHead * 0.7} ${baseX},${baseY + arrowHead * 0.7}`
    );
    head.setAttribute("fill", color);
    head.setAttribute("opacity", "0.98");
    head.setAttribute("stroke", "#ffffff");
    head.setAttribute("stroke-width", Math.max(1.2, state.image.width * 0.00055));

    group.append(hitArea, head);
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
});

el.overlay.addEventListener("pointermove", (event) => {
  if (!state.draggingId || !state.image) return;
  const point = state.points.find((candidate) => candidate.id === state.draggingId);
  if (!point) return;
  const next = svgPoint(event);
  point.x = next.x;
  point.y = next.y;
  point.source = point.source === "predicted" ? "reviewed" : point.source;
  renderReview();
});

el.overlay.addEventListener("pointerup", () => {
  state.draggingId = null;
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
}

el.saveReview.addEventListener("click", async () => {
  if (!state.image) return;
  setStatus("Saving review");
  state.image = await api(`/api/images/${state.image.id}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: state.points.map((point) => ({ ...point, source: point.source === "predicted" ? "reviewed" : point.source })),
      uncertain: el.uncertain.checked,
      notes: el.notes.value,
    }),
  });
  state.points = state.image.points.map((point) => ({ ...point }));
  state.images = state.images.map((image) => (image.id === state.image.id ? state.image : image));
  renderReview();
  renderImageList();
  setStatus("Saved");
});

el.rerunPrediction.addEventListener("click", async () => {
  if (!state.image) return;
  setStatus("Running detection");
  state.image = await api(`/api/images/${state.image.id}/predict`, { method: "POST" });
  state.points = state.image.points.map((point) => ({ ...point }));
  state.images = state.images.map((image) => (image.id === state.image.id ? state.image : image));
  renderReview();
  renderImageList();
  setStatus("Detection complete");
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
window.addEventListener("resize", fitOverlay);

function renderExportLinks() {
  if (!state.batchId) {
    el.exports.hidden = true;
    return;
  }
  el.exports.hidden = false;
  el.exportCounts.href = `/api/batches/${state.batchId}/exports/counts`;
  el.exportCoords.href = `/api/batches/${state.batchId}/exports/coordinates`;
  el.exportExcel.href = `/api/batches/${state.batchId}/exports/excel`;
  el.exportJson.href = `/api/batches/${state.batchId}/exports/json`;
  el.exportAnnotated.href = `/api/batches/${state.batchId}/exports/annotated.zip`;
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
