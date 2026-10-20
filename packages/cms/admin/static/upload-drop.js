/* Uploads in place: an Upload button and a drop target wherever the admin
   asks for a file (TASK-439).

   components/upload.njk renders each control `hidden`, so a page with no
   script is the same page it was. This reveals them, posts each chosen or
   dropped file to the control's data-upload-url, the JSON endpoint the
   editor's body uses, and hands what came back to its kind's handler in
   KINDS. A refused file says why in the control's status line and changes
   nothing else on the page.

   Plain ES5-shaped browser JavaScript, like media.js: it is served as it is
   written. */
(function () {
  var controls = document.querySelectorAll('[data-upload-drop]');
  if (!controls.length || !window.fetch || !window.FormData) return;

  var DRAGGING = ['outline-2', 'outline-offset-4', 'outline-dashed', 'outline-primary'];

  var KINDS = {
    photos: { landed: addTile },
    field: { landed: fillField },
    select: { landed: chooseOption },
    library: { landed: function () {}, finished: reload },
  };

  Array.prototype.forEach.call(controls, enhance);

  /* A file dropped just beside a target would otherwise replace the page
     with the file, and take an unsaved post with it. */
  document.addEventListener('dragover', function (event) {
    if (!carriesFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('drop', function (event) {
    if (carriesFiles(event)) event.preventDefault();
  });

  function enhance(control) {
    var kind = KINDS[control.getAttribute('data-upload-drop')];
    var target = document.getElementById(control.getAttribute('data-upload-target'));
    if (!kind || !target) return;

    var input = control.querySelector('[data-upload-input]');
    var zone = target.closest('.fieldset') || target;
    var depth = 0;
    control.hidden = false;

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files);
      input.value = '';
      send(control, kind, target, files);
    });

    zone.addEventListener('dragenter', function (event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(zone, true);
    });
    zone.addEventListener('dragover', function (event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(zone, false);
    });
    zone.addEventListener('drop', function (event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(zone, false);
      var files = Array.prototype.slice.call(event.dataTransfer.files);
      send(control, kind, target, input.multiple ? files : files.slice(0, 1));
    });
  }

  function carriesFiles(event) {
    var types = event.dataTransfer ? event.dataTransfer.types : [];
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function setDragging(zone, on) {
    DRAGGING.forEach(function (name) {
      zone.classList.toggle(name, on);
    });
  }

  function send(control, kind, target, files) {
    var landed = 0;
    var refusals = [];
    var queue = files.slice();

    function next() {
      var file = queue.shift();
      if (!file) return Promise.resolve();
      say(control, 'Uploading ' + file.name + '…', false);
      return upload(control, file)
        .then(function (result) {
          kind.landed(control, target, result, file);
          landed += 1;
        })
        .catch(function (error) {
          refusals.push(error.message);
        })
        .then(next);
    }

    return next().then(function () {
      if (refusals.length) {
        say(control, refusals.join(' '), true);
      } else {
        say(control, landed === 1 ? 'Uploaded.' : 'Uploaded ' + landed + ' files.', false);
      }
      if (landed && kind.finished) kind.finished(control, refusals.length);
    });
  }

  function upload(control, file) {
    var payload = new FormData();
    var token = document.querySelector('input[name="csrf_token"]');
    payload.set('csrf_token', token ? token.value : '');
    payload.set('file', file);
    if (control.hasAttribute('data-upload-images')) payload.set('images', '1');

    return fetch(control.getAttribute('data-upload-url'), {
      method: 'POST',
      body: payload,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .catch(function () {
        throw new Error(file.name + ' could not be uploaded.');
      })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (result) {
            if (!response.ok || typeof result.url !== 'string') {
              throw new Error(
                result.error || file.name + ' was refused (' + response.status + ').',
              );
            }
            return result;
          });
      });
  }

  function say(control, message, error) {
    var status = control.querySelector('[data-upload-status]');
    status.textContent = message;
    status.classList.toggle('text-error', error);
  }

  function addTile(control, grid, result, file) {
    var template = document.querySelector('template[data-upload-tile="' + grid.id + '"]');
    var tile = template.content.firstElementChild.cloneNode(true);
    var box = tile.querySelector('input');
    var picture = tile.querySelector('img');
    box.name = control.getAttribute('data-upload-name') + freeIndex(control, grid);
    box.value = result.url;
    box.checked = true;
    picture.src = result.url;
    picture.alt = file.name;
    grid.insertBefore(tile, grid.firstChild);
    Array.prototype.forEach.call(
      grid.parentElement.querySelectorAll('[data-upload-reveal]'),
      function (shown) {
        shown.hidden = false;
      },
    );
    Array.prototype.forEach.call(
      grid.parentElement.querySelectorAll('[data-upload-empty]'),
      function (gone) {
        gone.hidden = true;
      },
    );
  }

  function freeIndex(control, grid) {
    var prefix = control.getAttribute('data-upload-name');
    var highest = -1;
    Array.prototype.forEach.call(grid.closest('form').elements, function (element) {
      if (element.name && element.name.indexOf(prefix) === 0) {
        var index = Number(element.name.slice(prefix.length));
        if (index > highest) highest = index;
      }
    });
    return highest + 1;
  }

  function fillField(control, box, result) {
    box.value = result.url;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    var preview = document.getElementById(control.getAttribute('data-upload-preview'));
    if (preview) {
      preview.src = result.url;
      preview.hidden = false;
    }
  }

  function chooseOption(control, menu, result, file) {
    var option = document.createElement('option');
    option.value = result.url;
    option.textContent = file.name;
    menu.appendChild(option);
    menu.value = result.url;
    menu.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function reload(control, refused) {
    if (!refused) {
      window.location.reload();
      return;
    }
    var status = control.querySelector('[data-upload-status]');
    status.textContent += ' Reload the page to see the files that did upload.';
  }
})();
