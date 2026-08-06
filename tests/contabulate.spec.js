// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForDataLoaded(page) {
  await page.waitForFunction(() => {
    return window.__contabulateReady === true;
  }, { timeout: 20000 });
}

async function pickSampleQuery(page) {
  return 'love';
}

async function search(page, query, { gran = 'play', ngramMode = '1', matchMode = 'exact' } = {}) {
  await page.selectOption('#gran', gran);
  await page.selectOption('#matchMode', matchMode);
  if (matchMode === 'regex') {
    await page.selectOption('#ngramMode', ngramMode);
  }
  await page.fill('#q', query);
  await page.press('#q', 'Enter');
  await page.waitForSelector('#results tbody tr', { timeout: 15000 });
}

test.describe('Page Load', () => {
  test('loads and shows the Shakespeare title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Shakespeare Tabular Explorer');
  });

  test('shows base stats on first load with no search terms', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    await expect(page.locator('#results tbody tr')).toHaveCount(38);
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Location'))).toBeTruthy();
    expect(texts.some(t => t.includes('Play'))).toBeTruthy();
    expect(texts.some(t => t.includes('Year'))).toBeTruthy();
    expect(texts.some(t => t.includes('# acts'))).toBeTruthy();
    expect(texts.some(t => t.includes('# scenes'))).toBeTruthy();
    expect(texts.some(t => t.includes('# lines'))).toBeTruthy();
    // No commentary data in this corpus: the columns must not appear
    expect(texts.some(t => t.includes('# comments'))).toBeFalsy();
  });
});

test.describe('Segments Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
  });

  test('supports exact-term auto ngram detection and removable headers', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await page.fill('#q', `${sample} ${sample}`);
    await page.click('#addColumnBtn');
    await expect(page.locator('#results thead th')).toContainText([`"${sample} ${sample}"`]);
    await page.locator('#results thead th button.term-col-remove').click();
    await expect(page.locator('#results thead th')).not.toContainText([`"${sample} ${sample}"`]);
  });

  test('the + popover offers metrics only, without a commentators group', async ({ page }) => {
    await page.locator('#results thead th.add-column-th').click();
    const popover = page.locator('.add-column-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.add-column-search')).toHaveAttribute('placeholder', 'Search metrics...');
    await expect(popover.locator('.add-column-group-title', { hasText: 'Commentators' })).toHaveCount(0);
    await popover.locator('.add-column-option', { hasText: '% Hapax' }).click();
    await page.keyboard.press('Escape');
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('% Hapax'))).toBeTruthy();
  });

  test('count cells drill down through acts, scenes, and lines', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    const playHeaderKeys = await page.locator('#results thead th').evaluateAll((ths) =>
      ths.map((th) => th.dataset.key)
    );
    const playColumn = (key) => playHeaderKeys.indexOf(key) + 1;
    const firstPlay = page.locator('#results tbody tr').first();
    const playLocation = (await firstPlay.locator(`td:nth-child(${playColumn('location')})`).innerText()).trim();
    const playGenre = (await firstPlay.locator(`td:nth-child(${playColumn('genre')})`).innerText()).trim();
    // A play row → its five acts, scoped by its abbreviation-first location.
    await firstPlay.locator(`td:nth-child(${playColumn('num_chapters')}) button.drill-link`).click();
    await expect(page.locator('#gran')).toHaveValue('act');
    await expect(page.locator('#segmentsTotalInfo')).toContainText('(5 total rows)');
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText(`starts with ${playLocation}.`);
    // Act row → its scenes
    await page.locator('#results tbody tr').first().locator('td:nth-child(4) button.drill-link').click();
    await expect(page.locator('#gran')).toHaveValue('scene');
    // Back un-drills
    await page.goBack();
    await expect(page.locator('#gran')).toHaveValue('act');
    await page.goBack();
    await expect(page.locator('#gran')).toHaveValue('play');
    // Genre cell filters plays to that genre
    await page.locator('#results tbody tr').first().locator(`td:nth-child(${playColumn('genre')}) .drill-link`).click();
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText(`is ${playGenre}`);
    const visibleGenres = await page.locator(`#results tbody tr td:nth-child(${playColumn('genre')})`).allTextContents();
    expect(visibleGenres.length).toBeGreaterThan(0);
    expect(visibleGenres.every((genre) => genre.trim() === playGenre)).toBeTruthy();
  });

  test('play character counts open the Character table scoped to that play', async ({ page }) => {
    await page.goto('/?gran=play&s_ft_title=%5EHamlet%24');
    await waitForDataLoaded(page);
    await expect(page.locator('#results tbody tr')).toHaveCount(1);

    const playHeaderKeys = await page.locator('#results thead th').evaluateAll((ths) =>
      ths.map((th) => th.dataset.key)
    );
    const characterCountColumn = playHeaderKeys.indexOf('num_characters') + 1;
    expect(characterCountColumn).toBeGreaterThan(0);
    const countCell = page.locator(`#results tbody tr td:nth-child(${characterCountColumn})`);
    await expect(countCell).toHaveText('39');
    await expect(countCell.locator('button.drill-link')).toHaveAttribute('title', 'Show the 39 characters of Hamlet');

    await countCell.locator('button.drill-link').click();
    await expect(page.locator('#gran')).toHaveValue('character');
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Location starts with HAM.');
    await expect(page.locator('#segmentsTotalInfo')).toContainText('(39 total rows)');
    expect(new URL(page.url()).searchParams.get('s_ft_location')).toBe('^HAM\\.');

    const characterHeaderKeys = await page.locator('#results thead th').evaluateAll((ths) =>
      ths.map((th) => th.dataset.key)
    );
    const playColumn = characterHeaderKeys.indexOf('play_title') + 1;
    const visiblePlays = await page.locator(`#results tbody tr td:nth-child(${playColumn})`).allTextContents();
    expect(visiblePlays).toHaveLength(39);
    expect(visiblePlays.every((title) => title.trim() === 'Hamlet')).toBeTruthy();

    await page.reload();
    await waitForDataLoaded(page);
    await expect(page.locator('#segmentsTotalInfo')).toContainText('(39 total rows)');
    await page.goBack();
    await expect(page.locator('#gran')).toHaveValue('play');
    await expect(page.locator('#results tbody tr')).toHaveCount(1);
  });

  test('vocabulary granularities put n-grams in the rows with an active name toggle', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await page.selectOption('#gran', 'word');
    await expect(page.locator('#results thead th[data-key="ngram"]')).toHaveCount(1);
    await expect(page.locator('#results thead th[data-key="unusualness"]')).toHaveCount(1);
    // Speaker-derived proper-name data exists, so the toggle is visible
    await expect(page.locator('#vocabNamesToggle')).toBeVisible();
    await expect(page.locator('#vocabNamesUnavailable')).toBeHidden();
    const totalBeforeNames = await page.locator('#segmentsTotalInfo').textContent();
    await page.setChecked('#vocabNamesCheckbox', true);
    await expect(page.locator('#segmentsTotalInfo')).not.toHaveText(totalBeforeNames);
    const totalAfterNames = await page.locator('#segmentsTotalInfo').textContent();
    expect(Number(totalAfterNames.match(/\d+/)[0])).toBeLessThan(Number(totalBeforeNames.match(/\d+/)[0]));
    await page.setChecked('#vocabNamesCheckbox', false);
    // The search box filters the Word column here
    await page.fill('#q', 'love');
    await page.locator('#addColumnBtn').click();
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('matches love');
    const words = await page.locator('#results tbody tr td:first-child').allTextContents();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.includes('love'))).toBeTruthy();
  });

  test('supports regex mode with explicit ngram selection', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await search(page, `^${sample}$`, { gran: 'play', matchMode: 'regex', ngramMode: '1' });
    expect(await page.locator('#results tbody tr').count()).toBeGreaterThan(0);
  });

  test('line rows render speakers and highlights', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await search(page, sample, { gran: 'line' });
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Speaker'))).toBeTruthy();
    await page.locator('#segmentsTab details summary').click();
    await expect(page.locator('#results tbody td .hit').first()).toBeVisible({ timeout: 15000 });
  });

  test('speech rows support matching term columns and highlighted text', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await search(page, sample, { gran: 'speech' });
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Speech'))).toBeTruthy();
    expect(texts.some(t => t.includes(`# "${sample}"`))).toBeTruthy();
    await page.locator('#segmentsTab details summary').click();
    await expect(page.locator('#results tbody .speech-text-cell .hit').first()).toBeVisible({ timeout: 15000 });
  });

  test('granularity selector spans play, act, scene, speech, line, and character', async ({ page }) => {
    const options = await page.locator('#gran option').evaluateAll((opts) =>
      opts.map((opt) => ({ value: opt.value, text: (opt.textContent || '').trim() }))
    );
    for (const value of ['genre', 'play', 'act', 'scene', 'speech', 'line', 'character', 'word', 'bigram', 'trigram']) {
      expect(options.some((opt) => opt.value === value)).toBeTruthy();
    }
  });

  test('character granularity supports the death-obsession sample query', async ({ page }) => {
    await page.goto('/?cs=1&zr=0&hl=1&q=dead%7Cdeath&nm=1&gran=character&mm=regex&ts=%255B%257B%2522t%2522%253A%2522dead%257Cdeath%2522%252C%2522m%2522%253A%2522regex%2522%252C%2522n%2522%253A1%252C%2522d%2522%253A%2522count%2522%257D%255D&sk=t0_count&sd=desc&s_ft_gender=F');
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 15000 });
    await expect(page.locator('#gran')).toHaveValue('character');
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Character'))).toBeTruthy();
    const genders = await page.locator('#results tbody tr td:nth-child(2)').allTextContents();
    expect(genders.length).toBeGreaterThan(0);
    expect(genders.every(g => g.trim() === 'F')).toBeTruthy();
  });
});

test.describe('Lines View', () => {
  test('shows matching line rows at Line granularity', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    const sample = await pickSampleQuery(page);
    await search(page, sample, { gran: 'line' });
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Play'))).toBeTruthy();
    expect(texts.some(t => t.includes('Act'))).toBeTruthy();
    expect(texts.some(t => t.includes('Scene'))).toBeTruthy();
    expect(texts.some(t => t.includes('# comments'))).toBeFalsy();
    await expect(page.locator('#results tbody tr').first()).toBeVisible();
  });
});

test('vocabulary scope survives switching the n-gram size', async ({ page }) => {
  await page.goto('/?gran=word&s_ft_location=%5EMAC%5C.');
  await waitForDataLoaded(page);
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with MAC.');
  // Switching word -> bigram keeps the same scope in place
  await page.selectOption('#gran', 'bigram');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with MAC.');
  await page.selectOption('#gran', 'trigram');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with MAC.');
  // ...and carries into the location granularities
  await page.selectOption('#gran', 'scene');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with MAC.');
  // Jumping coarser than the scope shows its containing row, not nothing
  await page.selectOption('#gran', 'play');
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with MAC.');
});

test('locations start with play abbreviations and ancestor cells preserve hierarchy scope', async ({ page }) => {
  await page.goto('/?gran=line&sk=location&sd=asc');
  await waitForDataLoaded(page);
  // The line view shows a single-cell "Loading line text..." row while
  // all_lines.json streams in, so wait for the real header instead.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('#results thead th'))
      .some((th) => th.dataset.key === 'location'),
    null,
    { timeout: 30000 }
  );
  await page.waitForSelector('#results tbody tr td:nth-child(2)', { timeout: 15000 });

  const headerKeys = await page.locator('#results thead th').evaluateAll((ths) =>
    ths.map((th) => th.dataset.key)
  );
  const column = (key) => headerKeys.indexOf(key) + 1;
  const firstRow = () => page.locator('#results tbody tr').first();
  const firstLocation = (await firstRow().locator(`td:nth-child(${column('location')})`).innerText()).trim();
  const locationParts = firstLocation.split('.');

  expect(firstLocation).toMatch(/^[A-Z0-9]+\.\d\.\d{2}\.\d{4}$/);
  expect(firstLocation).not.toMatch(/^\d{2}\./);

  const expectLocationFilter = async (pattern) => {
    await expect.poll(() => new URL(page.url()).searchParams.get('s_ft_location')).toBe(pattern);
  };
  const restoreUnscopedLineView = async () => {
    await page.goBack();
    await expectLocationFilter(null);
    await page.waitForSelector('#results tbody tr');
  };

  await firstRow().locator(`td:nth-child(${column('play_title')}) button.drill-link`).click();
  await expectLocationFilter(`^${locationParts[0]}\\.`);
  await restoreUnscopedLineView();

  await firstRow().locator(`td:nth-child(${column('act')}) button.drill-link`).click();
  await expectLocationFilter(`^${locationParts[0]}\\.${locationParts[1]}\\.`);
  await restoreUnscopedLineView();

  await firstRow().locator(`td:nth-child(${column('scene')}) button.drill-link`).click();
  await expectLocationFilter(`^${locationParts[0]}\\.${locationParts[1]}\\.${locationParts[2]}\\.`);

  // Speech numbers need three digits: Love's Labour's Lost 5.2 reaches 407.
  await page.goto('/?gran=speech&s_ft_location=%5ELLL%5C.5%5C.02%5C.S407%24');
  await waitForDataLoaded(page);
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
  const speechHeaderKeys = await page.locator('#results thead th').evaluateAll((ths) =>
    ths.map((th) => th.dataset.key)
  );
  const speechLocationColumn = speechHeaderKeys.indexOf('location') + 1;
  await expect(page.locator(`#results tbody tr td:nth-child(${speechLocationColumn})`)).toHaveText('LLL.5.02.S407');
});

test('character counts are doors into speech, line, and main-table vocabulary views', async ({ page }) => {
  // Keep a non-unigram search-column setting active to prove that the
  // explicitly "# words" door still opens unigrams and reports word totals.
  await page.goto('/?gran=character&sk=line_count&sd=desc&mm=regex&nm=3');
  await waitForDataLoaded(page);
  await page.waitForSelector('#results tbody tr', { timeout: 15000 });
  const texts = await page.locator('#results thead th').allTextContents();
  expect(texts.some(t => t.includes('# lines'))).toBeTruthy();
  const firstRow = page.locator('#results tbody tr').first();
  const name = (await firstRow.locator('td:first-child').innerText()).replace(/\s+/g, ' ').trim();
  expect(name).toBe('HAMLET');
  const lineCount = parseInt((await firstRow.locator('td:nth-child(5)').innerText()).replace(/,/g, ''), 10);
  const wordCount = parseInt((await firstRow.locator('td:nth-child(6)').innerText()).replace(/,/g, ''), 10);
  expect(wordCount).toBe(11849);
  const speechCount = parseInt((await firstRow.locator('td:nth-child(4)').innerText()).replace(/,/g, ''), 10);
  expect(speechCount).toBe(358);
  // # speeches → the Speech view, where full TEI speech boundaries are
  // represented as rows and long speech text expands in place.
  await firstRow.locator('td:nth-child(4) button.drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('speech');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Character is HAMLET');
  await expect(page.locator('#segmentsTotalInfo')).toContainText(`(${speechCount} total rows)`);
  const speechHeaders = await page.locator('#results thead th').allTextContents();
  expect(speechHeaders.some(t => t.includes('Speech'))).toBeTruthy();
  expect(speechHeaders.some(t => t.includes('Speaker'))).toBeTruthy();
  const speechToggle = page.locator('#results tbody .speech-text-toggle').first();
  const speechText = page.locator('#results tbody .speech-text-content').first();
  await expect(speechToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(speechToggle).toHaveAttribute('aria-label', 'Show full speech');
  await expect(speechToggle).toHaveText(/more/);
  const collapsedSpeech = await speechText.innerText();
  await speechToggle.click();
  await expect(speechToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(speechToggle).toHaveAttribute('aria-label', 'Collapse speech');
  await expect(speechToggle).toHaveText(/less/);
  expect((await speechText.innerText()).length).toBeGreaterThan(collapsedSpeech.length);
  // The expanded prose is ordinary selectable text, not a giant toggle:
  // clicking or selecting it must leave the speech open.
  await speechText.click();
  await expect(speechToggle).toHaveAttribute('aria-expanded', 'true');
  const selectedText = await speechText.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selectedText.length).toBeGreaterThan(collapsedSpeech.length);
  await expect(speechToggle).toHaveAttribute('aria-expanded', 'true');
  await speechToggle.click();
  await expect(speechToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(speechToggle).toHaveAttribute('aria-label', 'Show full speech');
  await expect(speechToggle).toHaveText(/more/);
  await page.goBack();
  await expect(page.locator('#gran')).toHaveValue('character');
  // # lines → the Line view scoped to the character's play and speaker
  await page.locator('#results tbody tr').first().locator('td:nth-child(5) button.drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('line');
  const chips = await page.locator('#segmentsActiveFilters .active-filter-chip').allTextContents();
  expect(chips.some(c => c.includes('starts with'))).toBeTruthy();
  expect(chips.some(c => c.includes('Speaker') && c.includes('HAMLET'))).toBeTruthy();
  await expect(page.locator('#segmentsTotalInfo')).toContainText(`(${lineCount} total rows)`);
  // Back returns to the character view, where # words opens unigrams in the
  // main table, scoped by the character index.
  await page.goBack();
  await expect(page.locator('#gran')).toHaveValue('character');
  await page.locator('#results tbody tr').first().locator('td:nth-child(6) button.drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('word');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Character is HAMLET');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(2557 total rows)');
  const vocabHeaders = await page.locator('#results thead th').allTextContents();
  expect(vocabHeaders.some(t => t.includes('# characters'))).toBeTruthy();
  expect(vocabHeaders.some(t => t.includes('# scenes'))).toBeFalsy();
  await expect(page.locator('#results tbody tr').first().locator('td:nth-child(1) span[dir="auto"]')).toHaveText('the');
  await expect(page.locator('#results tbody tr').first().locator('td:nth-child(2)')).toHaveText('428');
  await expect(page.locator('.character-detail-modal')).toHaveCount(0);

  // Back/Forward retraces the drill, while all vocabulary sizes share the
  // character scope.
  expect(new URL(page.url()).searchParams.get('s_ft_character_id')).toBe('^70016$');
  await page.goBack();
  await expect(page.locator('#gran')).toHaveValue('character');
  await page.goForward();
  await expect(page.locator('#gran')).toHaveValue('word');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Character is HAMLET');
  await page.selectOption('#gran', 'bigram');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Character is HAMLET');
  await page.selectOption('#gran', 'word');

  // The resulting deep link is self-contained, and its character-count door
  // truthfully opens all characters using the selected word.
  await page.reload();
  await waitForDataLoaded(page);
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Character is HAMLET');
  await page.locator('#results tbody tr').first().locator('td:nth-child(3) button.drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('character');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(1166 total rows)');
});

test('scene word counts open the exact scene vocabulary instead of an empty descendant scope', async ({ page }) => {
  await page.goto('/?gran=scene&s_ft_location=%5EHAM%5C.1%5C.02%24');
  await waitForDataLoaded(page);
  await page.waitForSelector('#results tbody tr', { timeout: 15000 });
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
  await expect(page.locator('#results tbody tr').first().locator('td[data-value="2059"]')).toHaveCount(1);

  await page.locator('#results tbody tr').first().locator('td[data-value="2059"] button.drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('word');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Location is HAM.1.02');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(718 total rows)');
  await expect(page.locator('#results tbody tr').first().locator('td:nth-child(1) span[dir="auto"]')).toHaveText('to');
  await expect(page.locator('#results tbody tr').first().locator('td:nth-child(2)')).toHaveText('71');
  expect(new URL(page.url()).searchParams.get('s_ft_location')).toBe('^HAM\\.1\\.02$');
});

test('vocabulary distribution counts stay corpus-wide under location and genre scopes', async ({ page }) => {
  const columns = 'ngram%2Ccount%2Cbook_count%2Cverse_count%2Cunusualness';

  // Othello 4.2 contains four instances of "hell", but the distribution
  // columns still describe every play and scene in which the word occurs.
  await page.goto(`/?gran=word&co=${columns}&s_ft_location=%5EOTH%5C.4%5C.02%24&s_ft_ngram=%5Ehell%24`);
  await waitForDataLoaded(page);
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
  const sceneScopedRow = page.locator('#results tbody tr').first();
  await expect(sceneScopedRow.locator('td:nth-child(1) span[dir="auto"]')).toHaveText('hell');
  await expect(sceneScopedRow.locator('td:nth-child(2)')).toHaveText('4');
  await expect(sceneScopedRow.locator('td:nth-child(3)')).toHaveText('34');
  await expect(sceneScopedRow.locator('td:nth-child(4)')).toHaveText('119');
  await sceneScopedRow.locator('td:nth-child(4) button.drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('scene');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(119 total rows)');
  const sceneDrillFilters = await page.locator('#segmentsActiveFilters .active-filter-chip').allTextContents();
  expect(sceneDrillFilters.some(filter => filter.includes('Location'))).toBeFalsy();

  // The same corpus-wide distribution survives a different slice type;
  // only Count changes to the frequency within tragedies.
  await page.goto(`/?gran=word&co=${columns}&s_ft_genre=%5Etragedy%24&s_ft_ngram=%5Ehell%24`);
  await waitForDataLoaded(page);
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
  const genreScopedRow = page.locator('#results tbody tr').first();
  await expect(genreScopedRow.locator('td:nth-child(2)')).toHaveText('57');
  await expect(genreScopedRow.locator('td:nth-child(3)')).toHaveText('34');
  await expect(genreScopedRow.locator('td:nth-child(4)')).toHaveText('119');
});

test('genre scopes carry into the Line view instead of emptying it', async ({ page }) => {
  // Genre rows' "# lines" counts drill into a genre-scoped Line view; line
  // rows carry a genre field so the scope filter actually matches them.
  await page.goto('/?gran=genre');
  await waitForDataLoaded(page);
  await page.waitForSelector('#results tbody tr');
  const headers = page.locator('#results thead th');
  const headerKeys = await headers.evaluateAll(ths => ths.map(th => th.dataset.key));
  const verseCol = headerKeys.indexOf('verse_count') + 1;
  await page.locator(`#results tbody tr:first-child td:nth-child(${verseCol}) button.drill-link`).click();
  await expect(page.locator('#gran')).toHaveValue('line');
  await page.waitForSelector('#results tbody tr td:nth-child(2)', { timeout: 20000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('Genre');
  const rowCount = await page.locator('#results tbody tr').count();
  expect(rowCount).toBeGreaterThan(1);
  await expect(page.locator('#results tbody')).not.toContainText('No results match the filters.');
});

test('filter popover renders stored patterns as text, not markup', async ({ page }) => {
  // A crafted deep link must not execute when the filter popover opens.
  const evil = encodeURIComponent('"><img src=x onerror="window.__xss=1">');
  await page.goto(`/?gran=play&s_ft_title=${evil}`);
  await waitForDataLoaded(page);
  await page.waitForSelector('#results thead th');
  await page.locator('#results thead th[data-key="title"] .filter-icon').click();
  await page.waitForSelector('.filter-popover');
  const fired = await page.evaluate(() => window.__xss === 1);
  expect(fired).toBeFalsy();
  const inputValue = await page.inputValue('.filter-popover .f-pattern');
  expect(inputValue).toContain('onerror');
});
