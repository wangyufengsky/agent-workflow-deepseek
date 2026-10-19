import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES} from '@agent-workflow/shared';
import {request,ApiClientError} from '../../apps/web/src/api/client.ts';
import {pendingIdentityForPath} from '../../apps/web/src/api/pending-identity.ts';
import {pendingCommands,settleCommand} from '../../apps/web/src/api/pending-commands.ts';
import {saveWorkflow} from '../../apps/web/src/pages/workflows/workflow-api.ts';
const original=globalThis.fetch,values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});afterEach(()=>{globalThis.fetch=original;for(const item of pendingCommands())settleCommand(item.requestKey);values.clear();});
const envelope=(data:unknown)=>new Response(JSON.stringify({data,meta:{}}),{status:200});
test('template and workflow view recovery reads durable original identity for protocol-wrapped transport failures',async()=>{
 for(const path of [ROUTES.tasks,ROUTES.workflow('workflow_entry')]){let writes=0;globalThis.fetch=async()=>{writes++;throw new TypeError('response lost');};const key=`original-${writes}-${path.length}`;await assert.rejects(request(path,{method:path===ROUTES.tasks?'POST':'PATCH',body:{requestKey:key}}),(error:unknown)=>error instanceof ApiClientError&&error.kind==='protocol');assert.equal(pendingIdentityForPath(path)?.requestKey,key);await assert.rejects(request(path,{method:'POST',body:{requestKey:'unsent-new-key'}}),new RegExp(key));assert.equal(writes,1);assert.equal(pendingIdentityForPath(path)?.requestKey,key);globalThis.fetch=async()=>envelope({operation:{requestKey:key,status:'succeeded'}});await request(ROUTES.operationsByKey(pendingIdentityForPath(path)!.requestKey));assert.equal(pendingIdentityForPath(path),undefined);}
});
test('workflow adapter never labels accepted or unknown receipt as a saved version',async()=>{
 for(const status of ['accepted','unknown']){globalThis.fetch=async()=>envelope({receipt:{requestKey:`workflow-${status}`,status}});const result=await saveWorkflow({id:`workflow_${status}`,requestKey:`workflow-${status}`,draft:{} as never,expectedVersion:1});assert.equal(result.kind,'pending');assert.ok(pendingIdentityForPath(ROUTES.workflow(`workflow_${status}`)));}
});
