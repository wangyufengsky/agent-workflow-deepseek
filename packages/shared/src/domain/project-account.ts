import type { ProjectGitAccountSourceValue, GitAuthenticationValue, GitProviderValue } from './enums.ts';
import type { OperationReceipt } from './models.ts';
export interface ProjectGitAccountDraft {
  readonly source: ProjectGitAccountSourceValue;
  readonly provider: GitProviderValue;
  readonly authentication: GitAuthenticationValue;
  readonly username: string;
  /** Write-only; blank keeps the compatible stored project credential. */
  readonly credential?: string;
  readonly repositoryUrl?: string;
}
export interface ProjectGitAccountView {
  readonly projectId: string;
  readonly revision: number;
  readonly source: ProjectGitAccountSourceValue;
  readonly provider: GitProviderValue;
  readonly authentication: GitAuthenticationValue;
  readonly username: string;
  readonly credentialSaved: boolean;
  readonly origin?: string;
}
export interface ProjectGitAccountCommand extends ProjectGitAccountDraft { readonly requestKey: string; readonly expectedRevision: number }
export interface ProjectGitAccountResponse { readonly receipt: OperationReceipt; readonly resource?: ProjectGitAccountView }
export interface ProjectGitAccountProbe { readonly readable: boolean; readonly checkedAt: string; readonly message: string; readonly refs?: number }
