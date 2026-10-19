import type { AppSettings, CatalogSnapshot, PublicSettings } from '@agent-workflow/shared';
import { DEFAULT_CATALOG, DEFAULT_SETTINGS, mergeSettings } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { CommandService } from './operations.ts';
import { RecoveryService } from './recovery.ts';
import { ProjectService, TaskService, InboxService } from './project-task.ts';
import { PlanningService } from './planning.ts';
import { PlanService } from './plan.ts';
import { WorkspaceService } from './workspace.ts';
import { ExecutionService } from './execution.ts';
import { DeliveryService } from './delivery.ts';
import type { EngineContext } from './actions.ts';
import type { EnginePorts } from './ports.ts';

export interface EngineOptions {
  readonly store: Store;
  readonly ports: EnginePorts;
  readonly catalog?: CatalogSnapshot;
  readonly initialSettings?: AppSettings;
  readonly integration?: {
    readonly opencodeReady: () => boolean;
    readonly gitlabConfigured: () => boolean;
  };
}

/**
 * Composition root for domain services. Each module is independently testable;
 * the HTTP layer only translates transport and calls these services.
 */
export class Engine {
  readonly store: Store;
  readonly ports: EnginePorts;
  readonly catalog: CatalogSnapshot;
  readonly commands: CommandService;
  readonly context: EngineContext;
  readonly projects: ProjectService;
  readonly tasks: TaskService;
  readonly inbox: InboxService;
  readonly recoveries: RecoveryService;
  readonly planning: PlanningService;
  readonly plans: PlanService;
  readonly workspaces: WorkspaceService;
  readonly executions: ExecutionService;
  readonly deliveries: DeliveryService;
  #settings: AppSettings;

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.ports = options.ports;
    this.catalog = options.catalog ?? DEFAULT_CATALOG;
    this.#settings = mergeSettings(DEFAULT_SETTINGS, options.store.settings.getSettings() ?? {}) ?? options.initialSettings ?? DEFAULT_SETTINGS;
    this.commands = new CommandService(this.store);
    const integration = options.integration ?? { opencodeReady: () => false, gitlabConfigured: () => false };
    this.context = {
      store: this.store,
      settings: () => this.#settings,
      projects: () => this.store.projects.list(),
      opencodeReady: integration.opencodeReady,
      gitlabConfigured: integration.gitlabConfigured,
      planningBudgetConfigured: () => this.#settings.planning.budgetLimit > 0,
    };
    this.projects = new ProjectService(this.store, this.ports.git, this.commands, this.context);
    this.tasks = new TaskService(this.store, this.commands, this.context, this.projects);
    this.inbox = new InboxService(this.store, this.tasks);
    this.recoveries = new RecoveryService({ store: this.store, commands: this.commands });
    this.planning = new PlanningService(this.store, this.commands, this.context, this.ports.opencode, () => this.tasks);
    this.plans = new PlanService(this.store, this.commands, this.context, this.ports.git, () => this.tasks);
    this.workspaces = new WorkspaceService(this.store, this.commands, this.context, this.ports.git);
    this.executions = new ExecutionService(this.store, this.commands, this.context, this.ports.opencode);
    this.deliveries = new DeliveryService(this.store, this.commands, this.context, this.ports.git, this.workspaces, this.ports.remote);
  }

  get settings(): AppSettings {
    return this.#settings;
  }

  updateSettings(settings: AppSettings): void {
    this.#settings = settings;
    this.store.settings.saveSettings(settings);
  }

  publicSettings(): PublicSettings {
    return this.#settings;
  }
}
