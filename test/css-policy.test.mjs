import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCSS,safeCSS,CSS_BLOCKED_PROPERTIES,CSS_FUNCTIONS,cssCapabilityPrompt} from '../css-policy.mjs';
import {systemPrompt} from '../contract.mjs';
const flame='.flame::before{content:"";position:absolute;transform:rotate(45deg);background:linear-gradient(red,orange);width:12px}';
test('pseudo-element failure explains removed features without inventing data causes',()=>{
 const r=inspectCSS(flame);assert.equal(r.css,'.flame::before{width:12px}');assert.equal(r.removedCount,4);assert.deepEqual(r.diagnostics.map(x=>x.property),['content','position','transform','background']);assert.ok(r.diagnostics.every(x=>Number.isInteger(x.offset)));
});
test('prompt and sanitizer consume one immutable capability policy',()=>{assert.ok(systemPrompt.includes(cssCapabilityPrompt));for(const p of CSS_BLOCKED_PROPERTIES){assert.ok(cssCapabilityPrompt.includes(p));assert.equal(inspectCSS('.a{'+p+':initial}').removedCount,1);}for(const f of CSS_FUNCTIONS)assert.ok(cssCapabilityPrompt.includes(f));assert.ok(Object.isFrozen(CSS_FUNCTIONS));});
test('unsafe syntax remains blocked and reports stay bounded without source values',()=>{
 const r=inspectCSS('@import url(https://invalid.example);.a{background:url(https://invalid.example);--secret:private; color:var(--secret);filter:blur(2px)}');assert.ok(!r.css.includes('https'));assert.ok(!JSON.stringify(r.diagnostics).includes('private'));assert.equal(r.removedCount,5);
 const b=inspectCSS('.a{'+Array.from({length:100},()=> 'position:absolute;').join('')+'}');assert.equal(b.diagnostics.length,64);assert.equal(b.removedCount,100);assert.equal(b.truncated,true);assert.equal(inspectCSS(null).css,'');
});
test('ordinary responsive layout and colors survive unchanged',()=>{const s='.a{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;color:rgb(1,2,3);width:clamp(10px,50%,100px)}';assert.equal(safeCSS(s),s);});
