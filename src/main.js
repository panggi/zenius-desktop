const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const APP_TITLE = "Zenius";
const LINUX_APP_ID = "zenius-desktop";
const LINUX_DESKTOP_FILE_NAME = `${LINUX_APP_ID}.desktop`;
const APP_URL = "https://www.zenius.net/";
const TRUSTED_IN_APP_HOST_SUFFIXES = Object.freeze(["zenius.net", "zenius.com"]);
const TRUSTED_IN_APP_HOSTS = Object.freeze(["app.zencore.id"]);
const TRUSTED_AUTH_HOSTS = Object.freeze(["accounts.google.com"]);
const ALLOWED_EXTERNAL_PROTOCOLS = Object.freeze(["https:", "mailto:", "tel:"]);
const TRUSTED_PERMISSION_TYPES = Object.freeze(["fullscreen"]);

function loadElectronModule() {
  return require("electron");
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isTrustedInAppHost(hostname) {
  const normalizedHostname = String(hostname || "").toLowerCase();

  if (!normalizedHostname) {
    return false;
  }

  if (TRUSTED_IN_APP_HOSTS.includes(normalizedHostname)) {
    return true;
  }

  return TRUSTED_IN_APP_HOST_SUFFIXES.some(
    (suffix) =>
      normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`)
  );
}

function isTrustedInAppUrl(url) {
  const parsedUrl = parseUrl(url);

  return Boolean(
    parsedUrl &&
      parsedUrl.protocol === "https:" &&
      isTrustedInAppHost(parsedUrl.hostname)
  );
}

function isTrustedAuthUrl(url) {
  const parsedUrl = parseUrl(url);

  return Boolean(
    parsedUrl &&
      parsedUrl.protocol === "https:" &&
      TRUSTED_AUTH_HOSTS.includes(parsedUrl.hostname.toLowerCase())
  );
}

function isInAppPopupUrl(url) {
  return url === "about:blank" || isTrustedInAppUrl(url) || isTrustedAuthUrl(url);
}

function isAllowedNavigationUrl(url) {
  return isTrustedInAppUrl(url) || isTrustedAuthUrl(url);
}

function canOpenExternally(url) {
  const parsedUrl = parseUrl(url);

  return Boolean(
    parsedUrl && ALLOWED_EXTERNAL_PROTOCOLS.includes(parsedUrl.protocol)
  );
}

function isAllowedPermission(permission, requestingUrl) {
  return (
    TRUSTED_PERMISSION_TYPES.includes(permission) &&
    isTrustedInAppUrl(requestingUrl)
  );
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function createDefaultDeps({
  electronFactory = loadElectronModule,
  fsModule = fs,
  osModule = os,
  pathModule = path,
  spawnSyncFn = spawnSync,
  processObject = process,
  consoleObject = console,
  baseDir = __dirname
} = {}) {
  const electronModule = electronFactory();
  const electron =
    electronModule && typeof electronModule === "object" ? electronModule : {};

  return {
    ...electron,
    fs: fsModule,
    path: pathModule,
    spawnSync: spawnSyncFn,
    platform: processObject.platform,
    processEnv: processObject.env,
    processArgs: Array.isArray(processObject.argv) ? processObject.argv : [],
    execPath: processObject.execPath,
    homeDir: osModule.homedir(),
    console: consoleObject,
    baseDir
  };
}

function createMainProcess({
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  session,
  shell,
  fs: fsModule,
  path: pathModule,
  spawnSync: spawnSyncFn,
  platform,
  processEnv,
  processArgs,
  execPath,
  homeDir,
  console: consoleObject,
  baseDir
}) {
  const appPngIcon = pathModule.join(baseDir, "..", "assets", "icon.png");
  const appWindowIcon = pathModule.join(
    baseDir,
    "..",
    "assets",
    platform === "win32" ? "icon.ico" : "icon.png"
  );
  const appNativeIcon =
    platform === "linux" ? nativeImage.createFromPath(appPngIcon) : undefined;
  const linuxUserBinDir = pathModule.join(homeDir, ".local", "bin");
  const linuxUserAppsDir = pathModule.join(homeDir, ".local", "share", "applications");
  const linuxUserIconDir = pathModule.join(
    homeDir,
    ".local",
    "share",
    "icons",
    "hicolor",
    "256x256",
    "apps"
  );
  const linuxUserWrapperPath = pathModule.join(linuxUserBinDir, LINUX_APP_ID);
  const linuxUserDesktopPath = pathModule.join(linuxUserAppsDir, LINUX_DESKTOP_FILE_NAME);
  const linuxUserIconPath = pathModule.join(linuxUserIconDir, `${LINUX_APP_ID}.png`);
  const defaultLaunchArgs =
    platform === "linux" && processArgs.includes("--no-sandbox")
      ? ["--no-sandbox"]
      : [];

  let mainWindow = null;

  function ensureLinuxDesktopIntegration() {
    if (platform !== "linux" || !app.isPackaged) {
      return;
    }

    const launchTarget = processEnv.APPIMAGE || execPath;

    try {
      fsModule.mkdirSync(linuxUserBinDir, { recursive: true });
      fsModule.mkdirSync(linuxUserAppsDir, { recursive: true });
      fsModule.mkdirSync(linuxUserIconDir, { recursive: true });

      fsModule.writeFileSync(linuxUserIconPath, fsModule.readFileSync(appPngIcon));

      const wrapperScript = [
        "#!/usr/bin/env sh",
        `export BAMF_DESKTOP_FILE_HINT=${shellQuote(linuxUserDesktopPath)}`,
        `exec ${shellQuote(launchTarget)}${defaultLaunchArgs.length > 0 ? ` ${defaultLaunchArgs.join(" ")}` : ""} "$@"`
      ].join("\n");

      fsModule.writeFileSync(linuxUserWrapperPath, `${wrapperScript}\n`, {
        mode: 0o755
      });
      fsModule.chmodSync(linuxUserWrapperPath, 0o755);

      const desktopEntry = [
        "[Desktop Entry]",
        "Version=1.0",
        "Type=Application",
        `Name=${APP_TITLE}`,
        `Comment=Desktop wrapper for ${APP_URL}`,
        `Exec=${linuxUserWrapperPath} %U`,
        `Icon=${LINUX_APP_ID}`,
        "Terminal=false",
        "StartupNotify=true",
        `StartupWMClass=${LINUX_APP_ID}`,
        "Categories=Education;"
      ].join("\n");

      fsModule.writeFileSync(linuxUserDesktopPath, `${desktopEntry}\n`);
      processEnv.BAMF_DESKTOP_FILE_HINT = linuxUserDesktopPath;

      // Refresh user-level icon and desktop caches for GNOME shell resolution.
      spawnSyncFn("update-desktop-database", [linuxUserAppsDir], {
        stdio: "ignore"
      });
      spawnSyncFn(
        "gtk-update-icon-cache",
        ["-f", "-t", pathModule.join(homeDir, ".local", "share", "icons", "hicolor")],
        { stdio: "ignore" }
      );
    } catch (error) {
      consoleObject.error("Failed to install Linux desktop integration", error);
    }
  }

  function openAllowedExternalUrl(url) {
    if (!canOpenExternally(url)) {
      consoleObject.error(`Blocked external navigation to unsupported URL: ${url}`);
      return false;
    }

    shell.openExternal(url);
    return true;
  }

  function configurePermissionHandlers() {
    const defaultSession = session && session.defaultSession;

    if (!defaultSession) {
      return;
    }

    if (typeof defaultSession.setPermissionRequestHandler === "function") {
      defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback, details = {}) => {
          callback(isAllowedPermission(permission, details.requestingUrl));
        }
      );
    }

    if (typeof defaultSession.setPermissionCheckHandler === "function") {
      defaultSession.setPermissionCheckHandler(
        (_webContents, permission, requestingOrigin) =>
          isAllowedPermission(permission, requestingOrigin)
      );
    }

    if (typeof defaultSession.setDevicePermissionHandler === "function") {
      defaultSession.setDevicePermissionHandler(() => false);
    }
  }

  function createWindowOptions(overrides = {}) {
    return {
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 720,
      backgroundColor: "#ffffff",
      show: false,
      title: APP_TITLE,
      icon: platform === "linux" ? appNativeIcon : appWindowIcon,
      autoHideMenuBar: true,
      safeDialogs: true,
      webPreferences: {
        preload: pathModule.join(baseDir, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        spellcheck: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: !app.isPackaged
      },
      ...overrides
    };
  }

  function handleNavigationEvent(event, url) {
    if (isAllowedNavigationUrl(url)) {
      return false;
    }

    event.preventDefault();
    openAllowedExternalUrl(url);
    return true;
  }

  function attachWebContentsHandlers(webContents) {
    webContents.setWindowOpenHandler(({ url }) => {
      if (isInAppPopupUrl(url)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: createWindowOptions({
            parent: BrowserWindow.fromWebContents(webContents) || undefined
          })
        };
      }

      openAllowedExternalUrl(url);
      return { action: "deny" };
    });

    webContents.on("will-navigate", (event, url) => {
      handleNavigationEvent(event, url);
    });

    webContents.on("will-redirect", (event, url) => {
      handleNavigationEvent(event, url);
    });

    webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });

    webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {
          return;
        }

        consoleObject.error(
          `Failed to load ${url}: [${errorCode}] ${errorDescription}`
        );
      }
    );
  }

  function wireWindow(window) {
    attachWebContentsHandlers(window.webContents);

    if (platform === "linux" && appNativeIcon && !appNativeIcon.isEmpty()) {
      window.setIcon(appNativeIcon);
    }

    window.once("ready-to-show", () => {
      window.show();
    });

    window.webContents.on("did-create-window", (childWindow) => {
      attachWebContentsHandlers(childWindow.webContents);
      childWindow.once("ready-to-show", () => {
        childWindow.show();
      });
    });
  }

  function createMainWindow() {
    const window = new BrowserWindow(createWindowOptions());
    mainWindow = window;
    wireWindow(window);
    window.loadURL(APP_URL);
    window.on("closed", () => {
      if (mainWindow === window) {
        mainWindow = null;
      }
    });
    return window;
  }

  function bootstrap() {
    const gotLock = app.requestSingleInstanceLock();

    if (platform === "linux") {
      app.commandLine.appendSwitch("class", LINUX_APP_ID);
      app.setName(LINUX_APP_ID);
    }

    if (!gotLock) {
      app.quit();
    } else {
      app.on("second-instance", () => {
        if (!mainWindow) {
          return;
        }

        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }

        mainWindow.focus();
      });

      app.whenReady().then(() => {
        ensureLinuxDesktopIntegration();
        configurePermissionHandlers();

        if (platform === "darwin" && app.dock) {
          app.dock.setIcon(appPngIcon);
        }

        Menu.setApplicationMenu(null);
        createMainWindow();

        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
          }
        });
      });
    }

    app.on("window-all-closed", () => {
      if (platform !== "darwin") {
        app.quit();
      }
    });

    return gotLock;
  }

  return {
    constants: {
      APP_TITLE,
      APP_URL,
      ALLOWED_EXTERNAL_PROTOCOLS,
      LINUX_APP_ID,
      LINUX_DESKTOP_FILE_NAME,
      TRUSTED_AUTH_HOSTS,
      TRUSTED_IN_APP_HOSTS,
      TRUSTED_IN_APP_HOST_SUFFIXES,
      TRUSTED_PERMISSION_TYPES,
      appPngIcon,
      appWindowIcon,
      linuxUserDesktopPath,
      linuxUserIconPath,
      linuxUserWrapperPath
    },
    ensureLinuxDesktopIntegration,
    openAllowedExternalUrl,
    configurePermissionHandlers,
    createWindowOptions,
    handleNavigationEvent,
    attachWebContentsHandlers,
    wireWindow,
    createMainWindow,
    bootstrap,
    getMainWindow: () => mainWindow
  };
}

function maybeBootstrap({
  versions = process.versions,
  depsFactory = createDefaultDeps,
  createProcess = createMainProcess
} = {}) {
  if (!versions.electron) {
    return null;
  }

  const mainProcess = createProcess(depsFactory());
  mainProcess.bootstrap();
  return mainProcess;
}

maybeBootstrap();

module.exports = {
  APP_TITLE,
  APP_URL,
  ALLOWED_EXTERNAL_PROTOCOLS,
  LINUX_APP_ID,
  LINUX_DESKTOP_FILE_NAME,
  TRUSTED_AUTH_HOSTS,
  TRUSTED_IN_APP_HOSTS,
  TRUSTED_IN_APP_HOST_SUFFIXES,
  TRUSTED_PERMISSION_TYPES,
  loadElectronModule,
  parseUrl,
  isTrustedInAppHost,
  isTrustedInAppUrl,
  isTrustedAuthUrl,
  isInAppPopupUrl,
  isAllowedNavigationUrl,
  canOpenExternally,
  isAllowedPermission,
  shellQuote,
  createDefaultDeps,
  createMainProcess,
  maybeBootstrap
};
