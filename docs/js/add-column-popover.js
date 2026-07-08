// "+" header-cell popover for adding commentator and text-metric columns.
// Initialized via initAddColumnPopover(); opened from the trailing header cell.

(function () {
  'use strict';

  let deps = {
    getCommentators: () => [],
    isCommentatorSelected: () => false,
    toggleCommentator: () => {},
    getMetricDefs: () => [],
    isMetricEnabled: () => false,
    toggleMetric: () => {},
    formatCount: (n) => String(n),
    focusSearch: () => {}
  };

  let pop = null;
  let anchor = null;
  let searchText = '';
  let sortMode = 'az';

  function closePopover() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
    anchor = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pop) return;
    closePopover();
    // Return focus to the opener (or its rebuilt equivalent) for keyboard users.
    const opener = document.querySelector('.add-column-th .add-column-plus, .add-columns-mobile');
    if (opener) opener.focus();
  });

  document.addEventListener('click', (e) => {
    if (!pop) return;
    // A detached target means the click landed inside something that was
    // re-rendered mid-event (e.g. an option row) — never an outside click.
    if (!e.target || !e.target.isConnected) return;
    if (pop.contains(e.target)) return;
    if (anchor && anchor.contains && anchor.contains(e.target)) return;
    // Toggling a column rebuilds the header row, so the original anchor may be
    // gone; keep the popover open for clicks on any add-column header cell.
    if (e.target.closest && e.target.closest('.add-column-th')) return;
    closePopover();
  });

  function matchesFilter(haystack, filterText) {
    const terms = String(filterText || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const lower = haystack.toLowerCase();
    return terms.every(term => lower.includes(term));
  }

  function makeOption({ label, count, selected, tooltip, onToggle }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-column-option' + (selected ? ' is-selected' : '');
    if (tooltip) btn.title = tooltip;
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = selected ? '✓' : '';
    btn.appendChild(check);
    const text = document.createElement('span');
    text.className = 'option-label';
    text.textContent = label;
    btn.appendChild(text);
    if (count != null) {
      const countEl = document.createElement('span');
      countEl.className = 'count';
      countEl.textContent = count;
      btn.appendChild(countEl);
    }
    btn.addEventListener('click', () => {
      onToggle();
      render();
    });
    return btn;
  }

  function groupHead(title, sortControl) {
    const head = document.createElement('div');
    head.className = 'add-column-group-head';
    const titleEl = document.createElement('span');
    titleEl.className = 'add-column-group-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);
    if (sortControl) head.appendChild(sortControl);
    return head;
  }

  function buildSortControl() {
    const wrap = document.createElement('span');
    wrap.className = 'add-column-sort';
    [['az', 'A–Z'], ['count', 'Most cited']].forEach(([mode, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-btn' + (sortMode === mode ? ' is-active' : '');
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(sortMode === mode));
      btn.addEventListener('click', () => {
        if (sortMode === mode) return;
        sortMode = mode;
        render();
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function firstToggleTarget() {
    return pop ? pop.querySelector('.add-column-list .add-column-option:not(.is-selected)') : null;
  }

  function render() {
    if (!pop) return;
    const list = pop.querySelector('.add-column-list');
    const prevScroll = list ? list.scrollTop : 0;
    list.innerHTML = '';

    const metricDefs = deps.getMetricDefs()
      .filter(d => matchesFilter(`${d.label} ${d.code}`, searchText));
    if (metricDefs.length) {
      list.appendChild(groupHead('Text metrics'));
      metricDefs.forEach((d) => {
        list.appendChild(makeOption({
          label: d.label,
          selected: deps.isMetricEnabled(d.code),
          tooltip: d.tooltip || '',
          onToggle: () => deps.toggleMetric(d.code)
        }));
      });
    }

    // Corpora without commentary data skip the commentators group entirely
    const allCommentators = deps.getCommentators();
    if (allCommentators.length) {
      let commentators = allCommentators
        .filter(item => matchesFilter(`${item.label} ${item.key}`, searchText));
      if (sortMode === 'count') {
        commentators = commentators.slice().sort((a, b) =>
          (b.referenceCount - a.referenceCount) || a.label.localeCompare(b.label));
      }
      list.appendChild(groupHead(
        `Commentators (${commentators.length.toLocaleString('en-US')})`,
        buildSortControl()
      ));
      if (!commentators.length) {
        const empty = document.createElement('div');
        empty.className = 'add-column-empty muted';
        empty.textContent = 'No matching commentators.';
        list.appendChild(empty);
      }
      commentators.forEach((item) => {
        list.appendChild(makeOption({
          label: item.label,
          count: deps.formatCount(item.referenceCount),
          selected: deps.isCommentatorSelected(item.key),
          tooltip: `Comment counts by ${item.label}`,
          onToggle: () => deps.toggleCommentator(item.key)
        }));
      });
    }

    list.scrollTop = prevScroll;
  }

  function showPopover(anchorEl) {
    if (pop) {
      closePopover();
      return;
    }
    anchor = anchorEl;
    pop = document.createElement('div');
    pop.className = 'add-column-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Add columns');

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'add-column-search';
    search.placeholder = deps.getCommentators().length
      ? 'Search commentators and metrics...'
      : 'Search metrics...';
    search.setAttribute('autocomplete', 'off');
    search.value = searchText;
    search.addEventListener('input', () => {
      searchText = search.value;
      render();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const target = firstToggleTarget();
      if (target) target.click();
    });
    pop.appendChild(search);

    const list = document.createElement('div');
    list.className = 'add-column-list';
    pop.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'add-column-footer';
    footer.appendChild(document.createTextNode('Word & phrase columns: '));
    const searchLink = document.createElement('button');
    searchLink.type = 'button';
    searchLink.className = 'link-btn link-btn-no-padding';
    searchLink.textContent = 'use the search bar above';
    searchLink.addEventListener('click', () => {
      closePopover();
      deps.focusSearch();
    });
    footer.appendChild(searchLink);
    footer.appendChild(document.createTextNode('.'));
    pop.appendChild(footer);

    document.body.appendChild(pop);
    render();

    const rect = anchorEl.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 6;
    let left = rect.right + window.scrollX - pop.offsetWidth;
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';

    search.focus();
  }

  window.initAddColumnPopover = function (initDeps) {
    deps = Object.assign({}, deps, initDeps || {});
  };
  window.showAddColumnPopover = showPopover;
  window.closeAddColumnPopover = closePopover;
})();
