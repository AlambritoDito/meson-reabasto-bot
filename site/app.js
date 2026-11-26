/* Mejora progresiva de la página: entradas al hacer scroll, secuencia del chat de ejemplo
   y contadores. Sin dependencias. Si este archivo falla o no carga, todo el contenido queda
   visible: las clases que ocultan algo solo se aplican cuando el movimiento está permitido
   y el navegador soporta IntersectionObserver. */
(function () {
  'use strict';
  var raiz = document.documentElement;
  var reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducir || !('IntersectionObserver' in window)) return;
  raiz.classList.add('mov');

  // Red de seguridad: si algo impide la inicialización, se muestra todo.
  var seguro = window.setTimeout(function () { raiz.classList.remove('mov'); }, 4000);

  function contar(el) {
    var fin = parseInt(el.getAttribute('data-contar'), 10);
    if (!(fin > 1)) return;
    var t0 = null, dur = 500;
    function paso(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(fin * (1 - Math.pow(1 - p, 3))));
      if (p < 1) window.requestAnimationFrame(paso);
    }
    el.textContent = '0';
    window.requestAnimationFrame(paso);
  }

  function iniciar() {

    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        el.classList.add('visible');
        if (el.matches('.cifras')) el.querySelectorAll('[data-contar]').forEach(contar);
        obs.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    // Escalonar los elementos hermanos que entran juntos (tarjetas, pasos).
    document.querySelectorAll('.revelar').forEach(function (el) {
      var hermanos = el.parentElement ? el.parentElement.querySelectorAll(':scope > .revelar') : [];
      var i = Array.prototype.indexOf.call(hermanos, el);
      if (i > 0) el.style.setProperty('--retraso', Math.min(i, 5) * 70 + 'ms');
      obs.observe(el);
    });

    // Chat de ejemplo: los mensajes aparecen en orden una sola vez.
    var chat = document.querySelector('[data-secuencia]');
    if (chat) {
      Array.prototype.forEach.call(chat.children, function (m, i) {
        m.style.setProperty('--retraso', 250 + i * 420 + 'ms');
      });
      var obsChat = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) {
          chat.classList.add('visible');
          obsChat.disconnect();
        }
      }, { threshold: 0.2 });
      obsChat.observe(chat);
    }
    window.clearTimeout(seguro);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
