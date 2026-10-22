(() => {
  const byId = id => document.getElementById(id);
  const more = byId('more-controls'), menu = byId('view-menu');
  const picker = byId('scene-picker'), sheet = byId('scene-sheet');
  const exhibition = byId('exhibition'), scrim = byId('scrim');
  const seasonSelect = byId('season-select');
  const visibleControls = root => [...root.querySelectorAll('button,input,select,summary')].filter(el => !el.disabled && el.getClientRects().length);
  const sceneButton = id => document.querySelector(`.dock-scenes [data-scene-view="${id}"]`);

  function closeMenu(returnFocus = false) {
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (returnFocus) more.focus({preventScroll:true});
  }
  function closeSheet(returnFocus = true) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    picker.setAttribute('aria-expanded', 'false');
    const otherDialog = byId('settings').classList.contains('open') || !byId('about').hidden;
    scrim.hidden = !otherDialog;
    exhibition.inert = otherDialog || document.body.dataset.state !== 'ready';
    if (returnFocus) picker.focus({preventScroll:true});
  }
  function syncScenes() {
    const id = document.body.dataset.view;
    byId('current-scene').textContent = sceneButton(id)?.textContent || '全岛';
    document.querySelectorAll('[data-pick-scene]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pickScene === id)));
  }
  function syncSeasons() {
    const value = seasonSelect.value;
    const [season, clock] = byId('readout').textContent.split(/\s*·\s*/);
    if (season && byId('rail-season').textContent !== season) byId('rail-season').textContent = season;
    if (clock && byId('rail-time').textContent !== clock) byId('rail-time').textContent = clock;
    document.querySelectorAll('[data-season]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.season === value)));
    const names = ['春日','夏日','秋日','冬日'];
    const flowers = ['紫藤初开','绣球盛放','枝叶染色','雪落山茶'];
    const time = Number(byId('time').value);
    const light = time < .24 ? '午前' : time < .65 ? '午后' : time < .94 ? '黄昏' : '夜晚';
    byId('environment-summary').textContent = `${names[value]}${light} · ${flowers[value]}`;
  }
  more.onclick = () => {
    const open = menu.hidden;
    closeSheet(false);
    menu.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    if (open) visibleControls(menu)[0]?.focus({preventScroll:true});
  };
  menu.addEventListener('click', event => {
    if (event.target.closest('button')) closeMenu(false);
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !more.contains(event.target)) closeMenu(false);
  });
  picker.onclick = () => {
    closeMenu(false);
    closeOverlays();
    sheet.hidden = false;
    picker.setAttribute('aria-expanded', 'true');
    scrim.hidden = false;
    exhibition.inert = true;
    syncScenes();
    byId('close-scenes').focus({preventScroll:true});
  };
  byId('close-scenes').onclick = () => closeSheet();
  scrim.addEventListener('click', () => {closeSheet();closeMenu(false)});
  document.querySelectorAll('[data-pick-scene]').forEach(button => button.onclick = () => {
    const id = button.dataset.pickScene;
    closeSheet(false);
    sceneButton(id)?.click();
    syncScenes();
    picker.focus({preventScroll:true});
  });
  document.querySelectorAll('[data-season]').forEach(button => button.onclick = () => {
    seasonSelect.value = button.dataset.season;
    seasonSelect.dispatchEvent(new Event('change', {bubbles:true}));
    syncSeasons();
  });
  seasonSelect.addEventListener('change', syncSeasons);
  document.querySelector('.dock-scenes').addEventListener('click', () => {closeMenu(false);syncScenes()});
  new MutationObserver(syncScenes).observe(document.body, {attributes:true,attributeFilter:['data-view']});
  new MutationObserver(syncSeasons).observe(byId('readout'), {childList:true,subtree:true});
  new MutationObserver(() => {
    if (byId('boot').hidden && getComputedStyle(picker).display !== 'none') picker.focus({preventScroll:true});
  }).observe(byId('boot'), {attributes:true,attributeFilter:['hidden']});
  byId('home').addEventListener('click', () => {closeMenu(false);closeSheet(false)}, true);
  byId('tune').addEventListener('click', () => closeMenu(false), true);
  byId('tune').addEventListener('click', () => requestAnimationFrame(() => {
    if (byId('settings').classList.contains('open')) byId('close-panel').focus({preventScroll:true});
  }));
  byId('settings').addEventListener('transitionend', event => {
    const panel = byId('settings');
    if (event.target === panel && panel.classList.contains('open') && !panel.contains(document.activeElement)) {
      byId('close-panel').focus({preventScroll:true});
    }
  });
  byId('close-about').addEventListener('click', () => requestAnimationFrame(() => more.focus({preventScroll:true})));
  byId('exit-focus').addEventListener('click', () => requestAnimationFrame(() => more.focus({preventScroll:true})));

  // Keep keyboard focus inside the visible layer; collapsed controls are skipped.
  document.addEventListener('keydown', event => {
    if (event.target.closest('.dock-scenes') && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();
      const items = visibleControls(document.querySelector('.dock-scenes'));
      const current = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus({preventScroll:true});return;
    }
    if (event.key === 'Escape' && document.body.classList.contains('focus')) {
      event.preventDefault();event.stopImmediatePropagation();byId('exit-focus').click();return;
    }
    if (!menu.hidden) {
      const items = visibleControls(menu), current = items.indexOf(document.activeElement);
      if (event.key === 'Escape') {event.preventDefault();event.stopImmediatePropagation();closeMenu(true);return}
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();event.stopImmediatePropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();return;
      }
      if (event.key === 'Tab') {closeMenu(true);return}
    }
    const dialog = !sheet.hidden ? sheet : byId('settings').classList.contains('open') ? byId('settings') : !byId('about').hidden ? byId('about') : null;
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();event.stopImmediatePropagation();
      if (dialog === sheet) closeSheet();else if (dialog === byId('about')) byId('close-about').click();else byId('close-panel').click();
      return;
    }
    if (event.key === 'Tab') {
      const controls = visibleControls(dialog), first = controls[0], last = controls.at(-1);
      event.stopImmediatePropagation();
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus()}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus()}
    }
  }, true);
  window.addEventListener('resize', () => {
    if (getComputedStyle(picker).display === 'none' && !sheet.hidden) {
      closeSheet(false);sceneButton(document.body.dataset.view)?.focus({preventScroll:true});
    }
    if (getComputedStyle(picker).display !== 'none' && document.activeElement?.closest('.dock-scenes')) picker.focus({preventScroll:true});
    if (!more.getClientRects().length) closeMenu(false);
  });
  window.addEventListener('shiosai:ready', () => {
    // Reset the current camera only; environment settings remain the visitor's choice.
    byId('reset').onclick = () => {
      const id = document.body.dataset.view || 'overall';
      window.dispatchEvent(new CustomEvent('shiosai:view', {detail:id}));
      closeMenu(true);
    };
    syncScenes();syncSeasons();
  });
  syncScenes();syncSeasons();
})();
