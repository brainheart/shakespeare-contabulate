// Character Detail Modal (TF-IDF analysis)
// Initialized via initCharacterDetail()

(function () {
  'use strict';

  const NAME_TOKEN_RE = /[a-z]+/g;
  const CHARACTER_DETAIL_CACHE_MAX = 40;
  const GENERIC_CHARACTER_NAME_TOKENS = new Set([
    'all', 'and', 'both', 'boy', 'captain', 'chorus', 'citizen', 'citizens', 'clown',
    'constable', 'doctor', 'duke', 'earl', 'epilogue', 'first', 'fool', 'fourth', 'gentleman',
    'gentlemen', 'girl', 'governor', 'guard', 'guards', 'herald', 'jailer', 'king', 'knight',
    'lady', 'lord', 'lords', 'man', 'mayor', 'messenger', 'messengers', 'musician', 'musicians',
    'nobleman', 'nurse', 'of', 'officer', 'officers', 'old', 'other', 'others', 'page', 'porter',
    'priest', 'prince', 'prologue', 'queen', 'second', 'senator', 'senators', 'servant',
    'servants', 'seventh', 'sheriff', 'sixth', 'soldier', 'soldiers', 'tenth', 'the', 'third',
    'unknown', 'watch', 'widow', 'woman', 'young'
  ]);

  let charactersById, playsById, tokensChar, tokensChar2, tokensChar3, escapeHTML;
  let characterToPlayId, characterIdsByPlayId, characterNameFiltersByPlay, characterLineCountById, characterCountTotal;
  const setElementHidden = window.setElementHidden || ((el, hidden) => {
    if (!el || !el.classList) return;
    el.classList.toggle('is-hidden', !!hidden);
  });

  const characterDetailCache = new Map();
  const characterDetailState = {
    characterId: null,
    currentN: 1,
    scope: 'global',
    sortKey: 'tfidf',
    sortDir: 'desc',
    excludeCharacterNames: true,
    threshold: 0,
    dataByScope: { global: null, play: null },
    loadSeq: 0
  };
  let characterDetailEls = null;

  function isCharacterDetailCell(granVal, key, row) {
    // Both the name and the word count open the character's vocabulary:
    // the count is a door into the words it counts.
    return granVal === 'character' && (key === 'name' || key === 'ngram_count') && row && row.character_id != null;
  }

  function buildCharacterDetailLink(text, characterId) {
    const el = document.createElement('span');
    el.className = 'play-detail-link character-detail-link';
    el.dataset.characterId = String(characterId);
    el.textContent = String(text ?? '');
    return el;
  }

  function tokenizeName(name) {
    return String(name || '').toLowerCase().match(NAME_TOKEN_RE) || [];
  }

  function normalizeSpeakerName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function buildCharacterLineCountById(characters, allLines) {
    const linesByPlaySpeaker = new Map();
    for (const ln of allLines || []) {
      const playId = Number(ln && ln.play_id);
      if (!Number.isInteger(playId)) continue;
      const speaker = normalizeSpeakerName(ln.speaker);
      if (!speaker) continue;
      const key = `${playId}|${speaker}`;
      linesByPlaySpeaker.set(key, (linesByPlaySpeaker.get(key) || 0) + 1);
    }

    const out = new Map();
    for (const ch of characters || []) {
      const characterId = Number(ch && ch.character_id);
      const playId = Number(ch && ch.play_id);
      if (!Number.isInteger(characterId) || !Number.isInteger(playId)) continue;
      const speaker = normalizeSpeakerName(ch.name);
      const key = `${playId}|${speaker}`;
      out.set(characterId, linesByPlaySpeaker.get(key) || 0);
    }
    return out;
  }

  function formatGenderLabel(code) {
    const c = String(code || '').toUpperCase();
    if (c === 'M') return 'Male';
    if (c === 'F') return 'Female';
    if (c === 'A') return 'Ambiguous';
    return 'Unknown';
  }

  function createCharacterNameFilter() {
    return { tokens: new Set(), phrasesByN: { 1: new Set(), 2: new Set(), 3: new Set() } };
  }

  function ensureCharacterNameFilter(byPlay, playId) {
    if (!byPlay.has(playId)) byPlay.set(playId, createCharacterNameFilter());
    return byPlay.get(playId);
  }

  function addAutoDetectedName(filter, name) {
    const toks = tokenizeName(name);
    if (!toks.length) return;

    if (toks.length >= 2 && toks.length <= 3) {
      filter.phrasesByN[toks.length].add(toks.join(' '));
    }

    const filteredTokens = Array.from(new Set(toks.filter(tok => (
      tok.length >= 2 && !GENERIC_CHARACTER_NAME_TOKENS.has(tok)
    ))));
    for (const tok of filteredTokens) filter.tokens.add(tok);
  }

  function addConfigName(filter, name) {
    const toks = tokenizeName(name);
    if (!toks.length || toks.length > 3) return;
    const phrase = toks.join(' ');
    filter.phrasesByN[toks.length].add(phrase);
    if (toks.length === 1) filter.tokens.add(toks[0]);
  }

  function removeConfigName(filter, name) {
    const toks = tokenizeName(name);
    if (!toks.length || toks.length > 3) return;
    const phrase = toks.join(' ');
    filter.phrasesByN[toks.length].delete(phrase);
    if (toks.length === 1) filter.tokens.delete(toks[0]);
  }

  function buildConfigPlayLookup(playsByIdMap) {
    const lookup = new Map();
    for (const [playId, play] of playsByIdMap.entries()) {
      lookup.set(String(playId), playId);
      if (play && play.abbr) lookup.set(String(play.abbr).trim().toUpperCase(), playId);
      if (play && play.title) lookup.set(String(play.title).trim().toLowerCase(), playId);
    }
    return lookup;
  }

  function resolveConfigPlayId(key, lookup) {
    const raw = String(key || '').trim();
    if (!raw) return null;
    if (lookup.has(raw)) return lookup.get(raw);
    const upper = raw.toUpperCase();
    if (lookup.has(upper)) return lookup.get(upper);
    const lower = raw.toLowerCase();
    if (lookup.has(lower)) return lookup.get(lower);
    return null;
  }

  function applyCharacterNameFilterConfig(byPlay, playsByIdMap, config) {
    if (!config || typeof config !== 'object') return byPlay;

    const playIds = Array.from(playsByIdMap.keys());
    const globalAdditions = Array.isArray(config.global_additions) ? config.global_additions : [];
    const globalRemovals = Array.isArray(config.global_removals) ? config.global_removals : [];
    for (const playId of playIds) {
      const filter = ensureCharacterNameFilter(byPlay, playId);
      globalAdditions.forEach(name => addConfigName(filter, name));
      globalRemovals.forEach(name => removeConfigName(filter, name));
    }

    const lookup = buildConfigPlayLookup(playsByIdMap);
    const applyPerPlay = (entries, applyFn) => {
      for (const [playKey, names] of Object.entries(entries || {})) {
        const playId = resolveConfigPlayId(playKey, lookup);
        if (!Number.isInteger(playId)) continue;
        const filter = ensureCharacterNameFilter(byPlay, playId);
        (Array.isArray(names) ? names : []).forEach(name => applyFn(filter, name));
      }
    };

    applyPerPlay(config.play_additions, addConfigName);
    applyPerPlay(config.play_removals, removeConfigName);
    return byPlay;
  }

  function buildCharacterNameTokensByPlay(characters, playsByIdMap, config) {
    const byPlay = new Map();
    for (const ch of characters || []) {
      const playId = Number(ch && ch.play_id);
      if (!Number.isInteger(playId)) continue;
      const filter = ensureCharacterNameFilter(byPlay, playId);
      addAutoDetectedName(filter, ch.name);
    }
    return applyCharacterNameFilterConfig(byPlay, playsByIdMap, config);
  }

  function ngramContainsCharacterName(ngram, playId) {
    const filter = characterNameFiltersByPlay && characterNameFiltersByPlay.get(playId);
    if (!filter) return false;

    const phrase = String(ngram || '').toLowerCase().trim();
    if (!phrase) return false;
    const toks = phrase.split(' ');
    const phraseSet = filter.phrasesByN[toks.length];
    if (phraseSet && phraseSet.has(phrase)) return true;
    for (const tok of toks) {
      if (filter.tokens.has(tok)) return true;
    }
    return false;
  }

  function maxTfIdfFromRows(rows) {
    let max = 0;
    for (const row of rows || []) {
      if (row.tfidf > max) max = row.tfidf;
    }
    return max;
  }

  function getScopeDocCount(scope, playId) {
    if (scope === 'play') {
      const set = characterIdsByPlayId ? characterIdsByPlayId.get(playId) : null;
      return set ? set.size : 0;
    }
    return characterCountTotal || 0;
  }

  function getScopeLabel(scope) {
    return scope === 'play' ? 'within-play' : 'global';
  }

  function rowsForCurrentSelection() {
    const data = characterDetailState.dataByScope[characterDetailState.scope];
    if (!data) return [];
    const n = characterDetailState.currentN;
    return characterDetailState.excludeCharacterNames
      ? (data.rowsByNNoNames[n] || [])
      : (data.rowsByN[n] || []);
  }

  function maxForCurrentSelection() {
    const data = characterDetailState.dataByScope[characterDetailState.scope];
    if (!data) return 0;
    const n = characterDetailState.currentN;
    return characterDetailState.excludeCharacterNames
      ? (data.maxByNNoNames[n] || 0)
      : (data.maxByN[n] || 0);
  }

  function getPlayFilterDisplayData(playId) {
    const filter = characterNameFiltersByPlay && characterNameFiltersByPlay.get(playId);
    if (!filter) {
      return { tokens: [], phrases: [], total: 0 };
    }

    const tokensSorted = Array.from(filter.tokens || []).sort((a, b) => a.localeCompare(b));
    const phraseSet = new Set();
    for (const n of [2, 3]) {
      const phrases = filter.phrasesByN && filter.phrasesByN[n];
      for (const phrase of phrases || []) phraseSet.add(phrase);
    }
    const phrasesSorted = Array.from(phraseSet).sort((a, b) => a.localeCompare(b));
    return {
      tokens: tokensSorted,
      phrases: phrasesSorted,
      total: tokensSorted.length + phrasesSorted.length
    };
  }

  function getCachedCharacterDetailData(key) {
    if (!characterDetailCache.has(key)) return null;
    const value = characterDetailCache.get(key);
    characterDetailCache.delete(key);
    characterDetailCache.set(key, value);
    return value;
  }

  function setCachedCharacterDetailData(key, value) {
    if (characterDetailCache.has(key)) characterDetailCache.delete(key);
    characterDetailCache.set(key, value);
    while (characterDetailCache.size > CHARACTER_DETAIL_CACHE_MAX) {
      const firstKey = characterDetailCache.keys().next().value;
      characterDetailCache.delete(firstKey);
    }
  }

  function ensureCharacterDetailModal() {
    if (characterDetailEls) return characterDetailEls;

    const overlay = document.createElement('div');
    overlay.className = 'play-detail-overlay character-detail-overlay';
    overlay.innerHTML = `
      <div class="play-detail-modal character-detail-modal" role="dialog" aria-modal="true" aria-label="Character detail">
        <div class="play-detail-head">
          <button type="button" class="play-detail-close character-detail-close" aria-label="Close">×</button>
          <h3 id="characterDetailTitle"></h3>
          <div class="play-detail-meta" id="characterDetailMeta"></div>
        </div>
        <div class="play-detail-body">
          <div class="play-detail-tabs">
            <button type="button" class="play-detail-tab-btn active" data-n="1">Unigrams</button>
            <button type="button" class="play-detail-tab-btn" data-n="2">Bigrams</button>
            <button type="button" class="play-detail-tab-btn" data-n="3">Trigrams</button>
          </div>
          <div class="play-detail-controls">
            <label for="characterDetailSlider">Distinctiveness</label>
            <input id="characterDetailSlider" type="range" min="0" max="0" value="0" step="0.0001">
            <span class="play-detail-value" id="characterDetailValue">0</span>
            <label class="play-detail-toggle" for="characterDetailFilterNames">
              <input id="characterDetailFilterNames" type="checkbox" checked>
              Exclude character names
            </label>
            <div id="characterDetailFilterDisclosure" class="play-detail-filter-disclosure is-hidden"></div>
            <label for="characterDetailScope">TF-IDF scope</label>
            <select id="characterDetailScope">
              <option value="global" selected>Global (all characters)</option>
              <option value="play">Within this play</option>
            </select>
          </div>
          <div class="play-detail-loading" id="characterDetailLoading">Computing...</div>
          <table id="characterDetailTable" class="is-hidden">
            <thead>
              <tr>
                <th>Rank</th>
                <th data-key="ngram">N-gram</th>
                <th data-key="count">Count</th>
                <th data-key="tfidf">TF-IDF Score</th>
              </tr>
            </thead>
            <tbody id="characterDetailTableBody"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.character-detail-close');
    const loading = overlay.querySelector('#characterDetailLoading');
    const slider = overlay.querySelector('#characterDetailSlider');
    const sliderValue = overlay.querySelector('#characterDetailValue');
    const table = overlay.querySelector('#characterDetailTable');
    const tbodyEl = overlay.querySelector('#characterDetailTableBody');
    const titleEl = overlay.querySelector('#characterDetailTitle');
    const metaEl = overlay.querySelector('#characterDetailMeta');
    const filterNamesToggle = overlay.querySelector('#characterDetailFilterNames');
    const filterDisclosureEl = overlay.querySelector('#characterDetailFilterDisclosure');
    const scopeSel = overlay.querySelector('#characterDetailScope');
    const tabBtns = Array.from(overlay.querySelectorAll('.play-detail-tab-btn'));
    const sortableHeaders = Array.from(overlay.querySelectorAll('th[data-key]'));

    function setLoading(msg) {
      loading.textContent = msg || 'Computing...';
      setElementHidden(loading, false);
      setElementHidden(table, true);
    }

    function updateSliderUi() {
      const max = maxForCurrentSelection();
      slider.max = String(max);
      slider.min = '0';
      slider.step = String(max > 0 ? Math.max(max / 400, 0.0001) : 0.0001);
      if (characterDetailState.threshold > max) characterDetailState.threshold = max;
      slider.value = String(characterDetailState.threshold);
      slider.disabled = max <= 0;
      sliderValue.textContent = characterDetailState.threshold.toFixed(4);
    }

    function cdSortRows(rows) {
      const out = rows.slice();
      const key = characterDetailState.sortKey;
      const dir = characterDetailState.sortDir;
      out.sort((a, b) => {
        let cmp = 0;
        if (key === 'ngram') cmp = a.ngram.localeCompare(b.ngram);
        else if (key === 'tfidf') cmp = a.tfidf - b.tfidf;
        else cmp = a.count - b.count;
        if (cmp === 0) cmp = a.ngram.localeCompare(b.ngram);
        return dir === 'asc' ? cmp : -cmp;
      });
      return out;
    }

    function updateSortIndicators() {
      sortableHeaders.forEach(th => {
        const key = th.dataset.key;
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (!key || key !== characterDetailState.sortKey) return;
        th.classList.add(characterDetailState.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      });
    }

    function renderFilterDisclosure() {
      if (!filterDisclosureEl) return;

      const character = charactersById && charactersById.get(characterDetailState.characterId);
      const playId = character ? Number(character.play_id) : null;
      const play = Number.isInteger(playId) && playsById ? playsById.get(playId) : null;
      const playLabel = (play && (play.title || play.abbr)) || 'this play';
      const display = getPlayFilterDisplayData(playId);

      if (!characterDetailState.excludeCharacterNames) {
        filterDisclosureEl.innerHTML = '';
        setElementHidden(filterDisclosureEl, true);
        return;
      }

      const tokenList = display.tokens.length
        ? escapeHTML(display.tokens.join(', '))
        : '<span class="muted">None</span>';
      const phraseList = display.phrases.length
        ? display.phrases.map(phrase => `&quot;${escapeHTML(phrase)}&quot;`).join(', ')
        : '<span class="muted">None</span>';

      filterDisclosureEl.innerHTML = `
        <details class="excluded-terms-details">
          <summary>Filtering ${display.total} terms for ${escapeHTML(playLabel)}</summary>
          <div class="excluded-terms-group">
            <span class="excluded-terms-label">Single tokens</span>
            <span class="excluded-terms-list">${tokenList}</span>
          </div>
          <div class="excluded-terms-group">
            <span class="excluded-terms-label">Phrases</span>
            <span class="excluded-terms-list">${phraseList}</span>
          </div>
        </details>
      `;
      setElementHidden(filterDisclosureEl, false);
    }

    function renderRows() {
      const rows = rowsForCurrentSelection();
      const threshold = characterDetailState.threshold || 0;
      const filtered = threshold > 0 ? rows.filter(r => r.tfidf >= threshold) : rows.slice();
      const sorted = cdSortRows(filtered);
      updateSortIndicators();

      if (!sorted.length) {
        const emptyMsg = (threshold > 0)
          ? 'No n-grams at this distinctiveness threshold.'
          : (characterDetailState.excludeCharacterNames
            ? 'No n-grams remain after excluding character names.'
            : 'No n-grams available.');
        tbodyEl.innerHTML = `<tr><td colspan="4" class="muted">${emptyMsg}</td></tr>`;
        return;
      }

      const html = [];
      for (let i = 0; i < sorted.length; i++) {
        const row = sorted[i];
        html.push(
          `<tr>` +
          `<td>${i + 1}</td>` +
          `<td>${escapeHTML(row.ngram)}</td>` +
          `<td>${row.count}</td>` +
          `<td>${row.tfidf.toFixed(4)}</td>` +
          `</tr>`
        );
      }
      tbodyEl.innerHTML = html.join('');
    }

    function setTab(n) {
      characterDetailState.currentN = n;
      tabBtns.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.n) === n));
      characterDetailState.threshold = 0;
      characterDetailState.sortKey = 'tfidf';
      characterDetailState.sortDir = 'desc';
      updateSliderUi();
      renderRows();
    }

    async function ensureScopeDataLoaded(scope) {
      const charId = characterDetailState.characterId;
      if (!Number.isInteger(charId)) return;

      const seq = ++characterDetailState.loadSeq;
      setLoading(`Computing ${getScopeLabel(scope)} TF-IDF...`);

      const data = await computeCharacterDetailData(charId, scope);
      if (characterDetailState.characterId !== charId || characterDetailState.scope !== scope || characterDetailState.loadSeq !== seq) {
        return;
      }

      characterDetailState.dataByScope[scope] = data;
      setElementHidden(loading, true);
      setElementHidden(table, false);
      updateSliderUi();
      renderRows();
    }

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => setTab(Number(btn.dataset.n)));
    });

    slider.addEventListener('input', () => {
      characterDetailState.threshold = Number(slider.value) || 0;
      if (characterDetailState.threshold === 0) {
        characterDetailState.sortKey = 'tfidf';
        characterDetailState.sortDir = 'desc';
      }
      sliderValue.textContent = characterDetailState.threshold.toFixed(4);
      renderRows();
    });

    if (filterNamesToggle) {
      filterNamesToggle.addEventListener('change', () => {
        characterDetailState.excludeCharacterNames = !!filterNamesToggle.checked;
        updateSliderUi();
        renderFilterDisclosure();
        renderRows();
      });
    }

    if (scopeSel) {
      scopeSel.addEventListener('change', async () => {
        const nextScope = scopeSel.value === 'play' ? 'play' : 'global';
        if (nextScope === characterDetailState.scope) return;
        characterDetailState.scope = nextScope;
        characterDetailState.threshold = 0;
        characterDetailState.sortKey = 'tfidf';
        characterDetailState.sortDir = 'desc';

        if (characterDetailState.dataByScope[nextScope]) {
          updateSliderUi();
          renderRows();
          return;
        }
        await ensureScopeDataLoaded(nextScope);
      });
    }

    sortableHeaders.forEach(th => {
      th.style.cursor = 'pointer';
      const key = th.dataset.key || '';
      if (key === 'tfidf') {
        th.title = 'TF-IDF = term frequency for this character × inverse document frequency across the selected character scope. IDF = max(0, ln((N - df + 0.5) / (df + 0.5))), where N is the number of characters in scope and df is the number containing the term. Very common terms are clamped to 0; higher means more distinctive.';
        th.setAttribute('aria-label', 'TF-IDF score. Hover for explanation. Click to sort.');
      } else {
        th.title = 'Click to sort';
      }
      th.addEventListener('click', () => {
        const clickedKey = th.dataset.key;
        if (!clickedKey) return;
        if (characterDetailState.sortKey === clickedKey) {
          characterDetailState.sortDir = (characterDetailState.sortDir === 'asc' ? 'desc' : 'asc');
        } else {
          characterDetailState.sortKey = clickedKey;
          characterDetailState.sortDir = (clickedKey === 'ngram' ? 'asc' : 'desc');
        }
        renderRows();
      });
    });

    closeBtn.addEventListener('click', closeCharacterDetailModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCharacterDetailModal();
    });

    characterDetailEls = {
      overlay,
      loading,
      table,
      titleEl,
      metaEl,
      filterNamesToggle,
      scopeSel,
      setLoading,
      setTab,
      updateSliderUi,
      renderRows,
      renderFilterDisclosure,
      ensureScopeDataLoaded
    };
    return characterDetailEls;
  }

  function closeCharacterDetailModal() {
    if (!characterDetailEls) return;
    characterDetailEls.overlay.classList.remove('open');
  }

  function computeCharacterNgramRows(index, characterId, playId, scope) {
    const rows = [];
    let maxTfIdf = 0;
    const scopeDocCount = getScopeDocCount(scope, playId);
    if (scopeDocCount <= 0) return { rows, maxTfIdf };

    for (const [ngram, postings] of Object.entries(index || {})) {
      if (!Array.isArray(postings) || postings.length === 0) continue;

      let tf = 0;
      const docsSeen = new Set();

      for (const posting of postings) {
        if (!Array.isArray(posting) || posting.length < 2) continue;
        const cid = posting[0];
        const count = Number(posting[1]) || 0;
        if (count <= 0) continue;
        if (scope === 'play' && characterToPlayId.get(cid) !== playId) continue;

        docsSeen.add(cid);
        if (cid === characterId) tf += count;
      }

      if (tf <= 0) continue;
      const df = docsSeen.size;
      if (df <= 0 || df > scopeDocCount) continue;

      // BM25-style IDF makes very common terms non-discriminative (clamped to 0),
      // which keeps high-frequency stopwords like "the" from dominating.
      const rawIdf = Math.log((scopeDocCount - df + 0.5) / (df + 0.5));
      const idf = rawIdf > 0 ? rawIdf : 0;
      const tfidf = tf * idf;
      if (tfidf > maxTfIdf) maxTfIdf = tfidf;
      rows.push({ ngram, count: tf, tfidf, containsCharacterName: ngramContainsCharacterName(ngram, playId) });
    }

    rows.sort((a, b) => (b.count - a.count) || a.ngram.localeCompare(b.ngram));
    return { rows, maxTfIdf };
  }

  async function computeCharacterDetailData(characterId, scope) {
    const cacheKey = `${characterId}:${scope}`;
    const cached = getCachedCharacterDetailData(cacheKey);
    if (cached) return cached;

    const character = charactersById.get(characterId);
    if (!character) return {
      rowsByN: { 1: [], 2: [], 3: [] },
      maxByN: { 1: 0, 2: 0, 3: 0 },
      rowsByNNoNames: { 1: [], 2: [], 3: [] },
      maxByNNoNames: { 1: 0, 2: 0, 3: 0 }
    };
    const playId = character.play_id;

    const result = {
      rowsByN: { 1: [], 2: [], 3: [] },
      maxByN: { 1: 0, 2: 0, 3: 0 },
      rowsByNNoNames: { 1: [], 2: [], 3: [] },
      maxByNNoNames: { 1: 0, 2: 0, 3: 0 }
    };
    const modal = ensureCharacterDetailModal();

    modal.setLoading(`Computing ${getScopeLabel(scope)} unigrams...`);
    await new Promise(r => setTimeout(r, 0));
    const u = computeCharacterNgramRows(tokensChar, characterId, playId, scope);
    result.rowsByN[1] = u.rows;
    result.maxByN[1] = u.maxTfIdf;

    modal.setLoading(`Computing ${getScopeLabel(scope)} bigrams...`);
    await new Promise(r => setTimeout(r, 0));
    const b = computeCharacterNgramRows(tokensChar2, characterId, playId, scope);
    result.rowsByN[2] = b.rows;
    result.maxByN[2] = b.maxTfIdf;

    modal.setLoading(`Computing ${getScopeLabel(scope)} trigrams...`);
    await new Promise(r => setTimeout(r, 0));
    const t = computeCharacterNgramRows(tokensChar3, characterId, playId, scope);
    result.rowsByN[3] = t.rows;
    result.maxByN[3] = t.maxTfIdf;

    for (const n of [1, 2, 3]) {
      const noNames = result.rowsByN[n].filter(row => !row.containsCharacterName);
      result.rowsByNNoNames[n] = noNames;
      result.maxByNNoNames[n] = maxTfIdfFromRows(noNames);
    }

    setCachedCharacterDetailData(cacheKey, result);
    return result;
  }

  async function openCharacterDetailModal(characterId) {
    const character = charactersById.get(characterId);
    if (!character) return;

    const modal = ensureCharacterDetailModal();
    characterDetailState.characterId = characterId;
    characterDetailState.currentN = 1;
    characterDetailState.scope = 'global';
    characterDetailState.sortKey = 'count';
    characterDetailState.sortDir = 'desc';
    characterDetailState.excludeCharacterNames = true;
    characterDetailState.threshold = 0;
    characterDetailState.dataByScope = { global: null, play: null };
    characterDetailState.loadSeq = 0;

    const play = playsById.get(character.play_id);
    const playTitle = (play && play.title) || character.play_title || 'Unknown play';
    const totalWords = character.total_words_spoken || 0;
    const computedLines = characterLineCountById && characterLineCountById.has(characterId)
      ? (characterLineCountById.get(characterId) || 0)
      : 0;
    const totalLines = Number.isFinite(Number(character.line_count)) && Number(character.line_count) > 0
      ? Number(character.line_count)
      : (computedLines || character.num_lines || 0);
    const totalSpeeches = character.num_speeches || 0;
    const genderCode = (character.gender ?? character.sex ?? 'A').toString().toUpperCase();
    const genderLabel = formatGenderLabel(genderCode);

    modal.titleEl.textContent = character.name || 'Unknown character';
    modal.metaEl.textContent = `${playTitle} · ${genderLabel} · ${totalWords} words · ${totalLines} lines · ${totalSpeeches} speeches`;
    if (modal.scopeSel) modal.scopeSel.value = 'global';
    if (modal.filterNamesToggle) modal.filterNamesToggle.checked = true;
    modal.overlay.classList.add('open');
    modal.setLoading('Computing global TF-IDF...');
    modal.updateSliderUi();
    modal.renderFilterDisclosure();

    await modal.ensureScopeDataLoaded('global');
    if (characterDetailState.characterId !== characterId) return;
    modal.setTab(1);
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.character-detail-link');
    if (!trigger) return;
    const characterId = Number(trigger.dataset.characterId);
    if (!Number.isInteger(characterId)) return;
    e.preventDefault();
    e.stopPropagation();
    openCharacterDetailModal(characterId);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && characterDetailEls && characterDetailEls.overlay.classList.contains('open')) {
      closeCharacterDetailModal();
    }
  });

  window.initCharacterDetail = function (deps) {
    const chars = deps.characters || [];
    const allLines = deps.allLines || [];
    charactersById = new Map(chars.map(c => [c.character_id, c]));
    playsById = deps.playsById;
    tokensChar = deps.tokensChar;
    tokensChar2 = deps.tokensChar2;
    tokensChar3 = deps.tokensChar3;
    escapeHTML = deps.escapeHTML;

    characterCountTotal = chars.length;
    characterToPlayId = new Map();
    characterIdsByPlayId = new Map();
    for (const c of chars) {
      const cid = Number(c.character_id);
      const pid = Number(c.play_id);
      if (!Number.isInteger(cid) || !Number.isInteger(pid)) continue;
      characterToPlayId.set(cid, pid);
      if (!characterIdsByPlayId.has(pid)) characterIdsByPlayId.set(pid, new Set());
      characterIdsByPlayId.get(pid).add(cid);
    }
    characterNameFiltersByPlay = buildCharacterNameTokensByPlay(
      chars,
      playsById,
      deps.characterNameFilterConfig || null
    );
    characterLineCountById = buildCharacterLineCountById(chars, allLines);
  };

  window.isCharacterDetailCell = isCharacterDetailCell;
  window.buildCharacterDetailLink = buildCharacterDetailLink;
})();
