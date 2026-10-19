import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES} from '@agent-workflow/shared';
import {request} from '../../apps/web/src/api/client.ts';
import {pendingCommands,settleCommand} from '../../apps/web/src/api/pending-commands.ts';

test('role package lost publish response retains original key across candidate/reload and never redispatches',async()=>{
 const priorFetch=globalThis.fetch;const priorStorage=globalThis.localStorage;const data=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)}});
 try{
  let writes=0;globalThis.fetch=async()=>{writes++;throw new TypeError('response lost after commit');};
  await assert.rejects(request(ROUTES.catalogRolePackagePublish,{method:'POST',body:{requestKey:'req_role_package_original'}}),/req_role_package_original/);
  assert.equal(pendingCommands()[0]?.scope,'/api/catalog/roles');assert.match([...data.values()][0]!,/req_role_package_original/);
  await assert.rejects(request(ROUTES.catalogRolePackagePublish,{method:'POST',body:{requestKey:'req_new_key'}}),/req_role_package_original/);assert.equal(writes,1);
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{operation:{requestKey:'req_role_package_original',status:'accepted'}},meta:{}}));
  await request(ROUTES.operationsByKey('req_role_package_original'));assert.equal(pendingCommands().length,1);
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{operation:{requestKey:'req_role_package_original',status:'succeeded'}},meta:{}}));
  await request(ROUTES.operationsByKey('req_role_package_original'));assert.equal(pendingCommands().length,0);assert.equal(writes,1);
 }finally{globalThis.fetch=priorFetch;for(const pending of pendingCommands())settleCommand(pending.requestKey);Object.defineProperty(globalThis,'localStorage',{configurable:true,value:priorStorage});}
});
