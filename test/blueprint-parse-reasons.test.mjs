import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan} from '../blueprints.mjs';
const xml=(over={})=>'<reply>ok</reply><title>Plan</title><summary>S.</summary><questions></questions><ready>'+(over.ready??'true')+'</ready>';
test('valid XML, JSON and unwrapped-reply contracts still parse; ready demotes while questions remain',()=>{
  assert.equal(parsePlan(xml()).ready,true);
  const withQ=parsePlan('<reply>ok</reply><title>P</title><summary>S</summary><questions><question>Was?</question></questions><ready>true</ready>');
  assert.deepEqual([withQ.ready,withQ.questions.length],[false,1]);
  assert.equal(parsePlan(JSON.stringify({reply:'r',title:'t',summary:'s',questions:[],ready:true})).title,'t');
  assert.match(parsePlan('Vorfrage?\n<title>T</title><summary>S</summary><questions></questions><ready>false</ready>').reply,/Vorfrage/);
});
test('structural failures name the missing or malformed sections',()=>{
  for(const bad of ['<reply>nur das</reply>','garbage without any sections','<title>t</title><summary>s</summary><ready>true</ready>'])
    assert.throws(()=>parsePlan(bad),/Format ungültig/);
});
test('field validation failures are specific instead of generic',()=>{
  assert.throws(()=>parsePlan(JSON.stringify({reply:'r',title:'t',summary:'s',ready:'yes'})),/ready muss true oder false/);
  assert.throws(()=>parsePlan(JSON.stringify({reply:'r'.repeat(1801),title:'t',summary:'s',ready:true})),/reply über 1800/);
  assert.throws(()=>parsePlan(JSON.stringify({reply:'r',summary:'s',ready:true})),/title fehlt/);
  assert.throws(()=>parsePlan(JSON.stringify({reply:'r',title:'t'.repeat(101),summary:'s',ready:true})),/title über 100/);
  assert.throws(()=>parsePlan(JSON.stringify({reply:'r',title:'t',summary:'s'.repeat(6001),ready:true})),/summary über 6000/);
  assert.throws(()=>parsePlan(JSON.stringify({title:'t',summary:'s',ready:true})),/reply-Text fehlt/);
  assert.throws(()=>parsePlan('<reply>r</reply><title>t</title><summary>s</summary><questions><question>Frag</questio></questions><ready>true</ready>'),/questions/);
  assert.throws(()=>parsePlan('<reply>r</reply><title>t</title><summary>s</summary><questions></questions><ready>yes</ready>'),/Format ungültig/);
  assert.throws(()=>parsePlan(xml().replace('<questions></questions>','<questions>'+'<question>F?</question>'.repeat(21)+'</questions>')),/mehr als 20/);
});
