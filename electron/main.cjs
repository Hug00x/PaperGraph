const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdir } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

let mainWindow = null;
let nextServerProcess = null;

const isDev = !app.isPackaged;
const devServerUrl = process.env.ELECTRON_START_URL || "http://localhost:3000";

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

function createWindow(appUrl) {
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
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return { action: "allow" };
    }

    void shell.openExternal(url);
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

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" });

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
  const serverDirectory = path.join(process.resourcesPath, "server");
  const serverFile = path.join(serverDirectory, "server.js");
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
  await mkdir(dataDirectory, { recursive: true });

  const port = await findAvailablePort();
  const appUrl = `http://127.0.0.1:${port}`;

  nextServerProcess = spawn(process.execPath, [serverFile], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PAPERGRAPH_DATA_DIR: dataDirectory,
      PAPERGRAPH_TECTONIC_PATH: tectonicPath,
      PORT: String(port),
    },
    stdio: "ignore",
    windowsHide: true,
  });

  nextServerProcess.once("exit", (code) => {
    if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "PaperGraph",
        "O servidor local da app fechou inesperadamente. Fecha e volta a abrir o PaperGraph.",
      );
    }
  });

  await waitForServer(appUrl);
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
          void autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-downloaded", (info) => {
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

  autoUpdater.on("error", () => {
    // Update failures should not block the app. They are common in dev or without a published release.
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates();
  }, 4500);
}

async function boot() {
  try {
    const appUrl = isDev ? devServerUrl : await startPackagedNextServer();

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

app.on("before-quit", () => {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
  }
});

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void boot();
  }
});
