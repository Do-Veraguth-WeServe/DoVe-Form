import test from 'node:test';import assert from 'node:assert/strict';
import {acknowledgeOwnerDbWrite as ack} from '../src/owner-db-ack.js';
import {ElementDB} from '../db.mjs';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
const revision={id:'owned',stateRevision:'state',ownerCodeRevision:'code',dbRevision:4};
const result=(before=4,after=5)=>({ok:true,ownerDbWrite:{before,after}});
test('exact own write advances only DB revision',()=>{
 assert.deepEqual(ack(revision,result()),{...revision,dbRevision:5});assert.equal(revision.dbRevision,4);
 assert.equal(ack(ack(revision,result()),result(5,6)).dbRevision,6);
});
test('remote write before or after local commit is not swallowed',()=>{
 assert.equal(ack(revision,result(5,6)),revision);assert.notEqual(ack(revision,result()).dbRevision,6);
});
test('missing baseline, failed, malformed, duplicate and reordered acknowledgements stay conservative',()=>{
 assert.equal(ack(null,result()),null);
 for(const value of [null,{}, {ok:false,ownerDbWrite:{before:4,after:5}},result(4,6),result(-1,0),result(4,4.5),result('4',5),result(3,4),result(5,6)])assert.equal(ack(revision,value),revision);
});
test('receipts capture transaction boundaries, exclude reads and failed writes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-db-receipt-'));const file=path.join(dir,'e.sqlite');const a=new ElementDB(file),b=new ElementDB(file);
 const sessionId=crypto.randomUUID(),elementId=crypto.randomUUID();const op=(db,p)=>db.op({sessionId,elementId,table:'notes',...p});
 try{
 assert.deepEqual(op(a,{op:'create'}).writeRevision,{before:0,after:1});
 assert.deepEqual(op(b,{op:'insert',row:{text:'remote'}}).writeRevision,{before:1,after:2});
 const local=op(a,{op:'insert',row:{text:'local'}});assert.deepEqual(local.writeRevision,{before:2,after:3});
 op(b,{op:'insert',row:{text:'later'}});assert.deepEqual(local.writeRevision,{before:2,after:3});
 assert.equal(op(a,{op:'select'}).writeRevision,undefined);assert.equal(op(a,{op:'create'}).writeRevision,undefined);
 }finally{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true});}
});
