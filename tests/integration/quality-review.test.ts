import { MethodCatalogService } from '../../packages/engine/src/method-catalog.ts';
import { completedTerminalTool } from '../../packages/server/src/adapters/opencode.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '@agent-workflow/storage';
import { Engine } from '../../packages/engine/src/index.ts';
import { methodToGraph } from '../../packages/engine/src/graph.ts';
import { materializeQualityReview, qualityReadKey } from '../../packages/engine/src/quality-review.ts';
import { DEFAULT_CATALOG, createRequestKey, validateScopedCandidate, validatePlanningCandidate, validQualityReviewContract, type QualityReviewContract } from '@agent-workflow/shared';

// Offline contract/binding regressions; never real-model acceptance.
for (const kind of ['requirement','risk'] as const) test(`${kind} report is explicit, complete and bound to an actual read in the current session`, () => {
 const store = new Store({dataDir:mkdtempSync(join(tmpdir(),'aw-review-contract-'))});
 const engine = new Engine({store,ports:{git:{} as never,opencode:{status:()=>({state:'stopped'}),abortSession:async()=>{},runSession:async()=>{throw Error('offline')}} as never}});
 try {
  const contract:QualityReviewContract={kind,criteria:['公开规范要求有效参数']};
  const graph=methodToGraph({...DEFAULT_CATALOG.methods[0]!,requiredSteps:[{key:'verify.explicit',title:'Explicit review',kind:'verify',group:'review',qualityReview:contract,acceptance:[]}]});
  const node={...graph.nodes[0]!,roleSnapshot:structuredClone(engine.catalog.roles.find(role=>role.id==='role.reviewer')!)};
  const project=store.projects.create({name:'public',rootPath:store.dataDir,gitState:'not_git'});
  const task=store.tasks.create({projectId:project.id,title:'contract',requirementText:'public',methodId:'method.manual',methodRevision:'r1'});
  const plan=store.plans.create({taskId:task.id,graph:{...graph,nodes:[node]},status:'confirmed',source:'manual'});
  const execution=store.executions.create({taskId:task.id,planRevisionId:plan.id,graph:{...graph,nodes:[node]},autoAdvance:false});
  const attempt=store.executions.createAttempt({executionId:execution.id,nodeId:node.id,ordinal:1,definition:{planRevisionId:plan.id,node}});
  store.tasks.update(task.id,{executionId:execution.id,currentPlanRevisionId:plan.id});store.executions.updateNode(execution.id,node.id,{currentAttemptId:attempt.id,status:'running'});
  const read={sessionId:'offline-session',path:'README.md',sha256:createHash('sha256').update('Validate parameters.').digest('hex'),text:'Validate parameters.'};
  store.settings.putJson(`execution.session.${attempt.id}`,{sessionId:read.sessionId});
  const payload={reviewReport:{kind,verdict:'passed',summary:'AI opinion',source:{attemptId:'forged'},findings:[{criterion:0,verdict:'passed',rationale:'规范与实现一致',evidence:[{path:read.path,sha256:read.sha256,quote:read.text}]}]}};
  const materialize=()=>materializeQualityReview(store,task.id,plan.id,node,attempt,payload);
  assert.throws(materialize,/实际获得/);store.settings.putJson(qualityReadKey(attempt.id,read.path),read);
  const report=materialize()!;assert.equal(report.source.attemptId,attempt.id);assert.equal(report.source.sessionId,read.sessionId);assert.deepEqual(report.contract,contract);
  assert.throws(()=>materializeQualityReview(store,task.id,plan.id,node,attempt,{verification:{state:'passed'}}),/不能替代/);
  assert.throws(()=>materializeQualityReview(store,task.id,plan.id,{...node,qualityReview:undefined},attempt,payload),/未配置/);
  store.settings.putJson(qualityReadKey(attempt.id,read.path),{...read,sessionId:'old-session'});assert.throws(materialize,/同会话/);
  store.settings.putJson(qualityReadKey(attempt.id,read.path),read);payload.reviewReport.findings[0]!.evidence[0]!.quote='invented';assert.throws(materialize,/实际获得/);
  payload.reviewReport.findings[0]!.evidence[0]!.quote=read.text;payload.reviewReport.findings=[];assert.throws(materialize,/覆盖/);
  const result={resultRevision:'res_fixture',summary:'offline fixture',qualityReview:report,verification:{state:'passed' as const},errors:[],warnings:[],artifacts:[]};
  store.executions.finishAttempt(attempt.id,'succeeded',result);store.executions.updateNode(execution.id,node.id,{status:'succeeded'});
  const evidence=()=>engine.insights.taskUsage().find(item=>item.taskId===task.id)!.qualityEvidence!.checks.find(item=>item.kind===kind)!;
  assert.equal(evidence().state,'passed');store.acceptances.put({taskId:task.id,verdict:'rejected',decidedAt:new Date().toISOString()});assert.equal(evidence().state,'passed');
  store.executions.finishAttempt(attempt.id,'succeeded',{...result,qualityReview:undefined});assert.equal(evidence().state,'unknown');
  store.executions.finishAttempt(attempt.id,'succeeded',{...result,qualityReview:{...report,source:undefined} as never});assert.equal(evidence().state,'unknown');
  store.executions.finishAttempt(attempt.id,'succeeded',result);
  store.db.prepare("UPDATE attempts SET readability_json=? WHERE id=?").run(JSON.stringify({output:'ok',tools:'ok',result:'forbidden'}),attempt.id);assert.equal(evidence().state,'unknown');assert.equal(evidence().sources.length,0);
 } finally {store.close();}
});
test('review configuration never silently infers historical types or permits non-verify / empty contracts',()=>{
 assert.equal(validQualityReviewContract({kind:'risk',criteria:['risk']},'verify'),true);assert.equal(validQualityReviewContract({kind:'risk',criteria:[]},'verify'),false);assert.equal(validQualityReviewContract({kind:'risk',criteria:['risk']},'implementation'),false);
 assert.ok(methodToGraph(DEFAULT_CATALOG.methods[0]!).nodes.every(node=>node.qualityReview===undefined));
});

test('terminal submit keeps authorization alive for delayed request, errors and unrelated tool text',()=>{
 const names=['result.submit','result-submit','result_submit'];
 assert.equal(completedTerminalTool({type:'session.next.tool.called',properties:{tool:'agent-workflow_workflow_result_submit'}},names),false);
 assert.equal(completedTerminalTool({type:'session.next.tool.progress',properties:{tool:'agent-workflow_workflow_result_submit'}},names),false);
 assert.equal(completedTerminalTool({type:'session.next.tool.failed',properties:{tool:'agent-workflow_workflow_result_submit',error:'validation failed'}},names),false);
 assert.equal(completedTerminalTool({type:'session.next.tool.success',properties:{tool:'workspace_file_read',output:'result_submit'}},names),false);
 assert.equal(completedTerminalTool({type:'session.next.tool.success',properties:{part:{tool:'agent-workflow_workflow_result_submit',state:{status:'completed',output:'ok'}}}},names),true);
 assert.equal(completedTerminalTool({type:'session.next.tool.success',properties:{tool:'agent-workflow_workflow_result_submit'}},names),true);
});

test('explicit review survives catalog persistence and planning refuses a lost configured contract',()=>{
 const store=new Store({dataDir:mkdtempSync(join(tmpdir(),'aw-review-catalog-'))});
 try {
  const service=new MethodCatalogService({store});const qualityReview={kind:'risk' as const,criteria:['限定公开风险条款']};
  const draft={name:'Explicit review',description:'公开配置',requiredSteps:[{key:'verify.risk',title:'风险评审',kind:'verify' as const,group:'验收',qualityReview,acceptance:[]}],refinableGroups:[]};
  const created=service.create({requestKey:createRequestKey(),draft,confirmCreate:true});assert.deepEqual(service.get(created.method.id).requiredSteps[0]!.qualityReview,qualityReview);
  const reloaded=new MethodCatalogService({store});assert.deepEqual(reloaded.get(created.method.id).requiredSteps[0]!.qualityReview,qualityReview);
  const validation=validatePlanningCandidate({candidate:{summary:'candidate',groups:[{id:'g',label:'验收',kind:'test'}],nodes:[{key:'verify.risk',title:'风险评审',kind:'verify',groupId:'g',summary:'review'}],edges:[]},requiredSteps:draft.requiredSteps,refinableGroups:[],limits:{maxNodes:20,maxEdges:20,maxGroups:5,maxDepth:10}});
  assert.ok(validation.problems.some(problem=>problem.code==='REVIEW_CONTRACT_LOST'));
  const baseGraph=methodToGraph({...DEFAULT_CATALOG.methods[0]!,requiredSteps:draft.requiredSteps});const scope={groupRef:baseGraph.groups[0]!.id,groupTitle:'验收',placeholderNodeIds:[],basePlanRevisionId:'plan_scope_fixture'};
  const scoped=validateScopedCandidate({candidate:{summary:'scoped',groups:[{id:'g',label:'验收',kind:'test'}],nodes:[{key:'verify.risk',title:'风险评审',kind:'verify',groupId:'g',summary:'review'}],edges:[]},baseGraph,scope,requiredSteps:draft.requiredSteps,limits:{maxNodes:20,maxEdges:20,maxGroups:5,maxDepth:10}});
  assert.ok(scoped.problems.some(problem=>problem.code==='REVIEW_CONTRACT_LOST'));

 } finally {store.close();}
});

test('two explicit risk reviewers preserve disagreement as pending human decision and both original sources',()=>{
 const store=new Store({dataDir:mkdtempSync(join(tmpdir(),'aw-review-disagreement-'))});const engine=new Engine({store,ports:{git:{} as never,opencode:{status:()=>({state:'stopped'}),abortSession:async()=>{},runSession:async()=>{throw Error('offline')}} as never}});
 try {
  const contract={kind:'risk' as const,criteria:['公开风险合同']};const graph=methodToGraph({...DEFAULT_CATALOG.methods[0]!,requiredSteps:['one','two'].map(key=>({key:`verify.${key}`,title:key,kind:'verify' as const,group:'review',requires:[],qualityReview:contract,acceptance:[]}))});
  const project=store.projects.create({name:'public',rootPath:store.dataDir,gitState:'not_git'});const task=store.tasks.create({projectId:project.id,title:'two reviewers',requirementText:'public',methodId:'method.manual',methodRevision:'r1'});const plan=store.plans.create({taskId:task.id,graph,status:'confirmed',source:'manual'});const execution=store.executions.create({taskId:task.id,planRevisionId:plan.id,graph,autoAdvance:false});store.tasks.update(task.id,{executionId:execution.id,currentPlanRevisionId:plan.id,lifecycle:'completed'});
  for(const [index,node] of graph.nodes.entries()) {
   const attempt=store.executions.createAttempt({executionId:execution.id,nodeId:node.id,ordinal:1,definition:{planRevisionId:plan.id,node}});const verdict=index===0?'passed' as const:'failed' as const;const sessionId=`offline-review-${index}`;store.settings.putJson(`execution.session.${attempt.id}`,{sessionId});
   store.executions.finishAttempt(attempt.id,index===0?'succeeded':'failed',{resultRevision:`res_review_${index}`,summary:'offline structured binding fixture',artifacts:[],errors:[],warnings:[],qualityReview:{kind:'risk',verdict,summary:'opposed AI opinions',contract,source:{taskId:task.id,executionId:execution.id,planRevisionId:plan.id,nodeId:node.id,attemptId:attempt.id,sessionId},findings:[{criterion:0,verdict,rationale:'independent offline fixture',evidence:[]}]}});store.executions.updateNode(execution.id,node.id,{currentAttemptId:attempt.id,status:index===0?'succeeded':'failed'});
  }
  const evidence=()=>engine.insights.taskUsage().find(item=>item.taskId===task.id)!.qualityEvidence!;
  assert.equal(evidence().checks.find(item=>item.kind==='risk')!.state,'needs_decision');assert.match(evidence().checks.find(item=>item.kind==='risk')!.reason,/结论不一致/);assert.equal(evidence().checks.find(item=>item.kind==='risk')!.sources.length,2);assert.equal(evidence().summary,'pending_review');
  store.acceptances.put({taskId:task.id,verdict:'accepted',decidedAt:new Date().toISOString()});assert.equal(evidence().checks.find(item=>item.kind==='risk')!.state,'needs_decision');assert.deepEqual(store.executions.listAttempts(execution.id).map(attempt=>attempt.result!.qualityReview!.verdict).sort(),['failed','passed']);
 } finally {store.close();}
});
