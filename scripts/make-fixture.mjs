// Generates tests/fixtures/fixture.png (320x200, distinctive colours) – run once, the PNG is committed.
import fs from 'node:fs';
import { PNG } from 'pngjs';
const W = 320, H = 200;
const png = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  let [r, g, b] = [40 + (x / W) * 120, 60 + (y / H) * 120, 200 - (x / W) * 100];
  if (x > 20 && x < 100 && y > 20 && y < 80) [r, g, b] = [230, 50, 60];
  if ((x - 230) ** 2 + (y - 120) ** 2 < 50 ** 2) [r, g, b] = [60, 220, 120];
  png.data.set([r, g, b, 255], i);
}
fs.writeFileSync('tests/fixtures/fixture.png', PNG.sync.write(png));
