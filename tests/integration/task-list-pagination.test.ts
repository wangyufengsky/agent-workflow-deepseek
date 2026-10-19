import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../packages/server/src/index.ts';
import {ROUTES,type TaskListPage} from '@agent-workflow/shared';
test('task HTTP filters complete scope before keyset pagination and home ongoing limit',async()=>{
 const root=mkdtempSync(join(tmpdir(),'aw-task-pages-'));writeFileSync(join(root,'public.md'),'public fixture');const app=await createApplication({dataDir:join(root,'data'),disableOpenCode:true,disableListen:true});
 try{const project=app.store.projects.create({name:'全部范围项目检索',rootPath:root,gitState:'not_git'});const old=app.store.tasks.create({projectId:project.id,title:'最早的进行中-needle',requirementText:'public',methodId:'method.requirement-development',methodRevision:'1'});app.store.tasks.update(old.id,{stage:'planning'});
 for(let index=0;index<225;index++){const task=app.store.tasks.create({projectId:project.id,title:`已结束-${index}`,requirementText:'public',methodId:'method.requirement-development',methodRevision:'1'});app.store.tasks.update(task.id,{lifecycle:'completed'});}
 const read=async(query:string)=>{const response=await app.app.inject({method:'GET',url:`${ROUTES.tasks}?${query}`});assert.equal(response.statusCode,200,response.body);return response.json().data as TaskListPage;};
 const first=await read('limit=50');assert.equal(first.total,226);assert.equal(first.counts.closed,225);assert.equal(first.counts.active,1);assert.equal(first.items.length,50);assert.ok(!first.items.some(task=>task.id===old.id));
 const home=await read('ongoing=true&limit=3');assert.equal(home.total,1);assert.deepEqual(home.items.map(task=>task.id),[old.id]);
 const found=await read('q=needle&limit=50');assert.equal(found.total,1);assert.equal(found.items[0]?.id,old.id);
 const named=await read(`q=${encodeURIComponent('全部范围项目检索')}&limit=50`);assert.equal(named.total,226,'search includes project names outside first page');
 const seen=new Set<string>();let cursor:string|undefined;do{const page=await read(`group=closed&limit=50${cursor?`&cursor=${cursor}`:''}`);assert.equal(page.total,225);for(const task of page.items){assert.equal(seen.has(task.id),false,'stable ordering must not repeat same-timestamp tasks');seen.add(task.id);}cursor=page.nextCursor;}while(cursor);assert.equal(seen.size,225);
 const invalid=await app.app.inject({method:'GET',url:`${ROUTES.tasks}?cursor=not-json`});assert.equal(invalid.statusCode,400);
 }finally{await app.close();}
});
