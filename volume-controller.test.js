const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.requestAnimationFrame = (callback) => callback(100);
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => 0 };

const controller = require("./volume-controller.js");

test("clamps volume to the supported range", () => {
  assert.equal(controller.clampVolume(-0.2), 0);
  assert.equal(controller.clampVolume(0.4), 0.4);
  assert.equal(controller.clampVolume(1.4), 1);
});

test("raise does not lower media that is already above target", () => {
  assert.equal(controller.getTargetForAction({ volume: 0.8 }, 0.5, "raise"), 0.8);
});

test("fade can lower media to the exact target", () => {
  assert.equal(controller.getTargetForAction({ volume: 0.8 }, 0.5, "fade"), 0.5);
});
