const QUESTIONS = {
  comfort: {
    title: "Is this comfortable, uncomfortable, mixed, or unclear?",
    hint: "Choose one or more. Mixed and unclear are real options, not failures to decide.",
    options: [
      { id: "comfortable", label: "Comfortable", desc: "Good, welcome, safe, warm, open, alive, or easeful." },
      { id: "uncomfortable", label: "Uncomfortable", desc: "Painful, tense, bad, threatened, heavy, or unwanted." },
      { id: "mixed", label: "Mixed", desc: "More than one side is present at the same time." },
      { id: "unclear", label: "Unclear", desc: "The signal is not readable enough yet." }
    ]
  },
  family: {
    title: "Which broad family is closest?",
    hint: "Choose every family that seems relevant to this part.",
    comfortableOptions: [
      { id: "connection_comfort", label: "Connection", desc: "Loving, cared for, grateful, accepted." },
      { id: "safety_trust", label: "Safety / self-trust", desc: "Confident, respected, hopeful, brave." },
      { id: "interest", label: "Interest / engagement", desc: "Curious, intrigued, creative, attentive." },
      { id: "positive_activation", label: "Positive activation", desc: "Excited, energized, inspired, eager." },
      { id: "ease", label: "Ease / contentment", desc: "Peaceful, warm, content, fulfilled." }
    ],
    uncomfortableOptions: [
      { id: "fear_threat", label: "Fear / threat", desc: "Afraid, worried, stressed, helpless." },
      { id: "loss_hurt", label: "Loss / hurt", desc: "Sad, disappointed, wounded, discouraged." },
      { id: "disconnection", label: "Disconnection", desc: "Alone, rejected, excluded, distant." },
      { id: "aversion", label: "Aversion", desc: "Dislike, suspicious, disgusted, skeptical." },
      { id: "anger_friction", label: "Anger / friction", desc: "Angry, resentful, frustrated, offended." },
      { id: "self_consciousness", label: "Self-consciousness", desc: "Embarrassed, ashamed, guilty, inferior." }
    ]
  }
};

const TEXTURE_OPTIONS = [
  { id: "activated", label: "Activated", desc: "Charged, alert, fast, urgent, eager, or hard to settle." },
  { id: "depleted", label: "Heavy / depleted", desc: "Low, collapsed, tired, slow, helpless, or drained." },
  { id: "settled", label: "Fairly settled", desc: "Steady, warm, quiet, clear, grounded, or spacious." },
  { id: "unclear_energy", label: "Unclear", desc: "The energy is hard to read right now." }
];

const QUESTION_ORDER = ["comfort", "family"];

const FAMILY_COLORS = {
  fear_threat: { color: "#5f7384", soft: "#dbe4e7", border: "#9eb0bb" },
  loss_hurt: { color: "#8a7296", soft: "#e7dfe9", border: "#b9a7c1" },
  disconnection: { color: "#668178", soft: "#dfe8e3", border: "#a5b9b1" },
  aversion: { color: "#7b8456", soft: "#e7ead8", border: "#b2ba8d" },
  anger_friction: { color: "#a35b4f", soft: "#f0ddd8", border: "#c99084" },
  self_consciousness: { color: "#a56d78", soft: "#f0dee2", border: "#c99aa3" },
  connection_comfort: { color: "#b76f5e", soft: "#f2e1dc", border: "#d09b8e" },
  safety_trust: { color: "#52735c", soft: "#dfe8de", border: "#94ad99" },
  interest: { color: "#4f8180", soft: "#dceaea", border: "#94b9b8" },
  positive_activation: { color: "#b08a38", soft: "#f0e5c7", border: "#d0b56d" },
  ease: { color: "#738562", soft: "#e4ead9", border: "#aab995" }
};

const FAMILY_RESULTS = {
  fear_threat: {
    activated: ["alarmed", "anxious", "nervous", "panicky", "vigilant"],
    depleted: ["helpless", "powerless", "inadequate", "small", "defeated"],
    settled: ["cautious", "concerned", "watchful", "careful"],
    base: ["afraid", "worried", "stressed", "unsafe"]
  },
  loss_hurt: {
    activated: ["hurt", "aching", "raw", "shaken"],
    depleted: ["sad", "disappointed", "discouraged", "grieving", "lonely"],
    settled: ["tender", "wistful", "sorrowful", "softened"],
    base: ["sad", "wounded", "let down", "tender"]
  },
  disconnection: {
    activated: ["rejected", "excluded", "left out", "homesick for contact"],
    depleted: ["alone", "distant", "isolated", "unseen"],
    settled: ["independent", "private", "separate", "quietly distant"],
    base: ["alone", "rejected", "excluded", "distant"]
  },
  aversion: {
    activated: ["repelled", "suspicious", "disgusted", "wary"],
    depleted: ["checked out", "resistant", "tired of it", "turned off"],
    settled: ["skeptical", "discerning", "unconvinced", "reserved"],
    base: ["dislike", "suspicion", "aversion", "doubt"]
  },
  anger_friction: {
    activated: ["angry", "frustrated", "offended", "indignant", "resentful"],
    depleted: ["bitter", "fed up", "defeated", "worn down"],
    settled: ["firm", "clear", "protective", "boundary-aware"],
    base: ["anger", "resentment", "frustration", "friction"]
  },
  self_consciousness: {
    activated: ["embarrassed", "exposed", "ashamed", "self-critical"],
    depleted: ["inferior", "guilty", "worthless", "inadequate"],
    settled: ["accountable", "reflective", "humbled", "repair-oriented"],
    base: ["embarrassed", "ashamed", "guilty", "inferior"]
  },
  connection_comfort: {
    activated: ["loving", "grateful", "moved", "appreciative"],
    depleted: ["tender", "needing closeness", "soft", "emotionally full"],
    settled: ["cared for", "accepted", "connected", "close"],
    base: ["loving", "cared for", "grateful", "accepted"]
  },
  safety_trust: {
    activated: ["brave", "determined", "encouraged", "optimistic"],
    depleted: ["relieved", "supported", "reassured", "able to rest"],
    settled: ["confident", "respected", "hopeful", "self-trusting"],
    base: ["confident", "respected", "hopeful", "brave"]
  },
  interest: {
    activated: ["fascinated", "inspired", "eager", "absorbed"],
    depleted: ["quietly curious", "drawn in", "reflective", "thoughtful"],
    settled: ["attentive", "creative", "intrigued", "engaged"],
    base: ["curious", "intrigued", "creative", "attentive"]
  },
  positive_activation: {
    activated: ["excited", "energized", "inspired", "eager"],
    depleted: ["pleasantly tired", "satisfied", "spent in a good way"],
    settled: ["ready", "motivated", "alive", "upbeat"],
    base: ["excited", "energized", "inspired", "eager"]
  },
  ease: {
    activated: ["joyful", "bright", "playful", "delighted"],
    depleted: ["restful", "sleepy", "unburdened", "relieved"],
    settled: ["content", "peaceful", "warm", "fulfilled"],
    base: ["peaceful", "warm", "content", "fulfilled"]
  }
};

const FAMILY_NEEDS = {
  fear_threat: "safety, information, grounding, reassurance, or a smaller next step",
  loss_hurt: "comfort, mourning, gentleness, care, or permission to be affected",
  disconnection: "contact, belonging, being seen, privacy, or honest repair",
  aversion: "distance, discernment, cleanliness, clarity, or permission to say no",
  anger_friction: "agency, fairness, repair, protection, or a boundary",
  self_consciousness: "kindness, perspective, accountability without attack, or repair",
  connection_comfort: "receiving, closeness, gratitude, savoring, or expression",
  safety_trust: "rest, trust, courage, respect, or a stable next step",
  interest: "attention, exploration, creativity, learning, or time to follow the thread",
  positive_activation: "movement, expression, play, creation, or direction",
  ease: "rest, savoring, warmth, enoughness, or staying with what is good"
};

const WORD_NEEDS = {
  alarmed: ["immediate safety cues", "slowing down", "reducing input"],
  anxious: ["reassurance", "grounding", "information", "a smaller next step"],
  nervous: ["encouragement", "preparation", "a gentler pace"],
  panicky: ["immediate safety", "breathing room", "less stimulation"],
  vigilant: ["clarity", "evidence checking", "a boundary"],
  helpless: ["support", "one doable action", "agency"],
  powerless: ["backup", "choice", "protection"],
  inadequate: ["kindness", "realistic expectations", "help"],
  defeated: ["rest", "encouragement", "a smaller scope"],
  hurt: ["care", "acknowledgment", "repair"],
  aching: ["comfort", "gentleness", "time"],
  raw: ["protection", "softness", "less exposure"],
  shaken: ["stabilizing", "reassurance", "quiet"],
  sad: ["comfort", "permission to grieve", "company"],
  disappointed: ["mourning", "recalibration", "honesty"],
  discouraged: ["encouragement", "rest", "a believable next step"],
  grieving: ["mourning", "ritual", "patient care"],
  lonely: ["contact", "belonging", "being remembered"],
  rejected: ["reassurance", "belonging", "repair"],
  excluded: ["inclusion", "clarity", "being considered"],
  alone: ["contact", "presence", "support"],
  distant: ["space", "reconnection", "privacy"],
  isolated: ["company", "community", "low-pressure contact"],
  unseen: ["attention", "recognition", "being understood"],
  repelled: ["distance", "protection", "permission to refuse"],
  suspicious: ["clarity", "evidence", "trust-building"],
  disgusted: ["distance", "cleanliness", "a firm no"],
  wary: ["time", "discernment", "proof of safety"],
  skeptical: ["better evidence", "honesty", "room for doubt"],
  angry: ["boundary", "repair", "agency"],
  frustrated: ["movement", "clarity", "removing a blocker"],
  offended: ["respect", "repair", "acknowledgment"],
  indignant: ["fairness", "accountability", "protection"],
  resentful: ["fairness", "restored choice", "spoken limits"],
  bitter: ["mourning", "repair", "letting the cost be named"],
  embarrassed: ["privacy", "reassurance", "normalizing"],
  exposed: ["protection", "cover", "gentleness"],
  ashamed: ["compassion", "belonging", "repair without attack"],
  guilty: ["accountability", "repair", "forgiveness"],
  inferior: ["respect", "perspective", "encouragement"],
  loving: ["expression", "closeness", "receiving"],
  grateful: ["savoring", "thanks", "receiving"],
  moved: ["expression", "slowness", "meaning"],
  appreciative: ["recognition", "sharing", "savoring"],
  tender: ["gentleness", "care", "protection"],
  accepted: ["receiving", "belonging", "rest"],
  connected: ["closeness", "continuity", "expression"],
  close: ["presence", "trust", "shared time"],
  brave: ["support", "direction", "a meaningful next step"],
  determined: ["focus", "commitment", "resources"],
  encouraged: ["momentum", "support", "a next step"],
  optimistic: ["planning", "hope", "grounded action"],
  relieved: ["rest", "letting down", "integration"],
  supported: ["receiving help", "trust", "shared load"],
  reassured: ["stability", "settling", "confirmation"],
  confident: ["agency", "expression", "using the clarity"],
  fascinated: ["exploration", "time", "attention"],
  inspired: ["creation", "movement", "expression"],
  eager: ["direction", "opportunity", "beginning"],
  absorbed: ["focus", "protected time", "immersion"],
  curious: ["exploration", "permission to follow the question"],
  attentive: ["focus", "presence", "careful observation"],
  creative: ["expression", "materials", "room to try"],
  intrigued: ["learning", "experimentation", "more information"],
  excited: ["movement", "sharing", "channeling energy"],
  energized: ["action", "expression", "momentum"],
  ready: ["a clear next step", "commitment", "support"],
  motivated: ["direction", "structure", "follow-through"],
  alive: ["expression", "movement", "meaning"],
  joyful: ["play", "sharing", "savoring"],
  bright: ["expression", "connection", "enjoyment"],
  playful: ["freedom", "play", "lightness"],
  delighted: ["savoring", "sharing", "receiving"],
  restful: ["rest", "quiet", "permission to stop"],
  sleepy: ["sleep", "lower demands", "care for the body"],
  content: ["savoring", "enoughness", "staying present"],
  peaceful: ["quiet", "protection of ease", "rest"],
  warm: ["connection", "softness", "receiving"],
  fulfilled: ["savoring", "meaning", "integration"]
};

let nextTrackId = 1;
let activeTrackId = null;
let tracks = [];
let viewMode = "workspace";

function makeTrack() {
  const id = `track-${nextTrackId}`;
  const track = {
    id,
    name: `Part ${nextTrackId}`,
    step: 0,
    answers: {},
    familyTextures: {},
    selectedWords: {},
    draft: []
  };
  nextTrackId += 1;
  return track;
}

function init() {
  document.getElementById("addTrackBtn").addEventListener("click", addTrack);
  document.getElementById("partsViewBtn").addEventListener("click", () => setViewMode("workspace"));
  document.getElementById("summaryBtn").addEventListener("click", () => setViewMode("summary"));
  document.getElementById("resetAllBtn").addEventListener("click", resetAll);
  addTrack();
}

function addTrack() {
  const track = makeTrack();
  tracks.push(track);
  activeTrackId = track.id;
  viewMode = "workspace";
  render();
}

function setViewMode(mode) {
  viewMode = mode === "summary" ? "summary" : "workspace";
  render();
}

function resetAll() {
  if (!confirm("Reset all parts?")) return;
  tracks = [];
  nextTrackId = 1;
  activeTrackId = null;
  addTrack();
}

function activeTrack() {
  return tracks.find((track) => track.id === activeTrackId) || tracks[0];
}

function selectTrack(id) {
  activeTrackId = id;
  viewMode = "workspace";
  render();
}

function updateTrackName(id, value) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  track.name = value.trim() || "Part";
  renderTrackList();
}

function resetTrack(id) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  track.step = 0;
  track.answers = {};
  track.familyTextures = {};
  track.selectedWords = {};
  track.draft = [];
  render();
}

function removeTrack(id) {
  if (tracks.length === 1) {
    resetTrack(id);
    return;
  }
  tracks = tracks.filter((track) => track.id !== id);
  if (activeTrackId === id) activeTrackId = tracks[0].id;
  render();
}

function duplicateTrack(id) {
  const source = tracks.find((track) => track.id === id);
  if (!source) return;
  const copy = makeTrack();
  copy.name = `${source.name} copy`;
  copy.step = source.step;
  copy.answers = JSON.parse(JSON.stringify(source.answers));
  copy.familyTextures = JSON.parse(JSON.stringify(source.familyTextures || {}));
  copy.selectedWords = JSON.parse(JSON.stringify(source.selectedWords || {}));
  copy.draft = [...source.draft];
  tracks.push(copy);
  activeTrackId = copy.id;
  render();
}

function currentQuestion(track) {
  const questionId = QUESTION_ORDER[track.step];
  if (!questionId) return null;
  if (questionId !== "family") return { id: questionId, ...QUESTIONS[questionId] };
  return {
    id: "family",
    title: QUESTIONS.family.title,
    hint: QUESTIONS.family.hint,
    options: familyOptionsForTrack(track)
  };
}

function familyOptionsForTrack(track) {
  const comfort = new Set(track.answers.comfort || []);
  const includeComfortable = comfort.has("comfortable") || comfort.has("mixed") || comfort.has("unclear") || comfort.size === 0;
  const includeUncomfortable = comfort.has("uncomfortable") || comfort.has("mixed") || comfort.has("unclear") || comfort.size === 0;
  const options = [];
  if (includeUncomfortable) options.push(...QUESTIONS.family.uncomfortableOptions);
  if (includeComfortable) options.push(...QUESTIONS.family.comfortableOptions);
  return options;
}

function validOptionIds(track, questionId) {
  if (questionId === "family") return new Set(familyOptionsForTrack(track).map((option) => option.id));
  return new Set(QUESTIONS[questionId].options.map((option) => option.id));
}

function selectedAnswerIds(track, questionId) {
  const valid = validOptionIds(track, questionId);
  return (track.answers[questionId] || []).filter((id) => valid.has(id));
}

function syncFamilyTextures(track) {
  const selectedFamilies = new Set(selectedAnswerIds(track, "family"));
  track.familyTextures = track.familyTextures || {};
  track.selectedWords = track.selectedWords || {};
  Object.keys(track.familyTextures).forEach((familyId) => {
    if (!selectedFamilies.has(familyId)) delete track.familyTextures[familyId];
  });
  Object.keys(track.selectedWords).forEach((familyId) => {
    if (!selectedFamilies.has(familyId)) delete track.selectedWords[familyId];
  });
  selectedFamilies.forEach((familyId) => {
    if (!Array.isArray(track.familyTextures[familyId])) {
      track.familyTextures[familyId] = [];
    }
    if (!Array.isArray(track.selectedWords[familyId])) {
      track.selectedWords[familyId] = [];
    }
  });
}

function syncSelectedWords(track, familyId) {
  track.selectedWords = track.selectedWords || {};
  const visibleWords = new Set(possibleFeelingsForFamily(track, familyId));
  track.selectedWords[familyId] = (track.selectedWords[familyId] || []).filter((word) => visibleWords.has(word));
}

function toggleFamilyTexture(trackId, familyId, textureId) {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) return;
  syncFamilyTextures(track);
  const current = new Set(track.familyTextures[familyId] || []);
  if (current.has(textureId)) {
    current.delete(textureId);
  } else {
    current.add(textureId);
  }
  track.familyTextures[familyId] = [...current];
  syncSelectedWords(track, familyId);
  render();
}

function toggleEmotionWord(trackId, familyId, word) {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) return;
  syncFamilyTextures(track);
  syncSelectedWords(track, familyId);
  const current = new Set(track.selectedWords[familyId] || []);
  if (current.has(word)) {
    current.delete(word);
  } else {
    current.add(word);
  }
  track.selectedWords[familyId] = [...current];
  render();
}

function toggleOption(optionId) {
  const track = activeTrack();
  const question = currentQuestion(track);
  if (!question) return;
  const current = new Set(track.draft);
  if (current.has(optionId)) {
    current.delete(optionId);
  } else {
    current.add(optionId);
  }
  track.draft = [...current];
  renderActiveTrack();
}

function continueTrack() {
  const track = activeTrack();
  const question = currentQuestion(track);
  if (!question || track.draft.length === 0) return;
  track.answers[question.id] = [...track.draft];
  clearFutureAnswers(track, track.step);
  track.step += 1;
  const nextQuestion = currentQuestion(track);
  track.draft = nextQuestion ? selectedAnswerIds(track, nextQuestion.id) : [];
  syncFamilyTextures(track);
  render();
}

function clearFutureAnswers(track, stepIndex) {
  QUESTION_ORDER.slice(stepIndex + 1).forEach((questionId) => {
    delete track.answers[questionId];
  });
}

function goBack() {
  const track = activeTrack();
  if (track.step === 0) return;
  track.step -= 1;
  const question = currentQuestion(track);
  track.draft = question ? selectedAnswerIds(track, question.id) : [];
  render();
}

function editStep(stepIndex) {
  const track = activeTrack();
  track.step = stepIndex;
  const question = currentQuestion(track);
  track.draft = question ? selectedAnswerIds(track, question.id) : [];
  render();
}

function optionLabel(questionId, optionId, track) {
  const options = questionId === "family" ? familyOptionsForTrack(track) : QUESTIONS[questionId].options;
  const option = options.find((item) => item.id === optionId);
  return option ? option.label : optionId;
}

function answerLabels(track) {
  return QUESTION_ORDER.flatMap((questionId) => {
    return selectedAnswerIds(track, questionId).map((optionId) => optionLabel(questionId, optionId, track));
  });
}

function possibleFeelingsForFamily(track, familyId) {
  const family = FAMILY_RESULTS[familyId];
  if (!family) return [];
  const textures = (track.familyTextures?.[familyId] || []).filter((textureId) => textureId !== "unclear_energy");
  const feelings = [];
  if (textures.length === 0) {
    feelings.push(...family.base);
  } else {
    textures.forEach((textureId) => feelings.push(...(family[textureId] || family.base)));
  }
  return [...new Set(feelings)].slice(0, 10);
}

function possibleFeelings(track) {
  const families = selectedAnswerIds(track, "family");
  const feelings = families.flatMap((familyId) => possibleFeelingsForFamily(track, familyId));
  if (feelings.length === 0) {
    const comfort = selectedAnswerIds(track, "comfort");
    if (comfort.includes("mixed")) return ["mixed", "conflicted", "layered"];
    if (comfort.includes("unclear")) return ["unclear", "hard to read"];
  }
  return [...new Set(feelings)].slice(0, 12);
}

function possibleNeeds(track) {
  const families = selectedAnswerIds(track, "family");
  const needs = families.map((id) => FAMILY_NEEDS[id]).filter(Boolean);
  if (needs.length) return needs.slice(0, 6);
  if (selectedAnswerIds(track, "comfort").includes("unclear")) return ["more time, less pressure, or a body-level clue"];
  return ["more information, gentleness, or time to notice"];
}

function possibleNeedsForFamily(track, familyId) {
  syncSelectedWords(track, familyId);
  const words = track.selectedWords?.[familyId] || [];
  const needs = needsForFamily(track, familyId);
  if (needs.length) return needs.join(", ");
  return "more information, gentleness, or time to notice";
}

function needsForFamily(track, familyId) {
  syncSelectedWords(track, familyId);
  const words = track.selectedWords?.[familyId] || [];
  const wordNeeds = [...new Set(words.flatMap((word) => WORD_NEEDS[word] || []))];
  if (wordNeeds.length) return wordNeeds;
  return FAMILY_NEEDS[familyId] ? [FAMILY_NEEDS[familyId]] : [];
}

function trackSummary(track) {
  const labels = answerLabels(track);
  if (labels.length === 0) return "Not started";
  return labels.slice(0, 5).join(" / ") + (labels.length > 5 ? "..." : "");
}

function familyById(track, familyId) {
  return familyOptionsForTrack(track).find((option) => option.id === familyId) || { id: familyId, label: familyId, desc: "" };
}

function allFamilyOptions() {
  return [...QUESTIONS.family.uncomfortableOptions, ...QUESTIONS.family.comfortableOptions];
}

function familyMeta(familyId) {
  return allFamilyOptions().find((option) => option.id === familyId) || { id: familyId, label: familyId, desc: "" };
}

function familyColorStyle(familyId) {
  const colors = FAMILY_COLORS[familyId] || { color: "#5a665f", soft: "#e4eae6", border: "#aeb8b1" };
  return `--family-color:${colors.color};--family-soft:${colors.soft};--family-border:${colors.border};`;
}

function textureClassForFamily(track, familyId) {
  const textures = new Set(track.familyTextures?.[familyId] || []);
  if (textures.has("activated")) return "texture-activated";
  if (textures.has("depleted")) return "texture-depleted";
  if (textures.has("settled")) return "texture-settled";
  if (textures.has("unclear_energy")) return "texture-unclear";
  return "texture-none";
}

function familyIdsForTrack(track) {
  return selectedAnswerIds(track, "family");
}

function selectedWordsForTrack(track) {
  syncFamilyTextures(track);
  return familyIdsForTrack(track).flatMap((familyId) => {
    syncSelectedWords(track, familyId);
    return (track.selectedWords?.[familyId] || []).map((word) => ({ familyId, word }));
  });
}

function render() {
  document.getElementById("workspaceView").hidden = viewMode === "summary";
  document.getElementById("summaryView").hidden = viewMode !== "summary";
  document.getElementById("partsViewBtn").classList.toggle("active", viewMode === "workspace");
  document.getElementById("summaryBtn").classList.toggle("active", viewMode === "summary");
  renderTrackList();
  if (viewMode === "summary") {
    renderSummary();
  } else {
    renderActiveTrack();
  }
}

function renderTrackList() {
  document.getElementById("trackCount").textContent = `${tracks.length} ${tracks.length === 1 ? "part" : "parts"}`;
  document.getElementById("trackList").innerHTML = `
    <div class="track-list-items">
      ${tracks.map((track, index) => `
        <button class="track-card ${track.id === activeTrackId ? "active" : ""}" type="button" onclick="selectTrack('${track.id}')">
          ${renderTrackFamilyDots(track)}
          <span class="track-card-title">
            <span>${escapeHtml(track.name)}</span>
            <span>${track.step >= QUESTION_ORDER.length ? "done" : `${index + 1}`}</span>
          </span>
          <span class="track-card-summary">${escapeHtml(trackSummary(track))}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderTrackFamilyDots(track) {
  const families = familyIdsForTrack(track);
  if (!families.length) {
    return `<span class="track-family-dots empty" aria-hidden="true"><span></span></span>`;
  }
  return `
    <span class="track-family-dots" aria-label="Selected family colors">
      ${families.map((familyId) => `<span style="${familyColorStyle(familyId)}"></span>`).join("")}
    </span>
  `;
}

function renderActiveTrack() {
  const track = activeTrack();
  if (!track) return;
  syncFamilyTextures(track);
  const isFamilyCards = track.step >= QUESTION_ORDER.length;
  document.getElementById("activeTrack").innerHTML = `
    <div class="active-track-header">
      <div>
        <div class="track-name-row">
          <input value="${escapeHtml(track.name)}" aria-label="Part name" oninput="updateTrackName('${track.id}', this.value)">
        </div>
        ${renderPath(track)}
      </div>
      <div class="track-actions">
        <button type="button" onclick="duplicateTrack('${track.id}')">Duplicate</button>
        <button type="button" onclick="resetTrack('${track.id}')">Reset</button>
        <button type="button" onclick="removeTrack('${track.id}')">${tracks.length === 1 ? "Clear" : "Remove"}</button>
      </div>
    </div>
    ${isFamilyCards ? renderFamilyCards(track) : renderQuestion(track)}
    ${renderCombined()}
  `;
}

function renderPath(track) {
  const chips = QUESTION_ORDER.flatMap((questionId, index) => {
    return selectedAnswerIds(track, questionId).map((optionId) => {
      const label = optionLabel(questionId, optionId, track);
      return `<button type="button" class="path-chip" onclick="editStep(${index})">${escapeHtml(label)}</button>`;
    });
  });
  if (!chips.length) return `<p class="empty-note">No selections yet.</p>`;
  return `<div class="answer-path" aria-label="Selected path">${chips.join("")}</div>`;
}

function renderQuestion(track) {
  const question = currentQuestion(track);
  if (!question) return "";
  const validIds = new Set(question.options.map((option) => option.id));
  const selected = new Set(track.draft.filter((id) => validIds.has(id)));
  track.draft = [...selected];
  return `
    <section class="question-panel">
      <h2>${escapeHtml(question.title)}</h2>
      <p class="question-hint">${escapeHtml(question.hint)}</p>
      <div class="option-grid">
        ${question.options.map((option) => `
          <button
            type="button"
            class="option-button ${selected.has(option.id) ? "selected" : ""}"
            aria-pressed="${selected.has(option.id) ? "true" : "false"}"
            onclick="toggleOption('${option.id}')"
          >
            <span class="option-title">${escapeHtml(option.label)}</span>
            <span class="option-desc">${escapeHtml(option.desc)}</span>
          </button>
        `).join("")}
      </div>
      <div class="question-actions">
        <button type="button" class="secondary" onclick="goBack()" ${track.step === 0 ? "disabled" : ""}>Back</button>
        <button type="button" onclick="continueTrack()" ${track.draft.length === 0 ? "disabled" : ""}>Continue</button>
      </div>
    </section>
  `;
}

function renderFamilyCards(track) {
  const families = selectedAnswerIds(track, "family");
  if (families.length === 0) {
    return `
      <section class="question-panel">
        <h2>Pick broad families</h2>
        <p class="question-hint">Go back and choose one or more families for this part.</p>
        <div class="question-actions">
          <button type="button" class="secondary" onclick="goBack()">Back</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="question-panel">
      <h2>Refine each family</h2>
      <p class="question-hint">Each selected family can have its own texture. The words and needs update separately inside each card.</p>
      <div class="family-card-grid">
        ${families.map((familyId) => renderFamilyCard(track, familyId)).join("")}
      </div>
      <div class="question-actions">
        <button type="button" class="secondary" onclick="goBack()">Back</button>
      </div>
    </section>
  `;
}

function renderFamilyCard(track, familyId) {
  const family = familyById(track, familyId);
  const selectedTextures = new Set(track.familyTextures?.[familyId] || []);
  const feelings = possibleFeelingsForFamily(track, familyId);
  syncSelectedWords(track, familyId);
  const selectedWords = new Set(track.selectedWords?.[familyId] || []);
  const need = possibleNeedsForFamily(track, familyId);
  return `
    <article class="family-card ${textureClassForFamily(track, familyId)}" style="${familyColorStyle(familyId)}">
      <header class="family-card-header">
        <h3>${escapeHtml(family.label)}</h3>
        <p>${escapeHtml(family.desc)}</p>
      </header>
      <div class="texture-picker" aria-label="${escapeHtml(family.label)} texture">
        ${TEXTURE_OPTIONS.map((texture) => `
          <button
            type="button"
            class="texture-chip ${selectedTextures.has(texture.id) ? "selected" : ""}"
            title="${escapeHtml(texture.desc)}"
            aria-pressed="${selectedTextures.has(texture.id) ? "true" : "false"}"
            onclick="toggleFamilyTexture('${track.id}', '${familyId}', '${texture.id}')"
          >${escapeHtml(texture.label)}</button>
        `).join("")}
      </div>
      <div class="family-card-body">
        <div>
          <h4>Possible words</h4>
          <div class="word-cloud">
            ${feelings.map((feeling) => `
              <button
                type="button"
                class="${selectedWords.has(feeling) ? "selected" : ""}"
                aria-pressed="${selectedWords.has(feeling) ? "true" : "false"}"
                onclick="toggleEmotionWord('${track.id}', '${familyId}', '${escapeForJs(feeling)}')"
              >${escapeHtml(feeling)}</button>
            `).join("")}
          </div>
        </div>
        <div>
          <h4>Possible need</h4>
          <p>${escapeHtml(need)}</p>
        </div>
      </div>
    </article>
  `;
}

function renderCombined() {
  return "";
}

function renderSummary() {
  tracks.forEach(syncFamilyTextures);
  const summary = buildSummary();
  document.getElementById("summaryView").innerHTML = `
    <div class="summary-header">
      <div>
        <p class="breadcrumb"><a href="/shelf/">Shelf</a> · Apps</p>
        <h2>Summary</h2>
        <p>What you seem to be holding across parts right now.</p>
      </div>
    </div>
    <section class="summary-section">
      <h3>Overall color state</h3>
      ${renderFamilyDistribution(summary.familyCounts)}
    </section>
    <section class="summary-section">
      <h3>Parts overview</h3>
      ${renderSummaryTable(summary)}
    </section>
  `;
}

function buildSummary() {
  const familyCounts = new Map();
  const needCounts = new Map();
  tracks.forEach((track) => {
    familyIdsForTrack(track).forEach((familyId) => {
      familyCounts.set(familyId, (familyCounts.get(familyId) || 0) + 1);
      needsForFamily(track, familyId).forEach((need) => {
        needCounts.set(need, (needCounts.get(need) || 0) + 1);
      });
    });
  });
  return { familyCounts, needCounts };
}

function renderFamilyDistribution(familyCounts) {
  const entries = [...familyCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="empty-note">Choose broad families to see the color state.</p>`;
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return `
    <div class="color-stack" aria-label="Family color distribution">
      ${entries.map(([familyId, count]) => `
        <span style="${familyColorStyle(familyId)} width:${Math.max(8, (count / total) * 100)}%;" title="${escapeHtml(familyHoverLabel(familyId, count))}"></span>
      `).join("")}
    </div>
  `;
}

function familyHoverLabel(familyId, count) {
  const names = tracks
    .filter((track) => familyIdsForTrack(track).includes(familyId))
    .map((track) => track.name)
    .join(", ");
  const partLabel = count === 1 ? "part" : "parts";
  return `${familyMeta(familyId).label}: ${count} ${partLabel}${names ? ` (${names})` : ""}`;
}

function renderSummaryTable(summary) {
  const families = [...summary.familyCounts.keys()].sort((a, b) => summary.familyCounts.get(b) - summary.familyCounts.get(a));
  if (!families.length) return `<p class="empty-note">Choose broad families to fill in the table.</p>`;
  return `
    <div class="summary-table-wrap">
      <table class="summary-table">
        <thead>
          <tr>
            <th>Part</th>
            ${families.map((familyId) => `
              <th style="${familyColorStyle(familyId)}">
                <span class="family-count-dot"></span>
                ${escapeHtml(familyMeta(familyId).label)}
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody>
          ${tracks.map((track) => `
            <tr>
              <th scope="row">${escapeHtml(track.name)}</th>
              ${families.map((familyId) => renderSummaryTableCell(track, familyId, summary.needCounts)).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSummaryTableCell(track, familyId, needCounts) {
  if (!familyIdsForTrack(track).includes(familyId)) {
    return `<td class="summary-empty-cell"></td>`;
  }
  const words = selectedWordsForTrack(track).filter((item) => item.familyId === familyId).map((item) => item.word);
  const needs = needsForFamily(track, familyId)
    .sort((a, b) => (needCounts.get(b) || 0) - (needCounts.get(a) || 0))
    .slice(0, 4);
  return `
    <td class="summary-filled-cell" style="${familyColorStyle(familyId)}">
      <div class="summary-cell-fill">
        <strong>${words.length ? escapeHtml(words.join(", ")) : "selected"}</strong>
        <span>${needs.length ? escapeHtml(needs.join(", ")) : "No needs yet."}</span>
      </div>
    </td>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeForJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

window.selectTrack = selectTrack;
window.updateTrackName = updateTrackName;
window.resetTrack = resetTrack;
window.removeTrack = removeTrack;
window.duplicateTrack = duplicateTrack;
window.toggleOption = toggleOption;
window.continueTrack = continueTrack;
window.goBack = goBack;
window.editStep = editStep;
window.addTrack = addTrack;
window.toggleFamilyTexture = toggleFamilyTexture;
window.toggleEmotionWord = toggleEmotionWord;
window.setViewMode = setViewMode;

init();
