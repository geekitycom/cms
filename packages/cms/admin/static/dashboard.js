(function () {
  var grid = document.querySelector('[data-dashboard-cards]');
  if (!grid) return;
  var url = grid.getAttribute('data-layout-url');

  var live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  document.body.appendChild(live);

  var dragged = null;
  var before = '';

  Array.prototype.forEach.call(cards(), function (card) {
    var title = card.querySelector('.card-title');
    var handle = document.createElement('span');
    handle.className = 'cursor-grab select-none text-base-content/60';
    handle.setAttribute('aria-hidden', 'true');
    handle.setAttribute('title', 'Drag to move');
    handle.textContent = '⠿';
    title.insertBefore(handle, title.firstChild);

    /* Only the handle starts a drag, so text in the card still selects. */
    handle.addEventListener('pointerdown', function () {
      card.draggable = true;
    });
    card.addEventListener('dragstart', function (event) {
      dragged = card;
      before = order().join('\n');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.getAttribute('data-dashboard-card'));
      card.classList.add('opacity-50');
    });
    card.addEventListener('dragend', function () {
      card.draggable = false;
      card.classList.remove('opacity-50');
      dragged = null;
      if (order().join('\n') !== before) save(card);
    });
  });

  grid.addEventListener('dragover', function (event) {
    if (!dragged) return;
    event.preventDefault();
    var over = event.target.closest('[data-dashboard-card]');
    if (!over || over === dragged) return;
    var past = isPastDiagonal(over.getBoundingClientRect(), event);
    if (past && over.nextElementSibling !== dragged) over.after(dragged);
    else if (!past && over.previousElementSibling !== dragged) over.before(dragged);
  });
  grid.addEventListener('drop', function (event) {
    if (dragged) event.preventDefault();
  });

  function isPastDiagonal(box, event) {
    return (event.clientX - box.left) / box.width + (event.clientY - box.top) / box.height > 1;
  }

  function cards() {
    return Array.prototype.slice.call(grid.querySelectorAll('[data-dashboard-card]'));
  }

  function order() {
    return cards().map(function (card) {
      return card.getAttribute('data-dashboard-card');
    });
  }

  function save(card) {
    var form = card.querySelector('form');
    var body = new URLSearchParams();
    body.append('csrf_token', form.elements['csrf_token'].value);
    body.append('action', 'order');
    order().forEach(function (key) {
      body.append('order', key);
    });
    fetch(url, {
      method: 'POST',
      body: body,
      credentials: 'same-origin',
      redirect: 'manual',
    })
      .then(function (response) {
        if (response.type !== 'opaqueredirect' && !response.ok) {
          throw new Error(String(response.status));
        }
        moveButtons();
        var all = cards();
        live.textContent =
          card.querySelector('.card-title').textContent.replace('⠿', '').trim() +
          ' moved to position ' +
          String(all.indexOf(card) + 1) +
          ' of ' +
          String(all.length) +
          '.';
      })
      .catch(function () {
        window.location.reload();
      });
  }

  function moveButtons() {
    var all = cards();
    all.forEach(function (card, index) {
      card.querySelector('button[value="earlier"]').disabled = index === 0;
      card.querySelector('button[value="later"]').disabled = index === all.length - 1;
    });
  }
})();
