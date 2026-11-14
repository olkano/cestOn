import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseSchema, releasePath, type ReleaseManifest } from '../../../packages/contracts/src/release.js';
import { canonicalPath, safePath } from '../../../packages/contracts/src/paths.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { fileHash } from '../../../packages/contracts/src/files.js';
export function inventory(root: string) {
  const files: ReleaseManifest['files'] = []; let total = 0;
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name; if (relative === 'release-manifest.json') continue;
      const file = join(directory, entry.name); const stat = lstatSync(file);
      if (!releasePath.safeParse(relative).success || entry.isSymbolicLink() || stat.isSymbolicLink()) throw new DomainError('release_path_denied', 403);
      if (stat.isDirectory()) walk(file, relative);
      else if (stat.isFile()) { if (stat.nlink !== 1) throw new DomainError('release_integrity_failed'); const size = stat.size; if ((total += size) > 1024 * 1048576 || files.length >= 30000) throw new DomainError('release_size_limit', 413); files.push({ path: relative, size, sha256: fileHash(file) }); }
      else throw new DomainError('release_file_denied', 403);
    }
  };
  walk(canonicalPath(root), ''); return files.sort((a,b) => a.path.localeCompare(b.path));
}
export function manifestHash(manifest: ReleaseManifest) { return createHash('sha256').update(JSON.stringify(manifest)).digest('hex'); }
export function verifyRelease(root: string, expectedHash?: string) {
  const bytes = readFileSync(safePath(root, 'release-manifest.json')); if (bytes.length > 10 * 1048576) throw new DomainError('release_manifest_too_large', 413);
  const manifest = releaseSchema.parse(JSON.parse(bytes.toString('utf8'))); if (new Set(manifest.files.map(file => file.path.toLowerCase())).size !== manifest.files.length) throw new DomainError('release_duplicate_path');
  const actual = inventory(root); if (actual.length !== manifest.files.length || actual.some((file, index) => file.path !== manifest.files[index]!.path || file.size !== manifest.files[index]!.size || file.sha256 !== manifest.files[index]!.sha256)) throw new DomainError('release_integrity_failed');
  if (fileHash(safePath(root, 'package-lock.json')) !== manifest.lockfileHash) throw new DomainError('release_lock_mismatch');
  for (const file of actual) if (/\.(exe|dll|node|ps1|cmd|bat)$/i.test(file.path) && !file.path.startsWith('node_modules/') && !file.path.startsWith('source/') && !['scripts/windows-pipe-host.ps1', 'scripts/os-protect.ps1', 'scripts/windows-access.ps1', 'scripts/windows-startup.ps1'].includes(file.path)) throw new DomainError('release_executable_denied', 403);
  const hash = manifestHash(manifest); if (expectedHash && hash !== expectedHash) throw new DomainError('release_hash_mismatch'); return { manifest, hash };
}
