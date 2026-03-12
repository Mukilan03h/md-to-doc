const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const chokidar = require('chokidar');
const { exportDocx } = require('./src/exportDocx');
const { exportPdf } = require('./src/exportPdf');
const matter = require('gray-matter');
const { marked } = require('marked');

const store = new Store({
  defaults: {
    defaultOutputFolder: app.getPath('documents'),
    defaultTheme: 'default',
    pdfPageSize: 'A4',
    pdfFontSize: '16px',
    pdfMargins: '20mm',
    autoOpen: true
  }
});

let mainWindow;
const watcher = chokidar.watch([], { ignoreInitial: true });
let isSavingFromApp = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  watcher.on('change', (filePath) => {
    if (!isSavingFromApp) {
      mainWindow.webContents.send('file:changed', filePath);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers

ipcMain.handle('settings:get', () => store.store);
ipcMain.handle('settings:set', (event, { key, value }) => {
  store.set(key, value);
});

function getUniqueFilename(folder, filename) {
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  let finalPath = path.join(folder, filename);
  let counter = 1;

  while (fs.existsSync(finalPath)) {
    finalPath = path.join(folder, `${baseName} (${counter})${ext}`);
    counter++;
  }

  return finalPath;
}

ipcMain.handle('export:docx', async (event, { markdown, filename, outputPath, frontmatter }) => {
  const targetFolder = outputPath || store.get('defaultOutputFolder');
  const targetFile = getUniqueFilename(targetFolder, `${path.basename(filename, '.md')}.docx`);

  try {
    const basePath = path.dirname(filename);
    const resultPath = await exportDocx(markdown, targetFile, basePath, frontmatter);

    if (store.get('autoOpen')) {
      shell.openPath(resultPath);
    }

    return { success: true, path: resultPath };
  } catch (err) {
    console.error('Docx export failed', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export:pdf', async (event, { html, filename, outputPath, theme, pageSize, frontmatter }) => {
  const targetFolder = outputPath || store.get('defaultOutputFolder');
  const targetFile = getUniqueFilename(targetFolder, `${path.basename(filename, '.md')}.pdf`);
  const basePath = path.dirname(filename);
  const usedTheme = theme || store.get('defaultTheme');
  const usedSize = pageSize || store.get('pdfPageSize');
  const fontSize = store.get('pdfFontSize');
  const margins = store.get('pdfMargins');

  try {
    // Determine Chromium executable path (Electron bundled)
    const execPath = process.execPath;

    const resultPath = await exportPdf(html, targetFile, usedTheme, usedSize, execPath, fontSize, margins, frontmatter, basePath);

    if (store.get('autoOpen')) {
      shell.openPath(resultPath);
    }

    return { success: true, path: resultPath };
  } catch (err) {
    console.error('Pdf export failed', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  });

  if (canceled) return [];

  // Add to watcher
  filePaths.forEach(p => watcher.add(p));

  return filePaths.map(p => {
    const content = fs.readFileSync(p, 'utf-8');
    const parsed = matter(content);
    return {
      path: p,
      name: path.basename(p),
      content: parsed.content,
      frontmatter: parsed.data,
      raw: content
    };
  });
});

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(content);
    return { content: parsed.content, frontmatter: parsed.data, raw: content };
  } catch(e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:writeFile', async (event, {filePath, content, isSavingFromApp: fromApp}) => {
  try {
    isSavingFromApp = fromApp;
    fs.writeFileSync(filePath, content, 'utf-8');
    // small delay to allow chokidar events to fire while flag is true
    setTimeout(() => { isSavingFromApp = false; }, 500);
    return { success: true };
  } catch(e) {
    isSavingFromApp = false;
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dialog:saveFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!canceled) {
    return filePaths[0];
  }
  return null;
});

ipcMain.handle('export:batch', async (event, files) => {
  let successCount = 0;
  let errors = [];

  // Use first file's folder as target or default if none specified
  const targetFolder = store.get('defaultOutputFolder');
  const execPath = process.execPath;
  const usedTheme = store.get('defaultTheme');
  const usedSize = store.get('pdfPageSize');
  const fontSize = store.get('pdfFontSize');
  const margins = store.get('pdfMargins');

  for (const f of files) {
    const docxTarget = getUniqueFilename(targetFolder, `${path.basename(f.name, '.md')}.docx`);
    const pdfTarget = getUniqueFilename(targetFolder, `${path.basename(f.name, '.md')}.pdf`);
    const basePath = path.dirname(f.path);

    try {
      await exportDocx(f.content, docxTarget, basePath, f.frontmatter);
      const html = marked.parse(f.content);
      await exportPdf(html, pdfTarget, usedTheme, usedSize, execPath, fontSize, margins, f.frontmatter, basePath);
      successCount++;
    } catch (e) {
      errors.push(`${f.name}: ${e.message}`);
    }
  }

  return { success: successCount === files.length, count: successCount, errors };
});

ipcMain.handle('dialog:openFiles', async (event, filePaths) => {
  // Helper for drag and drop: reads arbitrary files
  filePaths.forEach(p => watcher.add(p));
  return filePaths.map(p => {
    const content = fs.readFileSync(p, 'utf-8');
    const parsed = matter(content);
    return {
      path: p,
      name: path.basename(p),
      content: parsed.content,
      frontmatter: parsed.data,
      raw: content
    };
  });
});

// Placeholder for Toast - renderer could handle its own toast, or main can just tell renderer to show it.
// Here we just relay it back if needed, but renderer can show it directly upon export success.
