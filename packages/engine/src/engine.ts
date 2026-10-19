import type { AppSettings, CatalogSnapshot, PublicSettings } from '@agent-workflow/shared';
import { DEFAULT_CATALOG, DEFAULT_SETTINGS, mergeSettings } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { CommandService } from './operations.ts';
import { RecoveryService } from './recovery.ts';
import { RoleCatalogService } from './role-catalog.ts';
import { MethodCatalogService } from './method-catalog.ts';
import { TaskExtrasService } from './task-extras.ts';
import { InsightsService } from './insights.ts';
import { KnowledgeService } from './knowledge.ts';
import { PptService } from './ppt.ts';
import { AcceptanceService } from './acceptance.ts';
import { TemplateCatalogService } from './template-catalog.ts';
import { CharterService, ProjectService, TaskService, InboxService } from './project-task.ts';
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

/** Result of `Engine.recoverOnStartup`, also used as startup diagnostics. */
export interface StartupRecoverySummary {
  readonly executions: number;
  readonly planningRounds: number;
  readonly workspaces: number;
  readonly pptWorks: number;
  readonly affectedTaskIds: readonly string[];
  readonly failures: readonly { readonly scope: string; readonly message: string }[];
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
  readonly charters: CharterService;
  readonly inbox: InboxService;
  readonly recoveries: RecoveryService;
  readonly roleCatalog: RoleCatalogService;
  readonly methods: MethodCatalogService;
  readonly extras: TaskExtrasService;
  readonly insights: InsightsService;
  readonly knowledge: KnowledgeService;
  readonly ppt: PptService;
  readonly acceptances: AcceptanceService;
  readonly templates: TemplateCatalogService;
  readonly planning: PlanningService;
  readonly plans: PlanService;
  readonly workspaces: WorkspaceService;
  readonly executions: ExecutionService;
  readonly deliveries: DeliveryService;
  #settings: AppSettings;
  readonly #baseCatalog: CatalogSnapshot;

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.ports = options.ports;
    this.#baseCatalog = options.catalog ?? DEFAULT_CATALOG;
    // The method catalog service is constructed before the effective catalog so
    // the live `catalog.methods` getter can merge built-ins with user methods.
    this.methods = new MethodCatalogService({
      store: this.store,
      roleIds: () => this.catalog.roles.map((role) => role.id),
    });
    const listMergedMethods = (): readonly import('@agent-workflow/shared').WorkflowMethod[] =>
      this.methods
        .list()
        .map((entry) => this.methods.resolve(entry.id))
        .filter((method): method is import('@agent-workflow/shared').WorkflowMethod => method !== undefined);
    this.catalog = {
      ...this.#baseCatalog,
      // Services capture this object once; a getter keeps custom methods visible
      // to task creation / planning / plan skeletons without rebuilding services.
      get methods() {
        return listMergedMethods();
      },
    };
    this.#settings = mergeSettings(DEFAULT_SETTINGS, options.store.settings.getSettings() ?? {}) ?? options.initialSettings ?? DEFAULT_SETTINGS;
    this.commands = new CommandService(this.store);
    this.roleCatalog = new RoleCatalogService({
      store: this.store,
      commands: this.commands,
      applyRoles: (roles) => {
        (this.catalog as { roles: readonly import('@agent-workflow/shared').RoleDefinition[] }).roles = roles;
      },
    });
    this.roleCatalog.applyEffective();
    this.templates = new TemplateCatalogService(this.store, this.commands, (templates) => {
      (this.catalog as { templates: readonly import('@agent-workflow/shared').TaskTemplate[] }).templates = templates;
    });
    this.templates.applyEffective(this.catalog.templates);
    this.insights = new InsightsService(this.store);
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
    this.tasks = new TaskService(this.store, this.commands, this.context, this.projects, this.catalog);
    this.charters = new CharterService(this.store, this.commands, this.ports.opencode, this.context);
    this.extras = new TaskExtrasService({ store: this.store, templates: () => this.catalog.templates });
    this.inbox = new InboxService(this.store, this.tasks);
    this.recoveries = new RecoveryService({ store: this.store, commands: this.commands });
    this.planning = new PlanningService(this.store, this.commands, this.context, this.ports.opencode, () => this.tasks, this.catalog);
    this.plans = new PlanService(this.store, this.commands, this.context, this.ports.git, () => this.tasks, this.catalog, () => this.executions);
    this.workspaces = new WorkspaceService(this.store, this.commands, this.context, this.ports.git);
    this.executions = new ExecutionService(this.store, this.commands, this.context, this.ports.opencode);
    this.deliveries = new DeliveryService(this.store, this.commands, this.context, this.ports.git, this.workspaces, this.ports.remote);
    this.knowledge = new KnowledgeService({ store: this.store, commands: this.commands, context: this.context, opencode: this.ports.opencode, roles: () => this.catalog.roles });
    this.ppt = new PptService(this.store, this.commands, this.context, this.ports.opencode);
    this.acceptances = new AcceptanceService(this.store, this.commands);
  }

  get settings(): AppSettings {
    return this.#settings;
  }

  /**
   * Deterministic, idempotent startup recovery for work a previous process left
   * in flight (executions, planning rounds, workspace preparation/cleanup and
   * PPT generation).
   *
   * It never calls a model and never deletes workspace directories; a broken
   * record is reported in `failures` instead of thrown so startup cannot be
   * blocked. Safe to call more than once (the second pass finds nothing).
   */
  recoverOnStartup(): StartupRecoverySummary {
    const affected = new Set<string>();
    const failures: { scope: string; message: string }[] = [];
    const run = (scope: string, recover: () => readonly string[], count: (value: number) => void): void => {
      try {
        const taskIds = recover();
        for (const taskId of taskIds) affected.add(taskId);
        count(taskIds.length);
      } catch (error) {
        failures.push({ scope, message: error instanceof Error ? error.message : String(error) });
      }
    };
    let executions = 0;
    let planningRounds = 0;
    let workspaces = 0;
    run('execution', () => this.executions.recoverOnStartup(), (value) => {
      executions = value;
    });
    run('planning', () => this.planning.recoverOnStartup(), (value) => {
      planningRounds = value;
    });
    run('workspace', () => this.workspaces.recoverOnStartup(), (value) => {
      workspaces = value;
    });
    let pptWorks = 0;
    try {
      pptWorks = this.ppt.recoverOnStartup().recovered;
    } catch (error) {
      failures.push({ scope: 'ppt', message: error instanceof Error ? error.message : String(error) });
    }
    for (const taskId of affected) {
      try {
        this.tasks.recomputeAttention(taskId);
      } catch (error) {
        failures.push({ scope: `attention:${taskId}`, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { executions, planningRounds, workspaces, pptWorks, affectedTaskIds: [...affected], failures };
  }

  updateSettings(settings: AppSettings): void {
    this.#settings = settings;
    this.store.settings.saveSettings(settings);
  }

  publicSettings(): PublicSettings {
    return this.#settings;
  }
}
