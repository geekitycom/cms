import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adminMenu, ADMIN_SECTIONS, UnknownAdminScreenError } from './menu.ts';

describe('the admin menu registry', () => {
  it('reads the way doc-5 lists it', () => {
    assert.deepEqual(
      ADMIN_SECTIONS.map((section) => section.label),
      [
        'Dashboard',
        'Posts',
        'Pages',
        'Media',
        'Comments',
        'Messages',
        'Appearance',
        'Users',
        'Tools',
        'Settings',
        'Federation',
      ],
    );
  });

  it('gives every section at least one child, and the section the first one as its URL', () => {
    for (const section of ADMIN_SECTIONS) {
      assert.ok(section.children.length > 0, `${section.label} has no children`);
      assert.equal(section.url, section.children[0]?.url, `${section.label} lands somewhere else`);
    }
  });

  it('files the terms and the add forms where WordPress files them', () => {
    const posts = ADMIN_SECTIONS.find((section) => section.section === 'posts');

    assert.deepEqual(
      posts?.children.map((child) => [child.label, child.url]),
      [
        ['All posts', '/admin/posts'],
        ['Add new', '/admin/posts/new'],
        ['Categories', '/admin/categories'],
        ['Tags', '/admin/tags'],
      ],
    );
    assert.deepEqual(
      ADMIN_SECTIONS.find((section) => section.section === 'pages')?.children.map(
        (child) => child.url,
      ),
      ['/admin/pages', '/admin/pages/new'],
    );
    assert.deepEqual(
      ADMIN_SECTIONS.find((section) => section.section === 'users')?.children.map(
        (child) => child.url,
      ),
      ['/admin/users', '/admin/users/new'],
    );
  });

  it('names no child twice inside one section', () => {
    for (const section of ADMIN_SECTIONS) {
      const names = section.children.map((child) => child.child);
      assert.equal(new Set(names).size, names.length, `${section.label} repeats a child`);
    }
  });
});

describe('adminMenu', () => {
  it('opens the section a screen names and marks the child it is on', () => {
    const menu = adminMenu({ section: 'posts', child: 'tags' });
    const posts = menu.find((section) => section.section === 'posts');

    assert.deepEqual(
      menu.filter((section) => section.open).map((section) => section.section),
      ['posts'],
      'exactly one section is open',
    );
    assert.deepEqual(
      posts?.children.filter((child) => child.current).map((child) => child.child),
      ['tags'],
      'exactly one child is current',
    );
  });

  it('still lists every section, so the whole menu is one list', () => {
    const menu = adminMenu({ section: 'users', child: 'all' });

    assert.deepEqual(
      menu.map((section) => section.section),
      ADMIN_SECTIONS.map((section) => section.section),
    );
    for (const section of menu) {
      assert.deepEqual(
        section.children.map((child) => child.url),
        ADMIN_SECTIONS.find((entry) => entry.section === section.section)?.children.map(
          (child) => child.url,
        ),
        'a closed section still carries its children',
      );
    }
  });

  it('opens nothing for a screen outside the shell', () => {
    const menu = adminMenu();

    assert.deepEqual(
      menu.filter((section) => section.open),
      [],
    );
    assert.deepEqual(
      menu.flatMap((section) => section.children.filter((child) => child.current)),
      [],
    );
  });

  it('refuses a child the registry has never heard of', () => {
    assert.throws(() => adminMenu({ section: 'posts', child: 'drafts' }), UnknownAdminScreenError);
    assert.throws(() => adminMenu({ section: 'nowhere', child: 'all' }), UnknownAdminScreenError);
    assert.throws(
      // A section with no child named is a screen that forgot half of where it
      // is, which is exactly the mistake this refusal exists to catch.
      () => adminMenu({ section: 'posts' }),
      UnknownAdminScreenError,
    );
  });
});
