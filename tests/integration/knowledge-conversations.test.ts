import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import { createApplication, sessionPermission } from '../../packages/server/src/index.ts';
import { createSessionScope } from '../../packages/server/src/session-scope.ts';
import type { KnowledgeConversationCommand, RuntimeInteractionResolveRequest } from '@agent-workflow/shared';
import type { QuestionRequest } from '@agent-workflow/opencode';

// Real SQLite/files/HTTP with an explicit offline runtime port; no model acceptance.
function fixture(existingStore?: Store) {
  const store = existingStore ?? new Store({ dataDir: mkdtempSync(join(tmpdir(),'aw-kb-conversation-')) });
  const root = mkdtempSync(join(tmpdir(),'aw-kb-docs-')); writeFileSync(join(root,'README.md'),'# Original source\nOnly bounded input.\n');
  const requests: OpenCodeRunRequest[] = []; const finishes: Array<(value: OpenCodeRunResult) => void> = []; const writes: unknown[] = [];
  let automatic = true; let failure = false; let idle = false; let pending: readonly Record<string, unknown>[] = []; let reads = 0;
  const result = (index: number): OpenCodeRunResult => ({ sessionId: `ses_kb_${index+1}`, outcome: { idle: true, timedOut: false, assistantText: JSON.stringify({ answer: `Offline protocol fixture answer ${index+1}`, citations: [{ path:'README.md',line:1 }] }), messages: [] } });
  const port: OpenCodePort = { status: () => ({ state:'ready' }) as never, ensureReady: async()=>{}, abortSession: async()=>{idle=true;}, findSessions:async()=>[], inspectSession:async()=> idle ? 'idle' : 'running',
    runSession: async(request)=>{ const index=requests.length;requests.push(request);request.onSessionId?.(`ses_kb_${index+1}`); return automatic ? result(index) : new Promise((resolve)=>{finishes[index]=resolve;}); },
    runtimePermissionAllowed:()=>false, runtimeRequests:async(session)=>{reads++;return pending.filter((request)=>request.sessionID===session);},
    replyRuntimeQuestion:async(...args)=>{writes.push(args);if(failure)throw Error('offline response lost');},replyRuntimePermission:async(...args)=>{writes.push(args);},
  };
  const engine=new Engine({store,ports:{git:{} as never,opencode:port},integration:{opencodeReady:()=>true,gitlabConfigured:()=>false}});
  const project=store.projects.create({name:'Conversation source',rootPath:root,gitState:'not_git'});
  let ordinal=0;
  const ask=(extra:Record<string,unknown>={})=>engine.knowledge.ask({requestKey:`req_conversation_${++ordinal}`,projectId:project.id,question:`Question number ${ordinal}?`,sourcePaths:['README.md'],...extra});
  const wait=async(index=0)=>{for(let n=0;n<100&&!requests[index];n++)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(requests[index]);return requests[index]!;};
  const question=async(index=0)=>{const request=await wait(index);const value:QuestionRequest={id:`que_kb_${index+1}`,sessionID:`ses_kb_${index+1}`,protocol:'v2',questions:[{question:'Which document format?',header:'Format',options:[{label:'Markdown',description:'text'},{label:'HTML',description:'web'}],multiple:true,custom:true}]};pending=[value as unknown as Record<string,unknown>];await request.sink.onQuestion?.(value);return engine.runtimeInteractions.list().find(item=>item.requestId===value.id)!;};
  return {store,engine,project,port,requests,writes,ask,wait,question,finish:(index=0)=>finishes[index]!(result(index)),setAutomatic:(value:boolean)=>{automatic=value;},setFailure:(value:boolean)=>{failure=value;},setPending:(value:typeof pending)=>{pending=value;},reads:()=>reads};
}
const command=(projectId:string,revision:number,key:string,title?:string):KnowledgeConversationCommand=>({projectId,expectedRevision:revision,requestKey:key,confirm:true,...(title===undefined?{}:{title})});

test('conversation metadata aggregates real turns; rename/archive/restore preserve frozen messages and follow-up context',async()=>{
 const f=fixture();try{
  const first=await f.ask();const original=first.resource!;const id=original.conversationId;let conversation=f.engine.knowledge.history(f.project.id).conversations![0]!;
  assert.equal(conversation.messageCount,1);assert.equal(conversation.state,'completed');assert.equal(conversation.title,original.question);
  const renamed=f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,conversation.revision,'req_rename','Named conversation'));assert.equal(renamed.resource?.title,'Named conversation');
  const archived=f.engine.knowledge.conversations.update(id,'archive',command(f.project.id,renamed.resource!.revision,'req_archive'));assert.ok(archived.resource?.archivedAt);
  const replay=f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,conversation.revision,'req_rename','Named conversation'));assert.equal(replay.receipt.status,'succeeded');assert.equal(f.requests.length,1);
  await assert.rejects(f.ask({conversationId:id}),/已归档/);assert.equal(f.requests.length,1);
  const restored=f.engine.knowledge.conversations.update(id,'restore',command(f.project.id,archived.resource!.revision,'req_restore'));assert.equal(restored.resource?.archivedAt,undefined);
  const follow=await f.ask({conversationId:id,question:'Follow-up about original input?'});assert.equal(follow.resource?.conversationId,id);
  assert.ok(f.requests[1]!.prompt.includes(original.question));assert.ok(f.requests[1]!.prompt.includes(original.answer));assert.equal(f.requests[1]!.model.id,f.requests[0]!.model.id);
  conversation=f.engine.knowledge.history(f.project.id).conversations![0]!;assert.equal(conversation.title,'Named conversation');assert.equal(conversation.messageCount,2);
  assert.equal(f.engine.knowledge.result(original.requestKey!,f.project.id).question,original.question);assert.deepEqual(f.engine.knowledge.result(original.requestKey!,f.project.id).citations,original.citations);
  assert.throws(()=>f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,1,'req_stale','Stale')),/已变化/);
 }finally{f.store.close();}
});

test('accepted/UNKNOWN metadata replay never redoes changes; by-key proof cannot overwrite a later name',async()=>{
 const f=fixture();try{
  const first=await f.ask();const id=first.resource!.conversationId;const initial=f.engine.knowledge.conversations.get(f.project.id,id);
  const body={id,projectId:f.project.id,expectedRevision:initial.revision,confirm:true,title:'Never written'};
  f.engine.commands.begin({requestKey:'req_accepted_meta',operation:'knowledge.conversation.rename',body,target:{projectId:f.project.id}});
  assert.equal(f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,initial.revision,'req_accepted_meta','Never written')).receipt.status,'accepted');
  f.store.operations.settle('req_accepted_meta','unknown');assert.equal(f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,initial.revision,'req_accepted_meta','Never written')).receipt.status,'unknown');assert.equal(f.engine.knowledge.conversations.get(f.project.id,id).title,initial.title);
  await f.engine.knowledge.reconcileOperation('req_accepted_meta');assert.equal(f.engine.commands.get('req_accepted_meta')?.status,'failed');
  const saved=f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,initial.revision,'req_saved_meta','First name'));
  f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,saved.resource!.revision,'req_later_meta','Later name'));
  f.store.operations.settle('req_saved_meta','unknown');await f.engine.knowledge.reconcileOperation('req_saved_meta');assert.equal(f.engine.commands.get('req_saved_meta')?.status,'succeeded');assert.equal(f.engine.knowledge.conversations.get(f.project.id,id).title,'Later name');
  assert.throws(()=>f.engine.knowledge.conversations.update(id,'rename',command(f.project.id,initial.revision,'req_saved_meta','Different body')),/同一请求号/);
 }finally{f.store.close();}
});

test('real native question binds project/run/conversation without task identity; reply resumes the original run',async()=>{
 const f=fixture();f.setAutomatic(false);const running=f.ask();try{
  const item=await f.question();assert.equal(item.binding.taskId,undefined);assert.equal(item.binding.projectId,f.project.id);assert.equal(item.binding.knowledgeRequestKey,'req_conversation_1');
  assert.equal(f.engine.knowledge.progress('req_conversation_1',f.project.id).status,'needs_answer');let conversation=f.engine.knowledge.history(f.project.id).conversations![0]!;assert.equal(conversation.state,'needs_answer');assert.deepEqual(conversation.pendingInteractionIds,[item.id]);assert.equal(conversation.actions.archive.allowed,false);assert.equal(f.engine.inbox.list().find(entry=>entry.id===item.id)?.taskId,undefined);
  const input:RuntimeInteractionResolveRequest={requestKey:'req_kb_answer',confirmResolve:true,action:'answer',answers:[{questionId:'q0',values:['o0','o1'],other:'PDF'}]};
  const response=await f.engine.runtimeInteractions.resolve(item.id,input);assert.equal(response.receipt.status,'succeeded');assert.deepEqual(f.writes[0],['ses_kb_1','que_kb_1',[['Markdown','HTML','PDF']],'v2']);
  assert.equal(f.engine.knowledge.progress('req_conversation_1',f.project.id).status,'researching');assert.equal(f.engine.commands.get('req_conversation_1')?.status,'accepted');
  f.finish();assert.equal((await running).receipt.status,'succeeded');conversation=f.engine.knowledge.history(f.project.id).conversations![0]!;assert.equal(conversation.state,'completed');assert.equal(conversation.pendingInteractionIds.length,0);assert.equal(f.requests.length,1);
 }finally{f.store.close();}
});

test('native UNKNOWN reply only reconciles by original key and permission revocation hides question body',async()=>{
 const f=fixture();f.setAutomatic(false);const running=f.ask();try{
  const item=await f.question();f.setFailure(true);
  const input:RuntimeInteractionResolveRequest={requestKey:'req_kb_unknown',confirmResolve:true,action:'answer',answers:[{questionId:'q0',values:['o0']}]};assert.equal((await f.engine.runtimeInteractions.resolve(item.id,input)).receipt.status,'unknown');
  f.setPending([]);await f.engine.runtimeInteractions.reconcileOperation(input.requestKey);assert.equal(f.engine.commands.get(input.requestKey)?.status,'unknown');assert.equal(f.writes.length,1);assert.equal(f.engine.knowledge.history(f.project.id).conversations![0]?.state,'unknown');
  f.requests[0]!.sink.onInteractionConfirmed?.({kind:'question',sessionID:'ses_kb_1',requestID:'que_kb_1',answers:[['Markdown']]});assert.equal(f.engine.commands.get(input.requestKey)?.status,'succeeded');
  f.engine.knowledge.inputs.updatePermissions(f.project.id,{requestKey:'req_revoke_kb',originalRead:false});const masked=f.engine.runtimeInteractions.view(f.engine.runtimeInteractions.get(item.id));assert.equal(masked.resolveAllowed,false);assert.deepEqual(masked.questions,[]);assert.equal(masked.resolution,undefined);
  f.finish();await assert.rejects(running,{code:'REVOKED'});assert.equal(f.engine.knowledge.history(f.project.id).conversations![0]?.latest?.answer,'');
 }finally{f.store.close();}
});

test('questions-only native tool does not grant any MCP/file/command permission and stop closes unsent questions',async()=>{
 const f=fixture();f.setAutomatic(false);const running=f.ask();try{
  const item=await f.question();assert.deepEqual(sessionPermission(f.requests[0]!,'workflow'),[{permission:'*',pattern:'*',action:'deny'},{permission:'question',pattern:'*',action:'allow'}]);
  const stopped=await f.engine.knowledge.stop('req_conversation_1',{projectId:f.project.id,requestKey:'req_kb_stop'});assert.equal(stopped.receipt.status,'succeeded');assert.equal(f.engine.runtimeInteractions.get(item.id).state,'resolved');assert.equal(f.engine.knowledge.history(f.project.id).conversations![0]?.state,'stopped');assert.equal(f.engine.inbox.list().some(entry=>entry.id===item.id),false);f.finish();await running;
 }finally{f.store.close();}
});

test('real HTTP metadata routes preserve original receipts, project identity and questions-only MCP guard',async()=>{
 const app=await createApplication({dataDir:mkdtempSync(join(tmpdir(),'aw-kb-history-http-')),disableOpenCode:true,disableListen:true});const f=fixture(app.store);Object.assign(app.engine,{knowledge:f.engine.knowledge,runtimeInteractions:f.engine.runtimeInteractions});
 try{
  const first=await f.ask();const id=first.resource!.conversationId;const url=`/api/knowledge/conversations/${id}`;
  const get=await app.app.inject({method:'GET',url:`${url}?projectId=${f.project.id}`});assert.equal(get.statusCode,200,get.body);const revision=get.json().data.conversation.revision;
  const payload=command(f.project.id,revision,'req_http_kb_rename','HTTP name');const rename=await app.app.inject({method:'POST',url:`${url}/rename`,payload});assert.equal(rename.statusCode,200,rename.body);assert.equal(rename.json().data.receipt.status,'succeeded');
  const replay=await app.app.inject({method:'POST',url:`${url}/rename`,payload});assert.equal(replay.json().data.receipt.status,'succeeded');
  const other=app.store.projects.create({name:'Other',rootPath:tmpdir(),gitState:'not_git'});assert.equal((await app.app.inject({method:'GET',url:`${url}?projectId=${other.id}`})).statusCode,404);
  const scope=createSessionScope(f.requests[0]!);try{const guard=await app.app.inject({method:'GET',url:'/internal/mcp/context?taskId=nonexistent',headers:{authorization:`Bearer ${app.internalToken}`,'x-agent-workflow-scope':scope.token}});assert.equal(guard.statusCode,403,guard.body);assert.match(guard.body,/禁止调用工具/);}finally{scope.revoke();}
 }finally{await app.close();}
});

test('conversation request index retains completed turns beyond the legacy thirty-entry window', async () => {
  const f = fixture();
  try {
    const first = await f.ask(); const id = first.resource!.conversationId;
    for (let index = 1; index < 33; index++) await f.ask({ conversationId: id });
    const history = f.engine.knowledge.history(f.project.id);
    assert.equal(history.entries.filter(entry => entry.conversationId === id).length, 33);
    assert.equal(history.conversations?.find(item => item.id === id)?.messageCount, 33);
    const restored = new Engine({ store: f.store, ports: { git: {} as never, opencode: f.port }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
    assert.equal(restored.knowledge.history(f.project.id).entries.length, 33);
    assert.equal(restored.knowledge.conversations.get(f.project.id, id).latest?.question, 'Question number 33?');
  } finally { f.store.close(); }
});

test('revoked completed history strips result text and native tool evidence copies', async () => {
  const f = fixture();
  try {
    const response = (await f.ask()).resource!;
    f.store.settings.putJson(`knowledge.result.${response.requestKey}`, { ...response, toolActivity: [{ input: { question: 'formerly authorized document body' } }], steps: [{ detail: 'formerly authorized tool response' }] });
    f.engine.knowledge.inputs.updatePermissions(f.project.id, { requestKey: 'req_revoke_completed', originalRead: false });
    const latest = f.engine.knowledge.history(f.project.id).conversations![0]!.latest!;
    assert.equal(latest.readability, 'forbidden'); assert.equal(latest.answer, ''); assert.deepEqual(latest.citations, []); assert.deepEqual(latest.toolActivity, []); assert.deepEqual(latest.steps, []);
    assert.throws(() => f.engine.knowledge.result(response.requestKey!, f.project.id), { code: 'REVOKED' });
  } finally { f.store.close(); }
});
