import { createWriteStream, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { open } from 'yauzl';
import { createHash } from 'node:crypto';
import { verifyRelease } from '../apps/supervisor/src/releases.js';
import { fileHash } from '../packages/contracts/src/files.js';
export async function verifyArchive(root: string, archive: string) {
  const release = verifyRelease(root); const expected = new Map([...release.manifest.files, { path: 'release-manifest.json', sha256: fileHash(join(root, 'release-manifest.json')) }].map(file => [file.path, file.sha256])); const seen = new Set<string>();
  await new Promise<void>((done, reject) => { open(archive, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => { if (error || !zip) { reject(error); return; } const fail = (error: unknown) => { zip.close(); reject(error); }; zip.once('error', fail); zip.once('end', () => { zip.close(); if (seen.size !== expected.size) reject(new Error('Archive file set mismatch')); else done(); }); zip.on('entry', entry => { const wanted = expected.get(entry.fileName); if (!wanted || seen.has(entry.fileName) || entry.uncompressedSize > 1024 * 1048576) { fail(new Error('Unexpected archive entry')); return; } seen.add(entry.fileName); zip.openReadStream(entry, (error, stream) => { if (error || !stream) { fail(error); return; } const hash = createHash('sha256'); stream.on('data', bytes => hash.update(bytes)); stream.once('error', fail); stream.once('end', () => { if (hash.digest('hex') !== wanted) fail(new Error('Archive content mismatch')); else zip.readEntry(); }); }); }); zip.readEntry(); }); });
  return { files: seen.size, manifestHash: release.hash };
}
export async function archiveRelease(root: string, output: string) {
  if (existsSync(output) || existsSync(`${output}.partial`)) throw new Error('Archive target already exists');
  const release = verifyRelease(root); const zip = new ZipFile(); const target = createWriteStream(`${output}.partial`, { flags: 'wx' });
  const finished = pipeline(zip.outputStream, target); zip.once('error', error => target.destroy(error));
  for (const file of [...release.manifest.files, { path: 'release-manifest.json' }]) zip.addFile(join(root, file.path), file.path, { mtime: new Date('2026-01-01T00:00:00Z'), mode: 0o100644, compressionLevel: 1 });
  zip.end(); await finished; await verifyArchive(root, `${output}.partial`); verifyRelease(root, release.hash); renameSync(`${output}.partial`, output);
}
