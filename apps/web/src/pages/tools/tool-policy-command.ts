import { ROUTES } from '@agent-workflow/shared';
import { pendingCommands, type PendingCommand } from '../../api/pending-commands.ts';

/** Policy writes share one route/scope across projects; only original identity is durable. */
export function pendingToolPolicyCommand(): PendingCommand | undefined {
  return pendingCommands().find(command => command.path === ROUTES.toolsPolicy);
}
export function toolPolicyCommandSnapshot(): string {
  const command = pendingToolPolicyCommand();
  return command === undefined ? '' : `${command.requestKey}:${command.phase ?? 'unknown'}`;
}
