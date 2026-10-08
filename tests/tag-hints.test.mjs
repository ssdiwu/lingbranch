import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedTagPeers, directNeighborhood } from '../shared/relationship-layout.mjs';

test('tag hints expose exact shared labels without duplicating persisted edges or changing records', () => {
  const notes = [
    {id:'root', tags:['UI','工具','UI'], x:12, y:34},
    {id:'peer', tags:['工具','UI','UI'], x:56, y:78},
    {id:'connected', tags:['UI']},
    {id:'other-case', tags:['ui']},
    {id:'body-only', tags:[], body:'UI 工具'},
  ];
  const links = [{fromId:'connected', toId:'root'}];
  const before = structuredClone({notes, links});
  for (const note of notes) { Object.freeze(note.tags); Object.freeze(note); }
  Object.freeze(notes); Object.freeze(links[0]); Object.freeze(links);
  assert.deepEqual(sharedTagPeers('root', notes, links), [
    {fromId:'root', toId:'peer', tags:['UI','工具']},
  ]);
  assert.deepEqual(sharedTagPeers('root', notes, links, 'UI'), [
    {fromId:'root', toId:'peer', tags:['UI']},
  ]);
  assert.deepEqual(sharedTagPeers('root', notes, links, 'ui'), []);
  assert.deepEqual([...directNeighborhood('root', links, notes.map(note => note.id))].sort(), ['connected','root']);
  assert.deepEqual({notes, links}, before);
});

test('hints stay around the selected visible node rather than connecting every member of a broad tag', () => {
  const notes = Array.from({length:1000}, (_, i) => ({id:String(i), tags:['工具']}));
  const links = [{fromId:'0', toId:'23'}];
  const hints = sharedTagPeers('0', notes, links);
  assert.equal(hints.length, 998);
  assert.ok(hints.every(hint => hint.fromId === '0' && hint.toId !== '0' && hint.toId !== '23'));
  assert.equal(new Set(hints.map(hint => hint.toId)).size, hints.length);
  const visible = [notes[2], notes[0], notes[23], notes[5]];
  assert.deepEqual(sharedTagPeers('0', visible, links).map(hint => hint.toId), ['2','5']);
  assert.deepEqual(sharedTagPeers('0', [notes[2], notes[5]], links), []);
  assert.deepEqual(sharedTagPeers(null, notes, links), []);
  assert.equal(links.length, 1);
});
