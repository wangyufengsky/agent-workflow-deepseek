/** Minimal typed surface of the OpenCode 1.19.0 local server used by the app. */

export interface OpenCodeSession {
  readonly id: string;
  readonly title?: string;
  readonly directory?: string;
  readonly version?: string;
  readonly model?: { readonly id: string; readonly providerID: string };
  readonly agent?: string;
  readonly time?: { readonly created: number; readonly updated: number };
}

export interface OpenCodePart {
  readonly id?: string;
  readonly type: string;
  readonly text?: string;
  readonly tool?: string;
  readonly callID?: string;
  readonly state?: {
    readonly status?: string;
    readonly input?: Record<string, unknown>;
    readonly output?: string;
    readonly title?: string;
    readonly error?: string;
    readonly metadata?: Record<string, unknown>;
    readonly time?: Record<string, number>;
  };
  readonly sessionID?: string;
  readonly messageID?: string;
}

export interface OpenCodeMessageInfo {
  readonly id: string;
  readonly sessionID: string;
  readonly role: 'user' | 'assistant';
  readonly time?: { readonly created: number; readonly completed?: number };
  readonly error?: { readonly name?: string; readonly message?: string; readonly data?: unknown };
  readonly modelID?: string;
  readonly providerID?: string;
  readonly cost?: number;
  readonly tokens?: Record<string, unknown>;
}

export interface OpenCodeMessage {
  readonly info: OpenCodeMessageInfo;
  readonly parts: readonly OpenCodePart[];
}

export interface OpenCodeEvent {
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

export interface OpenCodeModelRef {
  readonly providerID: string;
  readonly modelID: string;
}

export interface PromptInput {
  readonly text: string;
  readonly model: OpenCodeModelRef;
  readonly agent?: string;
  readonly system?: string;
  readonly tools?: Record<string, boolean>;
  readonly jsonSchema?: Record<string, unknown>;
  readonly messageId?: string;
}

export interface OpenCodeConfigInput {
  readonly model: OpenCodeModelRef;
  readonly mcp?: Record<string, unknown>;
  readonly permission?: Record<string, unknown>;
  readonly agent?: Record<string, unknown>;
  readonly instructions?: readonly string[];
  readonly extra?: Record<string, unknown>;
}

export interface StartOptions {
  readonly binaryPath: string;
  readonly expectedVersion: string;
  readonly host: string;
  readonly port: number;
  readonly configPath: string;
  readonly cwd: string;
  readonly password: string;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly logPath: string;
  readonly env?: Record<string, string>;
}

export interface OpenCodeManagerStatus {
  readonly state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed';
  readonly version?: string;
  readonly host?: string;
  readonly port?: number;
  readonly pid?: number;
  readonly startedAt?: string;
  readonly lastError?: string;
  readonly baseUrl?: string;
}
