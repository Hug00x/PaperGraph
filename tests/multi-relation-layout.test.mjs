import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMultiEdgeLayout } from '../src/lib/multi-relation-layout.ts';

const positions = {
  a: { x: 100, y: 100 },
  b: { x: 500, y: 100 },
  c: { x: 100, y: 300 },
  d: { x: 500, y: 300 },
};

function entry(id, relationType, fromArticleId = 'a', toArticleId = 'b') {
  return { relation: { id, relationType, fromArticleId, toArticleId }, fromPosition: positions[fromArticleId], toPosition: positions[toArticleId] };
}

test('collapses single and multi-edge groups without selection', () => {
  const layout = computeMultiEdgeLayout([entry('citation', 'citation'), entry('manual', 'manual')], null);
  assert.equal(layout.get('citation').expanded, false);
  assert.equal(layout.get('citation').laneOffset, -0.6);
  assert.equal(layout.get('manual').laneOffset, 0.6);
});

test('fans out a selected four-relation group in stable relation order', () => {
  const layout = computeMultiEdgeLayout([
    entry('wikilink', 'explicit'),
    entry('manual', 'manual'),
    entry('semantic', 'semantic'),
    entry('citation', 'citation'),
  ], 'b');
  assert.deepEqual([...layout].map(([id, value]) => [id, value.laneIndex]), [
    ['citation', 0], ['semantic', 1], ['manual', 2], ['wikilink', 3],
  ]);
  assert.deepEqual([...layout.values()].map((value) => value.laneOffset), [-24, -8, 8, 24]);
  assert.ok([...layout.values()].every((value) => value.expanded));
});

test('centers three lanes around the direct path', () => {
  const layout = computeMultiEdgeLayout([
    entry('citation', 'citation'),
    entry('semantic', 'semantic'),
    entry('manual', 'manual'),
  ], 'a');
  assert.deepEqual([...layout.values()].map((value) => value.laneOffset), [-18, 0, 18]);
});

test('keeps opposite directions in one stable visual bundle', () => {
  const layout = computeMultiEdgeLayout([
    entry('forward', 'citation', 'a', 'b'),
    entry('reverse', 'citation', 'b', 'a'),
  ], 'a');
  assert.equal(layout.get('forward').laneOffset, -9);
  assert.equal(layout.get('reverse').laneOffset, 9);
});

test('only groups incident to the selected node expand', () => {
  const layout = computeMultiEdgeLayout([
    entry('ab-citation', 'citation'),
    entry('ab-manual', 'manual'),
    entry('cd-citation', 'citation', 'c', 'd'),
    entry('cd-manual', 'manual', 'c', 'd'),
  ], 'a');
  assert.equal(layout.get('ab-citation').expanded, true);
  assert.equal(layout.get('cd-citation').expanded, false);
});

test('filtered relation groups are recalculated from visible entries', () => {
  const layout = computeMultiEdgeLayout([entry('citation', 'citation')], 'a');
  assert.equal(layout.get('citation').laneCount, 1);
  assert.equal(layout.get('citation').laneOffset, 0);
});
