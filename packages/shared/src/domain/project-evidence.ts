export interface ProjectEvidenceSource { readonly kind: import('./enums.ts').ProjectEvidenceKindValue; readonly path: string }
export interface EvidenceSourceCheck { readonly source: ProjectEvidenceSource; readonly state: import('./enums.ts').EvidenceSourceReadStateValue; readonly matchedFiles?: number; readonly truncated?: boolean; readonly reason?: string }
export interface ProjectBindingCheck {
  readonly projectId: string;
  readonly configHash: string;
  readonly checkedAt: string;
  readonly repository: { readonly state: import('./enums.ts').ProjectBindingRepositoryStateValue; readonly name?: string; readonly webUrl?: string; readonly reason?: string };
  readonly sources: readonly EvidenceSourceCheck[];
}
/** Portable non-secret configuration identity used for stale checks, not authorization. */
export function projectBindingIdentity(settings: { readonly gitlab?: unknown; readonly evidenceSources?: readonly ProjectEvidenceSource[] }): string { return JSON.stringify({ gitlab: settings.gitlab ?? null, evidenceSources: settings.evidenceSources ?? [] }); }
