import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '@agent-workflow/storage';
import {createApplication} from '../../packages/server/src/index.ts';
import {ROUTES,createRequestKey} from '@agent-workflow/shared';
import {Engine,type EnginePorts,type OpenCodePort,type OpenCodeRunRequest,type OpenCodeRunResult} from '../../packages/engine/src/index.ts';
class PagePort implements OpenCodePort {
 inputs:OpenCodeRunRequest[]=[];resolvers:((value:OpenCodeRunResult)=>void)[]=[];aborted:string[]=[];abortFails=false;inspection:'running'|'idle'|'unknown'='running';
 status():ReturnType<OpenCodePort['status']>{return {state:'ready'} as ReturnType<OpenCodePort['status']>;}
 async ensureReady(){} async findSessions(){return [];} async inspectSession(){return this.inspection;}
 async abortSession(id:string){this.aborted.push(id);if(this.abortFails)throw new Error('abort response lost');}
 async runSession(input:OpenCodeRunRequest){const index=this.inputs.length;this.inputs.push(input);input.onSessionId?.(`page-session-${index}`);return new Promise<OpenCodeRunResult>(resolve=>this.resolvers[index]=resolve);}
 finish(index:number,options:{timedOut?:boolean;error?:string;invalid?:boolean}={}){this.resolvers[index]!({sessionId:`page-session-${index}`,outcome:{idle:true,timedOut:options.timedOut??false,error:options.error,assistantText:options.invalid?'invalid':JSON.stringify({slides:[{title:`模型页${index}`,bullets:[`第${index}页真实回归产物`,'第二条真实回归产物']}]}),messages:[]}});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const store=new Store({dataDir:mkdtempSync(join(tmpdir(),'aw-ppt-pages-'))});const port=new PagePort();const engine=new Engine({store,ports:{git:{} as EnginePorts['git'],opencode:port},integration:{opencodeReady:()=>true,gitlabConfigured:()=>false}});const work=engine.ppt.create({requestKey:createRequestKey(),title:'逐页生产',topic:'真实部分状态',confirmCreate:true}).resource![0]!;engine.ppt.update(work.id,{requestKey:createRequestKey(),confirmUpdate:true,brief:{audience:'研发',objective:'核对',length:'三页',style:'克制',sources:'临时测试资料'},outline:['第一正文','第二正文','第三正文'],slides:[{title:'第一正文',bullets:['旧正文'],notes:'人工备注保留',titleStyle:{fontSize:38,color:'accent',align:'center'},tag:'人工标签'}]});return {store,port,engine,id:work.id};}
test('sequential page generation persists mixed states, actual output and completed-page edits without overwriting other pages',async()=>{
 const {store,port,engine,id}=fixture();try{
  const key=createRequestKey();const pending=engine.ppt.generateSlides(id,{requestKey:key,confirmGenerate:true});await tick();
  const view=()=>engine.ppt.list().works.find(work=>work.id===id)!;
  assert.deepEqual(view().generation?.pages?.map(page=>page.status),['generating','pending','pending']);assert.equal(port.inputs.length,1);
  port.finish(0);await tick();assert.deepEqual(view().generation?.pages?.map(page=>page.status),['completed','generating','pending']);
  assert.match(store.pptWorks.get(id)!.slides[0]!.bullets[0]!,/真实回归/);assert.equal(store.pptWorks.get(id)!.slides[0]!.notes,'人工备注保留');assert.equal(store.pptWorks.get(id)!.slides[0]!.tag,'人工标签');
  const completed=store.pptWorks.get(id)!;
  engine.ppt.update(id,{requestKey:createRequestKey(),confirmUpdate:true,expectedRevision:completed.revision,pageEdit:{index:0,page:{...completed.slides[0]!,bullets:['制作下一页时的人工修改']}}});
  assert.throws(()=>engine.ppt.update(id,{requestKey:createRequestKey(),confirmUpdate:true,expectedRevision:store.pptWorks.get(id)!.revision,pageEdit:{index:1,page:{title:'未完成页',bullets:['不应写入']}}}),/尚未制作完成/);
  port.finish(1);await tick();port.finish(2);const response=await pending;
  assert.equal(response.receipt.status,'succeeded');assert.equal(view().generation?.status,'completed');assert.deepEqual(view().generation?.pages?.map(page=>page.status),['completed','completed','completed']);
  assert.deepEqual(store.pptWorks.get(id)!.slides[0]!.bullets,['制作下一页时的人工修改']);assert.equal(port.inputs.length,3);assert.ok(port.inputs.every(input=>input.permission==='read_only'));
 }finally{store.close();}
});
test('stop retains completed pages and waits for the exact current session, without dispatching waiting pages',async()=>{
 const {store,port,engine,id}=fixture();try{
  const key=createRequestKey();const pending=engine.ppt.generateSlides(id,{requestKey:key,confirmGenerate:true});await tick();port.finish(0);await tick();
  const stopKey=createRequestKey();const response=await engine.ppt.stop(id,{requestKey:stopKey,confirmStop:true});assert.equal(response.receipt.status,'accepted');assert.deepEqual(port.aborted,['page-session-1']);
  port.finish(1);await pending;
  const view=engine.ppt.list().works.find(work=>work.id===id)!;assert.deepEqual(view.generation?.pages?.map(page=>page.status),['completed','stopped','stopped']);assert.equal(port.inputs.length,2);assert.equal(engine.commands.get(stopKey)?.status,'succeeded');assert.ok(store.pptWorks.get(id)!.slides[0]!.bullets.length);
  const copied=engine.ppt.manage(id,'copy',{requestKey:createRequestKey(),expectedRevision:store.pptWorks.get(id)!.revision!,confirm:true}).resource!;
  assert.deepEqual(copied.productionPages?.map(page=>page.status),['completed','stopped','stopped']);
  assert.throws(()=>engine.ppt.document(copied.id,copied.revision!),/未完成制作/);
  let manual=copied;for(const index of [1,2])manual=engine.ppt.update(copied.id,{requestKey:createRequestKey(),expectedRevision:manual.revision,confirmUpdate:true,pageEdit:{index,page:{title:`人工完成 ${index}`,bullets:['人工保存的真实页面']}}}).resource!;
  assert.equal(engine.ppt.document(copied.id,manual.revision!,false).pages,4);
 }finally{store.close();}
});
test('timeout plus abort failure retains unknown page and original keys until positive session reconciliation',async()=>{
 const {store,port,engine,id}=fixture();try{
  const key=createRequestKey();const pending=engine.ppt.generateSlides(id,{requestKey:key,confirmGenerate:true});await tick();port.finish(0);await tick();port.abortFails=true;
  const stopKey=createRequestKey();assert.equal((await engine.ppt.stop(id,{requestKey:stopKey,confirmStop:true})).receipt.status,'unknown');port.finish(1,{timedOut:true});await assert.rejects(pending);
  const before=engine.ppt.list().works.find(work=>work.id===id)!;assert.equal(before.generation?.pages?.[0]?.status,'completed');assert.equal(before.generation?.pages?.[1]?.status,'unknown');assert.equal(engine.commands.get(key)?.status,'unknown');assert.equal(port.inputs.length,2);
  port.inspection='idle';await engine.ppt.reconcileOperation(stopKey);assert.equal(engine.commands.get(stopKey)?.status,'succeeded');assert.equal(engine.ppt.list().works.find(work=>work.id===id)!.generation?.pages?.[1]?.status,'stopped');
 }finally{store.close();}
});
test('assistant discussion uses a separate original session during production and stopping it never stops page generation',async()=>{
 const {store,port,engine,id}=fixture();try{
  const mainKey=createRequestKey();const main=engine.ppt.generateSlides(id,{requestKey:mainKey,confirmGenerate:true});await tick();port.finish(0);await tick();
  const assistantKey=createRequestKey();const discussion=engine.ppt.assistant.ask(id,{requestKey:assistantKey,expectedRevision:store.pptWorks.get(id)!.revision!,message:'只解释剩余两页的叙事关系，不修改内容',scope:'all',confirmSend:true});await tick();
  let view=engine.ppt.list().works.find(work=>work.id===id)!;assert.equal(view.generation?.requestKey,mainKey);assert.equal(view.assistantGeneration?.requestKey,assistantKey);assert.equal(port.inputs[2]?.toolPolicy,'none');
  const stopKey=createRequestKey();await engine.ppt.stop(id,{requestKey:stopKey,generationRequestKey:assistantKey,confirmStop:true});assert.deepEqual(port.aborted,['page-session-2']);
  port.resolvers[2]!({sessionId:'page-session-2',outcome:{idle:true,timedOut:false,assistantText:JSON.stringify({reply:'尚未应用任何修改。'}),messages:[]}});await discussion;
  view=engine.ppt.list().works.find(work=>work.id===id)!;assert.equal(view.generation?.status,'running');assert.equal(store.pptWorks.get(id)?.status,'generating');assert.equal(engine.commands.get(stopKey)?.status,'succeeded');assert.equal(engine.commands.get(mainKey)?.status,'accepted');
  port.finish(1);await tick();port.finish(3);await main;
 }finally{store.close();}
});
test('startup preserves completed pages, marks the in-flight page unknown and never redispatches',async()=>{
 const {store,port,engine,id}=fixture();try{
  const key=createRequestKey();void engine.ppt.generateSlides(id,{requestKey:key,confirmGenerate:true});await tick();port.finish(0);await tick();
  const recovered=new Engine({store,ports:{git:{} as EnginePorts['git'],opencode:port},integration:{opencodeReady:()=>true,gitlabConfigured:()=>false}});recovered.ppt.recoverOnStartup();
  assert.deepEqual(recovered.ppt.list().works.find(work=>work.id===id)?.generation?.pages?.map(page=>page.status),['completed','unknown','pending']);assert.equal(port.inputs.length,2);assert.equal(recovered.commands.get(key)?.status,'unknown');assert.match(store.pptWorks.get(id)!.slides[0]!.bullets[0]!,/真实回归/);
 }finally{store.close();}
});

test('HTTP background production returns accepted immediately and exact-generation stop uses its own request scope',async()=>{
 const app=await createApplication({dataDir:mkdtempSync(join(tmpdir(),'aw-ppt-page-http-')),disableOpenCode:true,disableListen:true});const port=new PagePort();
 Object.assign(app.engine.ports.opencode,{status:port.status.bind(port),runSession:port.runSession.bind(port),abortSession:port.abortSession.bind(port),inspectSession:port.inspectSession.bind(port)});
 try{
  const created=app.engine.ppt.create({requestKey:createRequestKey(),title:'HTTP 部分状态',topic:'临时测试',confirmCreate:true});const id=String(created.receipt.outcome?.workId);
  app.engine.ppt.update(id,{requestKey:createRequestKey(),confirmUpdate:true,brief:{audience:'研发',objective:'确认',length:'2页',style:'克制',sources:'临时公开资料'},outline:['一','二']});
  const key=createRequestKey();const response=await app.app.inject({method:'POST',url:ROUTES.pptWorkGenerateSlides(id),payload:{requestKey:key,confirmGenerate:true,background:true}});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.receipt.status,'accepted');assert.deepEqual(response.json().data.resource.generation.pages.map((page:{status:string})=>page.status),['generating','pending']);
  port.finish(0);await tick();
  const stopKey=createRequestKey();const stop=await app.app.inject({method:'POST',url:ROUTES.pptGenerationStop(key),payload:{requestKey:stopKey,confirmStop:true}});assert.equal(stop.statusCode,200,stop.body);assert.equal(stop.json().data.receipt.status,'accepted');
  port.finish(1);await tick();assert.equal(app.engine.commands.get(stopKey)?.status,'succeeded');assert.equal(app.engine.ppt.list().works.find(work=>work.id===id)?.generation?.pages?.[1]?.status,'stopped');
 }finally{await app.close();}
});
