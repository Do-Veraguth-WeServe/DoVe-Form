import assert from 'node:assert/strict';
import {test} from 'node:test';
import {elementTimeline} from '../src/element-timeline.js';
test('one element follows newest build anchor; prose/forms and identity stay unchanged',()=>{
 const element={id:'old',render:{state:{count:4}},prose:'original',forms:{items:[]}};
 const messages=[element,...Array.from({length:16},(_,i)=>({id:'text'+i,prose:'text'})),{id:'anchor'}];
 const before=JSON.stringify(messages),job={kind:'refine',state:'building',targetMessageId:'old',messageId:'anchor'};
 const rows=elementTimeline(messages,[job]);assert.equal(rows[0].element,null);assert.equal(rows[0].message,element);assert.equal(rows.at(-1).element,element);assert.equal(rows.slice(-12).filter(r=>r.element).length,1);assert.equal(JSON.stringify(messages),before);
 for(const state of ['failed','cancelled'])assert.equal(elementTimeline(messages,[{...job,state}])[0].element,element);
 element.renderPositionId='anchor';assert.equal(elementTimeline(messages).at(-1).element,element);
 messages.push({id:'next'});assert.equal(elementTimeline(messages,[{...job,messageId:'next'}]).at(-1).element,element);
 assert.equal(elementTimeline(messages,[{...job,messageId:'foreign'}])[17].element,element);
});
