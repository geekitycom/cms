/*
 * Draws the hCaptcha widget a public form carries, in the page's colour mode
 * and language.
 *
 * The shell loads this, deferred, only on a page whose forms carry the
 * challenge. It finds every `div.h-captcha` with a site key, and only then
 * loads hCaptcha's script from the URL in its own `data-script`, asking for
 * explicit rendering so each widget is drawn here with the right theme.
 *
 * hCaptcha's widget is light or dark. The site's mode is `data-mode` on
 * `<html>`: `light` and `dark` are what they say, and anything else, or a
 * theme with no modes, follows the visitor's `prefers-color-scheme`. The
 * language is `<html lang>`.
 */
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
