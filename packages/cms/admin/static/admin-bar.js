/* The admin bar's script, on admin screens and on the public site alike
   (decision-30). A file rather than an inline <script> because the admin's
   Content-Security-Policy says `script-src 'self'`.

   It does two things. It measures the bar and sets that height on <html> as
   --geekity-admin-bar-height, which is what pushes the page down, so a bar
   that wraps to two lines on a phone, or one a theme has hidden, takes the
   room it really takes. And it gives focus back to the greeting when the
   account menu closes with focus inside it: Chrome does that for a popover in
   the light DOM, not from inside a shadow root, where the focus is simply
   lost. A click elsewhere has already moved focus by then, and keeps it.

   Plain ES5-shaped browser JavaScript, served as it is written. */
(function () {
  var host = document.querySelector('geekity-admin-bar');
  var root = host && host.shadowRoot;
  if (!root) return;

  new ResizeObserver(function () {
    var height = host.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--geekity-admin-bar-height', height + 'px');
  }).observe(host);

  var menu = root.getElementById('admin-account-menu');
  if (!menu) return;
  menu.addEventListener('beforetoggle', function (event) {
    if (event.newState === 'closed' && menu.contains(root.activeElement)) {
      setTimeout(function () {
        root.querySelector('.admin-bar-account').focus();
      });
    }
  });
})();
