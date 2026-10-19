import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolErrorResult, toolSuccessResult } from './errors.ts';
import type { JsonSchemaObject } from './schema.ts';

export interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/** One MCP tool. Handlers receive schema-validated arguments and return JSON data. */
export interface ToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly annotations?: ToolAnnotations;
  readonly handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolDefinitionInput<Args extends Record<string, unknown>> {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly annotations?: ToolAnnotations;
  readonly handler: (args: Args) => Promise<unknown>;
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

/** Typed helper so tool modules stay readable while the registry stays homogeneous. */
export function defineTool<Args extends Record<string, unknown>>(input: ToolDefinitionInput<Args>): ToolDefinition {
  assertToolDefinition(input);
  return { ...input, handler: (args) => input.handler(args as Args) };
}

export function assertToolDefinition(definition: { readonly name: string; readonly description: string; readonly inputSchema: JsonSchemaObject }): void {
  if (!TOOL_NAME_PATTERN.test(definition.name)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `MCP 工具名不合法：${definition.name}`, {
      details: { field: 'name', pattern: TOOL_NAME_PATTERN.source },
    });
  }
  if (typeof definition.description !== 'string' || definition.description.trim().length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `MCP 工具 ${definition.name} 缺少描述`, {
      details: { field: 'description', tool: definition.name },
    });
  }
  if (definition.inputSchema === undefined || definition.inputSchema.type !== 'object') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `MCP 工具 ${definition.name} 的 inputSchema 必须是 object`, {
      details: { field: 'inputSchema', tool: definition.name },
    });
  }
}

/** Name-indexed tool registry; duplicates are rejected eagerly. */
export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  get size(): number {
    return this.#tools.size;
  }

  register(definition: ToolDefinition): ToolDefinition {
    assertToolDefinition(definition);
    if (this.#tools.has(definition.name)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `MCP 工具名重复：${definition.name}`, {
        details: { field: 'name', tool: definition.name },
      });
    }
    this.#tools.set(definition.name, definition);
    return definition;
  }

  registerAll(definitions: readonly ToolDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  require(name: string): ToolDefinition {
    const definition = this.#tools.get(name);
    if (definition === undefined) {
      throw new AppError(ErrorCode.NOT_FOUND, `MCP 工具不存在：${name}`, { details: { tool: name } });
    }
    return definition;
  }

  list(): readonly ToolDefinition[] {
    return [...this.#tools.values()];
  }

  names(): readonly string[] {
    return this.list().map((definition) => definition.name);
  }
}

/** Execute a registered tool outside the MCP transport (used by direct tests). */
export async function invokeTool(registry: ToolRegistry, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  const definition = registry.require(name);
  try {
    const value = await definition.handler(args);
    return toolSuccessResult(value);
  } catch (error) {
    return toolErrorResult(error);
  }
}
