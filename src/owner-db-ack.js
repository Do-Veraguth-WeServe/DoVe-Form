// App-owned HTTP results only, never guest supplied tokens. A gap means an
// unobserved write: retain the baseline so canonical reconciliation still runs.
export function acknowledgeOwnerDbWrite(revision,result){
 const write=result?.ownerDbWrite;
 if(!revision||result?.ok!==true||!write||
   !Number.isSafeInteger(write.before)||write.before<0||
   !Number.isSafeInteger(write.after)||write.after!==write.before+1||
   revision.dbRevision!==write.before)return revision;
 return {...revision,dbRevision:write.after};
}
