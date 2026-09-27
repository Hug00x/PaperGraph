import test from 'node:test';
import assert from 'node:assert/strict';
import { getDrawnZoneBounds, isValidZoneBounds, getZoneForNodePosition, getZonesForNodePosition, getBlendedZoneColor, isPointInsideZone, normalizeZones, getSelectionBounds, findFreeZoneBounds, moveZoneMembers, resizeZone, zonesOverlap } from '../src/lib/graph-zones.ts';
const a = { id: 'a', name: 'Method 1', color: 'green', x: 10, y: 10, width: 20, height: 15 };
const b = { ...a, id: 'b', name: 'Method 2', color: 'violet', x: 40 };
test('center containment, half-open boundaries and a deterministic overlap fallback', () => {
  assert.equal(isPointInsideZone({ x: 10, y: 10 }, a), true);
  assert.equal(isPointInsideZone({ x: 30, y: 20 }, a), false);
  assert.equal(isPointInsideZone({ x: 20, y: 25 }, a), false);
  assert.equal(isPointInsideZone({ x: 9.9, y: 20 }, a), false);
  assert.equal(getZoneForNodePosition({ x: 15, y: 15 }, [b, a])?.id, 'a');
  assert.equal(getZoneForNodePosition({ x: 15, y: 15 }, [{ ...a, id: 'z' }, a])?.id, 'a');
});
test('enter, transfer and leave follow position only; zoom and pan are not inputs', () => {
  const zones = [a, b];
  assert.equal(getZoneForNodePosition({ x: 15, y: 15 }, zones)?.color, 'green');
  assert.equal(getZoneForNodePosition({ x: 45, y: 15 }, zones)?.color, 'violet');
  assert.equal(getZoneForNodePosition({ x: 35, y: 15 }, zones), null);
});
test('overlapping zones share article membership and blend their colors', () => {
  const overlap = { ...b, x: 20, y: 15, width: 20, height: 15 };
  assert.deepEqual(getZonesForNodePosition({ x: 22, y: 16 }, [overlap, a]).map((zone) => zone.id), ['a', 'b']);
  assert.equal(getBlendedZoneColor([a, overlap]), 'rgb(135 202 191)');
});
test('creation bounds enclose selected centers with padding, including world edges', () => {
  const positions = { one: { x: 2, y: 2 }, two: { x: 98, y: 98 } };
  const bounds = getSelectionBounds(['one', 'two'], positions);
  assert.ok(Object.values(positions).every(p => isPointInsideZone(p, bounds)));
  assert.equal(getSelectionBounds([], positions), null);
  const single = getSelectionBounds(['one'], positions);
  assert.ok(single.width >= 8 && single.height >= 6);
});
test('creation from existing zones finds free space and preserves selection layout', () => {
  const bounds = getSelectionBounds(['one', 'two'], { one: { x: 15, y: 15 }, two: { x: 17, y: 17 } });
  const free = findFreeZoneBounds(bounds, [a, b]);
  assert.ok(free && ![a, b].some(z => zonesOverlap(z, free)));
  assert.deepEqual(findFreeZoneBounds(bounds, [b, a]), free);
  assert.equal(findFreeZoneBounds({ x: 0, y: 0, width: 100, height: 100 }, [a]), null);
});
test('moving a zone moves only its members exactly once', () => {
  const positions = { one: { x: 15, y: 15 }, two: { x: 20, y: 20 }, external: { x: 45, y: 15 } };
  const next = moveZoneMembers(a, [a, b], positions, 3, 2);
  assert.deepEqual(next, { one: { x: 18, y: 17 }, two: { x: 23, y: 22 }, external: positions.external });
  assert.deepEqual(positions.one, { x: 15, y: 15 });
});
test('shrink/expand membership and deletion leave article positions intact', () => {
  const point = { x: 25, y: 20 };
  const smaller = { ...a, ...resizeZone(a, 'se', -10, 0) };
  assert.equal(getZoneForNodePosition(point, [smaller]), null);
  const larger = { ...smaller, ...resizeZone(smaller, 'se', 10, 0) };
  assert.equal(getZoneForNodePosition(point, [larger])?.id, 'a');
  assert.equal(getZoneForNodePosition(point, []), null);
  assert.deepEqual(point, { x: 25, y: 20 });
  assert.equal(resizeZone(a, 'nw', 100, 100).width, 8);
});
test('old, malformed and unsafe persisted zones normalize safely', () => {
  assert.deepEqual(normalizeZones(undefined), []);
  assert.deepEqual(normalizeZones([null, { ...a, x: NaN }, { ...a, color: 'url(evil)' }, { ...a, name: ' ' }, { ...a, width: -1 }]), []);
  assert.deepEqual(normalizeZones([a, a]), [a]);
  assert.equal(normalizeZones([{ ...a, name: '  Method 1  ' }])[0].name, 'Method 1');
});
test('JSON round trip preserves geometry and membership exactly', () => {
  const state = { zones: [a, b], positions: { one: { x: 29.99999, y: 20 }, two: { x: 45, y: 15 } } };
  const loaded = JSON.parse(JSON.stringify(state));
  assert.deepEqual(normalizeZones(loaded.zones), state.zones);
  assert.equal(getZoneForNodePosition(loaded.positions.one, loaded.zones)?.id, 'a');
  assert.equal(getZoneForNodePosition(loaded.positions.two, loaded.zones)?.id, 'b');
});

test('drawing works in every drag direction and does not expand small gestures', () => {
  for (const [start,end] of [[{x:10,y:20},{x:30,y:40}],[{x:30,y:40},{x:10,y:20}],[{x:10,y:40},{x:30,y:20}],[{x:30,y:20},{x:10,y:40}]]) {
    assert.deepEqual(getDrawnZoneBounds(start,end), {x:10,y:20,width:20,height:20});
  }
  assert.equal(isValidZoneBounds(getDrawnZoneBounds({x:10,y:20},{x:11,y:21})),false);
  assert.deepEqual(getDrawnZoneBounds({x:-1,y:-2},{x:101,y:110}), {x:0,y:0,width:100,height:100});
});
test('zone notes survive normalization and old zones need no notes field', () => {
  const notes = 'Observations\n<script>plain text</script>';
  assert.equal(normalizeZones([{...a,notes}])[0].notes,notes);
  assert.equal(normalizeZones([a])[0].notes,undefined);
  assert.equal(normalizeZones([{...a,notes:'x'.repeat(21000)}])[0].notes.length,20000);
});
