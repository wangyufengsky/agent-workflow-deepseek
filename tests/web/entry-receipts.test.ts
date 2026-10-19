import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES} from '@agent-workflow/shared';
import {request,ApiClientError} from '../../apps/web/src/api/client.ts';
import {pendingIdentityForPath,pendingIdentityMatching,isUncertainCommandFailure} from '../../apps/web/src/api/pending-identity.ts';
import {pendingCommands,settleCommand} from '../../apps/web/src/api/pending-commands.ts';
import {saveWorkflow,createWorkflow,copyWorkflow,archiveWorkflow} from '../../apps/web/src/pages/workflows/workflow-api.ts';
const original=globalThis.fetch,values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});afterEach(()=>{globalThis.fetch=original;for(const item of pendingCommands())settleCommand(item.requestKey);values.clear();});
const envelope=(data:unknown)=>new Response(JSON.stringify({data,meta:{}}),{status:200});
test('template and workflow view recovery reads durable original identity for protocol-wrapped transport failures',async()=>{
 for(const path of [ROUTES.tasks,ROUTES.workflow('workflow_entry')]){let writes=0;globalThis.fetch=async()=>{writes++;throw new TypeError('response lost');};const key=`original-${writes}-${path.length}`;await assert.rejects(request(path,{method:path===ROUTES.tasks?'POST':'PATCH',body:{requestKey:key}}),(error:unknown)=>error instanceof ApiClientError&&error.kind==='protocol');assert.equal(pendingIdentityForPath(path)?.requestKey,key);await assert.rejects(request(path,{method:'POST',body:{requestKey:'unsent-new-key'}}),new RegExp(key));assert.equal(writes,1);assert.equal(pendingIdentityForPath(path)?.requestKey,key);globalThis.fetch=async()=>envelope({operation:{requestKey:key,status:'succeeded'}});await request(ROUTES.operationsByKey(pendingIdentityForPath(path)!.requestKey));assert.equal(pendingIdentityForPath(path),undefined);}
});
test('workflow adapter never labels accepted or unknown receipt as a saved version',async()=>{
 for(const status of ['accepted','unknown']){globalThis.fetch=async()=>envelope({receipt:{requestKey:`workflow-${status}`,status}});const result=await saveWorkflow({id:`workflow_${status}`,requestKey:`workflow-${status}`,draft:{} as never,expectedVersion:1});assert.equal(result.kind,'pending');assert.ok(pendingIdentityForPath(ROUTES.workflow(`workflow_${status}`)));}
});

test('catalog workflows, project registration and template editor preserve their original identity after uncertain response',async()=>{
 for(const path of [ROUTES.workflows,ROUTES.workflowCopy('custom_original'),ROUTES.workflow('custom_archive'),ROUTES.projects,ROUTES.catalogTemplateUpdate('weekly')]) {
 const key='catalog-original-'+path;let writes=0;globalThis.fetch=async()=>{writes++;throw new TypeError('truncated response');};
 await assert.rejects(request(path,{method:'POST',body:{requestKey:key}}),(error:unknown)=>isUncertainCommandFailure(error));
 assert.equal(pendingIdentityForPath(path)?.requestKey,key);assert.equal(pendingIdentityMatching(p=>p===path)?.requestKey,key);
 await assert.rejects(request(path,{method:'POST',body:{requestKey:'never-dispatched'}}),new RegExp(key));assert.equal(writes,1);
 globalThis.fetch=async()=>envelope({operation:{requestKey:key,status:'succeeded'}});await request(ROUTES.operationsByKey(key));assert.equal(pendingIdentityForPath(path),undefined);
 }
 assert.equal(isUncertainCommandFailure(new ApiClientError({kind:'http',status:400,message:'bad input'})),false);
});

test('workflow directory adapters retain accepted receipts instead of reporting creation or archive success',async()=>{
 for(const status of ['accepted','unknown']){
 const actions=[{path:ROUTES.workflows,run:(requestKey:string)=>createWorkflow({draft:{} as never,requestKey})},{path:ROUTES.workflowCopy('catalog_pending'),run:(requestKey:string)=>copyWorkflow({id:'catalog_pending',name:'copy',requestKey})},{path:ROUTES.workflow('catalog_pending'),run:(requestKey:string)=>archiveWorkflow({id:'catalog_pending',requestKey})}];
 for(const [index,action]of actions.entries()){const key=`catalog-${status}-${index}`;globalThis.fetch=async()=>envelope({receipt:{status,requestKey:key}});await assert.rejects(action.run(key),isUncertainCommandFailure);assert.equal(pendingIdentityForPath(action.path)?.requestKey,key);settleCommand(key);}
 }
});
