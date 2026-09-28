import test from "node:test";
import assert from "node:assert/strict";
import { graphPreview, parseGraphLiveMessage, graphActivityLabel } from "../src/lib/graph-live.ts";

const message = { clientId: "peer", userName: "Ana", sequence: 2, phase: "active", activity: {
  target: { kind: "article", id: "A" }, action: "move", positions: { A: { x: 20, y: 30 } },
} };
test("live messages reject invalid coordinates, unrelated article targets and malformed payloads", () => {
  assert.deepEqual(parseGraphLiveMessage(message), message);
  for (const input of [null, {}, { ...message, sequence: -1 }, { ...message, userName: 12 },
    { ...message, activity: { ...message.activity, positions: { A: { x: Infinity, y: 1 } } } },
    { ...message, activity: { ...message.activity, positions: { B: { x: 1, y: 2 } } } },
    { ...message, activity: { ...message.activity, positions: { A: { x: 101, y: 2 } } } }]) {
    assert.equal(parseGraphLiveMessage(input), null);
  }
  assert.ok(parseGraphLiveMessage({ ...message, phase: "cancel", activity: null }));
  assert.equal(graphActivityLabel(message, false), "Ana · a mover");
});
test("remote previews never mutate durable positions, resurrect deleted nodes or replace group notes", () => {
  const positions = { A: { x: 10, y: 10 } };
  const zones = [{ id: "z", name: "Group", notes: "Local notes", color: "green", x: 10, y: 10, width: 20, height: 20 }];
  const peers = [{ ...message, receivedAt: 1 }, { ...message, activity: {
    target: { kind: "zone", id: "z" }, action: "move", zone: { ...zones[0], x: 30, notes: "Untrusted preview" },
    positions: { missing: { x: 20, y: 20 } },
  }, receivedAt: 2 }];
  const displayed = graphPreview(positions, zones, peers);
  assert.deepEqual(displayed.positions.A, { x: 20, y: 30 });
  assert.equal(displayed.zones[0].x, 30);
  assert.equal(displayed.zones[0].notes, "Local notes");
  assert.equal(displayed.positions.missing, undefined);
  assert.deepEqual(positions.A, { x: 10, y: 10 });
  assert.equal(zones[0].x, 10);
});
