import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export function inspectTranslations(code, file, knownKeys) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const issues = [];
  const report = (node, message) => issues.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  function inspectValue(node) {
    if (!node || ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
    if (ts.isTemplateExpression(node)) {
      report(node, 'Use localizeMessage with a literal template and explicit values.');
      return;
    }
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') report(node, 'Translate list items with localizeList before joining.');
      // Function calls are opaque: their arguments may be business values, not UI text.
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      [node.left, node.right].some(value => ts.isStringLiteral(value) && /[\u3400-\u9fff]/.test(value.text))) {
      report(node, 'Use a complete message instead of concatenating translated fragments.');
    }
    ts.forEachChild(node, inspectValue);
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (name === 'localize') inspectValue(node.arguments[0]);
      if (name === 'localizeList' && node.arguments[0]) {
        const inspectList = (value) => {
          if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'map') {
            const callback = value.arguments[0];
            if (callback && ts.isArrowFunction(callback)) inspectValue(callback.body);
          }
          ts.forEachChild(value, inspectList);
        };
        inspectList(node.arguments[0]);
      }
      if (name === 'localizeMessage') {
        const [key, values] = node.arguments;
        if (!key || !ts.isStringLiteral(key)) report(node, 'Message templates must be literal strings.');
        else {
          if (/[\u3400-\u9fff]/.test(key.text) && !knownKeys.has(key.text)) report(key, `Missing template translation: ${key.text}`);
          if (values && ts.isArrayLiteralExpression(values)) {
            const indexes = [...key.text.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
            if (indexes.some(index => index >= values.elements.length) || values.elements.length !== new Set(indexes).size) report(node, 'Message values do not match its placeholders.');
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return issues;
}

export function checkProject(root) {
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'lib/i18n/en.json'), 'utf8'));
  const patterns = JSON.parse(fs.readFileSync(path.join(root, 'lib/i18n/patterns.json'), 'utf8'));
  const keys = new Set([...Object.keys(messages), ...patterns.map(([key]) => key)]);
  const issues = [];
  for (const folder of ['app', 'components']) {
    for (const name of fs.readdirSync(path.join(root, folder), { recursive: true })) {
      if (!name.endsWith('.tsx')) continue;
      const file = path.join(folder, name);
      issues.push(...inspectTranslations(fs.readFileSync(path.join(root, file), 'utf8'), file, keys));
    }
  }
  return issues;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issues = checkProject(path.resolve(import.meta.dirname, '..'));
  if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
  else console.log('Translation template and list checks passed.');
}
