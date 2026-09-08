/**
 * AulaMap — Arrencada
 * Es carrega l'últim: connecta els esdeveniments i pinta la interfície inicial.
 */
'use strict';

function initApp() {
  initCanvasInteractions();
  initSidebarResize();
  initKeyboardShortcuts();

  // Desplaçament horitzontal de la tira d'equips desats amb la roda del ratolí.
  const savedScroll = el('savedTeamsScroll');
  savedScroll.addEventListener('wheel', function (event) {
    if (this.scrollWidth <= this.clientWidth) return;
    event.preventDefault();
    this.scrollLeft += event.deltaY;
  }, { passive: false });

  window.addEventListener('resize', closeHeaderMenu);

  renderAll();
  setTimeout(() => zoomReset(), 100);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();
