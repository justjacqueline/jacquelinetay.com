const image = document.getElementById("sampleImage");
const layer = document.getElementById("markerLayer");
const predictedCount = document.getElementById("predictedCount");
const reviewedCount = document.getElementById("reviewedCount");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const notes = document.getElementById("notes");
const uncertain = document.getElementById("uncertain");
const selectedReadout = document.getElementById("selectedReadout");

const storageKey = "trap-counter-practice-v1";
const imageSize = { width: 2560, height: 1920 };
const seedPoints = [
  { id: "pt_01", x: 0.7973, y: 0.0123, source: "predicted", confidence: 0.76 },
  { id: "pt_02", x: 0.6752, y: 0.0324, source: "predicted", confidence: 0.70 },
  { id: "pt_03", x: 0.5420, y: 0.0534, source: "predicted", confidence: 0.60 },
  { id: "pt_04", x: 0.3025, y: 0.0579, source: "predicted", confidence: 0.71 },
  { id: "pt_05", x: 0.4751, y: 0.0591, source: "predicted", confidence: 0.69 },
  { id: "pt_06", x: 0.9518, y: 0.0731, source: "predicted", confidence: 0.67 },
  { id: "pt_07", x: 0.5428, y: 0.1002, source: "predicted", confidence: 0.66 },
  { id: "pt_08", x: 0.8256, y: 0.0980, source: "predicted", confidence: 0.60 },
  { id: "pt_09", x: 0.7593, y: 0.1329, source: "predicted", confidence: 0.72 },
  { id: "pt_10", x: 0.4709, y: 0.1272, source: "predicted", confidence: 0.61 },
  { id: "pt_11", x: 0.5403, y: 0.1678, source: "predicted", confidence: 0.78 },
  { id: "pt_12", x: 0.9616, y: 0.1560, source: "predicted", confidence: 0.65 },
  { id: "pt_13", x: 0.5468, y: 0.1910, source: "predicted", confidence: 0.73 },
  { id: "pt_14", x: 0.8733, y: 0.2021, source: "predicted", confidence: 0.80 },
  { id: "pt_15", x: 0.6799, y: 0.2096, source: "predicted", confidence: 0.65 },
  { id: "pt_16", x: 0.5504, y: 0.2218, source: "predicted", confidence: 0.75 },
  { id: "pt_17", x: 0.8881, y: 0.2292, source: "predicted", confidence: 0.81 },
  { id: "pt_18", x: 0.0692, y: 0.2368, source: "predicted", confidence: 0.60 }
];

let state = loadState();
let selectedId = null;
let draggingId = null;
let dragMoved = false;

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (stored && Array.isArray(stored.points)) {
      return stored;
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
  return {
    points: seedPoints.map((point) => ({ ...point })),
    notes: "",
    uncertain: false
  };
}

function saveState() {
  state.notes = notes.value;
  state.uncertain = uncertain.checked;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function render() {
  const rect = image.getBoundingClientRect();
  layer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
  layer.innerHTML = "";

  state.points.forEach((point) => {
    const x = point.x * rect.width;
    const y = point.y * rect.height;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("marker-hit");
    group.dataset.id = point.id;
    group.setAttribute("transform", `translate(${x} ${y})`);

    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("cx", "0");
    hit.setAttribute("cy", "0");
    hit.setAttribute("r", "16");
    hit.setAttribute("fill", "transparent");

    const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
    head.setAttribute("d", "M -30 -9 L -8 0 L -30 9 Z");
    head.classList.add("marker-head");
    if (point.source === "reviewed") head.classList.add("reviewed");
    if (point.id === selectedId) head.classList.add("selected");

    group.append(hit, head);
    layer.append(group);
  });

  predictedCount.textContent = seedPoints.length.toString();
  reviewedCount.textContent = state.points.length.toString();
  updateSelectedReadout();
}

function updateSelectedReadout() {
  const point = state.points.find((item) => item.id === selectedId);
  if (!point) {
    selectedReadout.textContent = "No marker selected";
    return;
  }
  selectedReadout.textContent = `Selected ${point.id} at ${Math.round(point.x * imageSize.width)}, ${Math.round(point.y * imageSize.height)}`;
}

function pointerToPoint(event) {
  const rect = image.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function addPoint(event) {
  const point = pointerToPoint(event);
  const newPoint = {
    id: `pt_manual_${Date.now().toString(36)}`,
    x: point.x,
    y: point.y,
    source: "reviewed",
    confidence: 1
  };
  state.points.push(newPoint);
  selectedId = newPoint.id;
  saveState();
  render();
}

function moveSelected(event) {
  if (!draggingId) return;
  const point = state.points.find((item) => item.id === draggingId);
  if (!point) return;
  const next = pointerToPoint(event);
  point.x = next.x;
  point.y = next.y;
  point.source = "reviewed";
  dragMoved = true;
  render();
}

function deleteSelected() {
  if (!selectedId) return;
  state.points = state.points.filter((point) => point.id !== selectedId);
  selectedId = null;
  saveState();
  render();
}

layer.addEventListener("pointerdown", (event) => {
  const marker = event.target.closest(".marker-hit");
  if (marker) {
    selectedId = marker.dataset.id;
    draggingId = selectedId;
    dragMoved = false;
    layer.setPointerCapture(event.pointerId);
    render();
    return;
  }
  addPoint(event);
});

layer.addEventListener("pointermove", (event) => {
  moveSelected(event);
});

layer.addEventListener("pointerup", (event) => {
  if (draggingId) {
    layer.releasePointerCapture(event.pointerId);
    draggingId = null;
    if (dragMoved) saveState();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Delete" || event.key === "Backspace") {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
    event.preventDefault();
    deleteSelected();
  }
});

notes.addEventListener("input", saveState);
uncertain.addEventListener("change", saveState);

resetBtn.addEventListener("click", () => {
  state = {
    points: seedPoints.map((point) => ({ ...point })),
    notes: "",
    uncertain: false
  };
  selectedId = null;
  notes.value = "";
  uncertain.checked = false;
  saveState();
  render();
});

exportBtn.addEventListener("click", () => {
  saveState();
  const payload = {
    image: "2026-06-11_TrapQuant_drd-5AddDrd-5line2_003.tif",
    image_width: imageSize.width,
    image_height: imageSize.height,
    reviewed_count: state.points.length,
    uncertain: state.uncertain,
    notes: state.notes,
    points: state.points.map((point) => ({
      id: point.id,
      x: Math.round(point.x * imageSize.width * 10) / 10,
      y: Math.round(point.y * imageSize.height * 10) / 10,
      source: point.source,
      confidence: point.confidence
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "trap-counter-practice-review.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

image.addEventListener("load", () => {
  notes.value = state.notes || "";
  uncertain.checked = Boolean(state.uncertain);
  render();
});

if (image.complete) {
  notes.value = state.notes || "";
  uncertain.checked = Boolean(state.uncertain);
  render();
}

window.addEventListener("resize", render);
