import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
const messages = JSON.parse(fs.readFileSync(path.join(root, 'lib/i18n/en.json'), 'utf8'));
const patterns = JSON.parse(fs.readFileSync(path.join(root, 'lib/i18n/patterns.json'), 'utf8'));
const activityMessages = JSON.parse(fs.readFileSync(path.join(root, 'lib/activity-messages.json'), 'utf8'));
const categories = {};
function classify(text) {
  if (/^(草稿|已|待|未|全部|远程|现场|启用|停用|进行中|执行中|有效|无效|必填|选填|是$|否$)/.test(text) && text.length < 14) return 'statuses';
  if (/^(请|无法|不能|暂无|没有|尚未|正在|保存失败|读取失败|操作失败|确认.*？)|[。？；]|失败|未保存|成功/.test(text)) return 'messages';
  if (/^(保存|新建|创建|取消|确认|关闭|返回|添加|移除|删除|下载|上传|上载|编辑|查看|选择|切换|清空|清除|展开|收起|提交|发起|指派|改派|恢复|暂停|复制|发布|搜索|下一|上一|去确认|重试)/.test(text) && text.length < 24) return 'buttons';
  if (/主页|工作台|服务请求$|服务项目$|服务目录$|后台配置|引用数据$|导航|基本信息|系统信息|项目进展|最近动态|待办与跟进/.test(text)) return 'navigation';
  if (text.length < 20 && !/[。？！；：]/.test(text)) return 'fields';
  return 'content';
}
for (const key of [...Object.keys(messages), ...patterns.map(([source]) => source)]) if (!activityMessages[key] || activityMessages[key].uiLabel) categories[key] = classify(key);
function scan(folder) {
  for (const file of fs.readdirSync(folder, { withFileTypes: true })) {
    const target = path.join(folder, file.name);
    if (file.isDirectory()) scan(target);
    else if (file.name.endsWith('.tsx') && !file.name.includes('translation-workbench')) {
      const source = ts.createSourceFile(target, fs.readFileSync(target, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'localize' && ts.isStringLiteral(node.arguments[0])) {
          const text = node.arguments[0].text;
          if (Object.hasOwn(categories, text)) {
            let parent = node.parent;
            while (parent && !ts.isJsxElement(parent) && !ts.isJsxAttribute(parent)) parent = parent.parent;
            if (parent && ts.isJsxAttribute(parent)) {
              if (parent.name.getText(source) === 'placeholder') categories[text] = 'messages';
              else if (parent.name.getText(source) === 'label') categories[text] = 'fields';
            } else if (parent && ts.isJsxElement(parent)) {
              const tag = parent.openingElement.tagName.getText(source);
              if (/Button|button|DialogClose|DropdownMenuItem/.test(tag)) categories[text] = 'buttons';
              else if (/^(h[1-6]|DialogTitle|TabsTrigger)$/.test(tag)) categories[text] = 'navigation';
              else if (['label', 'th', 'dt'].includes(tag)) categories[text] = 'fields';
              else if (tag === 'option') categories[text] = 'statuses';
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
scan(path.join(root, 'components')); scan(path.join(root, 'app'));
fs.writeFileSync(path.join(root, 'lib/i18n/categories.json'), JSON.stringify(categories, null, 2) + '\n');
console.log(`Indexed ${Object.keys(categories).length} translation labels.`);
