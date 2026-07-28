const MAP_CENTER = [37.796, -122.414];
const AREA_BOUNDS = [
  [37.7882, -122.4285],
  [37.8018, -122.4056],
];
const SWEEP_LOOKAHEAD_DAYS = 8;

const DATASETS = {
  parking: {
    label: "Parking regulations",
    url: "https://data.sfgov.org/resource/hi6h-neyh.geojson?$limit=50000",
  },
  sweeping: {
    label: "Street sweeping",
    url: "https://data.sfgov.org/resource/yhqp-riqs.geojson?$limit=50000",
  },
  meters: {
    label: "Parking meters",
    url: "https://data.sfgov.org/resource/8vzz-qzz9.geojson?$limit=50000",
  },
  blue: {
    label: "Blue curb spaces",
    url: "https://data.sfgov.org/resource/g69s-9jxr.geojson?$limit=50000",
  },
};

const SAMPLE_SEGMENTS = [
  {
    id: "sample-area-c",
    coords: [[37.79665, -122.4164], [37.7965, -122.4145], [37.79634, -122.4128]],
    street: "Area C sample curb",
    limits: "Sample segment",
    side: "Unknown",
    permit: "Area C likely",
    sweeping: "Load bundled data for official records",
    meter: "No meter in starter record",
    confidence: "Needs sign check",
    source: "Starter placeholder",
  },
  {
    id: "sample-mixed",
    coords: [[37.7951, -122.4166], [37.79495, -122.4147], [37.79478, -122.4129]],
    street: "Mixed-rule sample curb",
    limits: "Sample segment",
    side: "Unknown",
    permit: "Area C or mixed rule possible",
    sweeping: "Load bundled data for official records",
    meter: "Unknown",
    confidence: "Needs city data",
    source: "Starter placeholder",
  },
  {
    id: "sample-unknown",
    coords: [[37.7977, -122.4144], [37.79754, -122.4126], [37.7974, -122.4108]],
    street: "Unverified sample curb",
    limits: "Sample segment",
    side: "Unknown",
    permit: "Unknown",
    sweeping: "Load bundled data for official records",
    meter: "Unknown",
    confidence: "Needs city data",
    source: "Starter placeholder",
  },
];

const state = {
  mode: "now",
  loadedCityData: false,
  citySweeping: [],
  layers: {
    samples: null,
    sweeping: null,
  },
};

const map = L.map("map", {
  zoomControl: false,
  scrollWheelZoom: true,
  touchZoom: true,
  doubleClickZoom: true,
  boxZoom: true,
  keyboard: true,
  zoomSnap: 0.25,
}).setView(MAP_CENTER, 16);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const dataStatus = document.querySelector("#data-status");
const loadButton = document.querySelector("#load-data");
const dateInput = document.querySelector("#check-date");
const timeInput = document.querySelector("#check-time");

function initDateTime() {
  const now = new Date();
  if (dateInput) dateInput.value = now.toISOString().slice(0, 10);
  if (timeInput) timeInput.value = now.toTimeString().slice(0, 5);
}

function valueFor(properties, names) {
  const entries = Object.entries(properties || {});
  for (const target of names) {
    const found = entries.find(([key]) => key.toLowerCase() === target.toLowerCase());
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim() !== "") {
      return String(found[1]);
    }
  }
  return "";
}

function includesAreaC(properties) {
  const fields = ["rpparea1", "rpparea2", "rpparea3", "rpp_area_1", "rpp_area_2", "rpp_area_3"];
  return fields.some((field) => {
    const value = valueFor(properties, [field]).toUpperCase();
    return value.split(/[^A-Z0-9]+/).includes("C") || value === "C";
  });
}

function boundsContainsFeature(feature) {
  try {
    const layer = L.geoJSON(feature);
    return map.getBounds().pad(1.35).intersects(layer.getBounds());
  } catch {
    return false;
  }
}

function statusForSegment(segment) {
  if (state.mode === "sources") return "unknown";
  if (state.mode === "sweeping") {
    return sweepStatus(segment);
  }
  if (state.mode === "now") {
    const decision = moveDecision(segment);
    if (decision.status === "no" || decision.status === "move") return "conflict";
    if (decision.status === "later") return "paid";
    if (decision.status === "ok") return "c-valid";
    if (/unknown|check|needs/i.test(segment.confidence || segment.sweeping || "")) return "unknown";
  }
  if (/overlap|mixed/i.test(segment.permit || "")) return "c-overlap";
  if (/area c|permit c|\bc\b/i.test(segment.permit || "")) return "c-valid";
  return "unknown";
}

function colorForStatus(status) {
  return {
    "c-valid": "#24735f",
    "c-overlap": "#6d6aa8",
    paid: "#b77b23",
    conflict: "#b43d38",
    unknown: "#7a8179",
  }[status] || "#7a8179";
}

function popupHtml(segment) {
  const decision = moveDecision(segment);
  const details = parkingDetailsHtml(segment);
  const spotEstimate = estimateSpotText(segment);
  return `
    <div class="popup-card">
      <p class="popup-kicker">${escapeHtml(segment.street || "This curb")}</p>
      <div class="verdict verdict-${decision.status}">
        <span>${escapeHtml(decision.label)}</span>
        <h3>${escapeHtml(decision.title)}</h3>
        <p>${escapeHtml(decision.body)}</p>
      </div>
      <div class="spot-estimate">${escapeHtml(spotEstimate)}</div>
      <details>
        <summary>City details</summary>
        ${details}
      </details>
    </div>
  `;
}

function parkingDecision(segment) {
  return moveDecision(segment);
}

function moveDecision(segment) {
  const nextSweep = nextSweepingEvent(segment);

  if (nextSweep && nextSweep.active) {
    return {
      status: "no",
      label: "When do I move?",
      title: "Move it now",
      body: `Street sweeping is active until ${formatHour(nextSweep.endHour)} on ${curbDescription(segment)}.`,
    };
  }

  if (nextSweep) {
    const hoursUntil = (nextSweep.start - selectedDateTime()) / 36e5;
    const status = hoursUntil <= 36 ? "move" : "later";
    return {
      status,
      label: "When do I move?",
      title: `Move before ${nextSweep.label} at ${formatHour(nextSweep.startHour)}`,
      body: `Next street sweeping is ${nextSweep.label} from ${formatHour(nextSweep.startHour)} to ${formatHour(nextSweep.endHour)} on ${curbDescription(segment)}.`,
    };
  }

  return {
    status: "ok",
    label: "When do I move?",
    title: `No sweep found in the next ${SWEEP_LOOKAHEAD_DAYS} days`,
    body: "No upcoming street-sweeping event was found in the bundled city data. Check posted signs for meters, colored curbs, and temporary tow-away notices.",
  };
}

function curbDescription(segment) {
  const parts = [
    readableSide(segment.side),
    segment.street && segment.street !== "This curb" ? segment.street : "",
    segment.limits && segment.limits !== "Unknown" ? `between ${segment.limits.replace(/\s+-\s+/g, " and ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "this curb";
}

function sweepStatus(segment) {
  const nextSweep = nextSweepingEvent(segment);
  if (!nextSweep) return "c-valid";
  if (nextSweep.active) return "conflict";
  const hoursUntil = (nextSweep.start - selectedDateTime()) / 36e5;
  if (hoursUntil <= 36) return "conflict";
  return "paid";
}

function nextSweepingEvent(segment) {
  const events = segment.upcomingSweeping || [];
  const base = selectedDateTime();
  return events
    .map((event) => {
      const start = new Date(event.date);
      start.setHours(Number.parseInt(event.startHour, 10) || 0, 0, 0, 0);
      const end = new Date(event.date);
      end.setHours(Number.parseInt(event.endHour, 10) || 0, 0, 0, 0);
      if (end <= start) end.setDate(end.getDate() + 1);
      return {
        ...event,
        start,
        end,
        active: base >= start && base < end,
      };
    })
    .filter((event) => event.active || event.start > base)
    .sort((a, b) => a.start - b.start)[0] || null;
}

function parkingDetailsHtml(segment) {
  const sweepingList = formatRestrictionList(segment.upcomingSweeping);
  return `
    <div class="popup-list">
      <div class="popup-row"><span>Block</span><div>${escapeHtml(segment.limits || "Unknown")}</div></div>
      <div class="popup-row"><span>Side</span><div>${escapeHtml(readableSide(segment.side))}</div></div>
      <div class="popup-row"><span>Next sweeps</span><div>${sweepingList}</div></div>
      <div class="popup-row"><span>Source</span><div>${escapeHtml(segment.source || "Unknown")}</div></div>
    </div>
  `;
}

function estimateSpotText(segment) {
  const feet = Number.parseFloat(segment.lengthFeet) || lineLengthFeet(segment.geometry);
  if (!feet || feet < 18) return "Spot estimate unavailable for this record.";
  const low = Math.max(1, Math.floor(feet / 24));
  const high = Math.max(low, Math.ceil(feet / 20));
  const range = low === high ? `${low}` : `${low}-${high}`;
  return `Estimated capacity: about ${range} standard spaces before driveways, curb colors, and temporary signs.`;
}

function readableSide(value) {
  const side = normalizeSide(value);
  if (side) return side[0].toUpperCase() + side.slice(1);
  if (String(value || "").toLowerCase() === "left") return "Left side";
  if (String(value || "").toLowerCase() === "right") return "Right side";
  return value || "Unknown";
}

function selectedDateTime() {
  return dateInput && dateInput.value ? new Date(`${dateInput.value}T${timeInput && timeInput.value ? timeInput.value : "00:00"}`) : new Date();
}

function lineLengthFeet(geometry) {
  const points = flattenCoordinates(geometry && geometry.coordinates);
  if (points.length < 2) return 0;
  let meters = 0;
  for (let index = 1; index < points.length; index += 1) {
    meters += distanceMeters(points[index - 1], points[index]);
  }
  return meters * 3.28084;
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

function formatRestrictionList(items) {
  if (!items || !items.length) return `No sweeping restriction found in the next ${SWEEP_LOOKAHEAD_DAYS} days`;
  return `<ul class="restriction-list">${items.map((item) => (
    `<li><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(item.text)}</li>`
  )).join("")}</ul>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function drawSamples() {
  if (state.layers.samples) state.layers.samples.remove();
  const group = L.layerGroup();
  SAMPLE_SEGMENTS.forEach((segment) => {
    const status = statusForSegment(segment);
    L.polyline(segment.coords, {
      color: colorForStatus(status),
      weight: 5,
      opacity: 0.58,
      lineCap: "round",
    }).bindPopup(popupHtml(segment)).addTo(group);
  });
  state.layers.samples = group.addTo(map);
}

function parkingSegmentFromFeature(feature) {
  const props = feature.properties || {};
  const street = valueFor(props, ["streetname", "street", "corridor"]);
  const from = valueFor(props, ["from_st", "fromstreet", "from_street", "limits"]);
  const to = valueFor(props, ["to_st", "tostreet", "to_street"]);
  const side = valueFor(props, ["side", "blockside", "block_side", "cnnrightleft"]);
  const limit = valueFor(props, ["hourlimit", "hrlimit", "time_limit", "timelimit"]);
  const days = valueFor(props, ["days", "weekdays", "day"]);
  const hours = [valueFor(props, ["begintime", "from_time", "fromhour"]), valueFor(props, ["endtime", "to_time", "tohour"])]
    .filter(Boolean)
    .join("-");
  const permitAreas = [valueFor(props, ["rpparea1"]), valueFor(props, ["rpparea2"]), valueFor(props, ["rpparea3"])]
    .filter(Boolean);
  const segment = {
    street: street || "This curb",
    limits: [from, to].filter(Boolean).join(" to ") || valueFor(props, ["limits"]) || "Unknown",
    side,
    permit: permitAreas.length ? `Area ${permitAreas.join(", ")}` : "No Area C permit rule found",
    sweeping: "Nearest sweeping match shown below when available",
    meter: limit ? `${limit} hour limit ${days} ${hours}`.trim() : "Unknown",
    confidence: "City parking regulation",
    source: "DataSF parking regulations",
    geometry: feature.geometry,
  };
  segment.upcomingSweeping = findNearbySweeping(segment);
  segment.street = street || nearestSweepingName(segment) || "This curb";
  return segment;
}

function sweepingSegmentFromFeature(feature) {
  const props = feature.properties || {};
  const street = valueFor(props, ["corridor", "street", "streetname"]) || "Street sweeping";
  const fullName = valueFor(props, ["fullname", "full_name"]);
  const day = valueFor(props, ["weekday", "week_day"]);
  const from = valueFor(props, ["fromhour", "from_hour"]);
  const to = valueFor(props, ["tohour", "to_hour"]);
  const side = valueFor(props, ["blockside", "block_side", "cnnrightleft"]);
  const weeks = activeWeeksText(props);
  const text = [
    fullName || weekdayFullName(day),
    from && to ? `${formatHour(from)}-${formatHour(to)}` : "",
    weeks ? `weeks ${weeks}` : "",
  ].filter(Boolean).join(", ");
  return {
    street,
    limits: valueFor(props, ["limits"]) || "Unknown",
    side,
    permit: "Check permit layer",
    sweeping: text || "Street sweeping schedule",
    meter: "Not shown",
    confidence: hasUpcomingSweeping(props) ? "Upcoming street sweeping" : "City sweeping schedule",
    source: "DataSF street sweeping",
    geometry: feature.geometry,
    upcomingSweeping: upcomingSweepingForProps(props),
  };
}

async function fetchGeoJson(dataset) {
  const response = await fetch(dataset.url);
  if (!response.ok) throw new Error(`${dataset.label} failed with ${response.status}`);
  return response.json();
}

async function fetchBundledSweepingData() {
  const response = await fetch("./data/bundled-sweeping-data.json");
  if (!response.ok) throw new Error(`Bundled sweeping data failed with ${response.status}`);
  return response.json();
}

function recordsToFeatureCollection(records, geometryField) {
  return {
    type: "FeatureCollection",
    features: (records || [])
      .filter((record) => record && record[geometryField])
      .map((record) => ({
        type: "Feature",
        properties: Object.fromEntries(Object.entries(record).filter(([key]) => key !== geometryField)),
        geometry: record[geometryField],
      })),
  };
}

function bundledLayer(bundle, name, geometryField) {
  return recordsToFeatureCollection(bundle[name] || [], geometryField);
}

function loadSweepingBundleIntoMap(bundle) {
  state.citySweeping = bundledLayer(bundle, "sweeping", "line").features;
  const counts = [
    `${drawGeoJsonLayer("sweeping", bundledLayer(bundle, "sweeping", "line"), sweepingSegmentFromFeature)} sweeping`,
  ];
  syncLayerOrder();
  state.loadedCityData = true;
  dataStatus.textContent = `Loaded fast street-sweeping data from ${bundle.generated_at}: ${counts.join(", ")} curb lines.`;
}

async function loadBundledData() {
  try {
    const bundle = await fetchBundledSweepingData();
    loadSweepingBundleIntoMap(bundle);
    redrawAll();
  } catch (error) {
    dataStatus.textContent = `Bundled data did not load: ${error.message}`;
    drawSamples();
  }
}

function drawGeoJsonLayer(name, geojson, mapper, filter) {
  if (state.layers[name]) state.layers[name].remove();
  const features = (geojson.features || [])
    .filter((feature) => !filter || filter(feature))
    .filter(boundsContainsFeature)
    .map((feature) => displayFeatureForLayer(name, feature));

  const layer = L.geoJSON({ type: "FeatureCollection", features }, {
    style: (feature) => {
      const segment = segmentForFeature(feature, mapper);
      const status = statusForSegment(segment);
      return {
        color: colorForStatus(status),
        weight: name === "sweeping" ? 3 : 4,
        opacity: name === "sweeping" ? 0.42 : 0.48,
        lineCap: "round",
      };
    },
    pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
      radius: 4,
      color: "#345a8a",
      fillColor: "#345a8a",
      fillOpacity: 0.72,
      weight: 1,
    }),
    onEachFeature: (feature, layer) => {
      const segment = segmentForFeature(feature, mapper);
      layer.bindPopup(popupHtml(segment));
      if (segment.street && segment.street !== "This curb") {
        layer.bindTooltip(segment.street, {
          sticky: true,
          opacity: 0.9,
        });
      }
    },
  });

  state.layers[name] = layer.addTo(map);
  return features.length;
}

function displayFeatureForLayer(name, feature) {
  if (name !== "sweeping" || !feature.geometry) return feature;
  return {
    ...feature,
    properties: { ...(feature.properties || {}) },
    geometry: offsetGeometryBySide(feature.geometry, valueFor(feature.properties || {}, ["blockside", "block_side", "cnnrightleft"])),
  };
}

function offsetGeometryBySide(geometry, sideValue) {
  const side = normalizeSide(sideValue);
  if (!side || !geometry.coordinates) return geometry;
  const offset = 0.000035;
  const delta = {
    east: [offset, 0],
    west: [-offset, 0],
    north: [0, offset],
    south: [0, -offset],
    right: [offset, 0],
    left: [-offset, 0],
  }[side];
  if (!delta) return geometry;
  return {
    ...geometry,
    coordinates: offsetCoordinates(geometry.coordinates, delta),
  };
}

function offsetCoordinates(coords, delta) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return [coords[0] + delta[0], coords[1] + delta[1]];
  }
  return coords.map((item) => offsetCoordinates(item, delta));
}

function segmentForFeature(feature, mapper) {
  if (!feature._parkingAppSegment) {
    feature._parkingAppSegment = mapper(feature);
  }
  return feature._parkingAppSegment;
}

async function loadCityData() {
  loadButton.disabled = true;
  dataStatus.textContent = "Refreshing live street-sweeping data...";
  try {
    const sweeping = await fetchGeoJson(DATASETS.sweeping);

    state.citySweeping = sweeping.features || [];
    const count = drawGeoJsonLayer("sweeping", sweeping, sweepingSegmentFromFeature);
    syncLayerOrder();

    state.loadedCityData = true;
    dataStatus.textContent = count
      ? `Loaded ${count} live street-sweeping curb lines in the current map area.`
      : "City data responded, but no nearby records matched the current filters.";
  } catch (error) {
    dataStatus.textContent = `City data did not load: ${error.message}`;
  } finally {
    loadButton.disabled = false;
    redrawAll();
  }
}

function meterSegmentFromFeature(feature) {
  const props = feature.properties || {};
  const segment = {
    street: valueFor(props, ["street_name", "street", "location"]) || "Parking meter",
    limits: valueFor(props, ["blockface", "block", "cnn"]) || "Meter record",
    side: valueFor(props, ["block_side", "side"]) || "Unknown",
    permit: "Meter space",
    sweeping: "Check nearby signs",
    meter: [valueFor(props, ["cap_color"]), valueFor(props, ["meter_type"])]
      .filter(Boolean)
      .join(", ") || "Meter",
    confidence: "Meter inventory",
    source: "DataSF parking meters",
    geometry: feature.geometry,
  };
  segment.upcomingSweeping = findNearbySweeping(segment);
  return segment;
}

function blueSegmentFromFeature(feature) {
  const props = feature.properties || {};
  const segment = {
    street: valueFor(props, ["street", "street_name", "location"]) || "Blue curb space",
    limits: [valueFor(props, ["from_st"]), valueFor(props, ["to_st"])].filter(Boolean).join(" to ") || valueFor(props, ["cnn"]) || "Accessible space",
    side: valueFor(props, ["side", "block_side"]) || "Unknown",
    permit: "Accessible placard required",
    sweeping: "Check nearby signs",
    meter: "Blue curb",
    confidence: "Official blue curb dataset",
    source: "DataSF blue curb spaces",
    geometry: feature.geometry,
  };
  segment.upcomingSweeping = findNearbySweeping(segment);
  return segment;
}

function checkDates() {
  const base = selectedDateTime();
  return Array.from({ length: SWEEP_LOOKAHEAD_DAYS }, (_, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + index);
    return {
      label: relativeDateLabel(date, index),
      date,
    };
  });
}

function upcomingSweepingForProps(props) {
  return checkDates()
    .filter(({ date }) => sweepingAppliesOnDate(props, date))
    .map(({ label, date }) => ({
      label,
      date: date.toISOString(),
      startHour: valueFor(props, ["fromhour", "from_hour"]),
      endHour: valueFor(props, ["tohour", "to_hour"]),
      text: sweepingText(props),
    }));
}

function hasUpcomingSweeping(props) {
  return upcomingSweepingForProps(props).length > 0;
}

function relativeDateLabel(date, offset) {
  if (offset === 0) return "today";
  if (offset === 1) return "tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function sweepingAppliesOnDate(props, date) {
  const weekday = normalizeWeekday(valueFor(props, ["weekday", "week_day", "fullname", "full_name"]));
  if (weekday === null || weekday !== date.getDay()) return false;
  const week = weekOfMonth(date);
  const weekField = valueFor(props, [`week${week}`, `week_${week}`]);
  if (String(weekField).trim() === "1" || /^true$/i.test(String(weekField))) return true;
  const anyWeekField = [1, 2, 3, 4, 5].some((n) => valueFor(props, [`week${n}`, `week_${n}`]));
  return !anyWeekField;
}

function sweepingText(props) {
  const fullName = valueFor(props, ["fullname", "full_name"]);
  const day = weekdayFullName(valueFor(props, ["weekday", "week_day"])) || fullName;
  const from = valueFor(props, ["fromhour", "from_hour"]);
  const to = valueFor(props, ["tohour", "to_hour"]);
  const side = valueFor(props, ["blockside", "block_side", "cnnrightleft"]);
  const limits = valueFor(props, ["limits"]);
  const weeks = activeWeeksText(props);
  return [
    day || fullName || "Scheduled",
    from && to ? `${formatHour(from)}-${formatHour(to)}` : "",
    weeks ? `weeks ${weeks}` : "",
    side ? `${side} side` : "",
    limits,
  ].filter(Boolean).join(", ");
}

function findNearbySweeping(segment) {
  if (!state.citySweeping.length) return [];
  const street = normalizeStreet(segment.street);
  const side = normalizeSide(segment.side);
  const center = geometryCenter(segment.geometry);
  const seen = new Set();
  const matches = state.citySweeping
    .map((feature) => {
      const props = feature.properties || {};
      const sweepStreet = normalizeStreet(valueFor(props, ["corridor", "street", "streetname"]));
      const sweepSide = normalizeSide(valueFor(props, ["blockside", "block_side", "cnnrightleft"]));
      const sweepCenter = geometryCenter(feature.geometry);
      const distance = center && sweepCenter ? squaredDistance(center, sweepCenter) : 0;
      const streetMatches = street && sweepStreet && street === sweepStreet;
      return { feature, props, sweepSide, distance, streetMatches };
    })
    .filter(({ sweepSide, distance, streetMatches }) => {
      if (side && sweepSide && side !== sweepSide) return false;
      if (streetMatches) return distance < 0.000012;
      return distance < 0.00000055;
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
    .map(({ feature }) => feature)
    .flatMap((feature) => upcomingSweepingForProps(feature.properties || {}));
  return matches.filter((event) => {
    const key = `${event.label}-${event.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function nearestSweepingName(segment) {
  const center = geometryCenter(segment.geometry);
  if (!center || !state.citySweeping.length) return "";
  const nearest = state.citySweeping
    .map((feature) => {
      const sweepCenter = geometryCenter(feature.geometry);
      return {
        feature,
        distance: sweepCenter ? squaredDistance(center, sweepCenter) : Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || nearest.distance > 0.00000075) return "";
  return valueFor(nearest.feature.properties || {}, ["corridor", "street", "streetname"]);
}

function geometryCenter(geometry) {
  const points = flattenCoordinates(geometry && geometry.coordinates);
  if (!points.length) return null;
  const total = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [total[0] / points.length, total[1] / points.length];
}

function flattenCoordinates(coords) {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === "number" && typeof coords[1] === "number") return [coords];
  return coords.flatMap(flattenCoordinates);
}

function squaredDistance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function normalizeStreet(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(value) {
  const side = String(value || "").toLowerCase();
  if (side.startsWith("n")) return "north";
  if (side.startsWith("s")) return "south";
  if (side.startsWith("e")) return "east";
  if (side.startsWith("w")) return "west";
  if (side === "l") return "left";
  if (side === "r") return "right";
  return "";
}

function normalizeWeekday(value) {
  const day = String(value || "").toLowerCase();
  if (day.startsWith("sun")) return 0;
  if (day.startsWith("mon")) return 1;
  if (day.startsWith("tue")) return 2;
  if (day.startsWith("wed")) return 3;
  if (day.startsWith("thu")) return 4;
  if (day.startsWith("fri")) return 5;
  if (day.startsWith("sat")) return 6;
  return null;
}

function weekdayFullName(value) {
  const index = typeof value === "number" ? value : normalizeWeekday(value);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][index] || "";
}

function weekOfMonth(date) {
  return Math.ceil(date.getDate() / 7);
}

function activeWeeksText(props) {
  const weeks = [1, 2, 3, 4, 5].filter((n) => {
    const value = valueFor(props, [`week${n}`, `week_${n}`]);
    return String(value).trim() === "1" || /^true$/i.test(String(value));
  });
  return weeks.length ? weeks.join(", ") : "";
}

function formatHour(value) {
  const number = Number.parseInt(String(value), 10);
  if (Number.isNaN(number)) return String(value);
  const hour = ((number + 11) % 12) + 1;
  return `${hour} ${number >= 12 ? "PM" : "AM"}`;
}

function redrawAll() {
  if (state.loadedCityData) {
    if (state.layers.samples) {
      state.layers.samples.remove();
      state.layers.samples = null;
    }
  } else {
    drawSamples();
  }
  for (const key of ["parking", "sweeping", "meters", "blue"]) {
    if (state.layers[key]) {
      state.layers[key].eachLayer((layer) => {
        if (layer.setStyle) {
          const feature = layer.feature;
          const mapper = key === "parking"
            ? parkingSegmentFromFeature
            : key === "sweeping"
              ? sweepingSegmentFromFeature
              : key === "meters"
                ? meterSegmentFromFeature
                : blueSegmentFromFeature;
          const segment = mapper(feature);
          layer.setStyle({ color: colorForStatus(statusForSegment(segment)) });
          layer.setPopupContent(popupHtml(segment));
        }
      });
    }
  }
  syncLayerOrder();
}

function syncLayerOrder() {
  if (state.mode === "now" || state.mode === "sweeping") {
    if (state.layers.sweeping) state.layers.sweeping.bringToFront();
    return;
  }
  if (state.layers.sweeping) state.layers.sweeping.bringToBack();
}

[dateInput, timeInput].filter(Boolean).forEach((input) => {
  input.addEventListener("change", redrawAll);
});

loadButton.addEventListener("click", loadCityData);

initDateTime();
loadBundledData();
map.fitBounds(AREA_BOUNDS);
