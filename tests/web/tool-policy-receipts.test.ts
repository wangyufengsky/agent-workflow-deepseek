import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES} from '@agent-workflow/shared';
import {request} from '../../apps/web/src/api/client.ts';
import {pendingCommands,settleCommand} from '../../apps/web/src/api/pending-commands.ts';
import {pendingToolPolicyCommand,toolPolicyCommandSnapshot} from '../../apps/web/src/pages/tools/tool-policy-command.ts';
const originalFetch=globalThis.fetch;
const values=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
afterEach(()=>{globalThis.fetch=originalFetch;for(const item of pendingCommands())settleCommand(item.requestKey);values.clear();});
const envelope=(data:unknown)=>new Response(JSON.stringify({data,meta:{}}),{status:200});
test('policy panel restores original durable identity after remount and scope changes without allocating an unsent lookup key',async()=>{
 let writes=0;globalThis.fetch=async()=>{writes++;throw new TypeError('lost response after actual commit');};
 await assert.rejects(request(ROUTES.toolsPolicy,{method:'PATCH',body:{requestKey:'policy-original',toolName:'workspace.file.read',enabled:false}}),/policy-original/);
 assert.equal(pendingToolPolicyCommand()?.requestKey,'policy-original');assert.equal(toolPolicyCommandSnapshot(),'policy-original:unknown');
 // A new panel lifetime only knows persistent identities, never a component's previous request body.
 const durable=JSON.parse([...values.values()][0]!);assert.equal(durable[0].requestKey,'policy-original');assert.equal(durable[0].toolName,undefined);
 await assert.rejects(request(ROUTES.toolsPolicy,{method:'PATCH',body:{requestKey:'must-not-be-dispatched',projectId:'another-project',enabled:true,toolName:'workspace.file.read'}}),/policy-original/);
 assert.equal(writes,1);assert.equal(pendingToolPolicyCommand()?.requestKey,'policy-original');
 globalThis.fetch=async(url)=>{assert.ok(String(url).endsWith(ROUTES.operationsByKey('policy-original')));return envelope({operation:{requestKey:'policy-original',status:'accepted'}});};
 await request(ROUTES.operationsByKey(pendingToolPolicyCommand()!.requestKey));assert.equal(toolPolicyCommandSnapshot(),'policy-original:accepted');
 globalThis.fetch=async()=>envelope({operation:{requestKey:'policy-original',status:'unknown'}});await request(ROUTES.operationsByKey('policy-original'));assert.equal(toolPolicyCommandSnapshot(),'policy-original:unknown');
 globalThis.fetch=async()=>envelope({operation:{requestKey:'policy-original',status:'succeeded'}});await request(ROUTES.operationsByKey('policy-original'));assert.equal(pendingToolPolicyCommand(),undefined);assert.equal(toolPolicyCommandSnapshot(),'');assert.equal(writes,1);
});
