import { formatTime } from '../shared/animation';
import { lastFrameTime, replay, setTime, stepFrame, togglePlay, useEditor } from './store';
import { IconButton, NumberField } from './ui';

export function Transport() {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const project = useEditor((s) => s.project);
  const { fps, durationSec } = project.settings;
  const frame = Math.round(time * fps);
  const total = Math.max(1, Math.round(durationSec * fps));
  return (
    <div className="transport" data-testid="transport">
      <IconButton title="Jump to the first frame (Home)" testId="to-start" onClick={() => { useEditor.setState({ playing: false }); setTime(0); }}>⏮</IconButton>
      <IconButton title="Previous frame (←)" testId="step-back" onClick={() => stepFrame(-1)}>◂</IconButton>
      <IconButton title={playing ? 'Pause (Space)' : 'Play (Space)'} testId="play" active={playing} onClick={togglePlay}>{playing ? '⏸' : '▶'}</IconButton>
      <IconButton title="Next frame (→)" testId="step-forward" onClick={() => stepFrame(1)}>▸</IconButton>
      <IconButton title="Replay from the start" testId="replay" onClick={replay}>↺</IconButton>
      <IconButton title={loop ? 'Looping: playback restarts at the end. Click to turn off.' : 'Loop playback when it reaches the end'} testId="loop" active={loop} onClick={() => useEditor.setState({ loop: !loop })}>🔁</IconButton>
      <span className="spacer" />
      <label className="timefield" title="Current time in seconds. Type a value to jump there.">
        <NumberField testId="time-input" value={time} step={1 / fps} min={0} max={lastFrameTime(project)} decimals={3} width={72} onCommit={(v) => { useEditor.setState({ playing: false }); setTime(v); }} />
        <span className="unit">s</span>
      </label>
      <span className="counter" data-testid="time-counter" title="Time and frame number">{formatTime(time, fps)} · frame {frame + 1} / {total} · {fps} fps</span>
    </div>
  );
}
