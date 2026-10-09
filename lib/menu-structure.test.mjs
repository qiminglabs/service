import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// GroupLabel reads Base UI's group context at render time. A successful build
// cannot catch a missing provider in a closed, portaled dropdown.
function ungroupedLabels(source) {
  const file = ts.createSourceFile(
    'menu.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const missing = [];
  function visit(node, inGroup = false) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(file);
      if (tag === 'DropdownMenu' || tag === 'DropdownMenuContent')
        inGroup = false;
      if (tag === 'DropdownMenuGroup' || tag === 'DropdownMenuRadioGroup')
        inGroup = true;
      if (tag === 'DropdownMenuLabel' && !inGroup)
        missing.push(
          file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        );
    }
    ts.forEachChild(node, (child) => visit(child, inGroup));
  }
  visit(file);
  return missing;
}

test('右上角菜单的标题必须置于菜单分组内，包括条件渲染分支', () => {
  const source = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /<DropdownMenuLabel>\{localize\("切换身份"\)\}/);
  assert.doesNotMatch(source, /切换角色|onRoleChange|setCurrentRole/);
  assert.match(
    source,
    /portalSwitchIdentities\(\s*identities,\s*currentActor\.id,\s*identitySources,?\s*\)/,
  );
  assert.match(source, /operationIdentities\(users, identitySources\)/);
  assert.deepEqual(ungroupedLabels(source), []);
});

test('结构检查能识别有用户和空用户分支中的缺失分组', () => {
  assert.equal(
    ungroupedLabels(
      '<DropdownMenuContent><DropdownMenuLabel>切换用户</DropdownMenuLabel>{!users.length && <DropdownMenuLabel>暂无用户</DropdownMenuLabel>}</DropdownMenuContent>',
    ).length,
    2,
  );
  assert.deepEqual(
    ungroupedLabels(
      '<DropdownMenuContent><DropdownMenuRadioGroup><DropdownMenuLabel>切换用户</DropdownMenuLabel>{!users.length && <p>暂无用户</p>}</DropdownMenuRadioGroup></DropdownMenuContent>',
    ),
    [],
  );
});
