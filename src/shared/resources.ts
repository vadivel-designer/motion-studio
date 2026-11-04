import type { Asset, Project } from './schema';
import type { Resources } from './render';

/** Browser-only loader for the images and fonts a project references. */
export class ResourceLoader implements Resources {
  private images = new Map<string, HTMLImageElement>();
  private keys = new Map<string, string>();
  private pending = new Map<string, Promise<void>>();
  private fonts = new Map<string, FontFace>();
  /** asset ids whose file could not be loaded */
  readonly failed = new Set<string>();

  constructor(public baseUrl: string, private onChange?: () => void) {}

  urlFor(a: Asset): string {
    const path = a.relativePath.split('/').map(encodeURIComponent).join('/');
    return `${this.baseUrl}/${path}?h=${a.hash}`;
  }

  getImage(id: string): CanvasImageSource | null {
    return this.images.get(id) ?? null;
  }

  get missing(): string[] {
    return [...this.failed];
  }

  /** Starts loading anything new/changed. Resolves when every asset is loaded or failed. */
  sync(project: Project): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const a of project.assets) {
      const key = `${a.relativePath}|${a.hash}`;
      if (this.keys.get(a.id) === key) {
        const p = this.pending.get(a.id);
        if (p) tasks.push(p);
        continue;
      }
      this.keys.set(a.id, key);
      this.failed.delete(a.id);
      const task = (a.type === 'image' ? this.loadImage(a) : this.loadFont(a)).then(
        () => { this.pending.delete(a.id); this.onChange?.(); },
        () => { this.pending.delete(a.id); this.failed.add(a.id); this.onChange?.(); },
      );
      this.pending.set(a.id, task);
      tasks.push(task);
    }
    return Promise.all(tasks).then(() => undefined);
  }

  private async loadImage(a: Asset) {
    const img = new Image();
    img.src = this.urlFor(a);
    await img.decode();
    this.images.set(a.id, img);
  }

  private async loadFont(a: Asset) {
    const family = a.family || a.originalName.replace(/\.[^.]+$/, '');
    const face = new FontFace(family, `url("${this.urlFor(a)}")`);
    await face.load();
    document.fonts.add(face);
    this.fonts.set(a.id, face);
  }
}
