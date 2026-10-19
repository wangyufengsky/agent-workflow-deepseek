import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectBindingIdentity } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { normalizeEvidenceSources, matchesEvidencePath, evidenceReportFiles, inspectEvidenceSource } from '../../packages/engine/src/project-evidence.ts';
import { retainConfiguredTestRun, snapshotConfiguredReports } from '../../packages/server/src/controlled-tests.ts';
const temp = () => mkdtempSync(join(tmpdir(), 'aw-project-evidence-'));
test('project source rules are bounded, relative JUnit only, permission filtered and symlink safe', () => {
  const root = temp(); mkdirSync(join(root, 'reports')); writeFileSync(join(root, 'reports/a.xml'), '<testsuite/>');
  symlinkSync(join(root, 'reports/a.xml'), join(root, 'reports/link.xml'));
  assert.deepEqual(normalizeEvidenceSources([{kind:'junit',path:'./reports/**/*.xml'}]), [{kind:'junit',path:'reports/**/*.xml'}]);
  for (const path of ['../a.xml', '/tmp/a.xml', '.git/a.xml', 'reports/[ab].xml']) assert.throws(() => normalizeEvidenceSources([{kind:'junit',path}]));
  assert.equal(matchesEvidencePath('reports/**/*.xml', 'reports/a.xml'), true);
  assert.deepEqual(evidenceReportFiles(root, ['reports/**/*.xml']).paths, ['reports/a.xml']);
  assert.deepEqual(evidenceReportFiles(root, ['reports/**/*.xml'], () => false).paths, []);
  assert.equal(inspectEvidenceSource(root, {kind:'logs',path:root}).state, 'readable');
  assert.equal(inspectEvidenceSource(root, {kind:'junit',path:'missing/*.xml'}).state, 'empty');
});
test('binding check has a durable original-key receipt, stale config guard and truthful disconnected state', async () => {
  const app = await createApplication({dataDir:temp(),disableOpenCode:true,disableListen:true});
  try {
    const root=temp(); mkdirSync(join(root,'reports')); writeFileSync(join(root,'reports/a.xml'), '<testsuite/>');
    const project=app.store.projects.create({name:'Offline source protocol fixture',rootPath:root,gitState:'not_git',settings:{evidenceSources:[{kind:'junit',path:'reports/*.xml'}]}});
    const body={requestKey:'req_project_evidence_check_123456789',expectedConfig:projectBindingIdentity(project.settings)};
    const first=await app.app.inject({method:'POST',url:`/api/projects/${project.id}/binding/check`,payload:body});
    assert.equal(first.statusCode,200,first.body); assert.equal(first.json().data.receipt.status,'succeeded');
    assert.equal(first.json().data.resource.repository.state,'not_configured'); assert.equal(first.json().data.resource.sources[0].matchedFiles,1);
    writeFileSync(join(root,'reports/b.xml'), '<testsuite/>');
    const replay=await app.app.inject({method:'POST',url:`/api/projects/${project.id}/binding/check`,payload:body});
    assert.equal(replay.json().data.resource.sources[0].matchedFiles,1,'replay must not re-probe');
    app.store.projects.update(project.id,{settings:{evidenceSources:[]}});
    const stale=await app.app.inject({method:'POST',url:`/api/projects/${project.id}/binding/check`,payload:{...body,requestKey:'req_project_evidence_stale_123456789'}});
    assert.equal(stale.json().error.code,'STALE_TARGET');
    assert.equal(app.engine.projects.detail(project.id).bindingCheck,undefined);
  } finally {await app.close();}
});
test('configured JUnit aggregation uses fresh actual cases, retains originals and never accepts stale/DTD reports', async () => {
  const app=await createApplication({dataDir:temp(),disableOpenCode:true,disableListen:true});
  try {
    const root=temp(); mkdirSync(join(root,'reports')); const patterns=['reports/*.xml'];
    const beforeReports=snapshotConfiguredReports(root,patterns,()=>true); const startedAt=new Date().toISOString();
    writeFileSync(join(root,'reports/a.xml'),'<testsuite tests="999"><testcase name="pass"/><testcase name="skip"><skipped/></testcase></testsuite>');
    writeFileSync(join(root,'reports/b.xml'),'<testsuite><testcase name="fail"><failure message="actual failure"/></testcase></testsuite>');
    const input={store:app.store,taskId:'fixture',executionId:'fixture',nodeId:'fixture',attemptId:'fixture',root,startedAt,patterns,beforeReports,allowed:()=>true,result:{command:'offline protocol fixture',exitCode:1,stdout:'',stderr:'',timedOut:false}};
    const run=retainConfiguredTestRun(input); assert.equal(run.state,'failed'); assert.deepEqual([run.passed,run.failed,run.skipped],[1,1,1]); assert.equal(run.reports?.length,2);
    const stale=retainConfiguredTestRun({...input,beforeReports:snapshotConfiguredReports(root,patterns,()=>true)}); assert.equal(stale.state,'unknown'); assert.match(stale.reason!,/旧测试报告/);
    writeFileSync(join(root,'reports/b.xml'),'<!DOCTYPE testsuite><testsuite><testcase name="x"/></testsuite>');
    const invalid=retainConfiguredTestRun(input); assert.equal(invalid.state,'unknown'); assert.match(invalid.reason!,/DTD/);
    assert.equal(retainConfiguredTestRun({...input,allowed:()=>false}).state,'unknown');
  } finally {await app.close();}
});
