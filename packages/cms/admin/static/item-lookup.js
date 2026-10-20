/* Look up on the review form (TASK-434). With no script the button posts the
   form to the editor, which draws it again with the empty boxes filled. This
   posts the same form to the lookup endpoint instead, which answers
   { ok, message, fields, thumbnail }, and fills each box it names that is
   still empty, so nothing typed while the lookup ran is lost. The sentence
   goes in the status line beside the button.

   A file rather than an inline script, so the admin's policy stays
   `script-src 'self'` and `connect-src 'self'`. Plain ES5-shaped browser
   JavaScript, served as it is written. */
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

  function say(message, failed) {
    status.textContent = message;
    status.classList.toggle('text-error', failed === true);
    status.classList.toggle('text-base-content', failed !== true);
  }

  press.addEventListener('click', function (event) {
    event.preventDefault();
    press.disabled = true;
    say('Looking it up…');

    fetch(url, {
      method: 'POST',
      body: plainForm(),
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        var type = response.headers.get('content-type') || '';
        if (type.indexOf('application/json') === -1) {
          throw new Error(
            response.status === 403
              ? 'The site refused the request because this page is out of date. Copy your changes somewhere safe, then reload the page.'
              : response.redirected
                ? 'You are signed out. Sign in again in another tab, then try again.'
                : 'The site answered ' + response.status + ' instead of a lookup.',
          );
        }
        return response.json();
      })
      .then(function (answer) {
        var fields = answer.fields || {};
        Object.keys(fields).forEach(function (name) {
          var box = form.elements.namedItem(name);
          if (box && box.value === '') box.value = String(fields[name]);
        });
        var preview = document.getElementById('editor-item-photo-preview');
        if (preview && answer.thumbnail && fields['item-photo']) {
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
  });
})();
