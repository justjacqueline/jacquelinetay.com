const latencyValue = document.getElementById('latencyValue');
const jitterValue = document.getElementById('jitterValue');
const downloadValue = document.getElementById('downloadValue');
const uploadValue = document.getElementById('uploadValue');
const scoreValue = document.getElementById('scoreValue');
const scoreSummary = document.getElementById('scoreSummary');
const scoreBand = document.getElementById('scoreBand');
const verdictBand = document.getElementById('verdictBand');
const verdictTitle = document.getElementById('verdictTitle');
const verdictSummary = document.getElementById('verdictSummary');
const actionList = document.getElementById('actionList');
const sampleCount = document.getElementById('sampleCount');
const statusText = document.getElementById('statusText');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');
const runTestBtn = document.getElementById('runTestBtn');
const stopTestBtn = document.getElementById('stopTestBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const locationInput = document.getElementById('locationInput');
const notesInput = document.getElementById('notesInput');
const historyBody = document.getElementById('historyBody');
const chart = document.getElementById('latencyChart');
const ctx = chart.getContext('2d');
const metricRatings = {
  latency: document.getElementById('latencyRating'),
  jitter: document.getElementById('jitterRating'),
  download: document.getElementById('downloadRating'),
  upload: document.getElementById('uploadRating'),
};

const HISTORY_KEY = 'wifi-tester-history-v1';
const SPEED_BASE = 'https://speed.cloudflare.com';
const LATENCY_SAMPLES = 18;
const DOWNLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_BYTES = 3 * 1024 * 1024;

let abortController = null;

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : '--';
}

function formatMbps(value) {
  return Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)} Mbps` : '--';
}

function setProgress(percent, label) {
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  progressBar.style.width = `${rounded}%`;
  progressText.textContent = `${rounded}%`;
  statusText.textContent = label;
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 25)));
}

function percentile(values, target) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1));
  return sorted[index];
}

function average(values) {
  if (!values.length) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateJitter(samples) {
  if (samples.length < 2) return NaN;
  const deltas = [];
  for (let index = 1; index < samples.length; index += 1) {
    deltas.push(Math.abs(samples[index] - samples[index - 1]));
  }
  return average(deltas);
}

function rateMetric(value, good, ok) {
  if (!Number.isFinite(value)) return 0;
  if (value <= good) return 100;
  if (value <= ok) return 72;
  return Math.max(18, 72 - ((value - ok) / ok) * 50);
}

function speedMetric(value, good, ok) {
  if (!Number.isFinite(value)) return 0;
  if (value >= good) return 100;
  if (value >= ok) return 72;
  return Math.max(12, (value / ok) * 72);
}

function scoreResult(result) {
  const latencyScore = rateMetric(result.latency, 45, 95);
  const jitterScore = rateMetric(result.jitter, 15, 35);
  const downScore = speedMetric(result.download, 50, 15);
  const upScore = speedMetric(result.upload, 12, 4);
  const failurePenalty = Math.max(0, 100 - result.failures * 12);
  return Math.round(((latencyScore * 0.3) + (jitterScore * 0.25) + (downScore * 0.25) + (upScore * 0.2)) * (failurePenalty / 100));
}

function gradeLatency(value) {
  if (!Number.isFinite(value)) return { label: 'Not measured', level: 'bad' };
  if (value <= 100) return { label: 'Good for calls', level: 'good' };
  if (value <= 180) return { label: 'May lag', level: 'ok' };
  return { label: 'Too slow', level: 'bad' };
}

function gradeJitter(value) {
  if (!Number.isFinite(value)) return { label: 'Not measured', level: 'bad' };
  if (value <= 20) return { label: 'Stable', level: 'good' };
  if (value <= 50) return { label: 'A little jumpy', level: 'ok' };
  return { label: 'Move spots', level: 'bad' };
}

function gradeDownload(value) {
  if (!Number.isFinite(value)) return { label: 'Not measured', level: 'bad' };
  if (value >= 15) return { label: 'Enough', level: 'good' };
  if (value >= 5) return { label: 'Limited', level: 'ok' };
  return { label: 'Too slow', level: 'bad' };
}

function gradeUpload(value) {
  if (!Number.isFinite(value)) return { label: 'Not measured', level: 'bad' };
  if (value >= 8) return { label: 'Good for video', level: 'good' };
  if (value >= 4) return { label: 'Probably okay', level: 'ok' };
  return { label: 'Video may fail', level: 'bad' };
}

function getMetricGrades(result) {
  return {
    latency: gradeLatency(result.latency),
    jitter: gradeJitter(result.jitter),
    download: gradeDownload(result.download),
    upload: gradeUpload(result.upload),
  };
}

function getVerdict(result) {
  const problems = [];
  if (result.failures > 0) problems.push('some requests failed');
  if (result.jitter > 50) problems.push('the connection is jumpy');
  if (result.upload < 4) problems.push('upload is weak');
  if (result.latency > 180) problems.push('latency is high');
  if (result.download < 5) problems.push('download is weak');

  if (!problems.length && result.score >= 82) {
    return {
      level: 'good',
      title: 'Stay here for Zoom',
      summary: 'This spot looks stable enough for video calls and normal office work.',
      actions: [
        'Use this room or desk for important calls.',
        'Run one more test if the office is much busier later.',
      ],
    };
  }

  if (result.jitter > 50 || result.upload < 4 || result.failures > 1 || result.score < 62) {
    return {
      level: 'bad',
      title: 'Move before a Zoom call',
      summary: `This spot is risky because ${problems.slice(0, 2).join(' and ')}.`,
      actions: [
        'Move closer to the router or access point.',
        'Try another room and run the test again.',
        'If every room looks bad, use a hotspot or ask whoever manages the router.',
      ],
    };
  }

  return {
    level: 'ok',
    title: 'Probably okay, but test another spot',
    summary: 'This should handle a basic call, but it may be uneven for screen sharing or busy meetings.',
    actions: [
      'Try one nearby room or desk and compare the score.',
      'Prefer the spot with lower jitter and higher upload.',
    ],
  };
}

function summarizeScore(score, result) {
  if (score >= 82) return 'Good for video calls, shared docs, and normal office work from this spot.';
  if (score >= 62) return 'Usable, but jitter or speed may show up during calls or large uploads.';
  const weakPoint = result.jitter > 35 ? 'unstable latency' : result.download < 15 ? 'slow download speed' : result.upload < 4 ? 'slow upload speed' : 'high latency';
  return `Likely to feel bad for office work because of ${weakPoint}.`;
}

function drawChart(samples) {
  const width = chart.width;
  const height = chart.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8faf7';
  ctx.fillRect(0, 0, width, height);

  const padding = 28;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;
  const maxValue = Math.max(120, percentile(samples, 95) || 120);
  const guideValues = [30, 60, 100];

  ctx.strokeStyle = 'rgba(23, 32, 42, 0.12)';
  ctx.lineWidth = 1;
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64706b';
  guideValues.forEach(value => {
    const y = padding + graphHeight - Math.min(value / maxValue, 1) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    ctx.fillText(`${value} ms`, 8, y + 4);
  });

  if (!samples.length) {
    ctx.fillStyle = '#64706b';
    ctx.fillText('Latency samples will appear here during a test.', padding, height / 2);
    return;
  }

  ctx.strokeStyle = '#1d5f8f';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const x = padding + (samples.length === 1 ? 0 : (index / (samples.length - 1)) * graphWidth);
    const y = padding + graphHeight - Math.min(sample / maxValue, 1) * graphHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#1d5f8f';
  samples.forEach((sample, index) => {
    const x = padding + (samples.length === 1 ? 0 : (index / (samples.length - 1)) * graphWidth);
    const y = padding + graphHeight - Math.min(sample / maxValue, 1) * graphHeight;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

async function timedFetch(url, options = {}) {
  const start = performance.now();
  const response = await fetch(url, {
    cache: 'no-store',
    signal: abortController.signal,
    ...options,
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  await response.arrayBuffer();
  return performance.now() - start;
}

async function runLatencyTest(samples) {
  let failures = 0;
  for (let index = 0; index < LATENCY_SAMPLES; index += 1) {
    try {
      const elapsed = await timedFetch(`${SPEED_BASE}/__down?bytes=64&r=${crypto.randomUUID()}`);
      samples.push(elapsed);
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      failures += 1;
      try {
        const fallback = await timedFetch(`./app.js?r=${Date.now()}-${index}`);
        samples.push(fallback);
      } catch {
        failures += 1;
      }
    }
    sampleCount.textContent = `${samples.length} samples`;
    latencyValue.textContent = formatMs(percentile(samples, 50));
    jitterValue.textContent = formatMs(calculateJitter(samples));
    drawChart(samples);
    setProgress(5 + ((index + 1) / LATENCY_SAMPLES) * 45, 'Measuring latency');
  }
  return failures;
}

async function runDownloadTest() {
  const elapsed = await timedFetch(`${SPEED_BASE}/__down?bytes=${DOWNLOAD_BYTES}&r=${crypto.randomUUID()}`);
  return (DOWNLOAD_BYTES * 8) / (elapsed / 1000) / 1000000;
}

async function runUploadTest() {
  const payload = new Uint8Array(UPLOAD_BYTES);
  for (let offset = 0; offset < payload.length; offset += 65536) {
    crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65536, payload.length)));
  }
  const start = performance.now();
  const response = await fetch(`${SPEED_BASE}/__up?r=${crypto.randomUUID()}`, {
    method: 'POST',
    body: payload,
    cache: 'no-store',
    signal: abortController.signal,
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  const elapsed = performance.now() - start;
  return (UPLOAD_BYTES * 8) / (elapsed / 1000) / 1000000;
}

function renderResult(result) {
  const grades = getMetricGrades(result);
  const verdict = getVerdict(result);

  latencyValue.textContent = formatMs(result.latency);
  jitterValue.textContent = formatMs(result.jitter);
  downloadValue.textContent = formatMbps(result.download);
  uploadValue.textContent = formatMbps(result.upload);
  scoreValue.textContent = `${result.score}`;
  scoreSummary.textContent = summarizeScore(result.score, result);
  scoreBand.classList.remove('good', 'ok', 'bad');
  scoreBand.classList.add(result.score >= 82 ? 'good' : result.score >= 62 ? 'ok' : 'bad');
  verdictBand.classList.remove('good', 'ok', 'bad');
  verdictBand.classList.add(verdict.level);
  verdictTitle.textContent = verdict.title;
  verdictSummary.textContent = verdict.summary;
  actionList.innerHTML = verdict.actions.map(action => `<li>${escapeHtml(action)}</li>`).join('');

  Object.entries(grades).forEach(([key, grade]) => {
    metricRatings[key].textContent = grade.label;
    metricRatings[key].className = grade.level;
  });
}

function renderHistory() {
  const history = getHistory();
  if (!history.length) {
    historyBody.innerHTML = '<tr><td colspan="8">No saved tests yet.</td></tr>';
    return;
  }

  historyBody.innerHTML = history.map(entry => {
    const verdict = getVerdict(entry);
    const time = new Date(entry.createdAt).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return `<tr>
      <td>${time}</td>
      <td>${escapeHtml(entry.location || 'Unlabeled')}</td>
      <td><span class="history-pill ${verdict.level}">${escapeHtml(verdict.title)}</span></td>
      <td>${entry.score}</td>
      <td>${formatMs(entry.latency)}</td>
      <td>${formatMs(entry.jitter)}</td>
      <td>${formatMbps(entry.download)}</td>
      <td>${formatMbps(entry.upload)}</td>
    </tr>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

async function runTest() {
  abortController = new AbortController();
  runTestBtn.disabled = true;
  stopTestBtn.disabled = false;
  downloadValue.textContent = '--';
  uploadValue.textContent = '--';
  setProgress(2, 'Starting test');

  const samples = [];
  let failures = 0;
  try {
    failures += await runLatencyTest(samples);

    setProgress(58, 'Measuring download');
    let download = NaN;
    try {
      download = await runDownloadTest();
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      failures += 1;
    }
    downloadValue.textContent = formatMbps(download);

    setProgress(78, 'Measuring upload');
    let upload = NaN;
    try {
      upload = await runUploadTest();
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      failures += 1;
    }
    uploadValue.textContent = formatMbps(upload);

    const result = {
      createdAt: new Date().toISOString(),
      location: locationInput.value.trim(),
      notes: notesInput.value.trim(),
      latency: percentile(samples, 50),
      jitter: calculateJitter(samples),
      download,
      upload,
      failures,
      samples,
    };
    result.score = scoreResult(result);
    renderResult(result);

    const history = getHistory();
    history.unshift(result);
    saveHistory(history);
    renderHistory();
    setProgress(100, failures ? `Complete with ${failures} failed request${failures === 1 ? '' : 's'}` : 'Complete');
  } catch (error) {
    setProgress(0, abortController.signal.aborted ? 'Stopped' : 'Test failed');
  } finally {
    runTestBtn.disabled = false;
    stopTestBtn.disabled = true;
    abortController = null;
  }
}

runTestBtn.addEventListener('click', runTest);
stopTestBtn.addEventListener('click', () => {
  if (abortController) abortController.abort();
});
clearHistoryBtn.addEventListener('click', () => {
  saveHistory([]);
  renderHistory();
});

drawChart([]);
renderHistory();
