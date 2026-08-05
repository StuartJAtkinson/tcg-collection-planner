// "Pull one balanced JSON value starting at position i, return [text, newPos]".
function extractOne(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return [text.slice(start, i + 1), i + 1]; }
    }
  }
  return null;
}

const input = `prefix{"meta":{"date":"x"},"data":{"10E":{"uuid":"a","name":"A","cards":[{"uuid":"c1"},{"uuid":"c2"}]},"20A":{"uuid":"b","name":"B","cards":[{"uuid":"c3"}]}}}}`;

let emitted = 0;
let pos = 0;
let m;
while ((m = extractOne(input, pos))) {
  pos = m[1];
  try {
    const obj = JSON.parse(m[0]);
    if (obj && obj.data && obj.data.cards) {
      // emit each set inside data
      for (const code of Object.keys(obj.data)) {
        const setObj = obj.data[code];
        if (setObj.cards) emitted += setObj.cards.length;
        if (setObj.tokens) emitted += setObj.tokens.length;
      }
    }
  } catch (e) { console.log('parse fail', e.message); }
  // skip whitespace/comma between values
  while (pos < input.length && (input[pos] === ',' || input[pos] === ' ' || input[pos] === '\n' || input[pos] === '\r')) pos++;
}
console.log('emitted:', emitted, 'expected 3');
