// Runs inside each design frame of the clickable design preview: routes clicks on linked controls to the top window
// and hands notices and keyboard shortcuts to the shell page (overlay.js).
(() => {
  const shell = window.parent !== window ? window.parent : null;
  const open = (href) => {
    (shell ?? window).location.href = new URL(href, location.href).href;
  };
  const notify = (text) => (shell && typeof shell.bfToast === 'function' ? shell.bfToast(text) : console.info(text));

  document.addEventListener(
    'click',
    (e) => {
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
      e.preventDefault();
      e.stopPropagation();
      if (href) open(href);
      else notify(`"${(target.getAttribute('data-bf-missing') || 'This control').slice(0, 60)}" is not designed yet.`);
    },
    true,
  );
  document.addEventListener('submit', (e) => e.preventDefault(), true);
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if (shell && typeof shell.bfKey === 'function' && shell.bfKey(e.key)) e.preventDefault();
  });
})();
