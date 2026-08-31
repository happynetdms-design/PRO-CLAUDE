// Mirrors document-intelligence.js's parseExtractionJson(). Run with
// plain `node`. The whole point of this function is to never throw and
// never trust the model's output blindly — every case here should either
// return a valid object or null, nothing else.

function parseExtractionJson(text){
  if(!text) return null;
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(fenceMatch) cleaned = fenceMatch[1].trim();
  try{
    const parsed = JSON.parse(cleaned);
    if(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  }catch(e){
    return null;
  }
}

console.log('=== Case 1: clean JSON ===');
const r1 = parseExtractionJson('{"vendor":"Liquid Telecom","amount_kes":65000,"confidence":"high"}');
console.log(JSON.stringify(r1));
if(!r1 || r1.vendor !== 'Liquid Telecom') { console.log('FAILED'); process.exit(1); }
console.log('PASS');
console.log('');

console.log('=== Case 2: JSON wrapped in markdown code fences (a model often does this despite being told not to) ===');
const r2 = parseExtractionJson('```json\n{"vendor":"Shell","amount_kes":4200}\n```');
console.log(JSON.stringify(r2));
if(!r2 || r2.vendor !== 'Shell') { console.log('FAILED'); process.exit(1); }
console.log('PASS — fenced JSON is still extracted correctly.');
console.log('');

console.log('=== Case 3: model adds a sentence before the JSON (should fail gracefully, not crash) ===');
const r3 = parseExtractionJson('Here is the extracted data: {"vendor":"Shell"}');
console.log(`Result: ${r3} (expect null — this is intentionally strict, not "smart" extraction of embedded JSON)`);
if(r3 !== null){ console.log('FAILED — should not have parsed this.'); process.exit(1); }
console.log('PASS — malformed-looking input correctly returns null instead of guessing.');
console.log('');

console.log('=== Case 4: completely garbled output ===');
const r4 = parseExtractionJson('I cannot read this image clearly.');
console.log(`Result: ${r4} (expect null)`);
if(r4 !== null){ console.log('FAILED'); process.exit(1); }
console.log('PASS');
console.log('');

console.log('=== Case 5: empty/missing text ===');
const r5 = parseExtractionJson('');
const r6 = parseExtractionJson(null);
console.log(`Empty string -> ${r5}, null -> ${r6} (expect null, null)`);
if(r5 !== null || r6 !== null){ console.log('FAILED'); process.exit(1); }
console.log('PASS');
console.log('');

console.log('=== Case 6: valid JSON but not an object (e.g. a bare array) ===');
const r7 = parseExtractionJson('["not", "an", "object"]');
console.log(`Result: ${JSON.stringify(r7)} (expect null — only objects are valid extractions)`);
if(r7 !== null){ console.log('FAILED'); process.exit(1); }
console.log('PASS');
console.log('');
console.log('ALL CHECKS PASS — the parser never throws and never trusts malformed output.');
