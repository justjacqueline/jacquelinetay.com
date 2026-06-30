const image = document.getElementById("sampleImage");
const layer = document.getElementById("markerLayer");
const exampleSelect = document.getElementById("exampleSelect");
const filenameReadout = document.getElementById("filenameReadout");
const predictedCount = document.getElementById("predictedCount");
const reviewedCount = document.getElementById("reviewedCount");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const notes = document.getElementById("notes");
const uncertain = document.getElementById("uncertain");
const selectedReadout = document.getElementById("selectedReadout");

const storageKey = "trap-counter-practice-v2";

let examples = [];
let currentExample = null;
let state = null;
let selectedId = null;
let draggingId = null;
let dragMoved = false;

function defaultState(example) {
  return {
    points: example.points.map((point) => ({ ...point })),
    notes: "",
    uncertain: false
  };
}

function stateKey(exampleId) {
  return `${storageKey}:${exampleId}`;
}

function loadState(example) {
  try {
    const stored = JSON.parse(localStorage.getItem(stateKey(example.id)) || "null");
    if (stored && Array.isArray(stored.points)) {
      return stored;
    }
  } catch {
    localStorage.removeItem(stateKey(example.id));
  }
  return defaultState(example);
}

function saveState() {
  if (!currentExample || !state) return;
  state.notes = notes.value;
  state.uncertain = uncertain.checked;
  localStorage.setItem(stateKey(currentExample.id), JSON.stringify(state));
}

function setExample(exampleId) {
  const next = examples.find((example) => example.id === exampleId) || examples[0];
  if (!next) return;
  currentExample = next;
  state = loadState(currentExample);
  selectedId = null;
  notes.value = state.notes || "";
  uncertain.checked = Boolean(state.uncertain);
  filenameReadout.textContent = currentExample.filename;
  image.src = currentExample.src;
  render();
}

function render() {
  if (!currentExample || !state) return;
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const stageRect = image.parentElement.getBoundingClientRect();
  const left = rect.left - stageRect.left;
  const top = rect.top - stageRect.top;

  layer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  layer.style.left = `${left}px`;
  layer.style.top = `${top}px`;
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

  predictedCount.textContent = currentExample.points.length.toString();
  reviewedCount.textContent = state.points.length.toString();
  updateSelectedReadout();
}

function updateSelectedReadout() {
  const point = state?.points.find((item) => item.id === selectedId);
  if (!point || !currentExample) {
    selectedReadout.textContent = "No marker selected";
    return;
  }
  selectedReadout.textContent = `Selected ${point.id} at ${Math.round(point.x * currentExample.width)}, ${Math.round(point.y * currentExample.height)}`;
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
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
  event.preventDefault();
  deleteSelected();
});

exampleSelect.addEventListener("change", () => {
  saveState();
  setExample(exampleSelect.value);
});

notes.addEventListener("input", saveState);
uncertain.addEventListener("change", saveState);

resetBtn.addEventListener("click", () => {
  if (!currentExample) return;
  state = defaultState(currentExample);
  selectedId = null;
  notes.value = "";
  uncertain.checked = false;
  saveState();
  render();
});

exportBtn.addEventListener("click", () => {
  if (!currentExample || !state) return;
  saveState();
  const payload = {
    image: currentExample.filename,
    image_width: currentExample.width,
    image_height: currentExample.height,
    reviewed_count: state.points.length,
    uncertain: state.uncertain,
    notes: state.notes,
    points: state.points.map((point) => ({
      id: point.id,
      x: Math.round(point.x * currentExample.width * 10) / 10,
      y: Math.round(point.y * currentExample.height * 10) / 10,
      source: point.source,
      confidence: point.confidence
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${currentExample.id}-review.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

image.addEventListener("load", render);
window.addEventListener("resize", render);

fetch("./examples.json")
  .then((response) => response.json())
  .then((data) => {
    examples = data;
    exampleSelect.innerHTML = examples
      .map((example) => `<option value="${example.id}">${example.label}</option>`)
      .join("");
    setExample(examples[0]?.id);
  })
  .catch(() => {
    selectedReadout.textContent = "Could not load practice examples.";
  });
