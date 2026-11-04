import { useEffect, useState } from 'react';
import { scenesBeyondEnd, ASPECT_RATIOS, RESOLUTION_PRESETS, shortSide } from '../shared/settings';
import { api } from './api';
import { openProject, saveProject, updateSettings, useEditor, isDirty } from './store';
import { ColorField, Modal, NumberField, Row } from './ui';
import { ASPECTS } from '../shared/schema';

export function SettingsDialog() {
  const project = useEditor((s) => s.project);
  const s = project.settings;
  const close = () => useEditor.setState({ dialog: null });
  const short = shortSide(s);
  const preset = s.aspect !== 'custom' && RESOLUTION_PRESETS.find((p) => p.short === short);
  const beyond = scenesBeyondEnd(project);
  return (
    <Modal title="Project settings" onClose={close} testId="settings-dialog">
      <p className="hint">Changing these never deletes layers. A new resolution rescales positions and sizes to fit.</p>
      <Row label="Duration" tip="Total length of the exported video, in seconds">
        <NumberField testId="set-duration" value={s.durationSec} step={1} min={0.1} max={3600} onCommit={(v) => updateSettings({ durationSec: v })} /><span className="unit">s</span>
      </Row>
      {beyond > 0 && <p className="warn">{beyond} scene{beyond > 1 ? 's' : ''} extend past the end — that part will not be exported.</p>}
      <Row label="Aspect ratio" tip="Shape of the video frame">
        <select data-testid="set-aspect" value={s.aspect} title="Aspect ratio of the video" onChange={(e) => updateSettings({ aspect: e.target.value as any })}>
          {ASPECTS.map((a) => <option key={a} value={a}>{a === 'custom' ? 'Custom' : a}</option>)}
        </select>
      </Row>
      <Row label="Resolution" tip="Output size. Text and shapes are re-drawn crisply at this size.">
        <select
          data-testid="set-resolution"
          title="Output resolution (length of the shorter side)"
          disabled={s.aspect === 'custom'}
          value={preset ? String(preset.short) : 'other'}
          onChange={(e) => updateSettings({ short: Number(e.target.value) })}
        >
          {RESOLUTION_PRESETS.map((p) => <option key={p.short} value={p.short}>{p.label}</option>)}
          {!preset && <option value="other">{s.aspect === 'custom' ? 'Custom (set below)' : `${short}p`}</option>}
        </select>
      </Row>
      <Row label="Size (px)" tip="Exact output width × height. Editing either switches the aspect ratio to Custom.">
        <NumberField testId="set-width" value={s.width} decimals={0} min={16} max={16384} width={70} onCommit={(v) => updateSettings({ width: v })} />
        <span className="unit">×</span>
        <NumberField testId="set-height" value={s.height} decimals={0} min={16} max={16384} width={70} onCommit={(v) => updateSettings({ height: v })} />
      </Row>
      <Row label="Frame rate" tip="Frames per second of the exported video">
        <select data-testid="set-fps" value={s.fps} title="Frames per second" onChange={(e) => updateSettings({ fps: Number(e.target.value) })}>
          {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
          {![24, 25, 30, 50, 60].includes(s.fps) && <option value={s.fps}>{s.fps} fps</option>}
        </select>
      </Row>
      <Row label="Background" tip="Color behind all layers">
        <ColorField value={s.background} title="Background color" testId="set-background" onChange={(v) => updateSettings({ background: v })} />
      </Row>
      <p className="hint">{Object.keys(ASPECT_RATIOS).length} presets · {s.width}×{s.height} @ {s.fps} fps · {s.durationSec}s</p>
      <div className="modal-actions"><button className="primary" onClick={close}>Done</button></div>
    </Modal>
  );
}

export function OpenDialog() {
  const [list, setList] = useState<{ name: string; modified: number }[] | null>(null);
  const dirty = useEditor(isDirty);
  const close = () => useEditor.setState({ dialog: null });
  useEffect(() => { void api.list().then(setList).catch(() => setList([])); }, []);
  return (
    <Modal title="Open project" onClose={close} testId="open-dialog">
      {dirty && <p className="warn">You have unsaved changes. Opening another project discards them.</p>}
      {list === null && <p className="muted">Loading…</p>}
      {list?.length === 0 && <p className="muted">No saved projects yet.</p>}
      <ul className="list" data-testid="project-list">
        {list?.map((p) => (
          <li key={p.name} data-testid="project-item" onClick={() => void openProject(p.name)} title={`Open ${p.name}.motion`}>
            <strong>{p.name}</strong><span className="muted">{new Date(p.modified).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; frame: number; total: number }
  | { kind: 'done'; jobId: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

export function ExportDialog() {
  const project = useEditor((s) => s.project);
  const folder = useEditor((s) => s.folder);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [ff, setFf] = useState<{ found: boolean } | null>(null);
  const [cli, setCli] = useState<string>('');
  const close = () => { if (phase.kind !== 'running') useEditor.setState({ dialog: null }); };
  const s = project.settings;
  const cliGuess = `npm run render -- "${folder ?? `projects/${project.name}.motion`}" "${project.name}.mp4"`;

  useEffect(() => { void api.health().then((h) => setFf(h.ffmpeg)); }, []);
  useEffect(() => {
    if (phase.kind !== 'running') return;
    const id = phase.jobId;
    const timer = setInterval(async () => {
      try {
        const st = await api.exportStatus(id);
        if (st.status === 'running') setPhase({ kind: 'running', jobId: id, frame: st.frame, total: st.total });
        else if (st.status === 'done') setPhase({ kind: 'done', jobId: id });
        else if (st.status === 'cancelled') setPhase({ kind: 'cancelled' });
        else setPhase({ kind: 'error', message: st.error ?? 'Export failed' });
      } catch (e) { setPhase({ kind: 'error', message: (e as Error).message }); }
    }, 400);
    return () => clearInterval(timer);
  }, [phase.kind === 'running' ? phase.jobId : null]);

  const start = async () => {
    if (!(await saveProject())) return setPhase({ kind: 'error', message: 'Could not save the project before exporting.' });
    try {
      const r = await api.startExport(project.name);
      setCli(r.cliCommand);
      setPhase({ kind: 'running', jobId: r.jobId, frame: 0, total: Math.round(s.durationSec * s.fps) });
    } catch (e: any) {
      if (e.cliCommand) setCli(e.cliCommand);
      setPhase({ kind: 'error', message: e.message });
    }
  };

  return (
    <Modal title="Export MP4" onClose={close} testId="export-dialog">
      <p>{s.width}×{s.height} · {s.fps} fps · {s.durationSec}s · H.264 (CRF 16, yuv420p)</p>
      <p className="hint">The project is saved first, then rendered frame by frame in a headless browser using the same drawing code as the preview.</p>
      {ff && !ff.found && phase.kind === 'idle' && (
        <div className="error" data-testid="ffmpeg-missing">
          <strong>ffmpeg was not found.</strong> Install it (Windows: <code>winget install Gyan.FFmpeg</code>), open a new terminal, and retry.
          <br />You can render the saved project from a terminal with: <code>{cliGuess}</code>
        </div>
      )}
      {phase.kind === 'running' && (
        <div data-testid="export-progress">
          <progress max={phase.total} value={phase.frame} />
          <p>Rendering frame {phase.frame} / {phase.total}</p>
        </div>
      )}
      {phase.kind === 'done' && (
        <p data-testid="export-done">✅ Export finished. <a href={api.downloadUrl(phase.jobId)} download data-testid="export-download">Download {project.name}.mp4</a></p>
      )}
      {phase.kind === 'cancelled' && <p className="warn" data-testid="export-cancelled">Export cancelled.</p>}
      {phase.kind === 'error' && (
        <div className="error" data-testid="export-error">
          <p>{phase.message}</p>
          <p>To render the saved project from a terminal: <code>{cli || cliGuess}</code></p>
        </div>
      )}
      <div className="modal-actions">
        {phase.kind === 'running'
          ? <button data-testid="export-cancel" title="Stop rendering and discard the partial file" onClick={() => void api.cancelExport(phase.jobId)}>Cancel export</button>
          : <>
              <button onClick={close}>Close</button>
              <button className="primary" data-testid="export-start" title="Save the project and render the MP4" onClick={() => void start()}>
                {phase.kind === 'idle' ? 'Start export' : 'Export again'}
              </button>
            </>}
      </div>
    </Modal>
  );
}
