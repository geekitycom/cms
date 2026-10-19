/* The media library's details dialog (TASK-429).

   Every tile is already a link to its file's details screen, so the library
   is complete before this file loads. This opens that screen in a dialog
   instead: it fetches the page the link names, takes its
   [data-media-details], and shows it over the grid. Previous and Next inside
   the dialog, and the left and right arrow keys, fetch the neighbouring file
   the same way. Anything that goes wrong falls back to following the link.

   Forms inside the dialog post as they would on the details screen, which is
   where their answers land.

   Plain ES5-shaped browser JavaScript, like copy.js: it is served as it is
   written. */
(function () {
  var tiles = document.querySelectorAll('a[data-media-tile]');
  if (!tiles.length || !window.fetch) return;

  var dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-label', 'File details');
  dialog.innerHTML =
    '<div class="modal-box max-w-6xl">' +
    '<form method="dialog" class="mb-2 text-right"><button class="btn btn-sm btn-ghost">Close</button></form>' +
    '<div data-media-dialog-body></div>' +
    '</div>' +
    '<form method="dialog" class="modal-backdrop"><button>Close</button></form>';
  document.body.appendChild(dialog);
  dialog.tabIndex = -1;
  var body = dialog.querySelector('[data-media-dialog-body]');

  Array.prototype.forEach.call(tiles, function (tile) {
    tile.addEventListener('click', function (event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      show(tile.href);
    });
  });

  body.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-media-step], a[data-media-library]');
    if (!link) return;
    event.preventDefault();
    if (link.hasAttribute('data-media-library')) dialog.close();
    else show(link.href);
  });

  dialog.addEventListener('keydown', function (event) {
    if (event.target.closest('input, textarea, select')) return;
    var rel = event.key === 'ArrowLeft' ? 'prev' : event.key === 'ArrowRight' ? 'next' : '';
    if (!rel) return;
    var link = body.querySelector('a[rel="' + rel + '"]');
    if (!link) return;
    event.preventDefault();
    show(link.href);
  });

  function show(url) {
    fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then(function (html) {
        /* A template's content is inert: the other page's nonced <style>
           elements are neither applied nor checked against this page's CSP. */
        var parsed = document.createElement('template');
        parsed.innerHTML = html;
        var details = parsed.content.querySelector('[data-media-details]');
        if (!details) throw new Error('no details');
        body.replaceChildren(document.importNode(details, true));
        body.dispatchEvent(new CustomEvent('geekity:inserted', { bubbles: true }));
        if (!dialog.open) dialog.showModal();
        dialog.focus();
      })
      .catch(function () {
        window.location.href = url;
      });
  }
})();
