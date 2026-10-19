export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Schema authority. Append-only: never edit an applied migration; add a new one.
 * JSON columns keep module-specific payloads evolvable; query-critical fields are
 * real columns.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  root_path TEXT NOT NULL,
  git_state TEXT NOT NULL,
  default_branch TEXT,
  remote_display_url TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  attention TEXT NOT NULL,
  method_id TEXT NOT NULL,
  method_revision TEXT NOT NULL,
  fixed_template_json TEXT,
  requirement_json TEXT NOT NULL,
  current_plan_revision_id TEXT,
  current_planning_round_id TEXT,
  workspace_id TEXT,
  execution_id TEXT,
  delivery_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage, attention);

CREATE TABLE IF NOT EXISTS plan_revisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  revision_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  base_revision_id TEXT,
  graph_json TEXT NOT NULL,
  validation_json TEXT,
  diff_json TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by TEXT,
  UNIQUE(task_id, revision_number)
);

CREATE TABLE IF NOT EXISTS planning_rounds (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  apply_status TEXT NOT NULL,
  input_revision INTEGER NOT NULL,
  method_json TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  model_json TEXT NOT NULL,
  stage_runs_json TEXT NOT NULL DEFAULT '[]',
  usage_json TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  last_activity TEXT,
  candidate_json TEXT,
  questions_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  stop_json TEXT,
  failure_json TEXT,
  reconcile_json TEXT,
  previous_round_id TEXT,
  record_first_seq INTEGER NOT NULL DEFAULT 1,
  record_last_seq INTEGER NOT NULL DEFAULT 0,
  gaps_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(task_id, ordinal)
);

CREATE TABLE IF NOT EXISTS planning_records (
  round_id TEXT NOT NULL REFERENCES planning_rounds(id),
  seq INTEGER NOT NULL,
  fragment_id TEXT NOT NULL,
  category TEXT NOT NULL,
  at TEXT,
  text TEXT,
  block_id TEXT,
  tool_call_json TEXT,
  metadata_json TEXT,
  PRIMARY KEY(round_id, seq)
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  plan_revision_id TEXT NOT NULL,
  status TEXT NOT NULL,
  auto_advance INTEGER NOT NULL DEFAULT 1,
  progress_json TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  pause_json TEXT,
  edit_session_json TEXT,
  notice_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS execution_nodes (
  execution_id TEXT NOT NULL REFERENCES executions(id),
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_attempt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  error_json TEXT,
  PRIMARY KEY(execution_id, node_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id),
  node_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  result_json TEXT,
  readability_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(execution_id, node_id, ordinal)
);

CREATE TABLE IF NOT EXISTS node_output (
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  seq INTEGER NOT NULL,
  fragment_id TEXT NOT NULL,
  category TEXT NOT NULL,
  at TEXT,
  text TEXT,
  block_id TEXT,
  tool_call_json TEXT,
  PRIMARY KEY(attempt_id, seq)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  revision TEXT NOT NULL,
  display_root TEXT,
  original_root_display TEXT,
  branch TEXT,
  base_ref TEXT,
  base_sha TEXT,
  worktree_handle TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]',
  parallel_write_policy TEXT NOT NULL DEFAULT 'serial',
  children_json TEXT NOT NULL DEFAULT '[]',
  active_writes_json TEXT NOT NULL DEFAULT '[]',
  pending_operation_ref TEXT,
  retention TEXT NOT NULL DEFAULT 'retained',
  created_at TEXT,
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  workspace_id TEXT,
  revision TEXT NOT NULL,
  projection TEXT NOT NULL,
  projection_reason TEXT,
  goal TEXT,
  changes_revision TEXT,
  selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
  remaining_json TEXT NOT NULL DEFAULT '{}',
  eligibility_json TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  verification_outcome TEXT,
  task_completion_ref TEXT,
  apply_preview_json TEXT,
  workspace_retention TEXT,
  last_updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations (
  request_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  status TEXT NOT NULL,
  target_json TEXT NOT NULL,
  outcome_json TEXT,
  error_json TEXT,
  accepted_at TEXT NOT NULL,
  settled_at TEXT,
  audit_id TEXT NOT NULL,
  reconcile_count INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  result_resource_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_operations_operation ON operations(operation, accepted_at DESC);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  repo_id TEXT NOT NULL,
  git_state TEXT NOT NULL,
  display_root TEXT,
  default_branch TEXT,
  remote_json TEXT,
  last_status_json TEXT,
  last_fetch_at TEXT,
  revision TEXT NOT NULL,
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  execution_id TEXT NOT NULL,
  subject_json TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  context TEXT NOT NULL,
  profession_json TEXT NOT NULL,
  state TEXT NOT NULL,
  stage TEXT,
  started_at TEXT,
  ended_at TEXT,
  findings_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT,
  receipt_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  review_run_id TEXT NOT NULL,
  finding_ids_json TEXT NOT NULL,
  base_json TEXT NOT NULL,
  fix_branch TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  profession_json TEXT NOT NULL,
  verify_command_json TEXT,
  state TEXT NOT NULL,
  outcomes_json TEXT NOT NULL DEFAULT '[]',
  changes_json TEXT,
  verification_json TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]',
  commit_draft_json TEXT,
  fix_revision TEXT NOT NULL,
  actions_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS database_connections (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'not_configured',
  last_checked_at TEXT,
  message TEXT
);

CREATE TABLE IF NOT EXISTS secrets (
  ref TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'planning_session_binding',
    sql: `
ALTER TABLE planning_rounds ADD COLUMN session_id TEXT;
ALTER TABLE planning_rounds ADD COLUMN abort_requested INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 3,
    name: 'ppt_works',
    sql: `
CREATE TABLE IF NOT EXISTS ppt_works (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  outline_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 4,
    name: 'ppt_slides',
    sql: `
ALTER TABLE ppt_works ADD COLUMN slides_json TEXT NOT NULL DEFAULT '[]';
`,
  },
];
