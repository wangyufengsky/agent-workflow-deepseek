import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDatabase } from './db.ts';
import { JsonlJournal } from './jsonl.ts';
import { SecretStore } from './secrets.ts';
import { EventService } from './events.ts';
import { ProjectRepository, TaskRepository } from './projects-tasks.ts';
import { PlanRepository, PlanningRepository } from './planning.ts';
import { ExecutionRepository, WorkspaceRepository } from './execution.ts';
import { DeliveryRepository } from './delivery.ts';
import { OperationRepository } from './operations.ts';
import { DatabaseConnectionRepository, SettingsRepository } from './settings.ts';
import { FixRepository, RepoRepository, ReviewRepository } from './git.ts';
import { PptWorkRepository } from './ppt.ts';
import { TaskAcceptanceRepository } from './acceptance.ts';

export interface StoreOptions {
  readonly dataDir: string;
}

/**
 * Composition root for local persistence. Repositories are independent modules;
 * a single SQLite connection keeps transactions simple and serialized.
 */
export class Store {
  readonly dataDir: string;
  readonly dbPath: string;
  readonly db: SqliteDatabase;
  readonly journal: JsonlJournal;
  readonly events: EventService;
  readonly secrets: SecretStore;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly plans: PlanRepository;
  readonly planning: PlanningRepository;
  readonly executions: ExecutionRepository;
  readonly workspaces: WorkspaceRepository;
  readonly deliveries: DeliveryRepository;
  readonly operations: OperationRepository;
  readonly settings: SettingsRepository;
  readonly databases: DatabaseConnectionRepository;
  readonly repos: RepoRepository;
  readonly reviews: ReviewRepository;
  readonly fixes: FixRepository;
  readonly pptWorks: PptWorkRepository;
  readonly acceptances: TaskAcceptanceRepository;

  constructor(options: StoreOptions) {
    this.dataDir = options.dataDir;
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(join(this.dataDir, 'worktrees'), { recursive: true });
    mkdirSync(join(this.dataDir, 'logs'), { recursive: true });
    this.dbPath = join(this.dataDir, 'agent-workflow.sqlite');
    this.db = new SqliteDatabase({ dbPath: this.dbPath });
    this.journal = new JsonlJournal(this.dataDir);
    this.events = new EventService(this.db, this.journal);
    this.secrets = new SecretStore(this.db, this.dataDir);
    this.projects = new ProjectRepository(this.db);
    this.tasks = new TaskRepository(this.db);
    this.plans = new PlanRepository(this.db);
    this.planning = new PlanningRepository(this.db);
    this.executions = new ExecutionRepository(this.db);
    this.workspaces = new WorkspaceRepository(this.db);
    this.deliveries = new DeliveryRepository(this.db);
    this.operations = new OperationRepository(this.db);
    this.settings = new SettingsRepository(this.db);
    this.databases = new DatabaseConnectionRepository(this.db);
    this.repos = new RepoRepository(this.db);
    this.reviews = new ReviewRepository(this.db);
    this.fixes = new FixRepository(this.db);
    this.pptWorks = new PptWorkRepository(this.db);
    this.acceptances = new TaskAcceptanceRepository(this.db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}
