const assert = require("node:assert/strict");
const test = require("node:test");

const {
  desktopBridge,
  loadElectronModule,
  maybeRegisterPreload,
  registerPreloadBridge
} = require("../src/preload.js");

test("registerPreloadBridge exposes a frozen desktop flag bridge", () => {
  const calls = [];

  registerPreloadBridge({
    exposeInMainWorld(name, value) {
      calls.push([name, value]);
    }
  });

  assert.deepEqual(calls, [
    [
      "zeniusDesktop",
      desktopBridge
    ]
  ]);
  assert.equal(Object.isFrozen(desktopBridge), true);
});

test("maybeRegisterPreload returns false outside Electron", () => {
  let loadedElectron = false;

  const result = maybeRegisterPreload({
    versions: {},
    electronFactory() {
      loadedElectron = true;
      return null;
    }
  });

  assert.equal(result, false);
  assert.equal(loadedElectron, false);
});

test("maybeRegisterPreload returns false when Electron does not expose contextBridge", () => {
  const result = maybeRegisterPreload({
    versions: { electron: "40.0.0" },
    electronFactory() {
      return "not-an-electron-object";
    }
  });

  assert.equal(result, false);
});

test("maybeRegisterPreload tolerates the plain Node electron module shape", () => {
  assert.equal(typeof loadElectronModule(), "string");
  assert.equal(maybeRegisterPreload({ versions: { electron: "40.0.0" } }), false);
});

test("maybeRegisterPreload registers the bridge inside Electron", () => {
  const calls = [];

  const result = maybeRegisterPreload({
    versions: { electron: "40.0.0" },
    electronFactory() {
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            calls.push([name, value]);
          }
        }
      };
    }
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    [
      "zeniusDesktop",
      desktopBridge
    ]
  ]);
});
