import { z } from 'zod'

export const adapterInstallMethodSchema = z.enum(['local', 'ssh', 'docker'])

export const claraHarnessPairingRequestSchema = z.object({
  kind: z.string().trim().min(1).max(64),
  /** Where the adapter will run; the hub uses it to choose the transport. */
  method: adapterInstallMethodSchema.optional(),
})

export type ClaraHarnessPairingRequest = z.infer<typeof claraHarnessPairingRequestSchema>

export const claraHarnessPairingSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  code: z.string(),
  transport: z.enum(['local', 'docker', 'relay']),
  wsUrl: z.string(),
  room: z.string(),
  fingerprint: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
})

export type ClaraHarnessPairing = z.infer<typeof claraHarnessPairingSchema>

export const claraAdapterInstallArtifactSchema = z.object({
  url: z.string(),
  sha256: z.string(),
  size: z.number().optional(),
})

export const claraAdapterInstallManifestSchema = z.object({
  schemaVersion: z.literal(1),
  harness: z.string(),
  version: z.string(),
  publishedAt: z.string().optional(),
  install: z.string(),
  installSha256: z.string(),
  artifacts: z.record(z.string(), claraAdapterInstallArtifactSchema),
})

export type ClaraAdapterInstallManifest = z.infer<typeof claraAdapterInstallManifestSchema>

export const claraAdapterInstallManifestResponseSchema = z.object({
  manifest: claraAdapterInstallManifestSchema,
})

export type ClaraAdapterInstallManifestResponse = z.infer<
  typeof claraAdapterInstallManifestResponseSchema
>

export const claraHarnessPairingResponseSchema = z.object({
  pairing: claraHarnessPairingSchema,
  manifest: claraAdapterInstallManifestSchema.optional(),
  command: z.string().optional(),
  deepLink: z.string(),
})

export type ClaraHarnessPairingResponse = z.infer<typeof claraHarnessPairingResponseSchema>
