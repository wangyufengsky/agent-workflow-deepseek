/** Read-only subset of JSON Schema used by MCP tool definitions. */
export interface JsonSchemaBase {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly description?: string;
}

export interface JsonSchemaString extends JsonSchemaBase {
  readonly type: 'string';
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly enum?: readonly string[];
}

export interface JsonSchemaNumber extends JsonSchemaBase {
  readonly type: 'number' | 'integer';
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface JsonSchemaBoolean extends JsonSchemaBase {
  readonly type: 'boolean';
}

export interface JsonSchemaArray extends JsonSchemaBase {
  readonly type: 'array';
  readonly items: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface JsonSchemaObject extends JsonSchemaBase {
  readonly type: 'object';
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
}

export type JsonSchema = JsonSchemaString | JsonSchemaNumber | JsonSchemaBoolean | JsonSchemaArray | JsonSchemaObject;

export function stringSchema(
  description: string,
  options: { readonly minLength?: number; readonly maxLength?: number; readonly pattern?: string; readonly enum?: readonly string[] } = {},
): JsonSchemaString {
  return {
    type: 'string',
    description,
    ...(options.minLength === undefined ? {} : { minLength: options.minLength }),
    ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
    ...(options.enum === undefined ? {} : { enum: options.enum }),
  };
}

export function integerSchema(
  description: string,
  options: { readonly minimum?: number; readonly maximum?: number } = {},
): JsonSchemaNumber {
  return {
    type: 'integer',
    description,
    ...(options.minimum === undefined ? {} : { minimum: options.minimum }),
    ...(options.maximum === undefined ? {} : { maximum: options.maximum }),
  };
}

export function booleanSchema(description: string): JsonSchemaBoolean {
  return { type: 'boolean', description };
}

export function arraySchema(
  description: string,
  items: JsonSchema,
  options: { readonly minItems?: number; readonly maxItems?: number } = {},
): JsonSchemaArray {
  return {
    type: 'array',
    description,
    items,
    ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
    ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
  };
}

/** Free-form JSON object (used for opaque planning candidate payloads). */
export const looseObjectSchema: JsonSchemaObject = {
  type: 'object',
  description: '任意 JSON 对象（由服务端做权威校验）',
  additionalProperties: true,
};

export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[] = [],
  options: { readonly description?: string; readonly additionalProperties?: boolean | JsonSchema } = {},
): JsonSchemaObject {
  return {
    type: 'object',
    ...(options.description === undefined ? {} : { description: options.description }),
    properties,
    required: [...required],
    ...(options.additionalProperties === undefined ? {} : { additionalProperties: options.additionalProperties }),
  };
}
