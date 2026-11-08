import test from 'node:test';import assert from 'node:assert/strict';
import {planningOffer} from '../planning-offer.mjs';
import {parseChat,chatPrompt} from '../forms.mjs';
import {createChatStream} from '../chat-envelope.mjs';
test('bounded inert offer rejects commands and malformed values',()=>{
 assert.deepEqual(planningOffer({title:'  Aufgabenliste  '}),{version:1,title:'Aufgabenliste'});
 for(const x of [true,[],{},null,'bauen',{title:''},{title:'x'.repeat(101)},{title:'<script>'},{title:'x',url:'https://evil.invalid'},{title:'x',command:'build'},{title:'x\ny'}])assert.equal(planningOffer(x),null);
});
test('metadata-only fenced and chunked offers do not leak into prose',()=>{
 for(const raw of ['Gerne.\n{"planningOffer":{"title":"Aufgabenliste"}}','Gerne.\n```json\n{"planningOffer":{"title":"Aufgabenliste"}}\n```']){
 const result=parseChat(raw,[]);assert.equal(result.prose,'Gerne.');assert.equal(result.planningOffer.title,'Aufgabenliste');assert.equal(result.metadataError,false);
 for(let size=1;size<20;size++){let prose='';const stream=createChatStream(t=>prose+=t);for(let i=0;i<raw.length;i+=size)stream.feed(raw.slice(i,i+size));stream.finish();assert.equal(prose.trim(),'Gerne.');}
 }
 assert.equal(parseChat('{"planningOffer":null}',[]).planningOffer,null);
 assert.equal(parseChat('{"planningOffer":',[]).metadataError,true);
});
test('clear legacy prose offers have fallback but ordinary discussion does not',()=>{
 for(const text of ['Ich kann ein Element für dich bauen.','Wir können eine App dafür planen.','Ich könnte ein kleines Werkzeug erstellen.'])assert.ok(planningOffer(undefined,text));
 for(const text of ['Ich kann keine App bauen.','Ich kann ein Element nicht erstellen.','Hallo!','Eine App ist ein Programm.','Ich kann dir erklären, warum diese App scheitert.','Baue jetzt!'])assert.equal(planningOffer(undefined,text),null);
 assert.equal(planningOffer(null,'Ich kann eine App bauen.'),null);
});
test('prompt requires contextual offers and separate explicit build approval',()=>{
 const prompt=chatPrompt([]);assert.match(prompt,/planningOffer/);assert.match(prompt,/separate Plan starten confirmation/);assert.doesNotMatch(prompt,/Only the app.s Plan button/);
});
