import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'lib/activity-messages.json'), 'utf8'));
const errors = [];
const ids = new Set();
const slots = value => [...value.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort((a, b) => Number(a) - Number(b)).join(',');
for (const [key, value] of Object.entries(catalog)) {
  if (!value.id || ids.has(value.id)) errors.push(`Duplicate or missing activity ID: ${key}`);
  ids.add(value.id);
  if (!value.en || slots(key) !== slots(value.en)) errors.push(`Missing activity translation or mismatched values: ${key}`);
}
for (const name of fs.readdirSync(path.join(root, 'lib'), { recursive: true }).filter(name => name.endsWith('.ts'))) {
  const code = fs.readFileSync(path.join(root, 'lib', name), 'utf8');
  const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (callee === 'activityMessage' && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!catalog[key]) errors.push(`${name}: Unregistered activity message: ${key}`);
      }
      if (['appendActivity', 'appendProjectActivity'].includes(callee)) {
        for (const argument of node.arguments.slice(3, 5)) {
          // Dynamic prose stays raw; system-generated strings must be structured.
          if (ts.isTemplateExpression(argument)) errors.push(`${name}: Activity text must capture parameters before formatting.`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Structured activity templates passed.');
