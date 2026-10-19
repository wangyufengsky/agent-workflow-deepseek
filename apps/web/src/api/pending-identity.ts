import {useSyncExternalStore} from 'react';
import {isApiClientError} from './client.ts';
import {pendingCommands,subscribePending,type PendingCommand} from './pending-commands.ts';
export function pendingIdentityForPath(path:string):PendingCommand|undefined{return pendingCommands().find(command=>command.path===path);}
export function usePendingIdentity(path:string):PendingCommand|undefined {
 const snapshot=useSyncExternalStore(subscribePending,()=>{const command=pendingIdentityForPath(path);return command?JSON.stringify(command):'';},()=> '');
 return snapshot?JSON.parse(snapshot) as PendingCommand:undefined;
}

export function isUncertainCommandFailure(error:unknown):boolean {return isApiClientError(error)&&['timeout','unavailable','protocol'].includes(error.kind);}
export function pendingIdentityMatching(matches:(path:string)=>boolean):PendingCommand|undefined {return pendingCommands().find(command=>matches(command.path));}
export function usePendingIdentityMatching(matches:(path:string)=>boolean):PendingCommand|undefined {
 const snapshot=useSyncExternalStore(subscribePending,()=>{const command=pendingIdentityMatching(matches);return command?JSON.stringify(command):'';},()=> '');
 return snapshot?JSON.parse(snapshot) as PendingCommand:undefined;
}
