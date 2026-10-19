/** Minimal runtime-discovered projection. Provider secrets and headers never cross the API. */
export interface AvailableModel {
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: string;
  readonly label: string;
}
export interface AvailableModelCatalog {
  readonly readAt: string;
  readonly models: readonly AvailableModel[];
}
