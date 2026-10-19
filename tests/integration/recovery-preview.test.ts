import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApplication} from '../../packages/server/src/index.ts';
import {ROUTES,createRequestKey} from '@agent-workflow/shared';
test('recovery preview is read-only, mode-specific and rejects changed source files before any new draft',async()=>{
 const app=await createApplication({dataDir:mkdtempSync(join(tmpdir(),'aw-preview-')),disableOpenCode:true,disableListen:true});
 try {
  const root=mkdtempSync(join(tmpdir(),'aw-preview-source-'));writeFileSync(join(root,'public.txt'),'baseline');
  const project=app.store.projects.create({name:'preview',rootPath:root,gitState:'not_git'});
  const task=app.store.tasks.create({projectId:project.id,title:'failure fixture',requirementText:'read public.txt',methodId:'method.requirement-development',methodRevision:'1'});
  const graph={nodes:['done','failed','future'].map(id=>({id,key:id,title:id,kind:'implementation' as const,groupId:'g',summary:'',inputs:[],outputs:[],acceptance:[],resources:{read:[],write:[]}})),edges:[{id:'df',from:'done',to:'failed',kind:'order' as const},{id:'ff',from:'failed',to:'future',kind:'order' as const}],groups:[]};
  const plan=app.store.plans.create({taskId:task.id,source:'manual',graph,status:'confirmed'});app.store.tasks.update(task.id,{currentPlanRevisionId:plan.id});
  const prepared=await app.engine.workspaces.prepare(task.id,{requestKey:createRequestKey(),confirmPrepare:true,expectedPlanRevisionNumber:1});const workspace=prepared.resource!.workspace;
  const execution=app.store.executions.create({taskId:task.id,planRevisionId:plan.id,graph,autoAdvance:false});app.store.executions.updateNode(execution.id,'done',{status:'succeeded'});app.store.executions.updateNode(execution.id,'failed',{status:'failed'});app.store.executions.update(execution.id,{status:'failed'});app.store.tasks.update(task.id,{executionId:execution.id,workspaceId:workspace.id,attention:'failed'});
  const before=app.store.tasks.list().length;
  const read=await app.app.inject({method:'GET',url:`${ROUTES.taskRecoveryPreview(task.id)}?mode=from_failed_stage`});assert.equal(read.statusCode,200,read.body);const preview=read.json().data;
  assert.deepEqual(preview.stages.map((s:{action:string})=>s.action),['context','copy','copy']);assert.equal(app.store.tasks.list().length,before);
  assert.deepEqual(app.engine.recoveries.preview(task.id,'all_stages').stages.map(s=>s.action),['copy','copy','copy']);assert.equal(app.engine.recoveries.preview(task.id,'verify_only').allowed,false,'no settled attempts is a service reason');
  writeFileSync(join(workspace.displayRoot!,'public.txt'),'changed after review');
  const rejected=await app.app.inject({method:'POST',url:ROUTES.taskRecovery(task.id),payload:{requestKey:createRequestKey(),mode:'from_failed_stage',confirmCreate:true,expectedSourceRevision:preview.sourceRevision}});assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().error.code,'STALE_TARGET');assert.equal(app.store.tasks.list().length,before);
  const fresh=app.engine.recoveries.preview(task.id,'from_failed_stage');const key=createRequestKey();const created=await app.engine.recoveries.create(task.id,{requestKey:key,mode:'from_failed_stage',confirmCreate:true,expectedSourceRevision:fresh.sourceRevision});assert.equal(created.receipt.status,'succeeded');assert.deepEqual(app.store.plans.get(created.resource!.task.currentPlanRevisionId!)!.graph.nodes.map(node=>node.id),['failed','future']);assert.equal((await app.engine.recoveries.create(task.id,{requestKey:key,mode:'from_failed_stage',confirmCreate:true,expectedSourceRevision:fresh.sourceRevision})).resource!.task.id,created.resource!.task.id);
  app.store.executions.update(execution.id,{status:'unknown'});const unknown=app.engine.recoveries.preview(task.id,'from_failed_stage');assert.equal(unknown.allowed,false);assert.match(unknown.reason??'',/未知/);
 }finally{await app.close();}
});
