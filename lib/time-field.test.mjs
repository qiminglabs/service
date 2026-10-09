import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { translate } from './i18n/translate.ts';
import { normalizeTime } from './time-value.ts';

const source = readFileSync(
  new URL('../components/time-field.tsx', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'time-field.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'TimeField',
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
function harness(input = {}, locale = 'zh-CN') {
  const states = [],
    changed = [];
  let index = 0;
  const props = {
    value: '09:30',
    ...input,
    onChange: (value) => {
      changed.push(value);
      props.value = value;
    },
  };
  const component = runInNewContext(`${compiled}; TimeField;`, {
    normalizeTime,
    useI18n: () => ({ locale, localize: value => translate(value, locale) }),
    useId: () => 'time-id',
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState: (initial) => {
      const i = index++;
      if (!(i in states)) states[i] = initial;
      return [
        states[i],
        (next) => {
          states[i] = typeof next === 'function' ? next(states[i]) : next;
        },
      ];
    },
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    Button: 'Button',
    Input: 'Input',
    Popover: 'Popover',
    PopoverContent: 'PopoverContent',
    PopoverTrigger: 'PopoverTrigger',
    Clock3: 'Clock3',
    RadioGroup: 'RadioGroup',
    RadioGroupItem: 'RadioGroupItem',
  });
  function render() {
    index = 0;
    const nodes = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      nodes.push(node);
      node.children?.flat(Infinity).forEach(visit);
    }
    visit(component(props));
    return {
      nodes,
      find: (type) => nodes.find((node) => node.type === type),
      button: (text) =>
        nodes.find(
          (node) => node.type === 'Button' && node.children.includes(text),
        ),
    };
  }
  return { render, changed };
}

test('时间支持24小时制、简写输入和中文冒号，拒绝无效时刻', () => {
  for (const [input, output] of [
    ['9:5', '09:05'],
    ['930', '09:30'],
    ['2359', '23:59'],
    ['00:00', '00:00'],
    [' 9：30 ', '09:30'],
  ])
    assert.equal(normalizeTime(input), output);
  for (const input of [
    '',
    '9',
    '24:00',
    '12:60',
    '-1:30',
    '9:30:00',
    '2026-09-08',
    'abc',
  ])
    assert.equal(normalizeTime(input), null);
});
test('双列完整显示24小时和60分钟，选择只更新草稿，确定才提交', () => {
  const field = harness();
  field.render().find('Popover').props.onOpenChange(true);
  const groups = field
    .render()
    .nodes.filter((node) => node.type === 'RadioGroup');
  assert.equal(
    field.render().nodes.filter((node) => node.type === 'RadioGroupItem')
      .length,
    84,
  );
  groups[0].props.onValueChange('18');
  field
    .render()
    .nodes.filter((node) => node.type === 'RadioGroup')[1]
    .props.onValueChange('42');
  assert.deepEqual(field.changed, []);
  assert.equal(field.render().find('Input').props.value, '18:42');
  field.render().button('确定').props.onClick();
  assert.deepEqual(field.changed, ['18:42']);
  assert.equal(field.render().find('Popover').props.open, false);
});
test('直接输入支持回车确认，错误留在面板内，取消不改值，清空返回空字符串', () => {
  const field = harness();
  field.render().find('Popover').props.onOpenChange(true);
  field
    .render()
    .find('Input')
    .props.onChange({ target: { value: '25:30' } });
  field.render().button('确定').props.onClick();
  assert.ok(field.render().nodes.some((node) => node.props.role === 'alert'));
  assert.deepEqual(field.changed, []);
  field.render().button('取消').props.onClick();
  field.render().find('Popover').props.onOpenChange(true);
  assert.equal(field.render().find('Input').props.value, '09:30');
  field
    .render()
    .find('Input')
    .props.onChange({ target: { value: '945' } });
  field
    .render()
    .find('Input')
    .props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(field.changed, ['09:45']);
  field.render().button('清空').props.onClick();
  assert.deepEqual(field.changed, ['09:45', '']);
});
test('必填标识、只读和禁用状态受控，禁用回调不修改值', () => {
  assert.ok(harness({ required: true }).render().find('em'));
  const readonly = harness({ readonly: true });
  assert.equal(readonly.render().find('Popover'), undefined);
  assert.equal(readonly.render().find('Input').props.readOnly, true);
  const disabled = harness({ disabled: true });
  disabled.render().find('Popover').props.onOpenChange(true);
  assert.equal(disabled.render().find('Popover').props.open, false);
  disabled.render().button('确定').props.onClick();
  disabled.render().button('清空').props.onClick();
  assert.deepEqual(disabled.changed, []);
});
test('预约会议使用公共 TimeField，业务页面不再新增原生时间选择器', () => {
  const meeting = readFileSync(
    new URL('../components/request-operations.tsx', import.meta.url),
    'utf8',
  );
  assert.match(meeting, /<TimeField/);
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(
        entry.name + (entry.isDirectory() ? '/' : ''),
        directory,
      );
      if (entry.isDirectory()) {
        if (entry.name !== 'ui') check(url);
      } else if (entry.name.endsWith('.tsx'))
        assert.doesNotMatch(
          readFileSync(url, 'utf8'),
          /type\s*=\s*["'](?:time|datetime-local)["']/,
        );
    }
  }
  check(new URL('../components/', import.meta.url));
  check(new URL('../app/', import.meta.url));
});


test('英文时刻选择器保留中文模式的 HH:mm 提交值', () => {
  const field = harness({}, 'en');
  field.render().find('Popover').props.onOpenChange(true);
  field.render().button('OK').props.onClick();
  assert.deepEqual(field.changed, ['09:30']);
});
