(function () {
  var widgets = document.querySelectorAll('.h-captcha[data-sitekey]');
  var source = document.currentScript && document.currentScript.dataset.script;
  if (widgets.length === 0 || !source) return;

  var root = document.documentElement;
  var mode = root.dataset.mode;
  var dark =
    mode === 'dark' ||
    (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  window.geekityDrawChallenge = function () {
    for (var index = 0; index < widgets.length; index += 1) {
      var widget = widgets[index];
      window.hcaptcha.render(widget, {
        sitekey: widget.dataset.sitekey,
        theme: dark ? 'dark' : 'light',
      });
    }
  };

  var url = new URL(source);
  url.searchParams.set('render', 'explicit');
  url.searchParams.set('onload', 'geekityDrawChallenge');
  if (root.lang) url.searchParams.set('hl', root.lang);

  var script = document.createElement('script');
  script.src = url.href;
  script.async = true;
  document.head.append(script);
})();
