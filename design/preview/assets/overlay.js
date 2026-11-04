// Navigation layer injected into every page of the clickable design preview. Reads window.BF_PAGE (written by build.mjs).
(() => {
  const P = window.BF_PAGE;
  if (!P) return;
  const KEY = 'bf-preview-collapsed';

  const host = document.createElement('div');
  host.id = 'bf-preview-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) n.append(kid);
    return n;
  };

  const style = el('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Noto Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
    .bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483000;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
      max-width: calc(100vw - 24px); padding: 8px 10px; border-radius: 16px; background: #ffffff; color: #1a1c1e;
      border: 1px solid #c8c5d3; box-shadow: 0 10px 30px rgba(26, 28, 30, 0.22); font-size: 13px; line-height: 1.2; }
    a, button { font: inherit; color: inherit; text-decoration: none; cursor: pointer; }
    .brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #5654ac; padding: 4px 6px; border-radius: 8px; }
    .brand:hover { background: #f1f0fa; }
    .dot { width: 10px; height: 10px; border-radius: 3px; background: #5654ac; display: inline-block; }
    .screen { font-weight: 600; white-space: nowrap; }
    .num { display: inline-block; padding: 2px 6px; margin-right: 4px; border-radius: 6px; background: #e2dfff; color: #322f86; font-size: 12px; font-weight: 700; }
    .mode { margin-left: 6px; font-size: 11px; font-weight: 500; color: #777683; }
    .sep { width: 1px; align-self: stretch; background: #e4e1ef; }
    .states { display: flex; gap: 4px; flex-wrap: wrap; max-width: 520px; }
    .state { padding: 4px 9px; border-radius: 999px; border: 1px solid #c8c5d3; background: #fff; font-size: 12px; white-space: nowrap; }
    .state:hover { border-color: #5654ac; color: #322f86; }
    .state[aria-current="page"] { background: #5654ac; border-color: #5654ac; color: #fff; font-weight: 600; }
    .nav { display: inline-flex; align-items: center; gap: 6px; }
    .btn { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 999px; border: 1px solid #c8c5d3; background: #fff; font-weight: 600; white-space: nowrap; }
    .btn:hover { border-color: #5654ac; color: #322f86; }
    .btn.primary { background: #5654ac; border-color: #5654ac; color: #fff; }
    .btn.primary:hover { background: #322f86; color: #fff; }
    .btn[aria-disabled="true"] { opacity: 0.4; pointer-events: none; }
    .btn[aria-pressed="true"] { background: #e2dfff; border-color: #5654ac; color: #322f86; }
    .step { color: #474551; font-size: 12px; white-space: nowrap; }
    .icon { border: 0; background: transparent; padding: 4px 8px; border-radius: 8px; color: #474551; font-size: 16px; }
    .icon:hover { background: #f1f0fa; }
    .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; padding: 8px 14px; border-radius: 999px; border: 1px solid #c8c5d3;
      background: #5654ac; color: #fff; font-weight: 700; font-size: 13px; box-shadow: 0 8px 24px rgba(26, 28, 30, 0.25); }
    .toast { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 2147483001; display: flex; gap: 12px; align-items: center;
      max-width: calc(100vw - 32px); padding: 10px 14px; border-radius: 12px; background: #2f3033; color: #f1f0f4; font-size: 13px;
      box-shadow: 0 10px 30px rgba(26, 28, 30, 0.3); }
    .toast a { color: #c4c1ff; font-weight: 600; text-decoration: underline; }
    [hidden] { display: none !important; }
  `;

  const toastBox = el('div', { class: 'toast', role: 'status', hidden: true });
  let toastTimer;
  const toast = (text) => {
    toastBox.replaceChildren(el('span', {}, text), el('a', { href: P.index }, 'All screens'));
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastBox.hidden = true), 4000);
  };

  const go = (href) => {
    if (href) location.href = href;
  };
  const toggleLinks = () => {
    const on = document.documentElement.classList.toggle('bf-show-links');
    linksBtn.setAttribute('aria-pressed', String(on));
  };

  const linksBtn = el('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', title: 'Highlight clickable areas (L)', on: { click: toggleLinks } }, 'Show links');
  const states = P.states.map((s) => el('a', { class: 'state', href: s.href, 'aria-current': s.current ? 'page' : null }, s.label));
  const nav = P.step
    ? el(
        'div',
        { class: 'nav' },
        el('a', { class: 'btn', href: P.prev?.href, title: P.prev?.title ?? 'Start of the guided flow', 'aria-disabled': P.prev ? null : 'true' }, '‹ Previous'),
        el('span', { class: 'step' }, `Step ${P.step} of ${P.steps}`),
        el('a', { class: 'btn primary', href: P.next?.href, title: P.next?.title ?? 'End of the guided flow', 'aria-disabled': P.next ? null : 'true' }, 'Next ›'),
      )
    : el('div', { class: 'nav' }, el('span', { class: 'step' }, 'Not in the guided flow'), el('a', { class: 'btn primary', href: P.resume?.href, title: P.resume?.title }, 'Go to the flow ›'));

  const bar = el(
    'div',
    { class: 'bar', role: 'navigation', 'aria-label': 'Design preview navigation' },
    el('a', { class: 'brand', href: P.index, title: 'All screens' }, el('span', { class: 'dot' }), 'Design preview'),
    el('span', { class: 'sep' }),
    el('span', { class: 'screen' }, el('span', { class: 'num' }, P.number), P.title, el('span', { class: 'mode' }, P.mode === 'image' ? 'image + hotspots' : 'HTML')),
    states.length > 1 ? el('div', { class: 'states', role: 'group', 'aria-label': 'States' }, states) : null,
    el('span', { class: 'sep' }),
    nav,
    linksBtn,
    el('a', { class: 'btn', href: P.index }, 'All screens'),
    el('button', { class: 'icon', type: 'button', title: 'Hide this bar (Esc)', 'aria-label': 'Hide navigation bar', on: { click: () => setCollapsed(true) } }, '▾'),
  );
  const pill = el('button', { class: 'pill', type: 'button', title: 'Show the design preview bar', on: { click: () => setCollapsed(false) } }, 'Design preview ▴');
  const setCollapsed = (c) => {
    bar.hidden = c;
    pill.hidden = !c;
    try {
      sessionStorage.setItem(KEY, c ? '1' : '');
    } catch {
      /* storage can be unavailable */
    }
  };

  shadow.append(style, bar, pill, toastBox);
  document.body.append(host);
  let collapsed = false;
  try {
    collapsed = sessionStorage.getItem(KEY) === '1';
  } catch {
    /* storage can be unavailable */
  }
  setCollapsed(collapsed);

  document.addEventListener(
    'click',
    (e) => {
      if (e.composedPath().includes(host)) return;
      const target = e.target instanceof Element ? e.target.closest('[data-bf-to], [data-bf-href], [data-bf-missing]') : null;
      if (!target) {
        const canvas = document.querySelector('.bf-canvas');
        if (canvas && canvas.contains(e.target)) {
          canvas.classList.remove('bf-flash');
          void canvas.offsetWidth;
          canvas.classList.add('bf-flash');
          setTimeout(() => canvas.classList.remove('bf-flash'), 900);
        }
        return;
      }
      const href = target.getAttribute('data-bf-href') ?? (target.tagName === 'A' ? target.getAttribute('href') : null);
      if (href) {
        e.preventDefault();
        e.stopPropagation();
        go(href);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toast(`"${(target.getAttribute('data-bf-missing') || 'This control').slice(0, 60)}" is not designed yet.`);
    },
    true,
  );
  document.addEventListener('submit', (e) => e.preventDefault(), true);
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if (e.key === 'ArrowRight' && P.next) go(P.next.href);
    else if (e.key === 'ArrowLeft' && P.prev) go(P.prev.href);
    else if (e.key === 'l' || e.key === 'L') toggleLinks();
    else if (e.key === 'Escape') setCollapsed(!bar.hidden);
  });
})();
