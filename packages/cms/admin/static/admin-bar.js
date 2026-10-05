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
  /* Chrome restores focus when a light-DOM popover closes, not one inside a
     shadow root. */
  menu.addEventListener('beforetoggle', function (event) {
    if (event.newState === 'closed' && menu.contains(root.activeElement)) {
      setTimeout(function () {
        root.querySelector('.admin-bar-account').focus();
      });
    }
  });
})();
