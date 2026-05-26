import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from './components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Checkbox } from './components/ui/checkbox';
import { FileUp, FolderUp, Download, Settings, File as FileIcon } from 'lucide-react';
import { marked } from 'marked';
import yaml from 'js-yaml';

export default function App() {
  const [files, setFiles] = useState([]);
  const [activeFileIndex, setActiveFileIndex] = useState(-1);
  const [settings, setSettings] = useState({
    defaultTheme: 'default',
    pdfPageSize: 'A4',
    pdfFontSize: '16px',
    pdfMargins: '20mm',
    autoOpen: true
  });
  const [toast, setToast] = useState(null);
  const [banner, setBanner] = useState(false);
  const editorRef = useRef(null);
  const activeFileIndexRef = useRef(activeFileIndex);

  useEffect(() => {
    activeFileIndexRef.current = activeFileIndex;
  }, [activeFileIndex]);

  useEffect(() => {
    if (!window.api) return; // For testing in plain browser without electron

    // Load initial settings
    window.api.getSettings().then(s => setSettings(prev => ({...prev, ...s})));

    // File watcher
    const unsubscribe = window.api.onFileChanged(async (changedPath) => {
      setFiles(currentFiles => {
        const idx = currentFiles.findIndex(f => f.path === changedPath);
        if (idx > -1) {
          setBanner(true);
          setTimeout(() => setBanner(false), 3000);

          window.api.readFile(changedPath).then(({ content, frontmatter, raw }) => {
            setFiles(files => {
              const newFiles = [...files];
              newFiles[idx] = { ...newFiles[idx], content, frontmatter, raw, isDirty: false };
              return newFiles;
            });
          });
        }
        return currentFiles;
      });
    });

    // Drag and Drop
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const filePaths = Array.from(e.dataTransfer.files)
          .filter(f => f.name.endsWith('.md') || f.name.endsWith('.markdown'))
          .map(f => f.path);
        if (filePaths.length > 0) {
          const newFiles = await window.api.openFiles(filePaths);
          if (newFiles && newFiles.length > 0) {
            setFiles(prev => {
              const updated = [...prev, ...newFiles.map(f => ({ ...f, isDirty: false }))];
              setActiveFileIndex(updated.length - 1);
              return updated;
            });
          }
        }
      }
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const updateSetting = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    await window.api.setSetting(key, value);
  };

  const handleOpenFiles = async () => {
    const newFiles = await window.api.openFile();
    if (newFiles && newFiles.length > 0) {
      setFiles(prev => {
        const updated = [...prev, ...newFiles.map(f => ({ ...f, isDirty: false }))];
        setActiveFileIndex(updated.length - 1);
        return updated;
      });
    }
  };

  const handleEditorChange = (value) => {
    if (activeFileIndex > -1) {
      setFiles(prev => {
        const newFiles = [...prev];
        const val = value || '';
        newFiles[activeFileIndex].raw = val;
        newFiles[activeFileIndex].isDirty = true;

        const match = val.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
          newFiles[activeFileIndex].content = match[2];
          try {
            const fm = yaml.load(match[1]);
            newFiles[activeFileIndex].frontmatter = fm || {};
          } catch (e) {
            console.error('YAML Parsing Error:', e);
            newFiles[activeFileIndex].frontmatter = {};
          }
        } else {
          newFiles[activeFileIndex].content = val;
          newFiles[activeFileIndex].frontmatter = {};
        }
        return newFiles;
      });
    }
  };

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      setFiles(prev => {
        const currentIndex = activeFileIndexRef.current;
        const file = prev[currentIndex];
        if (file) {
          window.api.writeFile(file.path, file.raw, true).then(res => {
            if (res.success) {
              setFiles(current => {
                const next = [...current];
                next[currentIndex].isDirty = false;
                return next;
              });
              showToast(`Saved ${file.name}`);
            } else {
              showToast(`Error saving: ${res.error}`);
            }
          });
        }
        return prev;
      });
    });
  };

  const exportDocx = async () => {
    if (activeFileIndex < 0) return;
    const f = files[activeFileIndex];
    const res = await window.api.exportDocx({
      markdown: f.content,
      filename: f.path, // Pass full path for correct base path resolution
      frontmatter: f.frontmatter
    });
    if (res.success) showToast(`Exported DOCX to ${res.path}`);
    else showToast(`Export failed: ${res.error}`);
  };

  const exportPdf = async () => {
    if (activeFileIndex < 0) return;
    const f = files[activeFileIndex];
    const html = marked.parse(f.content);
    const res = await window.api.exportPdf({
      html: html,
      filename: f.path, // Pass full path for correct base path resolution
      theme: settings.defaultTheme,
      pageSize: settings.pdfPageSize,
      frontmatter: f.frontmatter
    });
    if (res.success) showToast(`Exported PDF to ${res.path}`);
    else showToast(`Export failed: ${res.error}`);
  };

  const exportBatch = async () => {
    if (files.length === 0) return;
    const folder = await window.api.saveFolder();
    if (!folder) return;

    await window.api.setSetting('defaultOutputFolder', folder);
    showToast(`Starting batch export...`);

    const res = await window.api.exportBatch(files);
    if (res.success) {
      showToast(`Batch exported ${res.count} files`);
    } else {
      showToast(`Batch export had errors. Exported ${res.count}/${files.length}`);
    }
  };

  const activeFile = files[activeFileIndex];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-64 border-r flex flex-col bg-muted/30">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <FileIcon className="w-5 h-5 text-primary" /> MDForge
          </h2>
        </div>

        <div className="p-2 flex gap-2 border-b">
          <Button variant="outline" size="sm" className="w-full flex gap-2" onClick={handleOpenFiles}>
            <FileUp className="w-4 h-4" /> Open
          </Button>
          <Button variant="outline" size="sm" className="w-full flex gap-2" onClick={exportBatch}>
            <FolderUp className="w-4 h-4" /> Batch
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {files.map((f, i) => {
            const words = (f.content || '').split(/\s+/).filter(w => w.length > 0).length;
            return (
              <div
                key={f.path}
                className={`p-3 border-b text-sm cursor-pointer hover:bg-muted transition-colors flex justify-between items-center ${i === activeFileIndex ? 'bg-muted border-l-4 border-l-primary' : ''}`}
                onClick={() => setActiveFileIndex(i)}
              >
                <span className="truncate flex-1">{f.name}{f.isDirty ? '*' : ''}</span>
                <span className="text-xs text-muted-foreground ml-2">{words}w</span>
              </div>
            );
          })}
          {files.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
              <FileIcon className="w-8 h-8 opacity-20" />
              Drag & Drop Markdown files here
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-background">
          <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4" /> Settings
          </h3>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Theme</Label>
              <Select value={settings.defaultTheme} onValueChange={(v) => updateSetting('defaultTheme', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="academic">Academic</SelectItem>
                  <SelectItem value="minimal">Minimal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Page Size</Label>
              <Select value={settings.pdfPageSize} onValueChange={(v) => updateSetting('pdfPageSize', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4</SelectItem>
                  <SelectItem value="Letter">Letter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Font Size</Label>
                <Input className="h-8 text-xs" value={settings.pdfFontSize} onChange={(e) => updateSetting('pdfFontSize', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Margins</Label>
                <Input className="h-8 text-xs" value={settings.pdfMargins} onChange={(e) => updateSetting('pdfMargins', e.target.value)} />
              </div>
            </div>
            <div className="flex items-center space-x-2 pt-1">
              <Checkbox id="auto-open" checked={settings.autoOpen} onCheckedChange={(v) => updateSetting('autoOpen', v)} />
              <Label htmlFor="auto-open" className="text-xs font-normal">Auto-open after export</Label>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Tab Bar */}
        <div className="flex bg-muted/50 border-b overflow-x-auto min-h-10">
          {files.map((f, i) => (
            <div
              key={f.path}
              className={`px-4 py-2 text-sm border-r cursor-pointer select-none whitespace-nowrap flex items-center gap-2 ${i === activeFileIndex ? 'bg-background font-medium border-t-2 border-t-primary' : 'hover:bg-muted'}`}
              onClick={() => setActiveFileIndex(i)}
            >
              {f.name}{f.isDirty ? '*' : ''}
              <button
                className="text-muted-foreground hover:text-foreground rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-label={`Close ${f.name}`}
                title={`Close ${f.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFiles(prev => {
                    const next = [...prev];
                    next.splice(i, 1);
                    if (activeFileIndex === i) setActiveFileIndex(next.length > 0 ? 0 : -1);
                    else if (activeFileIndex > i) setActiveFileIndex(activeFileIndex - 1);
                    return next;
                  });
              }}>✕</button>
            </div>
          ))}
        </div>

        {/* Editor and Preview Split */}
        {activeFile ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Monaco Editor */}
            <div className="flex-1 border-r">
              <Editor
                height="100%"
                defaultLanguage="markdown"
                theme="vs-dark"
                value={activeFile.raw}
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                options={{
                  wordWrap: 'on',
                  minimap: { enabled: false },
                  padding: { top: 16 }
                }}
              />
            </div>

            {/* Live Preview */}
            <div className="flex-1 flex flex-col bg-white text-black overflow-hidden relative">
              {/* Frontmatter Strip */}
              {activeFile.frontmatter && Object.keys(activeFile.frontmatter).length > 0 && (
                <div className="bg-slate-100 border-b p-3 text-sm text-slate-700">
                  {Object.entries(activeFile.frontmatter).map(([k, v]) => (
                    <span key={k} className="mr-4"><strong>{k}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  ))}
                </div>
              )}

              <div
                className="flex-1 overflow-y-auto p-8 prose prose-slate max-w-none"
                dangerouslySetInnerHTML={{ __html: marked.parse(activeFile.content || '') }}
              />

              {/* Action Strip */}
              <div className="border-t p-3 bg-slate-50 flex justify-end gap-2 shrink-0">
                <Button variant="outline" onClick={exportDocx} className="flex gap-2 text-black border-slate-300">
                  <Download className="w-4 h-4" /> Export DOCX
                </Button>
                <Button onClick={exportPdf} className="flex gap-2">
                  <Download className="w-4 h-4" /> Export PDF
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <div className="flex flex-col items-center gap-2">
              <FileIcon className="w-12 h-12 opacity-20" />
              <p>No file opened. Drag & drop a markdown file or open one to start editing.</p>
            </div>
            <Button onClick={handleOpenFiles} className="flex gap-2">
              <FileUp className="w-4 h-4" /> Open File
            </Button>
          </div>
        )}
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-foreground text-background px-4 py-2 rounded shadow-lg z-50 text-sm animate-in slide-in-from-bottom-5">
          {toast}
        </div>
      )}

      {/* Banner */}
      {banner && (
        <div className="fixed top-0 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 px-4 py-1 rounded-b shadow-md z-50 text-xs font-medium animate-in slide-in-from-top-5">
          File updated externally.
        </div>
      )}
    </div>
  );
}
