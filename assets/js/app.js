/**
 * AulaMap — Arrencada
 * Es carrega l'últim: connecta la delegació d'esdeveniments i pinta la
 * interfície inicial.
 */
(function (A) {
'use strict';

function initApp() {
  A.initTheme();
  A.initActionDelegation();
  A.initCanvasInteractions();
  A.initSeatingDragAndDrop();
  A.initTeamsDragAndDrop();
  A.initSidebarResize();
  A.initKeyboardShortcuts();

  A.el('appVersion').textContent = 'v' + A.APP_VERSION;

  // Tancar el modal fent clic al fons.
  A.el('modalOverlay').addEventListener('click', event => {
    if (event.target.id === 'modalOverlay') A.closeModal();
  });

  // Qualsevol opció del menú de la capçalera el tanca.
  A.el('headerDropdown').addEventListener('click', event => {
    if (event.target.closest('.header-dropdown-item')) A.closeHeaderMenu();
  });

  // Desplaçament horitzontal de la tira d'equips desats amb la roda del ratolí.
  const savedScroll = A.el('savedTeamsScroll');
  savedScroll.addEventListener('wheel', function (event) {
    if (this.scrollWidth <= this.clientWidth) return;
    event.preventDefault();
    this.scrollLeft += event.deltaY;
  }, { passive: false });

  window.addEventListener('resize', A.closeHeaderMenu);

  A.renderAll();
  setTimeout(() => A.zoomReset(), 100);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

})(window.AulaMap);
