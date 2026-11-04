import { useRef, useState } from 'react';
import { getResources } from './store';
import {
  activeScene, addLayer, addScene, deleteLayers, deleteScene, duplicateLayers, duplicateScene, importFiles,
  moveLayer, moveScene, relinkAsset, removeAsset, renameLayer, renameScene, reorderLayerTo, select, setActiveScene,
  toggleLayerFlag, toggleSelect, useEditor,
} from './store';
import { pickFile } from './Preview';
import { IconButton, Section, TextField } from './ui';
import type { Layer } from '../shared/schema';
import { Phase2AddButtons } from './Phase2';

const ICON: Record<Layer['type'], string> = { text: 'T', image: '▣', shape: '◼', cursor: '↖' };

function ScenesSection() {
  const project = useEditor((s) => s.project);
  const scene = useEditor((s) => activeScene(s));
  return (
    <Section title="Scenes" tip="A scene is a block of the timeline holding its own layers." right={<button className="small" title="Add a new scene after the last one" data-testid="add-scene" onClick={addScene}>+ Scene</button>}>
      <ul className="list" data-testid="scene-list">
        {project.scenes.map((s, i) => (
          <li key={s.id} className={s.id === scene?.id ? 'active' : ''} data-testid="scene-row" onClick={() => setActiveScene(s.id)}>
            <TextField className="inline" value={s.name} title="Scene name (click to rename)" onCommit={(v) => renameScene(s.id, v)} />
            <span className="actions">
              <IconButton title="Move scene earlier (scenes re-pack back-to-back)" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveScene(s.id, -1); }}>↑</IconButton>
              <IconButton title="Move scene later (scenes re-pack back-to-back)" disabled={i === project.scenes.length - 1} onClick={(e) => { e.stopPropagation(); moveScene(s.id, 1); }}>↓</IconButton>
              <IconButton title="Duplicate this scene with all its layers" testId="duplicate-scene" onClick={(e) => { e.stopPropagation(); duplicateScene(s.id); }}>⧉</IconButton>
              <IconButton title="Delete this scene and its layers" testId="delete-scene" onClick={(e) => { e.stopPropagation(); deleteScene(s.id); }}>🗑</IconButton>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LayersSection() {
  const scene = useEditor((s) => activeScene(s));
  const selection = useEditor((s) => s.selection);
  const [dragId, setDragId] = useState<string | null>(null);
  const layers = scene ? [...scene.layers].reverse() : [];
  return (
    <Section title="Layers" tip="Top of the list is drawn on top of everything below it.">
      <div className="addbar">
        <button className="small" title="Add a text layer" data-testid="add-text" onClick={() => addLayer({ kind: 'text' })}>T Text</button>
        <button className="small" title="Add a rectangle" data-testid="add-rect" onClick={() => addLayer({ kind: 'shape', shape: 'rect' })}>▭ Rect</button>
        <button className="small" title="Add an ellipse" data-testid="add-ellipse" onClick={() => addLayer({ kind: 'shape', shape: 'ellipse' })}>◯ Ellipse</button>
        <button className="small" title="Add a triangle" data-testid="add-triangle" onClick={() => addLayer({ kind: 'shape', shape: 'triangle' })}>△ Triangle</button>
        <Phase2AddButtons />
      </div>
      <ul className="list layers" data-testid="layer-list">
        {layers.length === 0 && <li className="muted">No layers in this scene yet.</li>}
        {layers.map((l, i) => (
          <li
            key={l.id}
            data-testid="layer-row"
            className={`${selection.includes(l.id) ? 'active' : ''} ${dragId === l.id ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDragId(l.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragId) reorderLayerTo(dragId, l.id); setDragId(null); }}
            onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggleSelect(l.id) : select([l.id]))}
          >
            <span className={`ltype ${l.type}`} title={`${l.type} layer`}>{ICON[l.type]}</span>
            <TextField className="inline" value={l.name} title="Layer name (click to rename)" testId="layer-name" onCommit={(v) => renameLayer(l.id, v)} />
            <span className="actions always">
              <IconButton title={l.visible ? 'Hide this layer' : 'Show this layer'} testId="toggle-visible" active={!l.visible} onClick={(e) => { e.stopPropagation(); toggleLayerFlag(l.id, 'visible'); }}>{l.visible ? '👁' : '⊘'}</IconButton>
              <IconButton title={l.locked ? 'Unlock: allow editing in the preview and timeline' : 'Lock: protect from accidental edits'} testId="toggle-lock" active={l.locked} onClick={(e) => { e.stopPropagation(); toggleLayerFlag(l.id, 'locked'); }}>{l.locked ? '🔒' : '🔓'}</IconButton>
            </span>
            <span className="actions hover">
              <IconButton title="Move layer up (towards the front)" testId="layer-up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 'up'); }}>↑</IconButton>
              <IconButton title="Move layer down (towards the back)" testId="layer-down" disabled={i === layers.length - 1} onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 'down'); }}>↓</IconButton>
              <IconButton title="Duplicate layer" testId="layer-duplicate" onClick={(e) => { e.stopPropagation(); duplicateLayers([l.id]); }}>⧉</IconButton>
              <IconButton title="Delete layer" testId="layer-delete" onClick={(e) => { e.stopPropagation(); deleteLayers([l.id]); }}>🗑</IconButton>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AssetsSection() {
  const project = useEditor((s) => s.project);
  const missing = useEditor((s) => s.missingAssets);
  useEditor((s) => s.resourceVersion);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const loader = getResources();
  const used = (id: string) => project.scenes.some((s) => s.layers.some((l) => l.type === 'image' && l.assetId === id));
  return (
    <Section title="Assets" tip="Imported files are copied byte-for-byte into the project's assets/ folder." right={
      <button className="small" title="Import PNG, JPG, WebP, SVG images or TTF, OTF, WOFF2 fonts" data-testid="import-button" onClick={() => input.current?.click()}>Import…</button>
    }>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        data-testid="import-input"
        accept=".png,.jpg,.jpeg,.webp,.svg,.ttf,.otf,.woff2"
        onChange={(e) => { void importFiles([...(e.target.files ?? [])]); e.target.value = ''; }}
      />
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        data-testid="asset-dropzone"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void importFiles([...e.dataTransfer.files]); }}
      >
        {project.assets.length === 0 && <p className="muted">Drop images or fonts here</p>}
        <ul className="list assets" data-testid="asset-list">
          {project.assets.map((a) => {
            const isMissing = missing.includes(a.id);
            return (
              <li key={a.id} data-testid="asset-row" className={isMissing ? 'missing' : ''}>
                {a.type === 'image' && loader && !isMissing
                  ? <img className="thumb" src={loader.urlFor(a)} alt="" />
                  : <span className="thumb font">{a.type === 'font' ? 'Aa' : '?'}</span>}
                <span className="aname" title={a.originalName}>{a.originalName}{isMissing && <em> — missing</em>}</span>
                <span className="actions always">
                  {isMissing && <button className="small danger" data-testid="relink-asset" title="The file is missing from the project folder. Pick a replacement." onClick={() => pickFile(a.type === 'image' ? '.png,.jpg,.jpeg,.webp,.svg' : '.ttf,.otf,.woff2', (f) => void relinkAsset(a.id, f))}>Relink…</button>}
                  {a.type === 'image' && !isMissing && <button className="small" data-testid="place-asset" title="Place this image in the active scene" onClick={() => addLayer({ kind: 'image', assetId: a.id })}>Place</button>}
                  <IconButton title={used(a.id) ? 'In use by a layer – delete the layer first' : 'Remove this asset from the project'} disabled={used(a.id)} onClick={() => removeAsset(a.id)}>🗑</IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

export function LeftPanel() {
  return (
    <aside className="left">
      <ScenesSection />
      <LayersSection />
      <AssetsSection />
    </aside>
  );
}
