/* The editor's Use my location button, and nothing else.

   The Location boxes are typed by hand and work without this file. The
   button is rendered `hidden` and revealed here only where the browser has
   the Geolocation API, and it fills Coordinates and Accuracy in the shape the
   server reads back: "latitude, longitude" and whole metres. It does not turn
   the position into a place name: that would mean sending it to a geocoding
   service somebody else runs (TASK-254).

   It is a file rather than an inline <script> for the same reason slug.js is:
   the admin's Content-Security-Policy says `script-src 'self'` and means it.

   Plain ES5-shaped browser JavaScript, checked by eslint's browser config and
   left alone by the TypeScript build: it is served as it is written. */
(function () {
  if (!navigator.geolocation) return;

  var button = document.getElementById('editor-location-here');
  var status = document.getElementById('editor-location-status');
  var geo = document.getElementById('editor-location-geo');
  var accuracy = document.getElementById('editor-location-accuracy');
  if (!button || !status || !geo || !accuracy) return;

  var problems = {
    1: 'The browser was not allowed to share its location. Type the coordinates instead, or allow location for this site and try again.',
    2: 'The browser could not find its location. Type the coordinates instead.',
    3: 'The browser took too long to find its location. Try again, or type the coordinates instead.',
  };

  button.hidden = false;
  button.addEventListener('click', function () {
    button.disabled = true;
    status.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      function (position) {
        var coords = position.coords;
        geo.value = coords.latitude.toFixed(5) + ', ' + coords.longitude.toFixed(5);
        accuracy.value = String(Math.round(coords.accuracy));
        var block = button.closest('details');
        if (block) block.open = true;
        status.textContent =
          'Filled in from the browser, to within about ' + accuracy.value + ' metres.';
        button.disabled = false;
      },
      function (error) {
        status.textContent = problems[error.code] || problems[2];
        button.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  });
})();
