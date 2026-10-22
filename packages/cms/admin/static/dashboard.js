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

  Array.prototype.forEach.call(cards(grid), function (card) {
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
      before = arrangement();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.getAttribute('data-dashboard-card'));
      card.classList.add('opacity-50');
    });
    card.addEventListener('dragend', function () {
      card.draggable = false;
      card.classList.remove('opacity-50');
      dragged = null;
      if (arrangement() !== before) save(card);
    });
  });

  grid.addEventListener('dragover', function (event) {
    if (!dragged) return;
    event.preventDefault();
    var column = event.target.closest('[data-dashboard-column]');
    if (!column) return;
    var over = event.target.closest('[data-dashboard-card]');
    if (over === dragged) return;
    if (!over) {
      if (column.lastElementChild !== dragged) column.appendChild(dragged);
      return;
    }
    var box = over.getBoundingClientRect();
    if (event.clientY > box.top + box.height / 2) {
      if (over.nextElementSibling !== dragged) over.after(dragged);
    } else if (over.previousElementSibling !== dragged) {
      over.before(dragged);
    }
  });
  grid.addEventListener('drop', function (event) {
    if (dragged) event.preventDefault();
  });

  function columns() {
    return Array.prototype.slice.call(grid.querySelectorAll('[data-dashboard-column]'));
  }

  function cards(within) {
    return Array.prototype.slice.call(within.querySelectorAll('[data-dashboard-card]'));
  }

  function keys(column) {
    return cards(column).map(function (card) {
      return card.getAttribute('data-dashboard-card');
    });
  }

  function arrangement() {
    return columns()
      .map(function (column) {
        return keys(column).join('\n');
      })
      .join('\n\n');
  }

  function save(card) {
    var form = card.querySelector('form');
    var body = new URLSearchParams();
    body.append('csrf_token', form.elements['csrf_token'].value);
    body.append('action', 'order');
    columns().forEach(function (column) {
      var side = column.getAttribute('data-dashboard-column');
      keys(column).forEach(function (key) {
        body.append(side, key);
      });
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
        var column = card.closest('[data-dashboard-column]');
        var stack = cards(column);
        live.textContent =
          card.querySelector('.card-title').textContent.replace('⠿', '').trim() +
          ' moved to position ' +
          String(stack.indexOf(card) + 1) +
          ' of ' +
          String(stack.length) +
          ' in the ' +
          column.getAttribute('data-dashboard-column') +
          ' column.';
      })
      .catch(function () {
        window.location.reload();
      });
  }

  function moveButtons() {
    columns().forEach(function (column) {
      var side = column.getAttribute('data-dashboard-column');
      var stack = cards(column);
      stack.forEach(function (card, index) {
        card.querySelector('button[value="earlier"]').disabled = index === 0;
        card.querySelector('button[value="later"]').disabled = index === stack.length - 1;
        card.querySelector('button[value="left"]').hidden = side === 'left';
        card.querySelector('button[value="right"]').hidden = side === 'right';
      });
    });
  }
})();
