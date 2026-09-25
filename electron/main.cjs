const { app, BrowserWindow, dialog, shell, ipcMain } = require("electron");
const { OllamaManager } = require("./ollama-manager.cjs");
const { spawn } = require("node:child_process");
const { createWriteStream, existsSync } = require("node:fs");
const { mkdir } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

let mainWindow = null;
let nextServerProcess = null;
let embeddingRuntime = null;
let embeddingEnvironment = {};
let trustedAppOrigin = null;
let quitFinished = false;
let quitting = false;

const isDev = !app.isPackaged;
const protocolScheme = "papergraph";

function getDeepLinkUrl(argv) {
  return argv.find((argument) => argument.startsWith(`${protocolScheme}://`)) ?? null;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function handleDeepLink(url) {
  if (!url || !url.startsWith(`${protocolScheme}://`)) {
    return;
  }

  focusMainWindow();
}

function setupDeepLinkProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(protocolScheme, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(protocolScheme);
  }

  app.on("second-instance", (_event, argv) => {
    handleDeepLink(getDeepLinkUrl(argv));
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function getAutoUpdater() {
  if (isDev) {
    return null;
  }

  try {
    return require("electron-updater").autoUpdater;
  } catch {
    return null;
  }
}

function getIconPath() {
  return isDev
    ? path.join(app.getAppPath(), "public", "papergraph-icon.png")
    : path.join(process.resourcesPath, "server", "public", "papergraph-icon.png");
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function createWindow(appUrl) {
  trustedAppOrigin = new URL(appUrl).origin;
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1120,
    minHeight: 740,
    title: "PaperGraph",
    icon: getIconPath(),
    backgroundColor: "#071018",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    void embeddingRuntime.start();
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== trustedAppOrigin) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return { action: "deny" };
    }

    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  void mainWindow.loadURL(appUrl);
}

function findAvailablePort(preferredPort = 34173) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on("error", reject);
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : preferredPort;

      server.close(() => resolve(port));
    });
  }).catch(
    () =>
      new Promise((resolve, reject) => {
        const server = net.createServer();

        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : preferredPort;

          server.close(() => resolve(port));
        });
      }),
  );
}

async function waitForServer(url, getStartupError, timeoutMs = 90000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const startupError = getStartupError?.();

    if (startupError) {
      throw startupError;
    }

    try {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });

      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // The server can take a moment to boot after the child process starts.
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error("O servidor local do PaperGraph demorou demasiado a arrancar.");
}

async function startPackagedNextServer() {
  const serverDirectory = isDev ? app.getAppPath() : path.join(process.resourcesPath, "server");
  const serverFile = isDev ? path.join(serverDirectory, "node_modules/next/dist/bin/next") : path.join(serverDirectory, "server.js");
  const tectonicPath = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@node-latex-compiler",
    "bin-win32-x64",
    "bin",
    "tectonic.exe",
  );

  if (!existsSync(serverFile)) {
    throw new Error("O servidor standalone do PaperGraph nao foi encontrado no pacote.");
  }

  const dataDirectory = path.join(app.getPath("userData"), "data");
  const logDirectory = path.join(app.getPath("userData"), "logs");
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(logDirectory, { recursive: true });

  const port = await findAvailablePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const serverLogPath = path.join(logDirectory, "next-server.log");
  const serverLogStream = createWriteStream(serverLogPath, { flags: "a" });
  let startupError = null;

  serverLogStream.write(`\n[${new Date().toISOString()}] Starting PaperGraph server on ${appUrl}\n`);

  const serverEnvironment = { ...process.env };
  for (const key of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "PAPERGRAPH_OPENAI_API_KEY"]) delete serverEnvironment[key];
  nextServerProcess = spawn(process.execPath, isDev ? [serverFile, "dev", "--hostname", "127.0.0.1", "--port", String(port)] : [serverFile], {
    cwd: serverDirectory,
    env: {
      ...serverEnvironment,
      ...embeddingEnvironment,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: isDev ? "development" : "production",
      PAPERGRAPH_DATA_DIR: dataDirectory,
      PAPERGRAPH_TECTONIC_PATH: tectonicPath,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  nextServerProcess.stdout?.pipe(serverLogStream, { end: false });
  nextServerProcess.stderr?.pipe(serverLogStream, { end: false });

  nextServerProcess.once("error", (error) => {
    startupError = new Error(
      `Nao foi possivel iniciar o servidor local do PaperGraph. Detalhes: ${error.message}`,
    );
  });

  nextServerProcess.once("exit", (code, signal) => {
    serverLogStream.write(
      `[${new Date().toISOString()}] Server exited with code ${code ?? "null"} signal ${signal ?? "null"}\n`,
    );

    if (!startupError && code !== 0) {
      startupError = new Error(
        `O servidor local do PaperGraph fechou durante o arranque. Logs: ${serverLogPath}`,
      );
    }

    if (!quitting && code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "PaperGraph",
        "O servidor local da app fechou inesperadamente. Fecha e volta a abrir o PaperGraph.",
      );
    }
  });

  await waitForServer(appUrl, () => startupError);
  return appUrl;
}

function setupAutoUpdates() {
  const autoUpdater = getAutoUpdater();

  if (!autoUpdater) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    void dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Atualizacao disponivel",
        message: `PaperGraph ${info.version} esta disponivel.`,
        detail: "Queres transferir esta versao agora? A atualizacao so existe quando uma nova versao e publicada.",
        buttons: ["Transferir", "Agora nao"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          void autoUpdater.downloadUpdate().catch((error) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setProgressBar(-1);
              dialog.showErrorBox(
                "Atualizacao",
                `Nao foi possivel transferir a atualizacao. ${error instanceof Error ? error.message : "Tenta novamente mais tarde."}`,
              );
            }
          });
        }
      });
  });

  autoUpdater.on("download-progress", (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }

    void dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Atualizacao pronta",
        message: `PaperGraph ${info.version} foi transferido.`,
        detail: "A app pode reiniciar agora para instalar a atualizacao.",
        buttons: ["Reiniciar e instalar", "Mais tarde"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (error) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
      dialog.showErrorBox(
        "Atualizacao",
        `A verificacao ou transferencia da atualizacao falhou. ${error instanceof Error ? error.message : "Tenta novamente mais tarde."}`,
      );
    }
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {});
  }, 4500);
}

async function boot() {
  try {
    embeddingRuntime = new OllamaManager({
      runtimeDirectory: isDev ? path.join(app.getAppPath(), "build/ollama") : path.join(process.resourcesPath, "ollama"),
      dataDirectory: path.join(process.env.LOCALAPPDATA || app.getPath("userData"), "PaperGraph", "ollama"),
    });
    embeddingEnvironment = await embeddingRuntime.prepare();
    embeddingRuntime.on("state", (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("semantic-runtime:changed", state);
    });
    const appUrl = await startPackagedNextServer();

    createWindow(appUrl);
    setupAutoUpdates();
  } catch (error) {
    dialog.showErrorBox(
      "PaperGraph",
      error instanceof Error ? error.message : "Nao foi possivel arrancar o PaperGraph.",
    );
    app.quit();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitFinished) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    await embeddingRuntime?.stop().catch(() => {});
    if (nextServerProcess && nextServerProcess.exitCode === null) {
      if (process.platform === "win32") {
        await new Promise((resolve) => {
          const killer = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32/taskkill.exe"),
            ["/PID", String(nextServerProcess.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          const timeout = setTimeout(resolve, 10000);
          const done = () => { clearTimeout(timeout); resolve(); };
          killer.once("exit", done); killer.once("error", done);
        });
      } else nextServerProcess.kill();
    }
    quitFinished = true;
    app.quit();
  })();
});

function validateSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== trustedAppOrigin) throw new Error("Invalid runtime IPC sender");
}
ipcMain.handle("semantic-runtime:state", (event) => { validateSender(event); return embeddingRuntime.state; });
ipcMain.handle("semantic-runtime:retry", (event) => { validateSender(event); void embeddingRuntime.start(); return embeddingRuntime.state; });

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  setupDeepLinkProtocol();
  handleDeepLink(getDeepLinkUrl(process.argv));

  app.whenReady().then(boot);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void boot();
    }
  });
}
