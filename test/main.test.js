const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  ALLOWED_EXTERNAL_PROTOCOLS,
  APP_URL,
  LINUX_APP_ID,
  TRUSTED_AUTH_HOSTS,
  TRUSTED_IN_APP_HOSTS,
  TRUSTED_IN_APP_HOST_SUFFIXES,
  TRUSTED_PERMISSION_TYPES,
  isAllowedNavigationUrl,
  canOpenExternally,
  createDefaultDeps,
  createMainProcess,
  isAllowedPermission,
  isInAppPopupUrl,
  isTrustedAuthUrl,
  isTrustedInAppHost,
  isTrustedInAppUrl,
  loadElectronModule,
  maybeBootstrap,
  parseUrl,
  shellQuote
} = require("../src/main.js");

function createFakeWebContents() {
  const handlers = new Map();

  return {
    handlers,
    openHandler: null,
    setWindowOpenHandler(handler) {
      this.openHandler = handler;
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, ...args) {
      const handler = handlers.get(event);
      if (handler) {
        handler(...args);
      }
    }
  };
}

function createFakeWindow(options = {}) {
  const onceHandlers = new Map();
  const handlers = new Map();

  return {
    options,
    webContents: createFakeWebContents(),
    shown: false,
    loadURLCalls: [],
    setIconCalls: [],
    restored: false,
    focused: false,
    minimized: false,
    once(event, handler) {
      onceHandlers.set(event, handler);
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, ...args) {
      const handler = handlers.get(event);
      if (handler) {
        handler(...args);
      }

      const onceHandler = onceHandlers.get(event);
      if (onceHandler) {
        onceHandlers.delete(event);
        onceHandler(...args);
      }
    },
    show() {
      this.shown = true;
    },
    loadURL(url) {
      this.loadURLCalls.push(url);
    },
    setIcon(icon) {
      this.setIconCalls.push(icon);
    },
    isMinimized() {
      return this.minimized;
    },
    restore() {
      this.restored = true;
      this.minimized = false;
    },
    focus() {
      this.focused = true;
    }
  };
}

function createMockEnvironment({
  platform = "linux",
  isPackaged = true,
  lockGranted = true,
  processEnv = { APPIMAGE: "/opt/Zenius.AppImage" },
  processArgs = [],
  execPath = "/usr/bin/zenius",
  nativeIconEmpty = false,
  sessionFactory,
  dock = {
    setIconCalls: [],
    setIcon(icon) {
      this.setIconCalls.push(icon);
    }
  }
} = {}) {
  const appHandlers = new Map();
  const logs = [];
  const spawnCalls = [];
  const readIconBuffer = Buffer.from("icon-data");
  let readyResolve;
  let browserWindows = [];
  let parentWindow = null;

  const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });

  const fsMock = {
    mkdirSyncCalls: [],
    writeFileSyncCalls: [],
    chmodSyncCalls: [],
    readFileSyncCalls: [],
    mkdirSync(target, options) {
      this.mkdirSyncCalls.push({ target, options });
    },
    writeFileSync(target, data, options) {
      this.writeFileSyncCalls.push({ target, data, options });
    },
    chmodSync(target, mode) {
      this.chmodSyncCalls.push({ target, mode });
    },
    readFileSync(target) {
      this.readFileSyncCalls.push(target);
      return readIconBuffer;
    }
  };

  const app = {
    isPackaged,
    dock,
    quitCalls: 0,
    setNameCalls: [],
    commandLine: {
      appendSwitchCalls: [],
      appendSwitch(name, value) {
        this.appendSwitchCalls.push([name, value]);
      }
    },
    requestSingleInstanceLock() {
      return lockGranted;
    },
    quit() {
      this.quitCalls += 1;
    },
    setName(name) {
      this.setNameCalls.push(name);
    },
    on(event, handler) {
      appHandlers.set(event, handler);
    },
    whenReady() {
      return readyPromise;
    }
  };

  const Menu = {
    setApplicationMenuCalls: [],
    setApplicationMenu(value) {
      this.setApplicationMenuCalls.push(value);
    }
  };

  const shell = {
    openExternalCalls: [],
    openExternal(url) {
      this.openExternalCalls.push(url);
    }
  };

  const nativeIcon = {
    isEmpty() {
      return nativeIconEmpty;
    }
  };

  const nativeImage = {
    createFromPathCalls: [],
    createFromPath(target) {
      this.createFromPathCalls.push(target);
      return nativeIcon;
    }
  };

  const defaultSession = {
    permissionRequestHandler: null,
    permissionCheckHandler: null,
    devicePermissionHandler: null,
    setPermissionRequestHandler(handler) {
      this.permissionRequestHandler = handler;
    },
    setPermissionCheckHandler(handler) {
      this.permissionCheckHandler = handler;
    },
    setDevicePermissionHandler(handler) {
      this.devicePermissionHandler = handler;
    }
  };

  const session = sessionFactory ? sessionFactory(defaultSession) : { defaultSession };

  function BrowserWindow(options) {
    const window = createFakeWindow(options);
    BrowserWindow.instances.push(window);
    return window;
  }

  BrowserWindow.instances = [];
  BrowserWindow.fromWebContents = () => parentWindow;
  BrowserWindow.getAllWindows = () => browserWindows;

  const deps = {
    app,
    BrowserWindow,
    Menu,
    nativeImage,
    session,
    shell,
    fs: fsMock,
    path,
    spawnSync(...args) {
      spawnCalls.push(args);
      return { status: 0 };
    },
    platform,
    processEnv,
    processArgs,
    execPath,
    homeDir: "/home/tester",
    console: {
      error(...args) {
        logs.push(args);
      }
    },
    baseDir: "/workspace/src"
  };

  return {
    deps,
    helpers: {
      app,
      appHandlers,
      defaultSession,
      fsMock,
      logs,
      Menu,
      nativeIcon,
      nativeImage,
      readIconBuffer,
      resolveReady: readyResolve,
      setBrowserWindows(windows) {
        browserWindows = windows;
      },
      setParentWindow(window) {
        parentWindow = window;
      },
      session,
      shell,
      spawnCalls,
      BrowserWindow
    }
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("URL policy helpers classify trusted and external URLs", () => {
  assert.equal(parseUrl("https://www.zenius.net/").hostname, "www.zenius.net");
  assert.equal(parseUrl("not a url"), null);

  assert.deepEqual(TRUSTED_IN_APP_HOST_SUFFIXES, ["zenius.net", "zenius.com"]);
  assert.deepEqual(TRUSTED_IN_APP_HOSTS, ["app.zencore.id"]);
  assert.deepEqual(TRUSTED_AUTH_HOSTS, ["accounts.google.com"]);
  assert.deepEqual(ALLOWED_EXTERNAL_PROTOCOLS, ["https:", "mailto:", "tel:"]);
  assert.deepEqual(TRUSTED_PERMISSION_TYPES, ["fullscreen"]);

  assert.equal(isTrustedInAppHost(""), false);
  assert.equal(isTrustedInAppHost("www.zenius.net"), true);
  assert.equal(isTrustedInAppHost("classroom.zenius.com"), true);
  assert.equal(isTrustedInAppHost("app.zencore.id"), true);
  assert.equal(isTrustedInAppHost("zenius.net.evil.example"), false);

  assert.equal(isTrustedInAppUrl("https://www.zenius.net/"), true);
  assert.equal(isTrustedInAppUrl("https://tryout.zenius.net/"), true);
  assert.equal(isTrustedInAppUrl("https://app.zencore.id/"), true);
  assert.equal(isTrustedInAppUrl("http://www.zenius.net/"), false);
  assert.equal(isTrustedInAppUrl("https://evil.example/"), false);

  assert.equal(
    isTrustedAuthUrl("https://accounts.google.com/o/oauth2/v2/auth"),
    true
  );
  assert.equal(isTrustedAuthUrl("https://google.com/"), false);

  assert.equal(isInAppPopupUrl("about:blank"), true);
  assert.equal(isInAppPopupUrl("https://www.zenius.net/"), true);
  assert.equal(isInAppPopupUrl("https://accounts.google.com/o/oauth2/v2/auth"), true);
  assert.equal(isInAppPopupUrl("https://evil.example/"), false);

  assert.equal(
    isAllowedNavigationUrl("https://accounts.google.com/o/oauth2/v2/auth"),
    true
  );

  assert.equal(canOpenExternally("https://www.zenius.net/"), true);
  assert.equal(canOpenExternally("mailto:test@example.com"), true);
  assert.equal(canOpenExternally("tel:+621234"), true);
  assert.equal(canOpenExternally("javascript:alert(1)"), false);

  assert.equal(
    isAllowedPermission("fullscreen", "https://www.zenius.net/"),
    true
  );
  assert.equal(
    isAllowedPermission("notifications", "https://www.zenius.net/"),
    false
  );
  assert.equal(isAllowedPermission("fullscreen", "https://evil.example/"), false);
});

test("shellQuote escapes apostrophes for shell-safe wrappers", () => {
  assert.equal(shellQuote("it's ready"), "'it'\\''s ready'");
});

test("createDefaultDeps assembles runtime dependencies", () => {
  const deps = createDefaultDeps({
    electronFactory: () => ({
      app: "app",
      BrowserWindow: "BrowserWindow",
      Menu: "Menu",
      nativeImage: "nativeImage",
      session: "session",
      shell: "shell"
    }),
    fsModule: "fs",
    osModule: {
      homedir() {
        return "/home/mock";
      }
    },
    pathModule: path,
    spawnSyncFn: "spawnSync",
    processObject: {
      platform: "linux",
      env: { APPIMAGE: "/tmp/zenius" },
      argv: ["node", "script.js", "--no-sandbox"],
      execPath: "/usr/bin/node"
    },
    consoleObject: "console",
    baseDir: "/app/src"
  });

  assert.equal(deps.app, "app");
  assert.equal(deps.BrowserWindow, "BrowserWindow");
  assert.equal(deps.session, "session");
  assert.equal(deps.fs, "fs");
  assert.equal(deps.spawnSync, "spawnSync");
  assert.equal(deps.platform, "linux");
  assert.deepEqual(deps.processEnv, { APPIMAGE: "/tmp/zenius" });
  assert.deepEqual(deps.processArgs, ["node", "script.js", "--no-sandbox"]);
  assert.equal(deps.execPath, "/usr/bin/node");
  assert.equal(deps.homeDir, "/home/mock");
  assert.equal(deps.console, "console");
  assert.equal(deps.baseDir, "/app/src");
});

test("createDefaultDeps tolerates the plain Node electron module shape", () => {
  const loadedElectron = loadElectronModule();
  const deps = createDefaultDeps({
    osModule: {
      homedir() {
        return "/home/mock";
      }
    },
    processObject: {
      platform: "linux",
      env: {},
      execPath: "/usr/bin/node"
    },
    baseDir: "/app/src"
  });

  assert.equal(typeof loadedElectron, "string");
  assert.equal(deps.app, undefined);
  assert.equal(deps.homeDir, "/home/mock");
});

test("maybeBootstrap returns null outside Electron", () => {
  let created = false;

  const result = maybeBootstrap({
    versions: {},
    depsFactory() {
      throw new Error("depsFactory should not run");
    },
    createProcess() {
      created = true;
      return null;
    }
  });

  assert.equal(result, null);
  assert.equal(created, false);
});

test("maybeBootstrap boots the process inside Electron", () => {
  let bootstrapped = false;

  const mainProcess = maybeBootstrap({
    versions: { electron: "40.0.0" },
    depsFactory() {
      return { marker: true };
    },
    createProcess(deps) {
      assert.deepEqual(deps, { marker: true });
      return {
        bootstrap() {
          bootstrapped = true;
        }
      };
    }
  });

  assert.equal(typeof mainProcess.bootstrap, "function");
  assert.equal(bootstrapped, true);
});

test("ensureLinuxDesktopIntegration writes launcher, icon, and desktop files", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);

  mainProcess.ensureLinuxDesktopIntegration();

  assert.deepEqual(
    helpers.fsMock.mkdirSyncCalls.map((call) => call.target),
    [
      "/home/tester/.local/bin",
      "/home/tester/.local/share/applications",
      "/home/tester/.local/share/icons/hicolor/256x256/apps"
    ]
  );
  assert.deepEqual(helpers.fsMock.readFileSyncCalls, ["/workspace/assets/icon.png"]);

  const wrapperWrite = helpers.fsMock.writeFileSyncCalls.find(
    (call) => call.target === "/home/tester/.local/bin/zenius-desktop"
  );
  assert.match(
    wrapperWrite.data,
    /BAMF_DESKTOP_FILE_HINT='\/home\/tester\/.local\/share\/applications\/zenius-desktop\.desktop'/
  );
  assert.match(wrapperWrite.data, /exec '\/opt\/Zenius\.AppImage' "\$@"/);
  assert.deepEqual(wrapperWrite.options, { mode: 0o755 });

  const desktopWrite = helpers.fsMock.writeFileSyncCalls.find(
    (call) => call.target === "/home/tester/.local/share/applications/zenius-desktop.desktop"
  );
  assert.match(desktopWrite.data, /Exec=\/home\/tester\/.local\/bin\/zenius-desktop %U/);
  assert.match(desktopWrite.data, /Icon=zenius-desktop/);
  assert.match(desktopWrite.data, /StartupWMClass=zenius-desktop/);

  assert.equal(
    deps.processEnv.BAMF_DESKTOP_FILE_HINT,
    "/home/tester/.local/share/applications/zenius-desktop.desktop"
  );
  assert.deepEqual(helpers.fsMock.chmodSyncCalls, [
    {
      target: "/home/tester/.local/bin/zenius-desktop",
      mode: 0o755
    }
  ]);
  assert.deepEqual(helpers.spawnCalls, [
    [
      "update-desktop-database",
      ["/home/tester/.local/share/applications"],
      { stdio: "ignore" }
    ],
    [
      "gtk-update-icon-cache",
      ["-f", "-t", "/home/tester/.local/share/icons/hicolor"],
      { stdio: "ignore" }
    ]
  ]);
});

test("ensureLinuxDesktopIntegration falls back to execPath when APPIMAGE is absent", () => {
  const { deps, helpers } = createMockEnvironment({
    processEnv: {},
    execPath: "/usr/local/bin/zenius"
  });
  const mainProcess = createMainProcess(deps);

  mainProcess.ensureLinuxDesktopIntegration();

  const wrapperWrite = helpers.fsMock.writeFileSyncCalls.find(
    (call) => call.target === "/home/tester/.local/bin/zenius-desktop"
  );
  assert.match(wrapperWrite.data, /exec '\/usr\/local\/bin\/zenius' "\$@"/);
});

test("ensureLinuxDesktopIntegration preserves no-sandbox for local launcher when needed", () => {
  const { deps, helpers } = createMockEnvironment({
    processArgs: ["electron", ".", "--no-sandbox"]
  });
  const mainProcess = createMainProcess(deps);

  mainProcess.ensureLinuxDesktopIntegration();

  const wrapperWrite = helpers.fsMock.writeFileSyncCalls.find(
    (call) => call.target === "/home/tester/.local/bin/zenius-desktop"
  );
  assert.match(wrapperWrite.data, /exec '\/opt\/Zenius\.AppImage' --no-sandbox "\$@"/);
});

test("ensureLinuxDesktopIntegration skips unsupported platforms and unpackaged builds", () => {
  const windowsEnv = createMockEnvironment({ platform: "win32" });
  createMainProcess(windowsEnv.deps).ensureLinuxDesktopIntegration();
  assert.equal(windowsEnv.helpers.fsMock.writeFileSyncCalls.length, 0);

  const unpackagedEnv = createMockEnvironment({ isPackaged: false });
  createMainProcess(unpackagedEnv.deps).ensureLinuxDesktopIntegration();
  assert.equal(unpackagedEnv.helpers.fsMock.writeFileSyncCalls.length, 0);
});

test("ensureLinuxDesktopIntegration logs failures instead of throwing", () => {
  const { deps, helpers } = createMockEnvironment();
  deps.fs.mkdirSync = () => {
    throw new Error("no permissions");
  };

  createMainProcess(deps).ensureLinuxDesktopIntegration();

  assert.equal(helpers.logs[0][0], "Failed to install Linux desktop integration");
  assert.equal(helpers.logs[0][1].message, "no permissions");
});

test("configurePermissionHandlers installs a deny-by-default policy", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);
  const decisionLog = [];

  mainProcess.configurePermissionHandlers();

  helpers.defaultSession.permissionRequestHandler(
    null,
    "fullscreen",
    (allowed) => decisionLog.push(["request", allowed]),
    { requestingUrl: "https://www.zenius.net/" }
  );
  helpers.defaultSession.permissionRequestHandler(
    null,
    "notifications",
    (allowed) => decisionLog.push(["request", allowed]),
    { requestingUrl: "https://www.zenius.net/" }
  );

  assert.deepEqual(decisionLog, [
    ["request", true],
    ["request", false]
  ]);
  assert.equal(
    helpers.defaultSession.permissionCheckHandler(
      null,
      "fullscreen",
      "https://www.zenius.net/"
    ),
    true
  );
  assert.equal(
    helpers.defaultSession.permissionCheckHandler(
      null,
      "fullscreen",
      "https://evil.example/"
    ),
    false
  );
  assert.equal(helpers.defaultSession.devicePermissionHandler(), false);
});

test("configurePermissionHandlers tolerates missing session hooks", () => {
  const missingDefaultSessionEnv = createMockEnvironment({
    sessionFactory: () => ({})
  });
  createMainProcess(missingDefaultSessionEnv.deps).configurePermissionHandlers();

  const emptyHookEnv = createMockEnvironment({
    sessionFactory: () => ({ defaultSession: {} })
  });
  createMainProcess(emptyHookEnv.deps).configurePermissionHandlers();
});

test("createWindowOptions uses secure defaults and platform-specific icons", () => {
  const linuxEnv = createMockEnvironment({ platform: "linux", isPackaged: true });
  const linuxProcess = createMainProcess(linuxEnv.deps);
  const linuxOptions = linuxProcess.createWindowOptions({ width: 1280 });

  assert.equal(linuxOptions.width, 1280);
  assert.equal(linuxOptions.icon, linuxEnv.helpers.nativeIcon);
  assert.equal(linuxOptions.safeDialogs, true);
  assert.equal(linuxOptions.webPreferences.preload, "/workspace/src/preload.js");
  assert.equal(linuxOptions.webPreferences.webSecurity, true);
  assert.equal(linuxOptions.webPreferences.allowRunningInsecureContent, false);
  assert.equal(linuxOptions.webPreferences.webviewTag, false);
  assert.equal(linuxOptions.webPreferences.nodeIntegrationInSubFrames, false);
  assert.equal(linuxOptions.webPreferences.devTools, false);

  const winEnv = createMockEnvironment({ platform: "win32", isPackaged: false });
  const winProcess = createMainProcess(winEnv.deps);
  const winOptions = winProcess.createWindowOptions();

  assert.equal(winOptions.icon, "/workspace/assets/icon.ico");
  assert.equal(winOptions.webPreferences.devTools, true);
  assert.deepEqual(winEnv.helpers.nativeImage.createFromPathCalls, []);
});

test("openAllowedExternalUrl permits only a short safe protocol list", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);

  assert.equal(
    mainProcess.openAllowedExternalUrl("https://help.zenius.net/"),
    true
  );
  assert.equal(
    mainProcess.openAllowedExternalUrl("javascript:alert(1)"),
    false
  );

  assert.deepEqual(helpers.shell.openExternalCalls, ["https://help.zenius.net/"]);
  assert.equal(
    helpers.logs.at(-1)[0],
    "Blocked external navigation to unsupported URL: javascript:alert(1)"
  );
});

test("handleNavigationEvent keeps trusted origins in-app and ejects everything else", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);

  const trustedEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  assert.equal(
    mainProcess.handleNavigationEvent(trustedEvent, "https://www.zenius.net/dashboard"),
    false
  );
  assert.equal(trustedEvent.prevented, false);

  const externalEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  assert.equal(
    mainProcess.handleNavigationEvent(externalEvent, "https://example.com/docs"),
    true
  );
  assert.equal(externalEvent.prevented, true);
  assert.deepEqual(helpers.shell.openExternalCalls, ["https://example.com/docs"]);
});

test("handleNavigationEvent keeps Google auth inside the app", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);

  const mainWindowEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  assert.equal(
    mainProcess.handleNavigationEvent(
      mainWindowEvent,
      "https://accounts.google.com/o/oauth2/v2/auth"
    ),
    false
  );
  assert.equal(mainWindowEvent.prevented, false);

  const popupEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  assert.equal(
    mainProcess.handleNavigationEvent(
      popupEvent,
      "https://accounts.google.com/o/oauth2/v2/auth"
    ),
    false
  );
  assert.equal(popupEvent.prevented, false);
  assert.deepEqual(helpers.shell.openExternalCalls, []);
});

test("attachWebContentsHandlers manages navigation, popup, and load failures", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);
  const webContents = createFakeWebContents();
  const parentWindow = { id: "parent" };

  helpers.setParentWindow(parentWindow);
  mainProcess.attachWebContentsHandlers(webContents);

  const trustedPopup = webContents.openHandler({ url: "https://www.zenius.net/" });
  assert.equal(trustedPopup.action, "allow");
  assert.equal(trustedPopup.overrideBrowserWindowOptions.parent, parentWindow);

  const googlePopup = webContents.openHandler({
    url: "https://accounts.google.com/o/oauth2/v2/auth"
  });
  assert.equal(googlePopup.action, "allow");

  helpers.setParentWindow(null);
  const blankPopup = webContents.openHandler({ url: "about:blank" });
  assert.equal(blankPopup.overrideBrowserWindowOptions.parent, undefined);

  const externalPopup = webContents.openHandler({ url: "https://example.com/" });
  assert.equal(externalPopup.action, "deny");

  const blockedPopup = webContents.openHandler({ url: "file:///etc/passwd" });
  assert.equal(blockedPopup.action, "deny");
  assert.deepEqual(helpers.shell.openExternalCalls, ["https://example.com/"]);
  assert.equal(
    helpers.logs.at(-1)[0],
    "Blocked external navigation to unsupported URL: file:///etc/passwd"
  );

  const mailtoNavigation = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  webContents.emit("will-navigate", mailtoNavigation, "mailto:test@example.com");
  assert.equal(mailtoNavigation.prevented, true);

  const trustedNavigation = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  webContents.emit(
    "will-navigate",
    trustedNavigation,
    "https://www.zenius.net/classroom"
  );
  assert.equal(trustedNavigation.prevented, false);

  const allowedGoogleMainNavigation = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  webContents.emit(
    "will-navigate",
    allowedGoogleMainNavigation,
    "https://accounts.google.com/o/oauth2/v2/auth"
  );
  assert.equal(allowedGoogleMainNavigation.prevented, false);

  const redirectEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  webContents.emit("will-redirect", redirectEvent, "https://accounts.example/");
  assert.equal(redirectEvent.prevented, true);

  const webviewEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  webContents.emit("will-attach-webview", webviewEvent);
  assert.equal(webviewEvent.prevented, true);

  webContents.emit("did-fail-load", {}, -2, "ERR_FAILED", "https://zenius.net/", true);
  assert.equal(
    helpers.logs.at(-1)[0],
    "Failed to load https://zenius.net/: [-2] ERR_FAILED"
  );

  const beforeIgnoredErrors = helpers.logs.length;
  webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://zenius.net/", true);
  webContents.emit("did-fail-load", {}, -2, "ERR_FAILED", "https://zenius.net/", false);
  assert.equal(helpers.logs.length, beforeIgnoredErrors);

  assert.deepEqual(helpers.shell.openExternalCalls, [
    "https://example.com/",
    "mailto:test@example.com",
    "https://accounts.example/"
  ]);
});

test("attachWebContentsHandlers keeps Google auth redirects inside popup windows too", () => {
  const { deps, helpers } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);
  const popupContents = createFakeWebContents();

  mainProcess.attachWebContentsHandlers(popupContents);

  const googleNavigation = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  popupContents.emit(
    "will-navigate",
    googleNavigation,
    "https://accounts.google.com/o/oauth2/v2/auth"
  );
  assert.equal(googleNavigation.prevented, false);

  const googleRedirect = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  popupContents.emit(
    "will-redirect",
    googleRedirect,
    "https://accounts.google.com/signin/oauth/identifier"
  );
  assert.equal(googleRedirect.prevented, false);

  const externalNavigation = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  popupContents.emit("will-navigate", externalNavigation, "https://evil.example/");
  assert.equal(externalNavigation.prevented, true);
  assert.deepEqual(helpers.shell.openExternalCalls, ["https://evil.example/"]);
});

test("wireWindow applies icons and handles child windows on Linux", () => {
  const { deps } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);
  const window = createFakeWindow();
  const childWindow = createFakeWindow();

  mainProcess.wireWindow(window);

  assert.equal(window.setIconCalls.length, 1);
  window.emit("ready-to-show");
  assert.equal(window.shown, true);

  window.webContents.emit("did-create-window", childWindow);
  assert.equal(typeof childWindow.webContents.openHandler, "function");

  childWindow.emit("ready-to-show");
  assert.equal(childWindow.shown, true);
});

test("wireWindow skips Linux icon assignment when the native icon is empty", () => {
  const { deps } = createMockEnvironment({ nativeIconEmpty: true });
  const mainProcess = createMainProcess(deps);
  const window = createFakeWindow();

  mainProcess.wireWindow(window);

  assert.equal(window.setIconCalls.length, 0);
});

test("createMainWindow tracks the current window and clears it on close", () => {
  const { deps } = createMockEnvironment();
  const mainProcess = createMainProcess(deps);

  const firstWindow = mainProcess.createMainWindow();
  assert.equal(mainProcess.getMainWindow(), firstWindow);
  assert.deepEqual(firstWindow.loadURLCalls, [APP_URL]);

  const secondWindow = mainProcess.createMainWindow();
  firstWindow.emit("closed");
  assert.equal(mainProcess.getMainWindow(), secondWindow);

  secondWindow.emit("closed");
  assert.equal(mainProcess.getMainWindow(), null);
});

test("bootstrap quits immediately when the single-instance lock cannot be acquired", () => {
  const { deps, helpers } = createMockEnvironment({
    platform: "win32",
    lockGranted: false
  });
  const mainProcess = createMainProcess(deps);

  const gotLock = mainProcess.bootstrap();

  assert.equal(gotLock, false);
  assert.equal(helpers.app.quitCalls, 1);
  assert.deepEqual(helpers.app.commandLine.appendSwitchCalls, []);

  helpers.appHandlers.get("window-all-closed")();
  assert.equal(helpers.app.quitCalls, 2);
});

test("bootstrap wires Linux lifecycle events, activation, permissions, and focus management", async () => {
  const { deps, helpers } = createMockEnvironment({
    platform: "linux",
    isPackaged: false
  });
  const mainProcess = createMainProcess(deps);

  const gotLock = mainProcess.bootstrap();
  assert.equal(gotLock, true);
  assert.deepEqual(helpers.app.commandLine.appendSwitchCalls, [["class", LINUX_APP_ID]]);
  assert.deepEqual(helpers.app.setNameCalls, [LINUX_APP_ID]);

  helpers.appHandlers.get("second-instance")();

  helpers.resolveReady();
  await flushMicrotasks();

  assert.deepEqual(helpers.Menu.setApplicationMenuCalls, [null]);
  assert.equal(helpers.BrowserWindow.instances.length, 1);
  assert.equal(typeof helpers.defaultSession.permissionRequestHandler, "function");
  assert.equal(typeof helpers.defaultSession.permissionCheckHandler, "function");
  assert.equal(typeof helpers.defaultSession.devicePermissionHandler, "function");

  const activeWindow = mainProcess.getMainWindow();
  activeWindow.minimized = true;
  helpers.appHandlers.get("second-instance")();
  assert.equal(activeWindow.restored, true);
  assert.equal(activeWindow.focused, true);

  activeWindow.restored = false;
  activeWindow.focused = false;
  helpers.appHandlers.get("second-instance")();
  assert.equal(activeWindow.restored, false);
  assert.equal(activeWindow.focused, true);

  helpers.setBrowserWindows([]);
  helpers.appHandlers.get("activate")();
  assert.equal(helpers.BrowserWindow.instances.length, 2);

  helpers.setBrowserWindows([helpers.BrowserWindow.instances[1]]);
  helpers.appHandlers.get("activate")();
  assert.equal(helpers.BrowserWindow.instances.length, 2);

  helpers.appHandlers.get("window-all-closed")();
  assert.equal(helpers.app.quitCalls, 1);
});

test("bootstrap applies the dock icon on macOS and leaves the app alive on close", async () => {
  const dock = {
    setIconCalls: [],
    setIcon(icon) {
      this.setIconCalls.push(icon);
    }
  };
  const { deps, helpers } = createMockEnvironment({
    platform: "darwin",
    isPackaged: false,
    dock
  });
  const mainProcess = createMainProcess(deps);

  mainProcess.bootstrap();
  helpers.resolveReady();
  await flushMicrotasks();

  assert.deepEqual(dock.setIconCalls, ["/workspace/assets/icon.png"]);
  helpers.appHandlers.get("window-all-closed")();
  assert.equal(helpers.app.quitCalls, 0);
});
