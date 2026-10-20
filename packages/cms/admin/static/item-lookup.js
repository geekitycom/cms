(function () {
  var press = document.querySelector('button[data-item-lookup]');
  var status = document.getElementById('editor-item-lookup-status');
  if (!press || !status || !press.form) return;
  var form = press.form;
  var url = press.getAttribute('data-item-lookup');

  function plainForm() {
    var fields = new URLSearchParams();
    new FormData(form).forEach(function (value, name) {
      if (typeof value === 'string') fields.append(name, value);
    });
    return fields;
  }

  function tell(line, message, failed) {
    line.textContent = message;
    line.classList.toggle('text-error', failed === true);
    line.classList.toggle('text-base-content', failed !== true);
  }

  function say(message, failed) {
    tell(status, message, failed);
  }

  function answerOf(response) {
    var type = response.headers.get('content-type') || '';
    if (type.indexOf('application/json') === -1) {
      throw new Error(
        response.status === 403
          ? 'The site refused the request because this page is out of date. Copy your changes somewhere safe, then reload the page.'
          : response.redirected
            ? 'You are signed out. Sign in again in another tab, then try again.'
            : 'The site answered ' + response.status + ' instead of JSON.',
      );
    }
    return response.json();
  }

  function lookUp(pick) {
    var fields = plainForm();
    if (pick) fields.set('item-pick', pick);
    press.disabled = true;
    say('Looking it up…');

    return fetch(url, {
      method: 'POST',
      body: fields,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(answerOf)
      .then(function (answer) {
        var filled = answer.fields || {};
        Object.keys(filled).forEach(function (name) {
          var box = form.elements.namedItem(name);
          if (box && box.value === '') box.value = String(filled[name]);
        });
        var preview = document.getElementById('editor-item-photo-preview');
        if (preview && answer.thumbnail && filled['item-photo']) {
          preview.src = answer.thumbnail;
          preview.hidden = false;
        }
        say(String(answer.message || ''), !answer.ok);
      })
      .catch(function (error) {
        say(error.message || 'The lookup failed.', true);
      })
      .then(function () {
        press.disabled = false;
      });
  }

  press.addEventListener('click', function (event) {
    event.preventDefault();
    lookUp('');
  });

  var find = document.getElementById('editor-item-find');
  var query = document.getElementById('editor-item-find-query');
  var search = document.getElementById('editor-item-find-button');
  var said = document.getElementById('editor-item-find-status');
  var list = document.getElementById('editor-item-find-matches');
  var credit = document.getElementById('editor-item-find-credit');
  var shape = document.getElementById('editor-item-find-match');
  if (!find || !query || !search || !said || !list || !credit || !shape) return;
  find.hidden = false;
  var searching = false;

  function chosenKind() {
    var ticked = form.querySelector('input[name="item-kind"]:checked');
    return ticked ? ticked.value : '';
  }

  function clear() {
    Array.prototype.slice.call(list.querySelectorAll('li[data-match]')).forEach(function (row) {
      row.remove();
    });
    credit.hidden = true;
    list.hidden = true;
  }

  function show(matches) {
    clear();
    matches.forEach(function (match) {
      var row = shape.content.firstElementChild.cloneNode(true);
      row.setAttribute('data-match', '');
      var picture = row.querySelector('img');
      if (match.thumbnail) {
        picture.src = match.thumbnail;
        picture.hidden = false;
        row.querySelector('[data-no-picture]').hidden = true;
      }
      row.querySelector('[data-name]').textContent = match.name;
      row.querySelector('[data-detail]').textContent = match.detail;
      row.querySelector('[data-source]').textContent = match.source;
      row.querySelector('button').addEventListener('click', function () {
        clear();
        tell(said, '');
        lookUp(match.id);
      });
      list.insertBefore(row, credit);
    });
  }

  function run() {
    if (searching) return;
    searching = true;
    search.disabled = true;
    tell(said, 'Searching…');
    var address =
      find.getAttribute('data-item-search') +
      '?' +
      new URLSearchParams({ kind: chosenKind(), q: query.value }).toString();

    fetch(address, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(answerOf)
      .then(function (answer) {
        var matches = answer.matches || [];
        show(matches);
        if (answer.credit) {
          credit.textContent = answer.credit;
          credit.hidden = false;
        }
        list.hidden = !answer.ok;
        tell(
          said,
          answer.ok
            ? matches.length === 0
              ? 'Nothing matches “' + query.value.trim() + '”.'
              : matches.length === 1
                ? 'One match. Pick it to fill in the item.'
                : matches.length + ' matches. Pick one to fill in the item.'
            : String(answer.message || ''),
          !answer.ok,
        );
      })
      .catch(function (error) {
        clear();
        tell(said, error.message || 'The search failed.', true);
      })
      .then(function () {
        searching = false;
        search.disabled = false;
      });
  }

  search.addEventListener('click', run);
  query.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    run();
  });
  form.addEventListener('change', function (event) {
    if (event.target.name !== 'item-kind') return;
    clear();
    tell(said, '');
  });
})();
