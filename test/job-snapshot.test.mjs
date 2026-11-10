import test from 'node:test';import assert from 'node:assert/strict';
import {sameJobSnapshot} from '../src/job-snapshot.js';
const job={id:'j',conversationId:'c',messageId:'m',kind:'create',state:'building',phase:'correcting',rev:2,createdAt:'today'};
test('hydration and SSE projection compare semantically without ignoring content',()=>{
 assert.ok(sameJobSnapshot({...job,modelId:'private-model',updatedAt:'later'},{...job,prose:null,error:null,targetMessageId:null,blueprintRevision:null}));
 assert.ok(sameJobSnapshot(job,{...job,prose:''}));
 assert.ok(sameJobSnapshot(job,{...job,rev:'2'}));
 assert.equal(sameJobSnapshot(null,job),false);
 for(const [key,value] of Object.entries({id:'other',conversationId:'other',messageId:'other',targetMessageId:'other',kind:'refine',state:'failed',phase:'artifact',rev:3,error:'failed',blueprintRevision:2,createdAt:'tomorrow',prose:'new prose',render:{version:1},forms:{items:[]},blueprint:{revision:2}}))assert.equal(sameJobSnapshot(job,{...job,[key]:value}),false,key);
});
