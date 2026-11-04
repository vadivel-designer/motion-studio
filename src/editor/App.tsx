import { useEffect } from 'react';
import { ExportDialog, OpenDialog, SettingsDialog } from './Dialogs';
import { LeftPanel } from './LeftPanel';
import { Preview } from './Preview';
import { Properties } from './Properties';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';
import { Transport } from './Transport';
import {
  deleteLayers, duplicateLayers, isDirty, lastFrameTime, newProject, redo, saveProject, setTime, setTimeExact,
  stepFrame, togglePlay, undo, useEditor,
} from './store';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'button', 'range', 'color'].includes((el as HTMLInputElement).type)) || el.isContentEditable;
};

function usePlayback() {
  const playing = useEditor((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const s = useEditor.getState();
      const dt = (now - last) / 1000;
      last = now;
      const end = lastFrameTime(s.project);
      const dur = s.project.settings.durationSec;
      let t = s.time + dt;
      if (t > end) {
        if (s.loop) t = t % dur;
        else { setTimeExact(end); useEditor.setState({ playing: false }); return; }
      }
      setTimeExact(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

export function App() {
  const dialog = useEditor((s) => s.dialog);
  const toastMsg = useEditor((s) => s.toast);
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor(isDirty);
  usePlayback();

  useEffect(() => { void newProject(); }, []);
  useEffect(() => { document.title = `${dirty ? '● ' : ''}${name} — Motion Studio`; }, [dirty, name]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (isDirty(useEditor.getState())) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    // dropping a file outside a drop zone must not navigate away from the editor
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => { window.removeEventListener('beforeunload', h); window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { if (isTyping(e.target) && (e.target as HTMLElement).tagName === 'TEXTAREA') return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 's') { e.preventDefault(); void saveProject(); return; }
      if (isTyping(e.target) || useEditor.getState().dialog) return;
      const s = useEditor.getState();
      if (mod && k === 'd') { e.preventDefault(); if (s.selection.length) duplicateLayers(s.selection); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(e.shiftKey ? -10 : -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(e.shiftKey ? 10 : 1); }
      else if (e.key === 'Home') { setTime(0); }
      else if (e.key === 'End') { setTime(lastFrameTime(s.project)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) { e.preventDefault(); deleteLayers(s.selection); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftPanel />
        <div className="center">
          <Preview />
          <Transport />
          <Timeline />
        </div>
        <Properties />
      </div>
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'open' && <OpenDialog />}
      {dialog === 'export' && <ExportDialog />}
      {toastMsg && <div className="toast" role="status" data-testid="toast">{toastMsg}</div>}
    </div>
  );
}
