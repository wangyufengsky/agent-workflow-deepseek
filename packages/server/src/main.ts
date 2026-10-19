import { createApplication } from './application.ts';

const application = await createApplication();
const address = application.app.server.address();
const shownUrl = address !== null && typeof address === 'object' ? `http://${address.address}:${address.port}` : application.url;
console.log(`[agent-workflow] listening on ${shownUrl}`);
console.log(`[agent-workflow] data dir: ${application.paths.dataDir}`);
console.log(`[agent-workflow] opencode: ${application.adapter?.status().state ?? 'disabled'}`);

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`[agent-workflow] ${signal} received, shutting down`);
  await application.close().catch((error: unknown) => console.error('[agent-workflow] shutdown error', error));
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('[agent-workflow] uncaught exception', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[agent-workflow] unhandled rejection', error);
});
