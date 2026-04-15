const fs = require('fs');
const content = fs.readFileSync('src/index.css', 'utf8');
let openParens = 0;
let lineNum = 1;
for (let i = 0; i < content.length; i++) {
  if (content[i] === '\n') lineNum++;
  if (content[i] === '(') openParens++;
  if (content[i] === ')') openParens--;
  if (openParens < 0) {
    console.log(`Unmatched closing parenthesis at line ${lineNum}`);
    openParens = 0;
  }
}
if (openParens > 0) {
  console.log(`Unmatched opening parenthesis: ${openParens} remaining at end of file`);
} else {
  console.log('Parentheses balanced');
}
