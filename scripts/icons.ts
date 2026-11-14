import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function generateIcons() {
  const output = resolve('apps/web/public'); await mkdir(output, { recursive: true });
  const source = resolve('assets/cestOn-icon.svg'); await copyFile(source, resolve(output, 'cestOn-icon.svg'));
  for (const size of [180, 192, 512]) await sharp(source).resize(size, size).png().toFile(resolve(output, `icon-${size}.png`));
  for (const size of [192, 512]) {
    const inner = await sharp(source).resize(Math.floor(size * .7), Math.floor(size * .7)).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: '#1e1e1e' } }).composite([{ input: inner, gravity: 'centre' }]).png().toFile(resolve(output, `maskable-${size}.png`));
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/icons.ts')) await generateIcons();
