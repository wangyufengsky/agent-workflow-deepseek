import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpRuntime, type McpRuntime } from './runtime.ts';
import { connectStdio, createMcpServer } from './server.ts';

export const LOG_PREFIX = '[agent-workflow-mcp]';

/**
 * Executable entry point for the managed MCP stdio server.
 *
 * stdout belongs exclusively to the MCP transport, so every log line — including
 * accidental `console.log` calls — is redirected to stderr.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  console.log = (...args: unknown[]): void => {
    console.error(LOG_PREFIX, ...args);
  };
  console.info = console.log;
  console.debug = console.log;

  const runtime: McpRuntime = buildMcpRuntime(env);
  const server = createMcpServer(runtime.registry);
  const transport: StdioServerTransport = await connectStdio(server);

  console.error(
    `${LOG_PREFIX} ready tools=${runtime.registry.size} internal=${runtime.config.internalUrl.length > 0 ? 'configured' : 'not-configured'} local-fallback=${runtime.workspace === undefined ? 'disabled' : 'enabled'}`,
  );

  let closing = false;
  const shutdown = (reason: string): void => {
    if (closing) return;
    closing = true;
    console.error(`${LOG_PREFIX} shutting down (${reason})`);
    const forced = setTimeout(() => process.exit(0), 2_000);
    forced.unref();
    server
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('uncaughtException', (error: Error) => {
    console.error(`${LOG_PREFIX} uncaught exception`, error);
    process.exit(1);
  });
  process.once('unhandledRejection', (reason: unknown) => {
    console.error(`${LOG_PREFIX} unhandled rejection`, reason);
    process.exit(1);
  });
  transport.onclose = () => shutdown('transport-closed');
  process.stdin.once('end', () => shutdown('stdin-ended'));
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().catch((error: unknown) => {
    console.error(LOG_PREFIX, 'failed to start', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
