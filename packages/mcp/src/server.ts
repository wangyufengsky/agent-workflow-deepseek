import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolErrorResult, toolSuccessResult } from './errors.ts';
import type { ToolDefinition, ToolRegistry } from './registry.ts';
import type { JsonSchemaObject } from './schema.ts';

export const MCP_SERVER_NAME = 'agent-workflow';
export const MCP_SERVER_VERSION = '0.1.0';

export interface CreateMcpServerOptions {
  readonly serverName?: string;
  readonly serverVersion?: string;
}

const zodSchemaCache = new WeakMap<JsonSchemaObject, unknown>();

/** Convert our declarative input schema into the Zod schema the SDK validates with. */
export function toZodInputSchema(schema: JsonSchemaObject): unknown {
  const cached = zodSchemaCache.get(schema);
  if (cached !== undefined) return cached;
  const converted = z.fromJSONSchema(schema as never);
  zodSchemaCache.set(schema, converted);
  return converted;
}

/**
 * Build the MCP server and register every tool from the registry. Errors thrown
 * by handlers are always converted to a structured `isError` result so OpenCode
 * can feed them back to the model.
 */
export function createMcpServer(registry: ToolRegistry, options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.serverName ?? MCP_SERVER_NAME,
    version: options.serverVersion ?? MCP_SERVER_VERSION,
  });
  for (const definition of registry.list()) registerDefinition(server, definition);
  return server;
}

function registerDefinition(server: McpServer, definition: ToolDefinition): void {
  server.registerTool(
    definition.name,
    {
      description: definition.description,
      ...(definition.title === undefined ? {} : { title: definition.title }),
      inputSchema: toZodInputSchema(definition.inputSchema) as unknown as AnySchema,
      ...(definition.annotations === undefined ? {} : { annotations: { ...definition.annotations } }),
    },
    async (args: unknown): Promise<CallToolResult> => {
      try {
        const value = await definition.handler(isRecord(args) ? args : {});
        return toolSuccessResult(value);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}

/** Attach a stdio transport and start serving. Logging must go to stderr. */
export async function connectStdio(
  server: McpServer,
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport(stdin as never, stdout as never);
  await server.connect(transport);
  return transport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
