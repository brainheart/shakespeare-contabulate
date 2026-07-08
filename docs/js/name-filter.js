// Proper-name exclusion lists for the vocabulary views.
// Seeded from morphhb proper-noun tagging at build time (via
// character_name_filter_config.json); user edits are stored per book in
// localStorage. Initialized via initNameFilter().

(function () {
  'use strict';

  const NAME_TOKEN_RE = /[a-zא-ת]+/g;
  const NAME_FILTER_OVERRIDES_KEY = 'tanakhNameFilterOverrides';
  // Speaker-list noise words for corpora with auto-detected character names
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

  let playsById = new Map();
  let charactersRef = [];
  let nameFilterConfigRef = null;
  let onChange = null;
  let characterNameFiltersByPlay = new Map();

  function tokenizeName(name) {
    return String(name || '').toLowerCase().match(NAME_TOKEN_RE) || [];
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

  // --- User overrides (localStorage) layered on top of the built-in config ---

  function loadNameFilterOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(NAME_FILTER_OVERRIDES_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveNameFilterOverrides(overrides) {
    try {
      localStorage.setItem(NAME_FILTER_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (_) { /* private mode etc. — edits just won't persist */ }
  }

  function normalizeFilterTerm(term) {
    const toks = tokenizeName(term);
    if (!toks.length || toks.length > 3) return '';
    return toks.join(' ');
  }

  function playAbbrForId(playId) {
    const play = playsById && playsById.get(playId);
    return play && play.abbr ? String(play.abbr) : String(playId);
  }

  function getPlayOverrides(playId) {
    const all = loadNameFilterOverrides();
    const entry = all[playAbbrForId(playId)];
    return {
      added: Array.isArray(entry && entry.added) ? entry.added : [],
      removed: Array.isArray(entry && entry.removed) ? entry.removed : []
    };
  }

  function hasPlayOverrides(playId) {
    const o = getPlayOverrides(playId);
    return o.added.length > 0 || o.removed.length > 0;
  }

  function rebuildNameFilters() {
    characterNameFiltersByPlay = buildCharacterNameTokensByPlay(charactersRef, playsById, nameFilterConfigRef);
    for (const playId of playsById.keys()) {
      const filter = ensureCharacterNameFilter(characterNameFiltersByPlay, playId);
      const o = getPlayOverrides(playId);
      o.added.forEach(term => addConfigName(filter, term));
      o.removed.forEach(term => removeConfigName(filter, term));
    }
    // Version stamp lets the vocabulary views invalidate their caches
    window.__nameFilterVersion = (window.__nameFilterVersion || 0) + 1;
  }

  function isTermExcluded(playId, phrase) {
    const filter = characterNameFiltersByPlay && characterNameFiltersByPlay.get(playId);
    if (!filter) return false;
    const toks = phrase.split(' ');
    const phraseSet = filter.phrasesByN[toks.length];
    if (phraseSet && phraseSet.has(phrase)) return true;
    return toks.length === 1 && filter.tokens.has(phrase);
  }

  function mutatePlayOverrides(playId, mutate) {
    const abbr = playAbbrForId(playId);
    const all = loadNameFilterOverrides();
    const entry = all[abbr] || { added: [], removed: [] };
    entry.added = Array.isArray(entry.added) ? entry.added : [];
    entry.removed = Array.isArray(entry.removed) ? entry.removed : [];
    mutate(entry);
    if (entry.added.length || entry.removed.length) all[abbr] = entry;
    else delete all[abbr];
    saveNameFilterOverrides(all);
    rebuildNameFilters();
  }

  function excludeNameTerm(playId, rawTerm) {
    const phrase = normalizeFilterTerm(rawTerm);
    if (!phrase) return false;
    // Drop any removal override first; only record an explicit addition if
    // the built-in config still leaves the term unexcluded.
    mutatePlayOverrides(playId, (entry) => {
      entry.removed = entry.removed.filter(t => normalizeFilterTerm(t) !== phrase);
    });
    if (!isTermExcluded(playId, phrase)) {
      mutatePlayOverrides(playId, (entry) => {
        if (!entry.added.some(t => normalizeFilterTerm(t) === phrase)) entry.added.push(phrase);
      });
    }
    if (onChange) onChange();
    return true;
  }

  function includeNameTerm(playId, rawTerm) {
    const phrase = normalizeFilterTerm(rawTerm);
    if (!phrase) return false;
    mutatePlayOverrides(playId, (entry) => {
      entry.added = entry.added.filter(t => normalizeFilterTerm(t) !== phrase);
    });
    if (isTermExcluded(playId, phrase)) {
      mutatePlayOverrides(playId, (entry) => {
        if (!entry.removed.some(t => normalizeFilterTerm(t) === phrase)) entry.removed.push(phrase);
      });
    }
    if (onChange) onChange();
    return true;
  }

  function resetNameOverrides(playId) {
    const all = loadNameFilterOverrides();
    delete all[playAbbrForId(playId)];
    saveNameFilterOverrides(all);
    rebuildNameFilters();
    if (onChange) onChange();
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

  function getPlayFilterDisplayData(playId) {
    const filter = characterNameFiltersByPlay && characterNameFiltersByPlay.get(playId);
    if (!filter) {
      return { terms: [], total: 0 };
    }
    const termSet = new Set(filter.tokens || []);
    for (const n of [1, 2, 3]) {
      for (const phrase of (filter.phrasesByN && filter.phrasesByN[n]) || []) termSet.add(phrase);
    }
    const terms = Array.from(termSet).sort((a, b) => a.localeCompare(b));
    return { terms, total: terms.length };
  }

  window.initNameFilter = function (deps) {
    deps = deps || {};
    playsById = deps.playsById || new Map();
    charactersRef = deps.characters || [];
    nameFilterConfigRef = deps.characterNameFilterConfig || null;
    onChange = typeof deps.onChange === 'function' ? deps.onChange : null;
    rebuildNameFilters();
  };

  window.ngramContainsConfiguredName = ngramContainsCharacterName;
  window.nameFilterEditor = {
    listForPlay(playId) {
      const display = getPlayFilterDisplayData(playId);
      return { terms: display.terms, total: display.total, hasOverrides: hasPlayOverrides(playId) };
    },
    exclude(playId, term) { return excludeNameTerm(playId, term); },
    include(playId, term) { return includeNameTerm(playId, term); },
    reset(playId) { resetNameOverrides(playId); }
  };
})();
