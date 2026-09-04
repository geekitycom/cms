/* The media screen's copy buttons, and nothing else.

   Every URL and every ready-made Markdown line is already a readonly text
   input, which selects and copies like any other text, so the screen is
   complete before this file loads. The buttons are rendered `hidden` and
   revealed here: a button that did nothing without JavaScript would be worse
   than no button.

   It is a file rather than an inline <script> for the same reason slug.js is:
   the admin's Content-Security-Policy says `script-src 'self'` and means it.

   Plain ES5-shaped browser JavaScript, checked by eslint's browser config and
   left alone by the TypeScript build: it is served as it is written. */
(function () {
  /* The clipboard API is the whole point of the button. Without it — an
     insecure origin, an old browser — the fields stay as they are and no
     button appears. */
  if (!navigator.clipboard) return;

  var buttons = document.querySelectorAll('.admin-copy-button');
  if (!buttons.length) return;

  Array.prototype.forEach.call(buttons, function (button) {
    var field = document.getElementById(button.getAttribute('data-copy'));
    if (!field) return;

    button.hidden = false;
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(field.value).then(
        function () {
          said(button, 'Copied');
        },
        function () {
          /* Refused, usually because the document was not focused. Selecting
             the text is then the useful thing to do: the keyboard shortcut
             everybody already knows takes it from there. */
          field.select();
          said(button, 'Press ⌘C');
        },
      );
    });
  });

  /* Say something on the button for a moment, then put its label back. */
  function said(button, message) {
    if (button.dataset.label === undefined) button.dataset.label = button.textContent;
    button.textContent = message;
    window.setTimeout(function () {
      button.textContent = button.dataset.label;
    }, 1500);
  }
})();
