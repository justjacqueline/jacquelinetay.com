(function () {
  const page = document.body && document.body.dataset.page;
  if (!page) return;

  const STORAGE_KEY = `chicken-local-state:${page}`;
  const table = document.querySelector('.table');
  const arrowLayer = document.querySelector('.table-arrow-layer');
  const currentPlay = document.querySelector('[data-current-play]');
  const playBannerAction = currentPlay ? currentPlay.querySelector('.play-banner-action') : null;
  const playHeading = currentPlay ? currentPlay.querySelector('h2') : null;
  const primaryButton = document.querySelector('.top-actions .primary');
  const copyButton = document.querySelector('.top-actions .ghost');
  const targetPicker = document.querySelector('.target-picker');
  const targetButtons = Array.from(document.querySelectorAll('[data-target]'));
  const playerNodes = Array.from(document.querySelectorAll('[data-player]'));
  const actionNodes = Array.from(document.querySelectorAll('[data-action]'));
  const reactionNodes = Array.from(document.querySelectorAll('[data-reaction]'));
  const responseButtons = Array.from(document.querySelectorAll('.decision-button[data-reaction]'));
  const cornCount = document.querySelector('.big-corn');

  const seats = {
    maya: document.querySelector('[data-player="maya"]'),
    sam: document.querySelector('[data-player="sam"]'),
    ari: document.querySelector('[data-player="ari"]'),
    nina: document.querySelector('[data-player="nina"]'),
    you: document.querySelector('[data-player="you"]')
  };

  const ACTIONS = {
    take1: { label: 'Take 1 Corn', scope: 'self', cost: 0, targetRequired: false },
    take2: { label: 'Take 2 Corn', scope: 'self', cost: 0, targetRequired: false },
    coup: { label: 'Chicken Coup', scope: 'one', cost: 7, targetRequired: true, disabled: true },
    goat: { label: 'Goat', scope: 'self', cost: 0, targetRequired: false },
    rooster: { label: 'Rooster', scope: 'self', cost: 0, targetRequired: false },
    fox: { label: 'Fox', scope: 'one', cost: 0, targetRequired: true },
    snake: { label: 'Snake', scope: 'one', cost: 3, targetRequired: true },
    dog: { label: 'Guard Dog', scope: 'block', cost: 0, targetRequired: false }
  };

  const REACTIONS = {
    allow: { label: 'Allow' },
    challenge: { label: 'Challenge' },
    'block-goat': { label: 'Block with Goat' },
    'block-fox': { label: 'Block with Fox' },
    'inactive-rooster': { label: 'Not a response' },
    'inactive-snake': { label: 'Not a response' },
    'inactive-dog': { label: 'Not a response' }
  };

  const defaultState = page === 'turn'
    ? { action: 'take1', target: 'maya', reaction: null }
    : { action: null, target: null, reaction: 'allow' };

  let state = loadState();
  let renderQueued = false;

  bindChromeActions();
  bindInteractions();
  scheduleRender();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState };
      return { ...defaultState, ...JSON.parse(raw) };
    } catch {
      return { ...defaultState };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  }

  function setState(next) {
    state = { ...state, ...next };
    saveState();
    scheduleRender();
  }

  function bindChromeActions() {
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText('HEN42');
          flashButton(copyButton, 'Copied');
        } catch {
          flashButton(copyButton, 'Copy failed');
        }
      });
    }

    if (primaryButton) {
      primaryButton.addEventListener('click', () => {
        if (page === 'turn') {
          setState({ action: 'take1', target: 'maya' });
        } else {
          setState({ reaction: 'allow' });
        }
      });
    }
  }

  function bindInteractions() {
    actionNodes.forEach((node) => {
      node.addEventListener('click', () => {
        const action = node.dataset.action;
        const meta = ACTIONS[action];
        if (!meta) return;

        if (meta.disabled && !canAfford(meta.cost)) {
          flashBanner(`${meta.label} needs ${meta.cost} corn`);
          return;
        }

        setState({
          action,
          target: meta.targetRequired ? (state.target || 'maya') : null
        });
      });
    });

    targetButtons.forEach((node) => {
      node.addEventListener('click', () => {
        setState({ target: node.dataset.target });
      });
    });

    playerNodes.forEach((node) => {
      node.addEventListener('click', () => {
        const target = node.dataset.player;
        const meta = ACTIONS[state.action] || ACTIONS.take1;
        if (!meta.targetRequired || !target || target === 'you') return;
        setState({ target });
      });
    });

    reactionNodes.forEach((node) => {
      node.addEventListener('click', () => {
        const reaction = node.dataset.reaction;
        if (!reaction || reaction.startsWith('inactive')) return;
        setState({ reaction });
      });
    });
  }

  function canAfford(cost) {
    if (!cornCount) return true;
    const amount = parseInt(cornCount.textContent, 10);
    return Number.isFinite(amount) ? amount >= cost : true;
  }

  function flashButton(node, message) {
    const prev = node.textContent;
    node.textContent = message;
    window.clearTimeout(flashButton._timer);
    flashButton._timer = window.setTimeout(() => {
      node.textContent = prev;
    }, 1000);
  }

  function flashBanner(message) {
    if (!playBannerAction) return;
    const prev = playBannerAction.textContent;
    const prevBg = playBannerAction.style.background;
    const prevColor = playBannerAction.style.color;
    const prevBorder = playBannerAction.style.borderColor;

    playBannerAction.textContent = message;
    playBannerAction.style.background = '#fff0ec';
    playBannerAction.style.color = '#8b2f22';
    playBannerAction.style.borderColor = '#e8b8ad';

    window.clearTimeout(flashBanner._timer);
    flashBanner._timer = window.setTimeout(() => {
      playBannerAction.textContent = prev;
      playBannerAction.style.background = prevBg;
      playBannerAction.style.color = prevColor;
      playBannerAction.style.borderColor = prevBorder;
      scheduleRender();
    }, 1200);
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    if (page === 'turn') {
      renderTurn();
    } else {
      renderReaction();
    }
    renderArrows(buildArrows());
  }

  function renderTurn() {
    const meta = ACTIONS[state.action] || ACTIONS.take1;
    const selectedTarget = state.target ? prettyName(state.target) : '';

    actionNodes.forEach((node) => {
      node.classList.toggle('is-selected', node.dataset.action === state.action);
    });

    targetButtons.forEach((node) => {
      const selected = node.dataset.target === state.target;
      node.classList.toggle('is-selected', selected);
      node.classList.toggle('active-choice', selected);
    });

    if (playHeading) playHeading.textContent = 'Your turn';
    if (playBannerAction) {
      playBannerAction.style.background = '';
      playBannerAction.style.color = '';
      playBannerAction.style.borderColor = '';
      if (meta.targetRequired) {
        playBannerAction.textContent = `${meta.label} · cost ${meta.cost} · target ${selectedTarget || 'select one'}`;
      } else {
        playBannerAction.textContent = `${meta.label} · cost ${meta.cost}`;
      }
      if (meta.disabled && !canAfford(meta.cost)) {
        playBannerAction.textContent = `${meta.label} unavailable · need ${meta.cost} corn`;
        playBannerAction.style.background = '#f1eee8';
        playBannerAction.style.color = '#786b58';
        playBannerAction.style.borderColor = '#d3ccc0';
      }
    }

    if (targetPicker) {
      targetPicker.style.display = meta.targetRequired ? '' : 'none';
    }

    updateHighlightState({
      targetIds: state.target ? [state.target] : [],
      targetId: state.target
    });
  }

  function renderReaction() {
    responseButtons.forEach((node) => {
      node.classList.toggle('is-selected', node.dataset.reaction === state.reaction);
    });

    reactionNodes.forEach((node) => {
      const reaction = node.dataset.reaction;
      if (reaction && !reaction.startsWith('inactive')) {
        node.classList.toggle('is-selected', reaction === state.reaction);
      }
    });

    if (playHeading) {
      playHeading.textContent = state.reaction === 'challenge' ? 'Challenge Maya' : 'Maya claims Fox';
    }

    if (playBannerAction) {
      if (state.reaction === 'challenge') {
        playBannerAction.textContent = 'Call bluff · Maya may need to reveal Fox';
      } else if (state.reaction === 'block-goat') {
        playBannerAction.textContent = 'Goat blocks Fox';
      } else if (state.reaction === 'block-fox') {
        playBannerAction.textContent = 'Fox blocks Fox';
      } else {
        playBannerAction.textContent = 'Fox · steal 2';
      }
    }

    updateHighlightState({
      targetIds: state.reaction === 'challenge' || state.reaction === 'block-goat' || state.reaction === 'block-fox'
        ? ['maya', 'you']
        : ['you'],
      targetId: 'you'
    });
  }

  function updateHighlightState(config) {
    const targetIds = config.targetIds || [];
    const targetId = config.targetId || null;

    playerNodes.forEach((node) => {
      const id = node.dataset.player;
      node.classList.toggle('target', targetIds.includes(id));
    });

    Object.entries(seats).forEach(([id, seat]) => {
      if (!seat) return;
      seat.classList.toggle('target', targetIds.includes(id));
    });

    if (page === 'turn') {
      const activeTarget = targetId || '';
      targetButtons.forEach((node) => {
        const target = node.dataset.target;
        node.classList.toggle('target', target === activeTarget);
      });
    }
  }

  function prettyName(id) {
    switch (id) {
      case 'maya': return 'Maya';
      case 'sam': return 'Sam';
      case 'ari': return 'Ari';
      case 'nina': return 'Nina';
      case 'you': return 'You';
      default: return id;
    }
  }

  function buildArrows() {
    if (page === 'reaction') {
      if (state.reaction === 'challenge') {
        return [{ from: 'you', to: 'maya' }];
      }
      if (state.reaction === 'block-goat' || state.reaction === 'block-fox') {
        return [{ from: 'you', to: 'maya' }];
      }
      return [{ from: 'maya', to: 'you' }];
    }

    const meta = ACTIONS[state.action] || ACTIONS.take1;
    if (!meta.targetRequired) return [];

    if (meta.scope === 'all') {
      return ['maya', 'sam', 'ari', 'nina'].map((id) => ({ from: 'you', to: id }));
    }

    return state.target ? [{ from: 'you', to: state.target }] : [];
  }

  function renderArrows(arrows) {
    if (!arrowLayer || !table) return;
    arrowLayer.innerHTML = '';
    if (!arrows || !arrows.length) return;

    const tableRect = table.getBoundingClientRect();
    const width = Math.max(1, Math.round(tableRect.width));
    const height = Math.max(1, Math.round(tableRect.height));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'table-arrow');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', `attack-arrow-head-${page}`);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('markerWidth', '12');
    marker.setAttribute('markerHeight', '12');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');

    const markerShape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    markerShape.setAttribute('class', 'table-arrow-marker');
    markerShape.setAttribute('d', 'M 0 0 L 10 5 L 0 10 L 2.25 5 Z');
    marker.appendChild(markerShape);
    defs.appendChild(marker);
    svg.appendChild(defs);

    arrows.forEach((arrow, index) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = makeCurvePath(arrow.from, arrow.to, index, arrows.length);
      if (!d) return;
      path.setAttribute('d', d);
      path.setAttribute('marker-end', `url(#attack-arrow-head-${page})`);
      svg.appendChild(path);
    });

    arrowLayer.appendChild(svg);
  }

  function makeCurvePath(fromId, toId, index, total) {
    const fromSeat = seats[fromId];
    const toSeat = seats[toId];
    if (!fromSeat || !toSeat || !table) return '';

    const tableRect = table.getBoundingClientRect();
    const fromRect = fromSeat.getBoundingClientRect();
    const toRect = toSeat.getBoundingClientRect();

    const startX = fromRect.left - tableRect.left + fromRect.width / 2;
    const startY = fromRect.top - tableRect.top + fromRect.height / 2;
    const endX = toRect.left - tableRect.left + toRect.width / 2;
    const endY = toRect.top - tableRect.top + toRect.height / 2;

    const dx = endX - startX;
    const dy = endY - startY;
    const curve = Math.max(90, Math.abs(dx) * 0.35 + Math.abs(dy) * 0.15);
    const direction = dx >= 0 ? 1 : -1;
    const spread = (index - (total - 1) / 2) * 16;

    const sx = startX + spread;
    const sy = startY;
    const ex = endX - spread;
    const ey = endY;
    const c1x = sx + direction * curve;
    const c1y = sy - 24;
    const c2x = ex - direction * curve;
    const c2y = ey - 24;

    return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
  }

  window.addEventListener('resize', scheduleRender);
  window.addEventListener('load', scheduleRender);
})();
