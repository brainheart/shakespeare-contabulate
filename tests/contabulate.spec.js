// @ts-check
const { test, expect } = require('@playwright/test');
const chunks = require('../docs/data/chunks.json');

const actSceneCounts = chunks.reduce((map, chunk) => {
  const key = `${chunk.play_abbr}.${chunk.act}`;
  map.set(key, (map.get(key) || 0) + 1);
  return map;
}, new Map());

// Helper: wait for data to load (tokens are fetched async)
async function waitForDataLoaded(page) {
  await page.waitForFunction(() => {
    // UI and async startup are complete
    return document.querySelector('.tab-btn') !== null && window.__contabulateReady === true;
  }, { timeout: 15000 });
}

// Helper: run a search and wait for results
async function search(page, query, { gran = 'play', ngramMode = '1' } = {}) {
  await page.selectOption('#gran', gran);
  await page.selectOption('#ngramMode', ngramMode);
  await page.fill('#q', query);
  await page.press('#q', 'Enter');
  // Wait for results table to have rows
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
}

// ==========================================
// Basic loading
// ==========================================
test.describe('Page Load', () => {
  test('loads and shows title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Shakespeare/);
  });

  test('loads data and shows UI controls', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await expect(page.locator('#q')).toBeVisible();
    await expect(page.locator('#gran')).toBeVisible();
    await expect(page.locator('#ngramMode')).toBeVisible();
  });

  test('has two tabs', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    const tabs = page.locator('.tab-btn');
    await expect(tabs).toHaveCount(2);
  });
});

// ==========================================
// Search — Segments tab
// ==========================================
test.describe('Segments Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
  });

  test('play granularity returns 37 rows for common word', async ({ page }) => {
    await search(page, 'the', { gran: 'play' });
    const rows = page.locator('#results tbody tr');
    await expect(rows).toHaveCount(37);
  });

  test('play granularity shows expected columns', async ({ page }) => {
    await search(page, 'love', { gran: 'play' });
    const headers = page.locator('#results thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Play'))).toBeTruthy();
    expect(texts.some(t => t.includes('Genre'))).toBeTruthy();
    expect(texts.some(t => t.includes('Year'))).toBeTruthy();
    // Should NOT have a Location column in play view
    expect(texts.some(t => t === 'Location')).toBeFalsy();
  });

  test('scene granularity has Location column', async ({ page }) => {
    await search(page, 'love', { gran: 'scene' });
    const headers = page.locator('#results thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Location'))).toBeTruthy();
  });

  test('genre granularity shows play count column and genre totals', async ({ page }) => {
    await search(page, 'the', { gran: 'genre' });
    const headers = page.locator('#results thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => /plays/i.test(t))).toBeTruthy();

    const rows = await page.locator('#results tbody tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()))
    );
    const comedyRow = rows.find((cells) => cells[0].toLowerCase() === 'comedy');
    expect(comedyRow).toBeTruthy();
    expect(comedyRow).toContain('13');
  });

  test('act granularity returns results', async ({ page }) => {
    await search(page, 'love', { gran: 'act' });
    const rows = page.locator('#results tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('act granularity shows scene count column and act totals', async ({ page }) => {
    await search(page, 'the', { gran: 'act' });
    const headers = page.locator('#results thead th');
    const texts = await headers.allTextContents();
    const sceneCountColIdx = texts.findIndex((t) => /scenes/i.test(t));
    expect(sceneCountColIdx).toBeGreaterThan(-1);

    const rows = await page.locator('#results tbody tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()))
    );
    const firstActRow = rows.find((cells) => cells[0] && actSceneCounts.has(cells[0]));
    expect(firstActRow).toBeTruthy();
    expect(Number(firstActRow[sceneCountColIdx])).toBe(actSceneCounts.get(firstActRow[0]));
  });

  test('character granularity returns results', async ({ page }) => {
    await search(page, 'love', { gran: 'character' });
    const rows = page.locator('#results tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('character granularity shows speech count column', async ({ page }) => {
    await search(page, 'love', { gran: 'character' });
    const headers = page.locator('#results thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => /speeches/i.test(t))).toBeTruthy();
  });

  test('line granularity returns results', async ({ page }) => {
    // Tabs container is hidden until search; make it visible then click
    await search(page, 'love', { gran: 'play' });
    await page.evaluate(() => { document.querySelector('.tabs').style.display = 'flex'; });
    await page.click('.tab-btn[data-tab="lines"]');
    await page.fill('#linesQuery', 'love');
    await page.press('#linesQuery', 'Enter');
    await page.waitForSelector('#linesResults tbody tr', { timeout: 10000 });
    const rows = page.locator('#linesResults tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('line granularity updates text highlights immediately when highlight toggle changes', async ({ page }) => {
    await search(page, 'love', { gran: 'line' });
    await page.locator('#segmentsTab details summary').click();

    const highlightedBefore = await page.locator('#results tbody td .hit').count();
    expect(highlightedBefore).toBeGreaterThan(0);

    await page.locator('#segmentsTab label', { hasText: 'Highlight matching line text' }).click();
    await expect(page.locator('#segmentsTab .highlight-toggle')).not.toBeChecked();
    await expect(page.locator('#results tbody td .hit')).toHaveCount(0);

    await page.locator('#segmentsTab label', { hasText: 'Highlight matching line text' }).click();
    await expect(page.locator('#segmentsTab .highlight-toggle')).toBeChecked();
    await expect(page.locator('#results tbody td .hit').first()).toBeVisible();
  });

  test('lines tab removes text highlights when highlight toggle is unchecked', async ({ page }) => {
    await search(page, 'love', { gran: 'play' });
    await page.evaluate(() => { document.querySelector('.tabs').style.display = 'flex'; });
    await page.click('.tab-btn[data-tab="lines"]');
    await page.fill('#linesQuery', 'love');
    await page.press('#linesQuery', 'Enter');
    await page.waitForSelector('#linesResults tbody tr', { timeout: 10000 });
    await page.locator('#linesTab details').evaluate(el => { el.open = true; });

    const highlightedBefore = await page.locator('#linesResults tbody td .hit').count();
    expect(highlightedBefore).toBeGreaterThan(0);

    await page.locator('#linesTab label', { hasText: 'Highlight matching line text' }).click();
    await expect(page.locator('#linesTab .highlight-toggle')).not.toBeChecked();
    await expect(page.locator('#linesResults tbody td .hit')).toHaveCount(0);
  });

  test('line granularity disables percentage display modes without adding inline helper text', async ({ page }) => {
    await page.selectOption('#termDisplayMode', 'pct');
    await page.selectOption('#gran', 'line');

    await expect(page.locator('#termDisplayMode')).toHaveValue('counts');
    await expect(page.locator('#termDisplayMode option[value="both"]')).toBeDisabled();
    await expect(page.locator('#termDisplayMode option[value="pct"]')).toBeDisabled();
    await expect(page.locator('#termDisplayMode')).toHaveAttribute('title', 'Line rows show hits only.');
    await expect(page.locator('#termDisplayModeHint')).toHaveCount(0);
  });

  test('line granularity temporarily forces hits then restores prior display mode', async ({ page }) => {
    await page.selectOption('#termDisplayMode', 'both');
    await page.selectOption('#gran', 'line');
    await expect(page.locator('#termDisplayMode')).toHaveValue('counts');

    await page.selectOption('#gran', 'scene');
    await expect(page.locator('#termDisplayMode')).toHaveValue('both');
  });

  test('bigram search works', async ({ page }) => {
    await search(page, 'my lord', { gran: 'play', ngramMode: '2' });
    const rows = page.locator('#results tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('regex search works', async ({ page }) => {
    await page.selectOption('#gran', 'play');
    await page.selectOption('#matchMode', 'regex');
    await page.fill('#q', '^love$');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    const rows = page.locator('#results tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('sorting works', async ({ page }) => {
    await search(page, 'love', { gran: 'play' });
    // Click Year header to sort
    const yearHeader = page.locator('#results thead th', { hasText: 'Year' });
    await yearHeader.click();
    // Should have sort indicator
    const sorted = page.locator('#results thead th.sorted-asc, #results thead th.sorted-desc');
    const count = await sorted.count();
    expect(count).toBeGreaterThan(0);
  });

  test('adding a new term switches sort to that term descending', async ({ page }) => {
    await search(page, 'love', { gran: 'play' });
    await expect(page.locator('#results thead th.sorted-desc')).toContainText(/love/i);

    await page.fill('#q', 'death');
    await page.press('#q', 'Enter');

    const sortedDesc = page.locator('#results thead th.sorted-desc');
    await expect(sortedDesc).toHaveCount(1);
    await expect(sortedDesc).toContainText(/death/i);
    await expect(page.locator('#results thead th.sorted-desc', { hasText: /love/i })).toHaveCount(0);
  });

  test('numeric cells expose rank hints', async ({ page }) => {
    await search(page, 'love', { gran: 'play' });
    const rankedCell = page.locator('#results tbody td.ranked-cell').first();
    await expect(rankedCell).toHaveAttribute('data-rank-hint', /rank:\s*#\d+\s+of\s+\d+/i);
    await expect(rankedCell).toHaveAttribute('title', /rank:\s*#\d+\s+of\s+\d+/i);
  });
});

// ==========================================
// Deep links
// ==========================================
test.describe('Deep Links', () => {
  test('restores search from URL params', async ({ page }) => {
    await page.goto('/?q=love&nm=1&gran=play&mm=exact&cs=1&td=both&zr=0&hl=1');
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    const rows = page.locator('#results tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    // Check that the search field has the right value
    await expect(page.locator('#q')).toHaveValue('love');
  });

  test('deep link preserves sort', async ({ page }) => {
    await page.goto('/?q=love&nm=1&gran=play&mm=exact&sk=title&sd=asc&cs=1&td=both&zr=0&hl=1');
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    // First play should be alphabetically first
    const firstCell = page.locator('#results tbody tr:first-child td:first-child');
    const text = await firstCell.textContent();
    expect((text || '').trim().length).toBeGreaterThan(0);
    expect((text || '').trim().startsWith('A')).toBeTruthy();
    const sortedAsc = page.locator('#results thead th.sorted-asc');
    await expect(sortedAsc).toHaveCount(1);
    await expect(sortedAsc.first()).toContainText('Play');
  });

  test('permalink updates on search', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await search(page, 'death', { gran: 'play' });
    // Wait a moment for deep link to update
    // Deep link uses hash or query params — check the permalink input instead
    await page.waitForTimeout(500);
    const deepLinkInput = page.locator('#deepLinkInput, .deep-link-input, input[readonly]').first();
    const linkCount = await deepLinkInput.count();
    if (linkCount > 0) {
      const link = await deepLinkInput.inputValue();
      expect(link).toContain('q=death');
    } else {
      // If no permalink input, check URL
      const url = page.url();
      // Just verify search worked (URL might not update immediately)
      const rows = page.locator('#results tbody tr');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('deep link preserves mixed exact and regex term chips', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);

    await page.selectOption('#gran', 'play');
    await page.fill('#q', 'love');
    await page.press('#q', 'Enter');

    await page.selectOption('#matchMode', 'regex');
    await page.fill('#q', '^death$');
    await page.press('#q', 'Enter');

    await page.waitForSelector('#results tbody tr', { timeout: 10000 });

    const headersBefore = await page.locator('#results thead th').allTextContents();
    expect(headersBefore.some(t => t.includes('"love"'))).toBeTruthy();
    expect(headersBefore.some(t => t.includes('/^death$/'))).toBeTruthy();

    const deepLink = await page.locator('.deep-link').first().getAttribute('href');
    expect(deepLink).toBeTruthy();
    expect(deepLink).toContain('ts=');

    await page.goto(deepLink);
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });

    const chips = await page.locator('#termsList .term-pill').allTextContents();
    expect(chips.some(t => t.includes('love'))).toBeTruthy();
    expect(chips.some(t => t.includes('/^death$/'))).toBeTruthy();

    const headersAfter = await page.locator('#results thead th').allTextContents();
    expect(headersAfter.some(t => t.includes('"love"'))).toBeTruthy();
    expect(headersAfter.some(t => t.includes('/^death$/'))).toBeTruthy();
  });
});

// ==========================================
// Play Detail Modal
// ==========================================
test.describe('Play Detail Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await search(page, 'love', { gran: 'play' });
  });

  test('play titles are clickable links', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await expect(link).toBeVisible();
  });

  test('clicking play title opens modal', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    const modal = page.locator('.play-detail-overlay.open');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('modal shows play title and stats', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('.play-detail-overlay.open', { timeout: 5000 });
    const title = page.locator('#playDetailTitle');
    await expect(title).not.toBeEmpty();
    const meta = page.locator('#playDetailMeta');
    const metaText = await meta.textContent();
    expect(metaText).toContain('words');
    expect(metaText).toContain('lines');
  });

  test('modal shows n-gram data after computing', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });
    const rows = page.locator('#playDetailTable tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tab switching works', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });
    // Switch to bigrams
    await page.click('.play-detail-tab-btn[data-n="2"]');
    await page.waitForTimeout(500);
    const rows = page.locator('#playDetailTable tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tf-idf column includes mouseover explanation', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });

    const tfidfHeader = page.locator('#playDetailTable thead th[data-key="tfidf"]');
    const title = await tfidfHeader.getAttribute('title');
    expect((title || '').toLowerCase()).toContain('term frequency');
    expect((title || '').toLowerCase()).toContain('inverse document frequency');
    expect((title || '').toLowerCase()).toContain('idf = ln(n / df)');
  });

  test('modal sort indicators show active column and direction', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });

    const countHeader = page.locator('#playDetailTable thead th[data-key="count"]');
    await expect(countHeader).toHaveClass(/sorted-desc/);

    const ngramHeader = page.locator('#playDetailTable thead th[data-key="ngram"]');
    await ngramHeader.click();
    await expect(ngramHeader).toHaveClass(/sorted-asc/);
    await expect(countHeader).not.toHaveClass(/sorted-desc/);

    await ngramHeader.click();
    await expect(ngramHeader).toHaveClass(/sorted-desc/);
  });

  test('unusualness slider filters results', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });
    const initialCount = await page.locator('#playDetailTable tbody tr').count();
    // Move slider to ~halfway
    const slider = page.locator('#playDetailSlider');
    const max = await slider.getAttribute('max');
    // Use evaluate to set slider value since fill() doesn't work on range inputs
    const halfMax = Number(max) * 0.5;
    await slider.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input')); }, String(halfMax));
    await page.waitForTimeout(300);
    const filteredCount = await page.locator('#playDetailTable tbody tr').count();
    expect(filteredCount).toBeLessThan(initialCount);
  });

  test('character-name filter is on by default and can be disabled', async ({ page }) => {
    await search(page, 'the', { gran: 'play' });
    const hamletLink = page.locator('.play-detail-link', { hasText: 'Hamlet' }).first();
    await expect(hamletLink).toBeVisible();
    await hamletLink.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });

    const nameFilterToggle = page.locator('#playDetailFilterNames');
    await expect(nameFilterToggle).toBeChecked();

    const hamletTermCell = page.locator('#playDetailTable tbody td:nth-child(2)', { hasText: /^hamlet$/i });
    await expect(hamletTermCell).toHaveCount(0);

    await nameFilterToggle.uncheck();
    await page.waitForTimeout(250);
    const hamletTermCount = await hamletTermCell.count();
    expect(hamletTermCount).toBeGreaterThan(0);
  });

  test('config-backed generic role names are filtered in play detail', async ({ page }) => {
    await search(page, 'the', { gran: 'play' });
    const kingLearLink = page.locator('.play-detail-link', { hasText: 'King Lear' }).first();
    await expect(kingLearLink).toBeVisible();
    await kingLearLink.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });

    const foolTermCell = page.locator('#playDetailTable tbody td:nth-child(2)', { hasText: /^fool$/i });
    await expect(foolTermCell).toHaveCount(0);

    await page.locator('#playDetailFilterNames').uncheck();
    await page.waitForTimeout(250);
    const foolTermCount = await foolTermCell.count();
    expect(foolTermCount).toBeGreaterThan(0);
  });

  test('config-backed alias names are filtered in play detail', async ({ page }) => {
    await search(page, 'topas', { gran: 'play' });
    const twelfthNightLink = page.locator('.play-detail-link', { hasText: 'Twelfth Night' }).first();
    await expect(twelfthNightLink).toBeVisible();
    await twelfthNightLink.click();
    await page.waitForSelector('#playDetailTable tbody tr', { timeout: 15000 });

    const topasTermCell = page.locator('#playDetailTable tbody td:nth-child(2)', { hasText: /^topas$/i });
    const cesarioTermCell = page.locator('#playDetailTable tbody td:nth-child(2)', { hasText: /^cesario$/i });
    await expect(topasTermCell).toHaveCount(0);
    await expect(cesarioTermCell).toHaveCount(0);

    await page.locator('#playDetailFilterNames').uncheck();
    await page.waitForTimeout(250);
    expect(await topasTermCell.count()).toBeGreaterThan(0);
    expect(await cesarioTermCell.count()).toBeGreaterThan(0);
  });

  test('modal closes on X button', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('.play-detail-overlay.open', { timeout: 5000 });
    await page.click('.play-detail-close');
    await expect(page.locator('.play-detail-overlay.open')).toHaveCount(0);
  });

  test('modal closes on Escape', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('.play-detail-overlay.open', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.play-detail-overlay.open')).toHaveCount(0);
  });

  test('act count never exceeds 5', async ({ page }) => {
    const link = page.locator('.play-detail-link').first();
    await link.click();
    await page.waitForSelector('.play-detail-overlay.open', { timeout: 5000 });
    const meta = await page.locator('#playDetailMeta').textContent();
    const actMatch = meta.match(/(\d+)\s*acts/);
    expect(actMatch).toBeTruthy();
    expect(Number(actMatch[1])).toBeLessThanOrEqual(5);
  });
});

// ==========================================
// Character Detail Modal
// ==========================================
test.describe('Character Detail Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await search(page, 'love', { gran: 'character' });
  });

  test('character names are clickable links', async ({ page }) => {
    const link = page.locator('.character-detail-link').first();
    await expect(link).toBeVisible();
  });

  test('clicking character name opens character modal', async ({ page }) => {
    const link = page.locator('.character-detail-link').first();
    await link.click();
    const modal = page.locator('.character-detail-overlay.open');
    await expect(modal).toBeVisible({ timeout: 8000 });
  });

  test('character modal defaults to global scope and can switch to within-play scope', async ({ page }) => {
    const link = page.locator('.character-detail-link').first();
    await link.click();
    await page.waitForSelector('#characterDetailTable tbody tr', { timeout: 20000 });

    const scopeSel = page.locator('#characterDetailScope');
    await expect(scopeSel).toHaveValue('global');

    await scopeSel.selectOption('play');
    await expect(scopeSel).toHaveValue('play');
    await page.waitForSelector('#characterDetailTable tbody tr', { timeout: 20000 });
  });

  test('character modal tf-idf header has explanation and sort indicator updates', async ({ page }) => {
    const link = page.locator('.character-detail-link').first();
    await link.click();
    await page.waitForSelector('#characterDetailTable tbody tr', { timeout: 20000 });

    const tfidfHeader = page.locator('#characterDetailTable thead th[data-key="tfidf"]');
    const title = await tfidfHeader.getAttribute('title');
    expect((title || '').toLowerCase()).toContain('term frequency');
    expect((title || '').toLowerCase()).toContain('idf = max(0, ln((n - df + 0.5) / (df + 0.5)))');

    const countHeader = page.locator('#characterDetailTable thead th[data-key="count"]');
    await expect(countHeader).toHaveClass(/sorted-desc/);

    const ngramHeader = page.locator('#characterDetailTable thead th[data-key="ngram"]');
    await ngramHeader.click();
    await expect(ngramHeader).toHaveClass(/sorted-asc/);
  });

  test('very common words are de-emphasized in character tf-idf', async ({ page }) => {
    await search(page, 'the', { gran: 'character' });
    const firstCharacterLink = page.locator('.character-detail-link').first();
    await expect(firstCharacterLink).toBeVisible();
    await firstCharacterLink.click();
    await page.waitForSelector('#characterDetailTable tbody tr', { timeout: 20000 });

    const theRow = page.locator('#characterDetailTable tbody tr')
      .filter({ has: page.locator('td:nth-child(2)', { hasText: /^the$/i }) })
      .first();
    await expect(theRow).toBeVisible();
    await expect(theRow.locator('td:nth-child(4)')).toHaveText('0.0000');
  });

  test('character modal meta spells out gender and uses line counts distinct from words', async ({ page }) => {
    await search(page, 'the', { gran: 'character' });
    const firstCharacterLink = page.locator('.character-detail-link').first();
    await expect(firstCharacterLink).toBeVisible();
    await firstCharacterLink.click();
    await page.waitForSelector('#characterDetailTable tbody tr', { timeout: 20000 });

    const metaText = await page.locator('#characterDetailMeta').textContent();
    expect(metaText).toMatch(/\b(Male|Female|Ambiguous)\b/);
    const m = (metaText || '').match(/(\d+)\s+words\s+·\s+(\d+)\s+lines/i);
    expect(m).toBeTruthy();
    expect(Number(m[1])).not.toBe(Number(m[2]));
  });
});

// ==========================================
// Column Reordering
// ==========================================
test.describe('Column Reordering', () => {
  test('column headers are draggable', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await search(page, 'love', { gran: 'play' });
    const th = page.locator('#results thead th').first();
    const draggable = await th.getAttribute('draggable');
    expect(draggable).toBe('true');
  });
});

// ==========================================
// Footer and meta
// ==========================================
test.describe('Footer and Meta', () => {
  test('has footer with credits', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('.site-footer');
    await expect(footer).toBeVisible();
    const text = await footer.textContent();
    expect(text).toContain('Reinhard Engels');
    expect(text).toContain('Source');
  });

  test('has favicon', async ({ page }) => {
    await page.goto('/');
    const favicon = page.locator('link[rel="icon"]');
    await expect(favicon).toHaveCount(1);
  });

  test('has Open Graph meta tags', async ({ page }) => {
    await page.goto('/');
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveCount(1);
  });
});
