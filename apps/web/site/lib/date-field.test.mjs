import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { format, isValid, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const source = readFileSync(
  new URL('../components/date-field.tsx', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'date-field.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'DateField',
);
const compiled = ts.transpileModule(
  declaration.getText(ast).replace(/^export /, ''),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
    },
  },
).outputText;

// Exercise the actual component callbacks without browser automation or hook rendering.
function render(props = {}) {
  const changed = [],
    opened = [];
  const deps = {
    useId: () => 'generated-date-id',
    useState: () => [true, (value) => opened.push(value)],
    format,
    isValid,
    parseISO,
    zhCN,
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    Button: 'Button',
    Calendar: 'Calendar',
    Input: 'Input',
    Popover: 'Popover',
    PopoverTrigger: 'PopoverTrigger',
    PopoverContent: 'PopoverContent',
    CalendarDays: 'CalendarDays',
  };
  const component = runInNewContext(`${compiled}; DateField;`, deps);
  const tree = component({
    value: '2027-06-30',
    onChange: (value) => changed.push(value),
    ...props,
  });
  const nodes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    node.children?.flat(Infinity).forEach(visit);
  }
  visit(tree);
  return {
    changed,
    opened,
    find: (type) => nodes.find((node) => node.type === type),
    nodes,
  };
}

test('公共日期组件显示中文日历，选择日期或清空保持日期字符串格式并关闭弹窗', () => {
  const field = render();
  const calendar = field.find('Calendar');
  assert.equal(calendar.props.locale, zhCN);
  assert.equal(format(calendar.props.selected, 'yyyy-MM-dd'), '2027-06-30');
  calendar.props.onSelect(new Date(2028, 1, 29));
  assert.deepEqual(field.changed, ['2028-02-29']);
  assert.deepEqual(field.opened, [false]);
  field.nodes
    .find((node) => node.type === 'Button' && node.children.includes('清空'))
    .props.onClick();
  assert.deepEqual(field.changed, ['2028-02-29', '']);
});

test('今天快捷选择、必填标记、空值、只读和禁用行为保留', () => {
  const field = render({ required: true });
  assert.ok(field.find('em'));
  const labelContent = field.find('label').children[0];
  assert.equal(labelContent.type, 'span');
  assert.ok(
    labelContent.children
      .flat(Infinity)
      .some((child) => child?.type === 'Fragment'),
  );
  assert.equal(field.find('label').props.htmlFor, 'generated-date-id');
  field.nodes
    .find((node) => node.type === 'Button' && node.children.includes('今天'))
    .props.onClick();
  assert.equal(field.changed[0], format(new Date(), 'yyyy-MM-dd'));
  const empty = render({ value: '' });
  assert.equal(empty.find('Calendar').props.selected, undefined);
  assert.equal(
    empty.nodes.find(
      (node) => node.type === 'Button' && node.children.includes('清空'),
    ).props.disabled,
    true,
  );
  const readonly = render({ readonly: true });
  assert.equal(readonly.find('Calendar'), undefined);
  assert.equal(readonly.find('Input').props.readOnly, true);
  const disabled = render({ disabled: true });
  assert.equal(disabled.find('Popover').props.open, false);
  disabled.find('Calendar').props.onSelect(new Date());
  assert.deepEqual(disabled.changed, []);
});

test('服务认证、服务申请和工时共用 DateField，业务页面不再使用原生日期框', () => {
  for (const path of [
    '../app/page.tsx',
    '../components/service-requests.tsx',
    '../components/request-operations.tsx',
  ]) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(
      text,
      /import \{ DateField \} from '@\/components\/date-field'/,
    );
    assert.match(text, /<DateField/);
  }
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(
        entry.name + (entry.isDirectory() ? '/' : ''),
        directory,
      );
      if (entry.isDirectory()) {
        if (entry.name !== 'ui') check(url);
      } else if (entry.name.endsWith('.tsx')) {
        assert.doesNotMatch(
          readFileSync(url, 'utf8'),
          /type\s*=\s*["'](?:date|datetime-local)["']/,
          `${entry.name} should use DateField`,
        );
      }
    }
  }
  check(new URL('../app/', import.meta.url));
  check(new URL('../components/', import.meta.url));
});
