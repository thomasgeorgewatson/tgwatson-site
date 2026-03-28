(function() {
  'use strict';

  var THEME_KEY = 'tgw-theme';
  var html = document.documentElement;
  var stored = localStorage.getItem(THEME_KEY);

  if (stored === 'study' ||
      (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.setAttribute('data-theme', 'study');
  }

  document.addEventListener('DOMContentLoaded', function() {

    // --- Theme Toggle ---
    var toggle = document.querySelector('.theme-toggle');
    if (toggle) {
      updateToggleLabel(toggle);
      toggle.addEventListener('click', function() {
        var isStudy = html.getAttribute('data-theme') === 'study';
        if (isStudy) {
          html.removeAttribute('data-theme');
          localStorage.setItem(THEME_KEY, 'field');
        } else {
          html.setAttribute('data-theme', 'study');
          localStorage.setItem(THEME_KEY, 'study');
        }
        updateToggleLabel(toggle);
      });
    }

    // --- Scroll Reveals ---
    var reveals = document.querySelectorAll('.reveal');
    if (reveals.length && 'IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

      reveals.forEach(function(el) { observer.observe(el); });
    } else {
      reveals.forEach(function(el) { el.classList.add('revealed'); });
    }

    // --- Page Transitions ---
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('mailto:') ||
          link.target === '_blank') return;

      e.preventDefault();
      document.body.classList.add('page-exit');
      setTimeout(function() { window.location.href = href; }, 200);
    });
  });

  function updateToggleLabel(btn) {
    var isStudy = html.getAttribute('data-theme') === 'study';
    btn.textContent = isStudy ? 'The Field' : 'The Study';
  }
})();
