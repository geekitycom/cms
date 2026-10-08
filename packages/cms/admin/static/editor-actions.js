/* The buttons running plugins put beside the editor's title, description and
   tags (decision-33). Each posts the form as it stands to its plugin's
   endpoint, which answers { ok, value } or { ok: false, message }, and shows
   the suggestion with Accept and Dismiss. Accept fills the field and saves
   nothing; a save is still only the form's own buttons.

   A file rather than an inline script, loaded from the admin's own origin
   like slug.js, so the admin's policy stays `script-src 'self'` and
   `connect-src 'self'`. Plain ES5-shaped browser JavaScript, served as it is
   written. */
(function () {
  function plainForm(form) {
    var fields = new URLSearchParams();
    new FormData(form).forEach(function (value, name) {
      if (typeof value === 'string') fields.append(name, value);
    });
    return fields;
  }

  function tagsOf(value) {
    return value
      .split(',')
      .map(function (tag) {
        return tag.trim();
      })
      .filter(function (tag) {
        return tag !== '';
      });
  }

  /* A tags suggestion adds what the field does not already hold; a title or
     description suggestion replaces the field. */
  function accepted(field, value) {
    if (field.id !== 'editor-tags') return value;
    var held = tagsOf(field.value);
    var known = held.map(function (tag) {
      return tag.toLowerCase();
    });
    tagsOf(value).forEach(function (tag) {
      if (known.indexOf(tag.toLowerCase()) === -1) {
        held.push(tag);
        known.push(tag.toLowerCase());
      }
    });
    return held.join(', ');
  }

  function enhance(block, field) {
    var url = block.getAttribute('data-editor-action');
    var press = block.querySelector('button');
    var status = block.querySelector('[role="status"]');
    var suggestion = block.querySelector('[role="group"]');
    if (!url || !press || !status || !suggestion) return;
    var text = suggestion.querySelector('p');
    var choices = suggestion.querySelectorAll('button');
    var accept = choices[0];
    var dismiss = choices[1];
    var pending = null;
    var offered = '';

    function say(message, failed) {
      status.textContent = message;
      status.classList.toggle('text-error', failed === true);
    }

    function close() {
      suggestion.hidden = true;
      offered = '';
    }

    press.hidden = false;
    press.addEventListener('click', function () {
      if (pending) pending.abort();
      var controller = new AbortController();
      pending = controller;
      close();
      press.disabled = true;
      say('Asking for a suggestion…');

      fetch(url, {
        method: 'POST',
        body: plainForm(field.form),
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
        .then(function (response) {
          var type = response.headers.get('content-type') || '';
          if (type.indexOf('application/json') === -1) {
            throw new Error(
              response.status === 403
                ? 'The site refused the request because this page is out of date. Copy your changes somewhere safe, then reload the page.'
                : response.redirected
                  ? 'You are signed out. Sign in again in another tab, then try again.'
                  : 'The site answered ' + response.status + ' instead of a suggestion.',
            );
          }
          return response.json();
        })
        .then(function (answer) {
          if (answer.ok) {
            offered = String(answer.value);
            text.textContent = offered;
            suggestion.hidden = false;
            say('');
            accept.focus();
            return;
          }
          say(String(answer.message), true);
          if (answer.withdrawn) press.hidden = true;
        })
        .catch(function (error) {
          if (controller.signal.aborted) return;
          say(
            error instanceof TypeError
              ? 'The site could not be reached. Check the connection and try again.'
              : error.message,
            true,
          );
        })
        .then(function () {
          if (pending === controller) pending = null;
          press.disabled = false;
        });
    });

    accept.addEventListener('click', function () {
      field.value = accepted(field, offered);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      close();
      say('');
      field.focus();
    });

    dismiss.addEventListener('click', function () {
      close();
      say('');
      press.focus();
    });
  }

  var groups = document.querySelectorAll('[data-editor-actions]');
  for (var i = 0; i < groups.length; i++) {
    var field = document.getElementById(groups[i].getAttribute('data-editor-actions'));
    if (!field || !field.form) continue;
    var blocks = groups[i].querySelectorAll('[data-editor-action]');
    for (var j = 0; j < blocks.length; j++) enhance(blocks[j], field);
  }
})();
