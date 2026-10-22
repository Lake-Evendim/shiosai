const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const captions = {overall:'Between the tides',garden:'Light in the courtyard',coastalGarden:'A garden by the sea',interior:'A room with a landscape',readingInterior:'A moment for reading',pagoda:'Above the treetops'};
let engineReady = false, starting = false, revealToken = 0, priorFocus;

function setProgress(value, message) {
  document.body.style.setProperty('--p', value / 100);
  $('progress').setAttribute('aria-valuenow', value);
  $('percent').textContent = value + '%';
  $('load-message').textContent = message;
}
window.shiosaiStage = async (message, step) => {
  setProgress(step * 25, message);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
async function enterIsland() {
  if (starting) return;
  if (engineReady) {await reveal();return;}
  starting = true;
  $('enter').disabled = true;
  $('enter').textContent = '风景加载中';
  $('entry-note').textContent = '六处风景正在准备，请稍候。';
  document.body.classList.add('running');
  window.shiosaiInitialView = 'overall';
  try {
    await window.shiosaiStage('准备这座岛的风景', 0);
    await import('./scene-engine.js');
  } catch (error) {
    starting = false;
    document.body.classList.remove('running');
    $('error').hidden = false;
    $('error').textContent = '加载中断，请刷新页面重试。';
    $('load-message').textContent = '加载中断';
    $('enter').disabled = false;
    $('enter').textContent = '刷新重试';
    $('enter').onclick = () => location.reload();
    console.error(error);
  }
}
$('enter').onclick = enterIsland;
window.addEventListener('shiosai:ready', async () => {
  engineReady = true; starting = false;
  setProgress(100, '风景已就绪');
  document.body.classList.remove('running');
  describeView('overall');
  await reveal();
});
async function reveal() {
  const token = ++revealToken;
  document.body.dataset.state = 'ready';
  $('boot').inert = true; $('exhibition').inert = false;
  document.body.classList.add('revealing');
  await new Promise(resolve => setTimeout(resolve, reducedMotion ? 20 : 900));
  if (token !== revealToken) return;
  $('boot').hidden = true;
  document.body.classList.remove('revealing');
  $('enter').disabled = false;
  document.querySelector('[data-scene-view="overall"]').focus({preventScroll:true});
}
function returnHome() {
  revealToken++;
  closeOverlays();
  document.body.classList.remove('revealing','focus');
  document.body.dataset.state = 'arrival';
  $('boot').hidden = false; $('boot').inert = false;
  $('exhibition').inert = true;
  $('exit-focus').hidden = true; $('focus').setAttribute('aria-pressed','false');
  $('enter').textContent = '走进这座岛';
  $('entry-note').textContent = '留一段时间，看看风景。';
  setProgress(100, '风景已就绪');
  $('enter').focus({preventScroll:true});
}
$('home').onclick = returnHome;
function describeView(id) {
  if (!captions[id]) return;
  document.body.dataset.view = id;
  document.querySelectorAll('[data-scene-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sceneView === id)));
  $('world-caption').textContent = captions[id];
  const name = document.querySelector(`[data-scene-view="${id}"]`).textContent;
  $('scene').setAttribute('aria-label',`${name}三维场景，可拖动旋转、滚轮缩放、轻触水面`);
}
document.querySelectorAll('[data-scene-view]').forEach(button => button.onclick = () => {
  if (!engineReady) return;
  window.dispatchEvent(new CustomEvent('shiosai:view', {detail:button.dataset.sceneView}));
  describeView(button.dataset.sceneView);
});
window.addEventListener('shiosai:selected', event => describeView(event.detail));
function setFocus(value) {
  closeOverlays();
  document.body.classList.toggle('focus', value);
  $('focus').setAttribute('aria-pressed', String(value));
  $('exit-focus').hidden = !value;
  (value ? $('exit-focus') : $('focus')).focus({preventScroll:true});
}
$('focus').onclick = () => setFocus(true);
$('exit-focus').onclick = () => setFocus(false);
function syncOverlay() {
  const open = $('settings').classList.contains('open') || !$('about').hidden;
  $('scrim').hidden = !open;
  $('exhibition').inert = open || document.body.dataset.state !== 'ready';
}
window.shiosaiPanelChanged = open => {
  if (open) priorFocus = $('tune');
  syncOverlay();
  if (open) $('close-panel').focus({preventScroll:true});
};
window.shiosaiAboutChanged = open => {
  if (open) priorFocus = $('made');
  syncOverlay();
  if (open) $('close-about').focus({preventScroll:true});
};
function closeOverlays() {
  const wasOpen = !$('scrim').hidden;
  $('settings').classList.remove('open'); $('settings').inert = true;
  $('tune').setAttribute('aria-expanded','false');
  $('about').hidden = true; $('made').setAttribute('aria-expanded','false');
  syncOverlay();
  if (wasOpen) priorFocus?.focus({preventScroll:true});
}
$('scrim').onclick = closeOverlays;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeOverlays();
    if (document.body.classList.contains('focus')) setFocus(false);
  }
  const dialog = $('settings').classList.contains('open') ? $('settings') : !$('about').hidden ? $('about') : null;
  if (event.key === 'Tab' && dialog) {
    const controls = [...dialog.querySelectorAll('button,input,select')].filter(element => !element.disabled);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  }
});
document.querySelectorAll('[data-time]').forEach(button => button.onclick = () => {
  $('time').value = button.dataset.time;
  $('time').dispatchEvent(new Event('input'));
});
$('time').addEventListener('input', () => document.querySelectorAll('[data-time]').forEach(button => button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.time) - Number($('time').value)) < .005))));
