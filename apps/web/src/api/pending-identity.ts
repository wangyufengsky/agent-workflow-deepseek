import {useSyncExternalStore} from 'react';
import {pendingCommands,subscribePending,type PendingCommand} from './pending-commands.ts';
export function pendingIdentityForPath(path:string):PendingCommand|undefined{return pendingCommands().find(command=>command.path===path);}
export function usePendingIdentity(path:string):PendingCommand|undefined {
 const snapshot=useSyncExternalStore(subscribePending,()=>{const command=pendingIdentityForPath(path);return command?JSON.stringify(command):'';},()=> '');
 return snapshot?JSON.parse(snapshot) as PendingCommand:undefined;
}
