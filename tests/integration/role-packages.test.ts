import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../packages/server/src/index.ts';
import {ROUTES,createRequestKey,type RolePackageValidation} from '@agent-workflow/shared';

test('role packages: read-only validation, reviewed atomic publish, history, bindings freeze, replay and stale/no-diff guards',async()=>{
 const app=await createApplication({dataDir:mkdtempSync(join(tmpdir(),'aw-role-package-')),disableOpenCode:true,disableListen:true});
 try{
  const before=app.engine.roleCatalog.list();
  const method=app.engine.catalog.methods[0]!;
  const frozen=app.engine.methods.instantiate(method.id);
  const source=JSON.stringify({version:1,roles:[{id:'role.package-reviewer',name:'包审阅员',purpose:'核对包配置',responsibilities:['核对真实差异'],instructions:'仅按真实证据审阅',allowedSlots:['execution_read_only'],image:{id:'image.package',kind:'emoji',value:'🔎'}}],bindings:[{methodId:method.id,stepKey:method.requiredSteps[0]!.key,roleId:'role.package-reviewer'}]});
  const validate=async(text:string)=>{const r=await app.app.inject({method:'POST',url:ROUTES.catalogRolePackageValidate,payload:{source:text}});assert.equal(r.statusCode,200,r.body);return r.json().data as RolePackageValidation;};
  const check=await validate(source);assert.equal(check.valid,true,JSON.stringify(check));assert.ok(check.differences.some(d=>d.path.startsWith('bindings/')));assert.deepEqual(app.engine.roleCatalog.list(),before);
  const requestKey=createRequestKey();const body={requestKey,source,sourceHash:check.sourceHash,baselineHash:check.baselineHash,confirmReviewed:true};
  const published=await app.app.inject({method:'POST',url:ROUTES.catalogRolePackagePublish,payload:body});assert.equal(published.statusCode,200,published.body);assert.equal(published.json().data.receipt.status,'succeeded');
  assert.equal(app.engine.roleCatalog.history('role.package-reviewer').history.length,1);
  assert.equal(app.engine.methods.instantiate(method.id).method.requiredSteps[0]!.roleId,'role.package-reviewer');
  assert.deepEqual(frozen.method.requiredSteps,method.requiredSteps);
  assert.match(app.engine.roleCatalog.list().roles.find(role=>role.id==='role.package-reviewer')?.archiveReason??'',/激活绑定/);
  assert.throws(()=>app.engine.roleCatalog.archive('role.package-reviewer',{requestKey:createRequestKey(),confirmArchive:true}),/激活绑定/);
  assert.equal((await app.app.inject({method:'POST',url:ROUTES.catalogRolePackagePublish,payload:body})).statusCode,200);
  assert.equal(app.engine.roleCatalog.history('role.package-reviewer').history.length,1);
  const unchanged=await validate(source);assert.equal(unchanged.differences.length,0);
  assert.equal((await app.app.inject({method:'POST',url:ROUTES.catalogRolePackagePublish,payload:{...body,requestKey:createRequestKey(),baselineHash:unchanged.baselineHash}})).statusCode,400);
  const nextSource=source.replace('核对真实差异','新职责');const next=await validate(nextSource);
  app.engine.roleCatalog.save({requestKey:createRequestKey(),roleId:'role.reviewer',name:'已有人工草稿',purpose:'保留人工修改',responsibilities:['人工内容'],confirmSave:true});
  const stale=await app.app.inject({method:'POST',url:ROUTES.catalogRolePackagePublish,payload:{requestKey:createRequestKey(),source:nextSource,sourceHash:next.sourceHash,baselineHash:next.baselineHash,confirmReviewed:true}});assert.equal(stale.statusCode,409,stale.body);
  const invalid=await validate(JSON.stringify({version:1,roles:[{id:'role.invalid',name:'错误角色',purpose:'测试',responsibilities:[]}],bindings:[{methodId:method.id,stepKey:'missing',roleId:'missing'}]}));assert.equal(invalid.valid,false);assert.equal(invalid.issues.length,2);
  assert.equal(app.engine.roleCatalog.list().roles.find(r=>r.id==='role.package-reviewer')?.responsibilities[0],'核对真实差异');
 }finally{await app.close();}
});

test('role package rejects invalid ZIP and rolls back all roles and history after a storage failure',async()=>{
 const app=await createApplication({dataDir:mkdtempSync(join(tmpdir(),'aw-role-package-fault-')),disableOpenCode:true,disableListen:true});
 try{
  assert.equal(app.engine.roleCatalog.validatePackage(JSON.stringify({archiveBase64:Buffer.from('broken').toString('base64')})).valid,false);
  const source=JSON.stringify({version:1,roles:[{id:'role.first',name:'第一角色',purpose:'故障回归',responsibilities:['第一项']},{id:'role.second',name:'第二角色',purpose:'故障回归',responsibilities:['第二项']}]});
  const check=app.engine.roleCatalog.validatePackage(source);assert.equal(check.valid,true,JSON.stringify(check));
  const badTool=JSON.stringify({version:1,roles:[{id:'role.badtool',name:'未知工具',purpose:'校验',responsibilities:['核对'],resourcePermissions:{tools:[{kind:'native',name:'shell_exec'}]}}]});
  assert.equal(app.engine.roleCatalog.validatePackage(badTool).valid,false);
  const original=app.store.settings.putJson.bind(app.store.settings);
  app.store.settings.putJson=(key,value)=>{if(key==='catalog.role.history.role.second')throw new Error('injected disk write failure');return original(key,value);};
  const requestKey=createRequestKey();
  assert.throws(()=>app.engine.roleCatalog.publishPackage({requestKey,source,sourceHash:check.sourceHash,baselineHash:check.baselineHash,confirmReviewed:true}),/disk write failure/);
  app.store.settings.putJson=original;
  assert.equal(app.engine.roleCatalog.list().roles.some(role=>['role.first','role.second'].includes(role.id)),false);
  assert.equal(app.store.settings.getJson('catalog.role.history.role.first'),undefined);
  assert.equal(app.engine.commands.get(requestKey)?.status,'failed');
 }finally{await app.close();}
});

function storedZip(name:string,text:string):Buffer {
 const filename=Buffer.from(name),data=Buffer.from(text);let crc=0xffffffff;
 for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+data.length,16);
 return Buffer.concat([local,filename,data,central,filename,end]);
}
test('role package accepts real ZIP roles.json, detects CRC corruption and rejects traversal without extraction',async()=>{
 const app=await createApplication({dataDir:mkdtempSync(join(tmpdir(),'aw-role-package-zip-')),disableOpenCode:true,disableListen:true});
 try{
  const source=JSON.stringify({version:1,roles:[{id:'role.zip',name:'ZIP 角色',purpose:'读取实际压缩包',responsibilities:['校验来源']}]});
  const zip=storedZip('roles.json',source);
  assert.equal(app.engine.roleCatalog.validatePackage(JSON.stringify({archiveBase64:zip.toString('base64')})).valid,true);
  const broken=Buffer.from(zip);broken[45]=broken[45]!^1;
  assert.equal(app.engine.roleCatalog.validatePackage(JSON.stringify({archiveBase64:broken.toString('base64')})).valid,false);
  assert.equal(app.engine.roleCatalog.validatePackage(JSON.stringify({archiveBase64:storedZip('../roles.json',source).toString('base64')})).valid,false);
 }finally{await app.close();}
});
