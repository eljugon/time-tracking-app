const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const MODEL = 'claude-opus-5';
const MCP_URL = 'https://microsoft365.mcp.claude.com/mcp';
const MCP_NAME = 'microsoft-365';

/* ---------- almacenamiento en disco ---------- */
let storeFile;
let store = {};

function loadStore() {
  storeFile = path.join(app.getPath('userData'), 'rail-data.json');
  try {
    store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  } catch {
    store = {};
  }
}

function saveStore() {
  const tmp = storeFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, storeFile);
}

ipcMain.handle('storage:get', (_evt, key) =>
  Object.prototype.hasOwnProperty.call(store, key) ? { value: store[key] } : null
);

ipcMain.handle('storage:set', (_evt, key, value) => {
  store[key] = value;
  saveStore();
  return true;
});

/* ---------- sincronización con el Excel de OneDrive ---------- */
ipcMain.handle('rail:sync', async (_evt, payload = {}) => {
  const apiKey = (payload.apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  const mcpToken = (payload.mcpToken || process.env.RAIL_MCP_TOKEN || '').trim();
  if (!apiKey) return { ok: false, error: 'Falta la clave de API de Anthropic.' };
  if (!payload.prompt) return { ok: false, error: 'Petición vacía.' };

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const server = { type: 'url', url: MCP_URL, name: MCP_NAME };
    if (mcpToken) server.authorization_token = mcpToken;

    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['mcp-client-2025-11-20'],
      mcp_servers: [server],
      tools: [{ type: 'mcp_toolset', mcp_server_name: MCP_NAME }],
      messages: [{ role: 'user', content: payload.prompt }],
    });

    const text = (res.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();

    if (res.stop_reason === 'refusal') {
      return { ok: false, error: 'La API rechazó la petición.' };
    }
    const toolErr = (res.content || []).find(
      (b) => b.type === 'mcp_tool_result' && b.is_error
    );
    if (toolErr) {
      return { ok: false, error: text || 'El conector de Microsoft 365 devolvió un error.' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Error desconocido' };
  }
});

/* ---------- ventana ---------- */
function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#10141A',
    title: 'Rail — Time Tracking',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Cualquier enlace externo se abre en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// Una sola instancia: al reabrir, enfocamos la ventana existente.
// La interfaz está en es-ES y todas las horas son de 24h: fijamos el idioma de
// Chromium para que los <input type="time"/"date"> no salgan en formato AM/PM.
app.commandLine.appendSwitch('lang', 'es-ES');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    loadStore();
    if (process.platform === 'win32') app.setAppUserModelId('com.rail.timetracking');
    mainWindow = createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
