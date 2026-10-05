// Progressive enhancement only: the complete catalog is already rendered in HTML.
for (const catalog of document.querySelectorAll('[data-catalog]')) {
  const form = catalog.querySelector('form');
  const grid = catalog.querySelector('[data-repo-grid]');
  const cards = [...grid.querySelectorAll('[data-repository]')];
  const count = catalog.querySelector('[data-result-count]');
  const empty = catalog.querySelector('[data-no-results]');
  if (!cards.length) continue;
  const params = new URLSearchParams(location.search);
  for (const name of ['q', 'category', 'sort']) {
    const input = form.elements.namedItem(name);
    const value = params.get(name);
    if (input && value && (input.tagName !== 'SELECT' || [...input.options].some(o => o.value === value))) input.value = value;
  }
  form.elements.templates.checked = params.get('templates') === 'true';
  function update(writeUrl = true) {
    const query = form.elements.q.value.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    const category = form.elements.namedItem('category')?.value || '';
    const templates = form.elements.templates.checked;
    const sort = form.elements.sort.value;
    let visible = 0;
    for (const card of cards) {
      card.hidden = !words.every(word => card.dataset.search.includes(word))
        || (category && !card.dataset.categories.split(' ').includes(category))
        || (templates && card.dataset.template !== 'true');
      if (!card.hidden) visible++;
    }
    cards.sort((a, b) => {
      if (sort === 'stars') return Number(b.dataset.stars) - Number(a.dataset.stars) || a.dataset.name.localeCompare(b.dataset.name);
      if (sort === 'name') return a.dataset.name.localeCompare(b.dataset.name);
      return b.dataset.updated.localeCompare(a.dataset.updated) || a.dataset.name.localeCompare(b.dataset.name);
    });
    grid.append(...cards);
    count.textContent = `${visible} of ${cards.length} ${cards.length === 1 ? 'repository' : 'repositories'}`;
    empty.hidden = visible !== 0;
    if (writeUrl) {
      const url = new URL(location.href);
      for (const name of ['q', 'category', 'sort', 'templates']) url.searchParams.delete(name);
      if (query) url.searchParams.set('q', form.elements.q.value.trim());
      if (category) url.searchParams.set('category', category);
      if (sort !== 'updated') url.searchParams.set('sort', sort);
      if (templates) url.searchParams.set('templates', 'true');
      // Some privacy settings disable history writes; filtering still works.
      try { history.replaceState(null, '', url); } catch { /* no URL persistence */ }
    }
  }
  form.hidden = false;
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => update());
  form.addEventListener('change', () => update());
  form.addEventListener('reset', () => setTimeout(() => update(), 0));
  update(false);
}