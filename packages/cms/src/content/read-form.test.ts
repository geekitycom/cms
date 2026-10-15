import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  readCite,
  readOfForm,
  readOfFromMicropub,
  resolveRead,
  submittedReadOfForm,
} from './read-form.ts';

const BASE = 'https://site.example';

describe('the read form’s cover (TASK-394)', () => {
  it('reads the cover and its alt text off the submitted form and back into it', () => {
    const form = submittedReadOfForm({
      'read-status': 'finished',
      'read-of-name': 'Dune',
      'read-of-photo': ' /uploads/a.jpg ',
      'read-of-photo-alt': ' A cover ',
    });
    assert.equal(form.photo, '/uploads/a.jpg');
    assert.equal(form.photoAlt, 'A cover');
    assert.deepEqual(
      readOfForm({ name: 'Dune', photo: { url: '/uploads/a.jpg', alt: 'A cover' } }),
      { name: 'Dune', author: '', uid: '', url: '', photo: '/uploads/a.jpg', photoAlt: 'A cover' },
    );
  });

  it('keeps a cover that is an upload or a web address, and drops one emptied', () => {
    const blank = { name: 'Dune', author: '', uid: '', url: '', photo: '', photoAlt: '' };
    assert.deepEqual(
      resolveRead('finished', { ...blank, photo: '/uploads/a.jpg', photoAlt: 'Sand' }),
      {
        read: {
          status: 'finished',
          of: {
            name: 'Dune',
            author: undefined,
            uid: undefined,
            url: undefined,
            photo: { url: '/uploads/a.jpg', alt: 'Sand' },
          },
        },
      },
    );
    const removed = resolveRead('finished', { ...blank, photoAlt: 'Left behind' });
    assert.ok('read' in removed);
    assert.equal(removed.read?.of.photo, undefined);
  });

  it('refuses a cover that is neither an upload nor a web address', () => {
    const blank = { name: 'Dune', author: '', uid: '', url: '', photo: '', photoAlt: '' };
    const refused = resolveRead('finished', { ...blank, photo: 'dune.jpg' });
    assert.ok('error' in refused);
    assert.equal(refused.field, 'editor-read-of-photo');
  });

  it('refuses a cover with no title, as any read without one', () => {
    const refused = resolveRead('', {
      name: '',
      author: '',
      uid: '',
      url: '',
      photo: '/uploads/a.jpg',
      photoAlt: '',
    });
    assert.ok('error' in refused);
    assert.equal(refused.field, 'editor-read-of-name');
  });

  it('takes the cover on Micropub as an h-cite photo, an address or a value with alt', () => {
    const refusals: string[] = [];
    const refuse = (message: string): void => {
      refusals.push(message);
    };
    const withAlt = readOfFromMicropub(
      [
        {
          type: ['h-cite'],
          properties: {
            name: ['Dune'],
            photo: [{ value: `${BASE}/uploads/a.jpg`, alt: 'Sand' }],
          },
        },
      ],
      refuse,
      BASE,
    );
    assert.equal(withAlt.photo, '/uploads/a.jpg');
    assert.equal(withAlt.photoAlt, 'Sand');
    const bare = readOfFromMicropub(
      [
        {
          type: ['h-cite'],
          properties: { name: ['Dune'], photo: ['https://covers.example/d.jpg'] },
        },
      ],
      refuse,
      BASE,
    );
    assert.equal(bare.photo, 'https://covers.example/d.jpg');
    assert.deepEqual(refusals, []);
    readOfFromMicropub(
      [{ type: ['h-cite'], properties: { name: ['Dune'], photo: ['nope'] } }],
      refuse,
      BASE,
    );
    assert.equal(refusals.length, 1);
  });

  it('gives the cover back on the h-cite, absolute, with its alt text', () => {
    assert.deepEqual(
      readCite(
        { name: 'Dune', author: 'Frank Herbert', photo: { url: '/uploads/a.jpg', alt: 'Sand' } },
        BASE,
      ),
      {
        type: ['h-cite'],
        properties: {
          name: ['Dune'],
          author: ['Frank Herbert'],
          photo: [{ value: `${BASE}/uploads/a.jpg`, alt: 'Sand' }],
        },
      },
    );
    assert.deepEqual(
      readCite({ name: 'Dune', photo: { url: '/uploads/a.jpg' } }, BASE).properties,
      {
        name: ['Dune'],
        photo: [`${BASE}/uploads/a.jpg`],
      },
    );
  });
});
