/* The one bit of progressive enhancement doc-5 asks for: the slug follows the
   title until somebody types a slug of their own, and the permalink follows
   the slug on the same terms. Without this the form still works — an empty
   slug is derived from the title on the server.

   It is a file rather than an inline <script> so the admin's
   Content-Security-Policy can say `script-src 'self'` and mean it: no nonce,
   no 'unsafe-inline', and nothing an HTML injection could ever get to run. It
   is loaded with `defer`, so the form is in the document by the time it runs.

   Plain ES5-shaped browser JavaScript, checked by eslint's browser config and
   left alone by the TypeScript build: it is served as it is written. */
(function () {
  var title = document.getElementById('editor-title');
  var slug = document.getElementById('editor-slug');
  var permalink = document.getElementById('editor-permalink');
  if (!title || !slug) return;

  var date = document.getElementById('editor-date');
  var slugFollows = slug.value === '';
  var permalinkFollows = !permalink || permalink.value === '';

  function slugify(value) {
    return value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* The same shape defaultPermalink() writes on the server: a post lives under
     the year and month of its date, a page at the top level. */
  function syncPermalink() {
    if (!permalink || !permalinkFollows) return;
    if (slug.value === '') {
      permalink.value = '';
      return;
    }
    var month = date ? /^(\d{4})-(\d{2})/.exec(date.value) : null;
    var prefix = month ? '/' + month[1] + '/' + month[2] + '/' : '/';
    permalink.value = prefix + slug.value + '/';
  }

  slug.addEventListener('input', function () {
    slugFollows = false;
    syncPermalink();
  });

  if (permalink) {
    permalink.addEventListener('input', function () {
      permalinkFollows = false;
    });
  }

  title.addEventListener('input', function () {
    if (!slugFollows) return;
    slug.value = slugify(title.value);
    syncPermalink();
  });
})();
