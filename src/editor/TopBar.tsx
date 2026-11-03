import { useRef } from 'react';
import { api } from './api';
import { isDirty, newProject, openProject, redo, renameProject, saveProject, toast, undo, useEditor } from './store';
import { IconButton, TextField } from './ui';

export function confirmDiscard(): boolean {
  return !isDirty(useEditor.getState()) || window.confirm('You have unsaved changes. Discard them?');
}

export function TopBar() {
  const project = useEditor((s) => s.project);
  const dirty = useEditor(isDirty);
  const busy = useEditor((s) => s.busy);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const zipIn = useRef<HTMLInputElement>(null);
  const dialog = (d: 'open' | 'settings' | 'export') => useEditor.setState({ dialog: d });

  const exportZip = async () => {
    if (await saveProject()) window.location.href = api.zipUrl(project.name);
  };
  const importZip = async (f: File) => {
    if (!confirmDiscard()) return;
    try { await openProject((await api.importZip(f)).name); } catch (e) { toast(`Import failed: ${(e as Error).message}`); }
  };

  return (
    <header className="topbar">
      <div className="brand" title="Motion Studio">◈ Motion Studio</div>
      <div className="projname">
        <TextField value={project.name} className="title" testId="project-name" title="Project name (also the folder name: <name>.motion)" onCommit={(v) => void renameProject(v)} />
        <span className={`dirty ${dirty ? 'on' : ''}`} data-testid="dirty-dot" title={dirty ? 'Unsaved changes' : 'All changes saved'}>●</span>
      </div>
      <span className="spacer" />
      <IconButton title="Undo (Ctrl+Z)" testId="undo" disabled={!canUndo} onClick={undo}>↶</IconButton>
      <IconButton title="Redo (Ctrl+Shift+Z)" testId="redo" disabled={!canRedo} onClick={redo}>↷</IconButton>
      <button title="Start a new empty project" data-testid="new-project" onClick={() => confirmDiscard() && void newProject()}>New</button>
      <button title="Open a saved project" data-testid="open-project" onClick={() => dialog('open')}>Open</button>
      <button title="Save to projects/<name>.motion/project.json (Ctrl+S)" data-testid="save" disabled={busy} onClick={() => void saveProject()}>Save</button>
      <button title="Duration, aspect ratio, resolution, frame rate and background" data-testid="settings" onClick={() => dialog('settings')}>Settings</button>
      <button title="Save and download the whole project (project.json + assets) as one .zip" data-testid="export-zip" onClick={() => void exportZip()}>Export .zip</button>
      <button title="Import a project .zip made with “Export .zip”" data-testid="import-zip" onClick={() => zipIn.current?.click()}>Import .zip</button>
      <input ref={zipIn} type="file" accept=".zip" hidden data-testid="import-zip-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importZip(f); e.target.value = ''; }} />
      <button className="primary" title="Render the project to an MP4 video" data-testid="export-mp4" onClick={() => dialog('export')}>Export MP4</button>
    </header>
  );
}
