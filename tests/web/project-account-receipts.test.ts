import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationReceipt } from '@agent-workflow/shared';
import { ProjectGitAccount } from '../../apps/web/src/pages/projects/ProjectGitAccount.tsx';
import { assertProjectAccountReceipt, readProjectAccountOperation } from '../../apps/web/src/pages/projects/project-account-receipt.ts';
const priorFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=priorFetch;});
const receipt=(projectId:string,requestKey:string):OperationReceipt=>({operation:'project.git-account.test',requestKey,target:{projectId},status:'succeeded',bodyHash:'fixture',contractVersion:'fixture',acceptedAt:new Date().toISOString(),auditId:'fixture'});
test('changing projects remounts the account form so old keys and credential input cannot carry over',()=>{
 const a=ProjectGitAccount({projectId:'project-a'}),b=ProjectGitAccount({projectId:'project-b'});
 assert.equal(a.key,'project-a');assert.equal(b.key,'project-b');assert.notEqual(a.key,b.key);
});
test('account operation reads reject late context and wrong project/key/operation, without dispatching a write',async()=>{
 const seen:string[]=[];let finish!:()=>void;
 globalThis.fetch=async(input)=>{seen.push(String(input));if(String(input).endsWith('req_account_old'))await new Promise<void>(resolve=>{finish=resolve;});return new Response(JSON.stringify({data:{operation:receipt(String(input).endsWith('req_account_old')?'project-a':'project-b',String(input).split('/').at(-1)!)},meta:{}}));};
 let current=true;const old=readProjectAccountOperation('project-a','req_account_old',()=>current);while(!finish)await new Promise(resolve=>setImmediate(resolve));current=false;
 const next=await readProjectAccountOperation('project-b','req_account_new',()=>true);assert.equal(next.target.projectId,'project-b');finish();await assert.rejects(old,/过期/);
 assert.deepEqual(seen,['/api/operations/req_account_old','/api/operations/req_account_new']);
 const valid=receipt('project-b','req_account_new');assert.doesNotThrow(()=>assertProjectAccountReceipt(valid,'project-b','req_account_new'));
 for(const invalid of [{...valid,target:{projectId:'project-a'}},{...valid,requestKey:'req_account_old'},{...valid,operation:'project.update'}])assert.throws(()=>assertProjectAccountReceipt(invalid,'project-b','req_account_new'),/身份不一致/);
});
