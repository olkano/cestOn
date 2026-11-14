import { z } from 'zod';
export const releasePath = z.string().min(1).max(600).refine(value => !/^[\\/]|^[a-z]:/i.test(value) && !value.includes(':') && !value.includes('\0') && !value.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const range = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([min, max]) => min <= max);
export const releaseSchema = z.strictObject({
  releaseId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/), sourceRevision: z.string().min(1).max(100), sourceSnapshotHash: sha, createdAt: z.iso.datetime(), requestId: z.uuid(), baseReleaseId: z.string().nullable(),
  files: z.array(z.strictObject({ path: releasePath, sha256: sha, size: z.number().int().min(0).max(536870912) })).min(1).max(30000),
  nodeMajor: z.literal(24), lockfileHash: sha, apiProtocol: z.literal(1), brokerProtocolRange: range, schemaReadRange: range, schemaWriteVersion: z.number().int().positive(), migrationIds: z.array(z.number().int().positive()), testEvidenceHashes: z.array(sha).max(100), activationClass: z.enum(['manual', 'coordinator', 'broker', 'protected']),
});
export type ReleaseManifest = z.infer<typeof releaseSchema>;
