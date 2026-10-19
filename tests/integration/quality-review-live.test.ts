import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { createRequestKey, type PlanGraph } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';

// Opt-in true model acceptance. Public temporary Git fixture; all conclusions submitted by runtime MCP.
test('live: explicit requirement and risk reviews submit distinct bound AI conclusions and readable evidence', { skip: process.env.AGENT_WORKFLOW_LIVE !== '1', timeout: 1_000_000 }, async()=>{
 const root=mkdtempSync(join(tmpdir(),'aw-quality-live-repo-'));const dataDir=mkdtempSync(join(tmpdir(),'aw-quality-live-data-'));
 writeFileSync(join(root,'README.md'),'# Public contract\nGreet must return hello for a nonempty name and reject empty names.\nRisk policy: no network, no secrets, and invalid inputs must fail closed.\n');
 writeFileSync(join(root,'greet.mjs'),'export function greet(name) { if (typeof name !== "string" || name.trim() === "") throw new Error("invalid name"); return "hello " + name; }\n');
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();git('init','-q','-b','main');git('config','user.name','Public Quality Review');git('config','user.email','quality@example.invalid');git('add','.');git('commit','-qm','public minimal contract');const head=git('rev-parse','HEAD');
 const app=await createApplication({dataDir,port:0,host:'127.0.0.1'});let web:Awaited<ReturnType<typeof createServer>>|undefined;
 const post=async(url:string,body:object)=>{const response=await app.app.inject({method:'POST',url,payload:{requestKey:createRequestKey(),...body}});assert.ok(response.statusCode<300,response.body);const value=response.json().data;assert.notEqual(value.receipt?.status,'failed',response.body);return value.resource;};
 try {
  await app.adapter!.ensureReady();const gui=process.env.AGENT_WORKFLOW_GUI_REVIEW==='1';if(gui){web=await createServer({configFile:resolve('apps/web/vite.config.ts'),root:resolve('apps/web'),server:{host:'127.0.0.1',port:5305,strictPort:true,proxy:{'/api':{target:app.url}}}});await web.listen();}
  const project=(await post('/api/projects',{name:'真实需求与风险 AI 评审 · 公开临时项目',rootPath:root})).project;
  const task=app.store.tasks.create({projectId:project.id,title:'独立需求与风险评审（真实模型）',requirementText:'请逐项独立评审 README.md 与 greet.mjs，不修改文件。不执行程序、不调用网络；仅使用实际读取文件作为引用，提交逐条AI结论。',methodId:'method.manual',methodRevision:'r1'});
  const role=app.engine.catalog.roles.find(role=>role.id==='role.reviewer')!;
  const graph:PlanGraph={nodes:(['requirement','risk'] as const).map(kind=>({id:`node_quality_${kind}`,key:`verify.${kind}`,title:kind==='requirement'?'独立需求评审':'独立风险评审',kind:'verify',groupId:'g',summary:'逐个调用workspace.file.read完整读取README.md和greet.mjs，按冻结条款提交payload.reviewReport；证据sha256必须使用工具sha。不要填写自身生成的假sha，不写任何文件。',inputs:[],outputs:[],acceptance:[],resources:{read:[{kind:'file',label:'README.md',basis:'declared'},{kind:'file',label:'greet.mjs',basis:'declared'}],write:[]},roleId:role.id,roleSnapshot:structuredClone(role),qualityReview:{kind,criteria:[kind==='requirement'?'greet实现满足README要求：非空name返回hello，空name拒绝。':'按README风险政策，代码无网络/秘密读取，且非法输入失败关闭。']}})),edges:[{id:'edge_quality',from:'node_quality_requirement',to:'node_quality_risk',kind:'order'}],groups:[{id:'g',label:'独立评审',kind:'test',refined:true,collapsible:true,collapsedByDefault:false}]};
  const plan=app.store.plans.create({taskId:task.id,graph,status:'unconfirmed',source:'manual'});app.store.tasks.update(task.id,{currentPlanRevisionId:plan.id,stage:'confirming'});
  await post(`/api/tasks/${task.id}/plan/confirm`,{planRevisionId:plan.id,expectedRevisionNumber:plan.revisionNumber,confirmPlan:true});await post(`/api/tasks/${task.id}/workspace/prepare`,{expectedPlanRevisionNumber:plan.revisionNumber,expectedBaseRef:'main',confirmPrepare:true});await post(`/api/tasks/${task.id}/execution/start`,{confirm:true});
  console.log('[quality-live] identity',JSON.stringify({dataDir,taskId:task.id,projectId:project.id,url:gui?`http://127.0.0.1:5305/tasks/${task.id}`:app.url}));
  let last='';const deadline=Date.now()+600_000;while(Date.now()<deadline){const execution=app.engine.executions.get(task.id)!;const text=JSON.stringify({status:execution.status,nodes:execution.nodes.map(node=>({id:node.nodeId,status:node.status,error:node.error}))});if(text!==last){console.log('[quality-live] state',text);last=text;}if(['completed','failed','unknown','stopped','paused'].includes(execution.status)&&execution.nodes.every(node=>node.status!=='running'))break;await new Promise(resolve=>setTimeout(resolve,1000));}
  const execution=app.engine.executions.get(task.id)!;const attempts=app.store.executions.listAttempts(execution.id);console.log('[quality-live] outcomes',JSON.stringify(attempts.map(attempt=>({id:attempt.id,status:attempt.status,summary:attempt.result?.summary,errors:attempt.result?.errors,report:attempt.result?.qualityReview,usage:attempt.usage}))));assert.equal(execution.status,'completed');assert.equal(attempts.length,2);
  for(const attempt of attempts){const report=attempt.result?.qualityReview;assert.ok(report);assert.ok(report.findings[0]!.evidence.length);assert.equal(report.source.attemptId,attempt.id);assert.equal(report.source.sessionId,app.store.settings.getJson<{sessionId:string}>(`execution.session.${attempt.id}`)?.sessionId);assert.ok((attempt.usage?.total??0)>0);const detail=await app.app.inject({method:'GET',url:`/api/tasks/${task.id}/nodes/${attempt.nodeId}?attemptId=${attempt.id}`});assert.equal(detail.statusCode,200);}
  assert.notEqual(attempts[0]!.result!.qualityReview!.source.sessionId,attempts[1]!.result!.qualityReview!.source.sessionId);const checks=app.engine.insights.taskUsage().find(item=>item.taskId===task.id)!.qualityEvidence!.checks;assert.equal(checks.find(item=>item.kind==='requirement')!.state,attempts.find(item=>item.nodeId==='node_quality_requirement')!.result!.qualityReview!.verdict);assert.equal(checks.find(item=>item.kind==='risk')!.state,attempts.find(item=>item.nodeId==='node_quality_risk')!.result!.qualityReview!.verdict);assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','HEAD'),head);
  if(gui){console.log('[quality-live] gui_review',JSON.stringify({dataDir,taskId:task.id}));const end=Date.now()+300_000;while(!existsSync(join(dataDir,'gui-reviewed'))&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,1000));assert.ok(existsSync(join(dataDir,'gui-reviewed')));}
 } finally {await web?.close();await app.close();}
});
