/* Redraws a queued or running job's status box until the job ends.

   A box carries the job's name in data-job-status and, while the job is
   active, the page to fetch in data-job-refresh. A box that also names
   data-job-redraw is redrawn from that page only when the job's state
   changes on the data-job-refresh page.

   Plain ES5-shaped browser JavaScript, like copy.js: it is served as it is
   written. */
(function () {
  var EVERY = 3000;
  var AFTER_FAILURE = 15000;
  var ANNOUNCE_PROGRESS_EVERY = 15000;

  var boxes = document.querySelectorAll('[data-job-status][data-job-refresh]');
  if (!boxes.length) return;

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
            swapKeepingFocus(region, replacement);
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

  function swapKeepingFocus(old, replacement) {
    var focused = document.activeElement;
    var inside = old.contains(focused);
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
    if (text === said.text || (!changed && now - said.at < ANNOUNCE_PROGRESS_EVERY)) return;
    said = { text: text, at: now };
    live.textContent = text;
  }
})();
