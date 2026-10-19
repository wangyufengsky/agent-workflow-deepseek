import { inflateRawSync } from 'node:zlib';
/** ZIP is read in memory; entries are never extracted into the user's workspace. */
export function rolePackageJson(source: string): unknown {
  const value: unknown=JSON.parse(source);
  if(!value || typeof value!=='object' || !('archiveBase64' in value))return value;
  const encoded=(value as {archiveBase64:unknown}).archiveBase64;
  if(typeof encoded!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('ZIP 编码不合法');
  const zip=Buffer.from(encoded,'base64');
  let end=-1;
  for(let offset=zip.length-22;offset>=Math.max(0,zip.length-65_557);offset--)if(zip.readUInt32LE(offset)===0x06054b50){end=offset;break;}
  if(end<0 || zip.readUInt16LE(end+4)!==0 || zip.readUInt16LE(end+6)!==0)throw new Error('不是支持的单卷 ZIP 配置包');
  const count=zip.readUInt16LE(end+10);let cursor=zip.readUInt32LE(end+16);let total=0;let result:unknown;
  if(count<1 || count>120)throw new Error('ZIP 文件条目数量不合法');
  for(let index=0;index<count;index++){
    if(cursor+46>zip.length || zip.readUInt32LE(cursor)!==0x02014b50)throw new Error('ZIP 目录损坏');
    const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),crc=zip.readUInt32LE(cursor+16),compressed=zip.readUInt32LE(cursor+20),size=zip.readUInt32LE(cursor+24),nameLength=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32),local=zip.readUInt32LE(cursor+42);
    const name=zip.subarray(cursor+46,cursor+46+nameLength).toString('utf8');cursor+=46+nameLength+extra+comment;total+=size;
    if(flags&1 || ![0,8].includes(method) || total>2_000_000 || size>2_000_000 || name.includes('..') || name.startsWith('/') || name.includes('\\'))throw new Error('ZIP 条目加密、路径或解压大小不受支持');
    if(local+30>zip.length || zip.readUInt32LE(local)!==0x04034b50)throw new Error('ZIP 文件头损坏');
    const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
    if(start+compressed>zip.length)throw new Error('ZIP 条目内容截断');
    const data=method===0?zip.subarray(start,start+compressed):inflateRawSync(zip.subarray(start,start+compressed),{maxOutputLength:2_000_000});
    if(data.length!==size || crc32(data)!==crc)throw new Error('ZIP 条目校验失败');
    if(name==='roles.json') {if(result!==undefined)throw new Error('重复 roles.json');result=JSON.parse(data.toString('utf8'));}
  }
  if(result===undefined)throw new Error('ZIP 根目录缺少 roles.json');
  return result;
}
function crc32(data:Uint8Array):number {let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
