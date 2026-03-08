function loadElectronModule() {
  return require("electron");
}

const desktopBridge = Object.freeze({
  isDesktopApp: true
});

function registerPreloadBridge(contextBridge) {
  contextBridge.exposeInMainWorld("zeniusDesktop", desktopBridge);
}

function maybeRegisterPreload({
  versions = process.versions,
  electronFactory = loadElectronModule
} = {}) {
  if (!versions.electron) {
    return false;
  }

  const electron = electronFactory();

  if (!electron || typeof electron !== "object" || !electron.contextBridge) {
    return false;
  }

  registerPreloadBridge(electron.contextBridge);
  return true;
}

maybeRegisterPreload();

module.exports = {
  desktopBridge,
  loadElectronModule,
  registerPreloadBridge,
  maybeRegisterPreload
};
