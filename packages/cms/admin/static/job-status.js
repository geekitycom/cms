/* Redraws a queued or running job's status box until the job ends (TASK-438).

   The box from components/job-status.njk, and the media library's sweep
   notice, carry the job's name in data-job-status and, while the job is
   active, the page that shows it in data-job-refresh. Every few seconds this
   fetches that page, finds the element with the same data-job-status in it,
   and swaps in its closest [data-job-region] (or the box itself). It stops
   once the new box names no page to fetch, and removes the old one when the
   page no longer shows it. While the tab is hidden it fetches nothing, and it
   looks again as soon as the tab is shown.

   A box whose own page is costly to draw also names it in data-job-redraw,
   and data-job-refresh names a cheaper page that shows the same job: that
   one is polled, and the box is redrawn from its own page only when the
   job's state changes there. The media library's notice polls Tools >
   Maintenance this way.

   Without this file, or when a fetch fails, the box's Check again link does
   the same by hand.

   Plain ES5-shaped browser JavaScript, like copy.js: it is served as it is
   written. */
(function () {
  var EVERY = 3000;
  var AFTER_FAILURE = 15000;
  /* Progress is read out no more often than this; a change of state at once. */
  var ANNOUNCE_EVERY = 15000;

  var boxes = document.querySelectorAll('[data-job-status][data-job-refresh]');
  if (!boxes.length || !window.fetch) return;

  /* Made before any update, so screen readers are watching it when the
     first one arrives. */
  var live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  document.body.appendChild(live);
  var said = { text: '', at: 0 };

  Array.prototype.forEach.call(boxes, watch);

  function watch(box) {
    var selector = '[data-job-status="' + CSS.escape(box.getAttribute('data-job-status')) + '"]';
    var region = regionOf(box);
    var drawn = region.outerHTML;
    var waiting = false;
    checkAgain(region, false);
    later(EVERY);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !waiting) return;
      waiting = false;
      poll();
    });

    function later(delay) {
      setTimeout(function () {
        if (document.hidden) waiting = true;
        else poll();
      }, delay);
    }

    function poll() {
      var redraw = box.getAttribute('data-job-redraw');
      var polled;
      find(box.getAttribute('data-job-refresh'))
        .then(function (found) {
          polled = found;
          if (!redraw) return polled;
          if (
            polled &&
            polled.getAttribute('data-job-state') === box.getAttribute('data-job-state')
          ) {
            return box;
          }
          return find(redraw);
        })
        .then(function (next) {
          if (!next) {
            drop(region);
            if (polled) announce(polled, true);
            return;
          }
          var nextRegion = regionOf(next);
          if (next !== box && nextRegion.outerHTML !== drawn) {
            drawn = nextRegion.outerHTML;
            var changed =
              next.getAttribute('data-job-state') !== box.getAttribute('data-job-state');
            var replacement = document.importNode(nextRegion, true);
            swap(region, replacement);
            region = replacement;
            box = region.matches(selector) ? region : region.querySelector(selector);
            announce(box, changed);
          }
          if (!box.hasAttribute('data-job-refresh')) return;
          checkAgain(region, false);
          later(EVERY);
        })
        .catch(function () {
          checkAgain(region, true);
          later(AFTER_FAILURE);
        });
    }

    function find(url) {
      return fetch(url, { credentials: 'same-origin' })
        .then(function (response) {
          if (!response.ok || response.redirected) throw new Error(String(response.status));
          return response.text();
        })
        .then(function (html) {
          /* A template's content is inert: the other page's nonced <style>
             elements are neither applied nor checked against this page's CSP. */
          var parsed = document.createElement('template');
          parsed.innerHTML = html;
          return parsed.content.querySelector(selector);
        });
    }
  }

  function regionOf(box) {
    return box.closest('[data-job-region]') || box;
  }

  function checkAgain(region, shown) {
    Array.prototype.forEach.call(
      region.querySelectorAll('[data-job-check-again]'),
      function (link) {
        link.hidden = !shown;
      },
    );
  }

  /* Whoever was on a link or button in the old box stays on the same one in
     the new box, or on the box when that one is gone. */
  function swap(old, replacement) {
    var focused = document.activeElement;
    var inside = focused && focused !== document.body && old.contains(focused);
    old.replaceWith(replacement);
    if (!inside) return;
    var same = Array.prototype.filter.call(
      replacement.querySelectorAll(focused.tagName),
      function (candidate) {
        return candidate.textContent.trim() === focused.textContent.trim();
      },
    )[0];
    if (!same) {
      replacement.tabIndex = -1;
      same = replacement;
    }
    same.focus({ preventScroll: true });
  }

  function drop(region) {
    var inside = region.contains(document.activeElement);
    region.remove();
    if (!inside) return;
    var main = document.getElementById('main');
    main.tabIndex = -1;
    main.focus({ preventScroll: true });
  }

  function announce(box, changed) {
    var message = box.querySelector('[data-job-message]');
    var text =
      box.getAttribute('data-job-label') +
      '.' +
      (message ? ' ' + message.textContent.replace(/\s+/g, ' ').trim() : '');
    var now = Date.now();
    if (text === said.text || (!changed && now - said.at < ANNOUNCE_EVERY)) return;
    said = { text: text, at: now };
    live.textContent = text;
  }
})();
