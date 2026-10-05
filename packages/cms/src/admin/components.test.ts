import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAdminTemplateEnvironment } from './templates.ts';

const environment = createAdminTemplateEnvironment({ noCache: true });

/** `body` rendered after importing `macros` from `components/<file>.njk`. */
function render(file: string, macros: string, body: string, context = {}): string {
  return environment
    .renderString(`{% from "components/${file}.njk" import ${macros} %}${body}`, context)
    .replaceAll(/>\s+</g, '><')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('button', () => {
  it('is a small button that submits nothing unless told', () => {
    assert.equal(
      render('button', 'button', `{{ button('Save') }}`),
      '<button type="button" class="btn btn-sm">Save</button>',
    );
  });

  it('maps each modifier to its DaisyUI class', () => {
    assert.equal(
      render(
        'button',
        'button',
        `{{ button('Delete', type='submit', color='error', style='outline', size='lg', shape='wide', active=true, name='action', value='delete', formaction='/x', disabled=true) }}`,
      ),
      '<button type="submit" class="btn btn-error btn-outline btn-lg btn-wide btn-active" name="action" value="delete" formaction="/x" disabled>Delete</button>',
    );
  });

  it('escapes its label', () => {
    assert.equal(
      render('button', 'button', `{{ button('<b>') }}`),
      '<button type="button" class="btn btn-sm">&lt;b&gt;</button>',
    );
  });

  it('opens a popover when given one to open', () => {
    assert.equal(
      render('button', 'button', `{{ button('More', popovertarget='more') }}`),
      '<button type="button" class="btn btn-sm" popovertarget="more">More</button>',
    );
  });
});

describe('button, with what the editor asks of it', () => {
  it('carries an id, starts hidden, and posts the form elsewhere in a new tab unchecked', () => {
    assert.equal(
      render(
        'button',
        'button',
        `{{ button('Preview', type='submit', id='p', formaction='/preview', formtarget='_blank', formnovalidate=true, hidden=true) }}`,
      ),
      '<button type="submit" id="p" class="btn btn-sm" formaction="/preview" formtarget="_blank" formnovalidate hidden>Preview</button>',
    );
  });
});

describe('collapse', () => {
  it('is a disclosure with an arrow, closed unless told', () => {
    assert.equal(
      render('collapse', 'collapse', `{% call collapse('Photos') %}<p>x</p>{% endcall %}`),
      '<details class="collapse collapse-arrow border border-base-300 bg-base-100"><summary class="collapse-title font-semibold">Photos</summary><div class="collapse-content"><p>x</p></div></details>',
    );
  });

  it('opens when told, and escapes its title', () => {
    assert.match(
      render('collapse', 'collapse', `{% call collapse('<b>', open=true) %}x{% endcall %}`),
      /^<details class="[^"]*" open><summary class="[^"]*">&lt;b&gt;<\/summary>/,
    );
  });

  it('groups the fields inside it under its title, for a screen reader', () => {
    assert.equal(
      render(
        'collapse',
        'collapse',
        `{% call collapse('Location', fields=true, icon='plus') %}<p>x</p>{% endcall %}`,
      ),
      '<details class="collapse collapse-plus border border-base-300 bg-base-100"><summary class="collapse-title font-semibold">Location</summary><div class="collapse-content"><fieldset class="flex min-w-0 flex-col gap-1"><legend class="sr-only">Location</legend><p>x</p></fieldset></div></details>',
    );
  });
});

describe('buttonLink', () => {
  it('is a link drawn as a button, which still navigates as a link', () => {
    assert.equal(
      render(
        'button',
        'buttonLink',
        `{{ buttonLink('Add new', '/admin/posts/new', color='primary') }}`,
      ),
      '<a class="btn btn-primary btn-sm" href="/admin/posts/new">Add new</a>',
    );
  });
});

describe('alert', () => {
  it('wraps its body in an alert of the colour and style asked for', () => {
    assert.equal(
      render(
        'alert',
        'alert',
        `{% call alert(color='success', style='soft', direction='responsive') %}<span>Saved.</span>{% endcall %}`,
      ),
      '<div role="alert" class="alert alert-success alert-soft alert-vertical sm:alert-horizontal"><span>Saved.</span></div>',
    );
  });

  it('is a plain alert with no modifiers', () => {
    assert.equal(
      render('alert', 'alert', `{% call alert() %}Note{% endcall %}`),
      '<div role="alert" class="alert">Note</div>',
    );
  });

  it('can be named by its heading and take focus when the page loads, with no script', () => {
    assert.equal(
      render(
        'alert',
        'alert',
        `{% call alert(color='error', labelledby='problems', focus=true) %}<h2 id="problems">Nothing was saved.</h2>{% endcall %}`,
      ),
      '<div role="alert" aria-labelledby="problems" tabindex="-1" autofocus class="alert alert-error"><h2 id="problems">Nothing was saved.</h2></div>',
    );
  });

  it('is a polite status instead of an interruption when asked', () => {
    assert.equal(
      render('alert', 'alert', `{% call alert(color='success', polite=true) %}Saved.{% endcall %}`),
      '<div role="status" class="alert alert-success">Saved.</div>',
    );
  });
});

describe('card', () => {
  it('puts its title and its body inside card-body', () => {
    assert.equal(
      render(
        'card',
        'card, cardActions',
        `{% call card(title='Recent posts', size='sm', style='border') %}<p>Body</p>{% call cardActions() %}<a href="/x">All</a>{% endcall %}{% endcall %}`,
      ),
      '<div class="card bg-base-100 shadow-sm card-sm card-border"><div class="card-body"><h2 class="card-title">Recent posts</h2><p>Body</p><div class="card-actions justify-end"><a href="/x">All</a></div></div></div>',
    );
  });

  it('leaves the title out when it is given none', () => {
    assert.equal(
      render('card', 'card', `{% call card() %}<p>Body</p>{% endcall %}`),
      '<div class="card bg-base-100 shadow-sm"><div class="card-body"><p>Body</p></div></div>',
    );
  });
});

describe('stats and stat', () => {
  it('nests stat inside stats, title then value then description', () => {
    assert.equal(
      render(
        'stat',
        'stats, stat',
        `{% call stats(direction='responsive') %}{{ stat('Published posts', 12, desc='Since 2020') }}{{ stat('Drafts', 0) }}{% endcall %}`,
      ),
      '<div class="stats bg-base-100 shadow stats-vertical lg:stats-horizontal"><div class="stat"><div class="stat-title">Published posts</div><div class="stat-value">12</div><div class="stat-desc">Since 2020</div></div><div class="stat"><div class="stat-title">Drafts</div><div class="stat-value">0</div></div></div>',
    );
  });

  it('is one link, named by its title and value, when it leads somewhere', () => {
    assert.equal(
      render(
        'stat',
        'stat',
        `{{ stat('Comments waiting', 3, href='/admin/comments?status=pending') }}`,
      ),
      '<a class="stat hover:bg-base-200" href="/admin/comments?status=pending"><div class="stat-title">Comments waiting</div><div class="stat-value text-primary">3</div></a>',
    );
  });
});

describe('badge', () => {
  it('is a small badge by default', () => {
    assert.equal(
      render('badge', 'badge', `{{ badge('Draft') }}`),
      '<span class="badge badge-outline badge-sm">Draft</span>',
    );
  });

  it('maps colour, style and size', () => {
    assert.equal(
      render('badge', 'badge', `{{ badge('Spam', color='warning', style='soft', size='md') }}`),
      '<span class="badge badge-warning badge-soft badge-md">Spam</span>',
    );
  });
});

describe('status', () => {
  it('draws a state that needs attention in its colour, with its word', () => {
    assert.equal(
      render('badge', 'status', `{{ status('draft', 'Draft') }}`),
      '<span class="badge badge-sm badge-warning">Draft</span>',
    );
    assert.equal(
      render('badge', 'status', `{{ status('failed', '3 failed') }}`),
      '<span class="badge badge-sm badge-error">3 failed</span>',
    );
  });

  it('draws a state that needs nothing as an outlined badge, so it reads on a card too', () => {
    assert.equal(
      render('badge', 'status', `{{ status('published', 'Published') }}`),
      '<span class="badge badge-sm badge-outline">Published</span>',
    );
  });

  it('escapes the word', () => {
    assert.equal(
      render('badge', 'status', `{{ status('published', '<b>') }}`),
      '<span class="badge badge-sm badge-outline">&lt;b&gt;</span>',
    );
  });

  it('refuses a status it does not know, naming the ones it does', () => {
    assert.throws(
      () => render('badge', 'status', `{{ status('drafted', 'Draft') }}`),
      /"drafted" is not one of published, \w+(, \w+)+/,
    );
  });
});

describe('table', () => {
  it('scrolls sideways inside a base-100 surface of its own and opens with its caption', () => {
    assert.equal(
      render(
        'table',
        'table',
        `{% call table('Posts', zebra=true, pinRows=true) %}<thead><tr><th scope="col">Title</th></tr></thead>{% endcall %}`,
      ),
      '<div class="max-w-full overflow-x-auto contain-inline-size rounded-box bg-base-100 p-2 shadow-sm"><table class="table table-sm table-zebra table-pin-rows"><caption class="sr-only">Posts</caption><thead><tr><th scope="col">Title</th></tr></thead></table></div>',
    );
  });

  it('draws no second surface for a table already in a card', () => {
    assert.equal(
      render('table', 'table', `{% call table('Recent posts', inCard=true) %}{% endcall %}`),
      '<div class="max-w-full overflow-x-auto contain-inline-size"><table class="table table-sm"><caption class="sr-only">Recent posts</caption></table></div>',
    );
  });
  it('stacks a row below lg: the first cell with its toggle, every other cell labelled by its heading', () => {
    assert.equal(
      render(
        'table',
        'table, row, heading, cell, rowToggle',
        `{% call table('Posts') %}<thead><tr><th scope="col">Title</th>{{ heading('Date') }}</tr></thead><tbody>{% call row() %}<td>A &amp; B{{ rowToggle(title) }}</td>{% call cell('Date', nowrap=true) %}2026-01-02{% endcall %}{% call cell('<b>') %}x{% endcall %}{% endcall %}</tbody>{% endcall %}`,
        { title: 'A & B' },
      ),
      '<div class="max-w-full overflow-x-auto contain-inline-size rounded-box bg-base-100 p-2 shadow-sm"><table class="table table-sm"><caption class="sr-only">Posts</caption>' +
        '<thead><tr><th scope="col">Title</th><th scope="col" class="max-lg:hidden">Date</th></tr></thead>' +
        '<tbody><tr class="group *:align-top max-lg:relative max-lg:block max-lg:pe-10 max-lg:not-last:border-b max-lg:border-base-content/5 max-lg:*:border-b-0">' +
        '<td>A &amp; B<details class="absolute end-1 top-1 lg:hidden"><summary class="btn btn-ghost btn-sm btn-square"><span class="sr-only">Details of A &amp; B</span><span aria-hidden="true" class="-mt-1 size-2 rotate-45 border-e-2 border-b-2 transition-transform group-has-open:mt-1 group-has-open:rotate-225"></span></summary></details></td>' +
        '<td data-label="Date" class="whitespace-nowrap max-lg:hidden max-lg:gap-2 max-lg:py-1 max-lg:group-has-open:flex max-lg:before:w-24 max-lg:before:shrink-0 max-lg:before:font-semibold max-lg:before:text-base-content/60 max-lg:before:content-[attr(data-label)]">2026-01-02</td>' +
        '<td data-label="&lt;b&gt;" class="max-lg:hidden max-lg:gap-2 max-lg:py-1 max-lg:group-has-open:flex max-lg:before:w-24 max-lg:before:shrink-0 max-lg:before:font-semibold max-lg:before:text-base-content/60 max-lg:before:content-[attr(data-label)]">x</td>' +
        '</tr></tbody></table></div>',
    );
  });
});

describe('tabs', () => {
  it('is a labelled row of links, the current one marked for the eye and the screen reader', () => {
    assert.equal(
      render('tabs', 'tabs', `{{ tabs(items, 'Comment status') }}`, {
        items: [
          { label: 'All', url: '/admin/comments', current: true, count: 3 },
          { label: 'Spam', url: '/admin/comments?status=spam', count: 0 },
        ],
      }),
      '<nav class="tabs tabs-box" aria-label="Comment status"><a class="tab tab-active" href="/admin/comments" aria-current="page">All (3)</a><a class="tab" href="/admin/comments?status=spam">Spam (0)</a></nav>',
    );
  });

  it('takes another style and a size', () => {
    assert.equal(
      render(
        'tabs',
        'tabs',
        `{{ tabs([{ label: 'A', url: '/a' }], 'Which', style='border', size='lg') }}`,
      ),
      '<nav class="tabs tabs-border tabs-lg" aria-label="Which"><a class="tab" href="/a">A</a></nav>',
    );
  });
});

describe('pagination', () => {
  it('joins newer, where you are and older into one group', () => {
    assert.equal(
      render(
        'pagination',
        'pagination',
        `{{ pagination(2, pages=5, previousUrl='/p1', nextUrl='/p3') }}`,
      ),
      '<nav aria-label="Pages"><div class="join"><a class="join-item btn btn-sm" rel="prev" href="/p1">Newer</a><span class="join-item btn btn-sm btn-active" aria-current="page">Page 2 of 5</span><a class="join-item btn btn-sm" rel="next" href="/p3">Older</a></div></nav>',
    );
  });

  it('keeps the end it cannot go to in place, disabled', () => {
    assert.equal(
      render('pagination', 'pagination', `{{ pagination(1, nextUrl='/p2') }}`),
      '<nav aria-label="Pages"><div class="join"><span class="join-item btn btn-sm btn-disabled" aria-disabled="true">Newer</span><span class="join-item btn btn-sm btn-active" aria-current="page">Page 1</span><a class="join-item btn btn-sm" rel="next" href="/p2">Older</a></div></nav>',
    );
  });

  it('draws nothing when there is only one page', () => {
    assert.equal(render('pagination', 'pagination', `{{ pagination(1) }}`), '');
  });
});

describe('menu', () => {
  const RING =
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-base-content';

  it('lists the sections, opening the children of the open one', () => {
    assert.equal(
      render('menu', 'menu', `{{ menu(navigation) }}`, {
        navigation: [
          {
            label: 'Posts',
            url: '/admin/posts',
            open: true,
            children: [
              { label: 'All posts', url: '/admin/posts', current: true },
              { label: 'Add new', url: '/admin/posts/new', current: false },
            ],
          },
          {
            label: 'Pages',
            url: '/admin/pages',
            open: false,
            children: [{ label: 'All pages', url: '/admin/pages', current: false }],
          },
        ],
      }),
      `<ul class="menu w-full"><li><a class="${RING}" href="/admin/posts">Posts</a><ul><li><a class="${RING} menu-active" href="/admin/posts" aria-current="page">All posts</a></li><li><a class="${RING}" href="/admin/posts/new">Add new</a></li></ul></li><li><a class="${RING}" href="/admin/pages">Pages</a></li></ul>`,
    );
  });

  it('lies across the page when asked, at the size asked', () => {
    assert.equal(
      render(
        'menu',
        'menu',
        `{{ menu([{ label: 'Home', url: '/', current: true }], direction='horizontal', size='sm') }}`,
      ),
      `<ul class="menu menu-horizontal menu-sm"><li><a class="${RING} menu-active" href="/" aria-current="page">Home</a></li></ul>`,
    );
  });
});

describe('navbar', () => {
  it('lays its start, centre and end out across the bar', () => {
    assert.equal(
      render(
        'navbar',
        'navbar, navbarStart, navbarCenter, navbarEnd',
        `{% call navbar() %}{% call navbarStart() %}S{% endcall %}{% call navbarCenter() %}C{% endcall %}{% call navbarEnd() %}E{% endcall %}{% endcall %}`,
      ),
      '<div class="navbar bg-base-100 shadow-sm"><div class="navbar-start">S</div><div class="navbar-center">C</div><div class="navbar-end">E</div></div>',
    );
  });
});

describe('dropdown', () => {
  it('is a button that opens its body as a popover, with no inline style for the CSP to refuse', () => {
    assert.equal(
      render(
        'dropdown',
        'dropdown',
        `{% call dropdown('user-menu', 'Andrew', placement='end', style='ghost') %}<p>Body</p>{% endcall %}`,
      ),
      '<button type="button" class="btn btn-ghost btn-sm" popovertarget="user-menu">Andrew</button><div class="dropdown rounded-box bg-base-100 z-1 w-52 shadow-sm dropdown-end" popover id="user-menu"><p>Body</p></div>',
    );
  });
});

describe('every macro', () => {
  const calls: readonly {
    what: string;
    file: string;
    macros: string;
    body: string;
    modifier: string;
  }[] = [
    {
      what: 'button',
      file: 'button',
      macros: 'button',
      body: `{{ button('x'{args}) }}`,
      modifier: 'size',
    },
    {
      what: 'buttonLink',
      file: 'button',
      macros: 'buttonLink',
      body: `{{ buttonLink('x', '/'{args}) }}`,
      modifier: 'size',
    },
    {
      what: 'alert',
      file: 'alert',
      macros: 'alert',
      body: `{% call alert({first}) %}x{% endcall %}`,
      modifier: 'direction',
    },
    {
      what: 'card',
      file: 'card',
      macros: 'card',
      body: `{% call card({first}) %}x{% endcall %}`,
      modifier: 'size',
    },
    {
      what: 'stats',
      file: 'stat',
      macros: 'stats',
      body: `{% call stats({first}) %}x{% endcall %}`,
      modifier: 'direction',
    },
    {
      what: 'badge',
      file: 'badge',
      macros: 'badge',
      body: `{{ badge('x'{args}) }}`,
      modifier: 'size',
    },
    {
      what: 'table',
      file: 'table',
      macros: 'table',
      body: `{% call table('x'{args}) %}{% endcall %}`,
      modifier: 'size',
    },
    {
      what: 'tabs',
      file: 'tabs',
      macros: 'tabs',
      body: `{{ tabs([], 'x'{args}) }}`,
      modifier: 'size',
    },
    { what: 'menu', file: 'menu', macros: 'menu', body: `{{ menu([]{args}) }}`, modifier: 'size' },
    {
      what: 'collapse',
      file: 'collapse',
      macros: 'collapse',
      body: `{% call collapse('x'{args}) %}{% endcall %}`,
      modifier: 'icon',
    },
    {
      what: 'dropdown',
      file: 'dropdown',
      macros: 'dropdown',
      body: `{% call dropdown('d', 'x'{args}) %}{% endcall %}`,
      modifier: 'size',
    },
  ];

  /** One call with `args` spliced in, after a positional argument or alone. */
  function callWith(body: string, args: string): string {
    return body.replace('{args}', `, ${args}`).replace('{first}', args);
  }

  for (const { what, file, macros, body, modifier } of calls) {
    it(`${what} refuses a ${modifier} it does not know, naming the ones it does`, () => {
      assert.throws(
        () => render(file, macros, callWith(body, `${modifier}='huge'`)),
        /"huge" is not one of \w+(, \w+)+/,
      );
    });

    it(`${what} takes no class string from its caller`, () => {
      assert.doesNotMatch(
        render(file, macros, callWith(body, `class='text-red-500'`)),
        /text-red-500/,
      );
    });
  }
});
