let editor;
let files = [];
let activeFileIndex = -1;

// Initialize Monaco Editor
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('monaco-container'), {
    value: '',
    language: 'markdown',
    theme: 'vs-dark',
    wordWrap: 'on',
    minimap: { enabled: false }
  });

  editor.onDidChangeModelContent(() => {
    if (activeFileIndex > -1) {
      const val = editor.getValue();
      files[activeFileIndex].raw = val;
      files[activeFileIndex].isDirty = true;

      // Rough parse of frontmatter for preview update
      const match = val.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (match) {
        files[activeFileIndex].content = match[2];
        const fmStr = match[1];
        const fm = {};
        fmStr.split('\n').forEach(line => {
          const parts = line.split(':');
          if (parts.length >= 2) fm[parts[0].trim()] = parts.slice(1).join(':').trim();
        });
        files[activeFileIndex].frontmatter = fm;
      } else {
        files[activeFileIndex].content = val;
        files[activeFileIndex].frontmatter = {};
      }

      updatePreview();
      updateFileStats();
    }
  });

  // Ctrl+S / Cmd+S handler
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
    if (activeFileIndex > -1) {
      const activeFile = files[activeFileIndex];
      const res = await window.api.writeFile(activeFile.path, activeFile.raw, true);
      if (res.success) {
        activeFile.isDirty = false;
        showToast(`Saved ${activeFile.name}`);
        updateFileStats();
      } else {
        showToast(`Error saving: ${res.error}`);
      }
    }
  });
});

// UI Elements
const fileListEl = document.getElementById('file-list');
const tabBarEl = document.getElementById('tab-bar');
const previewEl = document.getElementById('preview-container');
const metadataEl = document.getElementById('metadata-strip');
const bannerEl = document.getElementById('update-banner');
const toastEl = document.getElementById('toast');

// Actions
// Drag and Drop
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const filePaths = Array.from(e.dataTransfer.files)
      .filter(f => f.name.endsWith('.md') || f.name.endsWith('.markdown'))
      .map(f => f.path);

    if (filePaths.length > 0) {
      const newFiles = await window.api.openFiles(filePaths);
      if (newFiles && newFiles.length > 0) {
        files = [...files, ...newFiles.map(f => ({ ...f, isDirty: false }))];
        activeFileIndex = files.length - 1;
        renderFilePanel();
        loadActiveFile();
      }
    }
  }
});

document.getElementById('btn-open').addEventListener('click', async () => {
  const newFiles = await window.api.openFile();
  if (newFiles && newFiles.length > 0) {
    files = [...files, ...newFiles.map(f => ({ ...f, isDirty: false }))];
    activeFileIndex = files.length - 1;
    renderFilePanel();
    loadActiveFile();
  }
});

document.getElementById('btn-export-docx').addEventListener('click', async () => {
  if (activeFileIndex < 0) return;
  const f = files[activeFileIndex];
  const res = await window.api.exportDocx({
    markdown: f.content,
    filename: f.name,
    frontmatter: f.frontmatter
  });
  if (res.success) showToast(`Exported DOCX to ${res.path}`);
  else showToast(`Export failed: ${res.error}`);
});

document.getElementById('btn-export-pdf').addEventListener('click', async () => {
  if (activeFileIndex < 0) return;
  const f = files[activeFileIndex];
  // Parse HTML
  const html = marked.parse(f.content);
  const theme = document.getElementById('setting-theme').value;
  const pageSize = document.getElementById('setting-page-size').value;
  const res = await window.api.exportPdf({
    html: html,
    filename: f.name,
    theme: theme,
    pageSize: pageSize,
    frontmatter: f.frontmatter
  });
  if (res.success) showToast(`Exported PDF to ${res.path}`);
  else showToast(`Export failed: ${res.error}`);
});

document.getElementById('btn-export-all').addEventListener('click', async () => {
  if (files.length === 0) return;
  const folder = await window.api.saveFolder();
  if (!folder) return;

  // Update main store with latest UI settings for batch
  await window.api.setSetting('defaultTheme', document.getElementById('setting-theme').value);
  await window.api.setSetting('pdfPageSize', document.getElementById('setting-page-size').value);
  await window.api.setSetting('pdfFontSize', document.getElementById('setting-font-size').value);
  await window.api.setSetting('pdfMargins', document.getElementById('setting-margins').value);
  await window.api.setSetting('defaultOutputFolder', folder);

  showToast(`Starting batch export...`);

  const res = await window.api.exportBatch(files);
  if (res.success) {
    showToast(`Batch exported ${res.count} files`);
  } else {
    showToast(`Batch export had errors. Exported ${res.count}/${files.length}`);
    console.error(res.errors);
  }
});

// Settings logic
async function loadSettings() {
  const settings = await window.api.getSettings();
  if (settings.defaultTheme) document.getElementById('setting-theme').value = settings.defaultTheme;
  if (settings.pdfPageSize) document.getElementById('setting-page-size').value = settings.pdfPageSize;
  if (settings.pdfFontSize) document.getElementById('setting-font-size').value = settings.pdfFontSize;
  if (settings.pdfMargins) document.getElementById('setting-margins').value = settings.pdfMargins;
  if (settings.autoOpen !== undefined) document.getElementById('setting-auto-open').checked = settings.autoOpen;
}

// Save settings on change
const saveSetting = async (key, val) => await window.api.setSetting(key, val);
document.getElementById('setting-theme').addEventListener('change', (e) => saveSetting('defaultTheme', e.target.value));
document.getElementById('setting-page-size').addEventListener('change', (e) => saveSetting('pdfPageSize', e.target.value));
document.getElementById('setting-font-size').addEventListener('change', (e) => saveSetting('pdfFontSize', e.target.value));
document.getElementById('setting-margins').addEventListener('change', (e) => saveSetting('pdfMargins', e.target.value));
document.getElementById('setting-auto-open').addEventListener('change', (e) => saveSetting('autoOpen', e.target.checked));

loadSettings();

// File watcher
window.api.onFileChanged(async (changedPath) => {
  const idx = files.findIndex(f => f.path === changedPath);
  if (idx > -1) {
    // Show banner and update automatically
    bannerEl.classList.remove('hidden');
    setTimeout(() => { bannerEl.classList.add('hidden'); }, 3000); // Hide banner after 3 seconds

    const { content, frontmatter, raw } = await window.api.readFile(changedPath);
    files[idx].content = content;
    files[idx].frontmatter = frontmatter;
    files[idx].raw = raw;
    files[idx].isDirty = false;

    if (activeFileIndex === idx) {
      if (editor.getValue() !== raw) {
        const position = editor.getPosition();
        editor.setValue(raw);
        editor.setPosition(position);
      }
      updatePreview();
    }
  }
});

function renderFilePanel() {
  fileListEl.innerHTML = '';
  tabBarEl.innerHTML = '';

  files.forEach((f, idx) => {
    // List item
    const li = document.createElement('div');
    li.className = `file-item ${idx === activeFileIndex ? 'active' : ''}`;

    // Word count calculation
    const words = f.content.split(/\s+/).filter(w => w.length > 0).length;
    li.innerHTML = `<span>${f.name}${f.isDirty?'*':''}</span> <span style="font-size:10px; color:#aaa">${words}w</span>`;
    li.onclick = () => {
      activeFileIndex = idx;
      renderFilePanel();
      loadActiveFile();
    };
    fileListEl.appendChild(li);

    // Tab
    const tab = document.createElement('div');
    tab.className = `tab ${idx === activeFileIndex ? 'active' : ''}`;
    tab.textContent = `${f.name}${f.isDirty?'*':''}`;
    tab.onclick = () => {
      activeFileIndex = idx;
      renderFilePanel();
      loadActiveFile();
    };
    tabBarEl.appendChild(tab);
  });
}

function updateFileStats() {
  if (activeFileIndex < 0) return;
  const f = files[activeFileIndex];
  const listItems = fileListEl.querySelectorAll('.file-item');
  const tabs = tabBarEl.querySelectorAll('.tab');

  if (listItems[activeFileIndex] && tabs[activeFileIndex]) {
    const words = f.content.split(/\s+/).filter(w => w.length > 0).length;
    listItems[activeFileIndex].innerHTML = `<span>${f.name}${f.isDirty?'*':''}</span> <span style="font-size:10px; color:#aaa">${words}w</span>`;
    tabs[activeFileIndex].textContent = `${f.name}${f.isDirty?'*':''}`;
  }
}

function loadActiveFile() {
  if (activeFileIndex < 0) return;
  const f = files[activeFileIndex];

  if (editor) {
    if (editor.getValue() !== f.raw) {
      editor.setValue(f.raw);
    }
  }

  updatePreview();
}

function updatePreview() {
  if (activeFileIndex < 0) return;
  const f = files[activeFileIndex];

  // Update Frontmatter strip
  if (f.frontmatter && Object.keys(f.frontmatter).length > 0) {
    metadataEl.style.display = 'block';
    const fmHtml = Object.entries(f.frontmatter).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join(' | ');
    metadataEl.innerHTML = fmHtml;
  } else {
    metadataEl.style.display = 'none';
  }

  // Parse Markdown with Marked
  previewEl.innerHTML = marked.parse(f.content);
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.style.opacity = 1;
  setTimeout(() => {
    toastEl.style.opacity = 0;
    setTimeout(() => toastEl.classList.add('hidden'), 300);
  }, 3000);
}
