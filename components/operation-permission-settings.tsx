'use client';
import { useI18n } from '@/lib/i18n/context';


import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { OperationActor } from '@/lib/request-operations';
import {
  filterOperationPermissions,
  operationPermissionRows,
  permissionRoleForActor,
  permissionRoles,
  type PermissionResult,
} from '@/lib/operation-permissions';

const pageSize = 40;
const results: PermissionResult[] = [
  '允许',
  '有条件允许',
  '禁止',
  '不适用',
  '无页面入口',
];
const resultTone = (result: PermissionResult) =>
  result === '允许'
    ? 'allowed'
    : result === '有条件允许'
      ? 'conditional'
      : result === '禁止'
        ? 'denied'
        : 'neutral';

export function OperationPermissionSettings({
  identities,
  initialActorId,
}: {
  identities: OperationActor[];
  initialActorId: string;
}) {
  const { localize, localizeMessage } = useI18n();
  const [userId, setUserId] = useState(initialActorId);
  const [site, setSite] = useState('');
  const [object, setObject] = useState('');
  const [stage, setStage] = useState('');
  const [result, setResult] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const users = identities.filter((actor) => permissionRoleForActor(actor));
  const selectedUser = users.find((actor) => actor.id === userId);
  const role = selectedUser ? permissionRoleForActor(selectedUser) : undefined;
  const stages = [
    ...new Set(
      operationPermissionRows
        .filter(
          (row) =>
            (!object || row.object === object) &&
            (!site || row.site === site || row.site === '通用'),
        )
        .flatMap((row) => row.stages),
    ),
  ].filter((value) => value !== '任意');
  const rows = useMemo(
    () =>
      filterOperationPermissions({ site, role, object, stage, result, query }),
    [site, role, object, stage, result, query],
  );
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const counts = {
    allowed: rows.filter((row) => row.result === '允许').length,
    conditional: rows.filter((row) => row.result === '有条件允许').length,
  };
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <section
      className="reference-panel permission-settings"
      aria-label={localize("操作权限清单")}
    >
      <div className="permission-heading">
        <div className="permission-heading-title">
          <ShieldCheck size={22} />
          <h2>{localize("操作权限清单")}</h2>
          <span className="permission-readonly">{localize("只读")}</span>
        </div>
        <span className="permission-selected-user">
          {localize(selectedUser
            ? localizeMessage("{0} · {1}", [String(localize(selectedUser.name)), String(localize(permissionRoles[role!]))])
            : '全部角色')}
        </span>
      </div>
      <div className="permission-filters">
        <label htmlFor="permission-site">
          {localize("发起站点")}<NativeSelect
            id="permission-site"
            value={site}
            onChange={(event) => {
              change(setSite, event.target.value);
              setStage('');
            }}
          >
            <option value="">{localize("全部发起站点")}</option>
            {localize(['内部系统', '客户中心', '合作伙伴中心'].map((value) => (
              <option key={value} value={value}>
                {localize(value)}
              </option>
            )))}
          </NativeSelect>
        </label>
        <label htmlFor="permission-user">
          {localize("查看用户")}<NativeSelect
            id="permission-user"
            value={selectedUser?.id ?? ''}
            onChange={(event) => change(setUserId, event.target.value)}
          >
            <option value="">{localize("全部角色")}</option>
            {localize(Object.entries(permissionRoles).map(([key, label]) => (
              <optgroup key={key} label={localize(label)}>
                {localize(users
                  .filter((actor) => permissionRoleForActor(actor) === key)
                  .map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {localize(actor.name)} · {localize(actor.id)}
                    </option>
                  )))}
              </optgroup>
            )))}
          </NativeSelect>
        </label>
        <label htmlFor="permission-object">
          {localize("业务对象")}<NativeSelect
            id="permission-object"
            value={object}
            onChange={(event) => {
              change(setObject, event.target.value);
              setStage('');
            }}
          >
            <option value="">{localize("全部业务对象")}</option>
            {localize(['服务申请', '服务项目', '目录与系统'].map((value) => (
              <option key={value} value={value}>
                {localize(value)}
              </option>
            )))}
          </NativeSelect>
        </label>
        <label htmlFor="permission-stage">
          {localize("业务阶段")}<NativeSelect
            id="permission-stage"
            value={stage}
            onChange={(event) => change(setStage, event.target.value)}
          >
            <option value="">{localize("全部阶段")}</option>
            {localize(stages.map((value) => (
              <option key={value} value={value}>
                {localize(value)}
              </option>
            )))}
          </NativeSelect>
        </label>
        <label htmlFor="permission-result">
          {localize("权限结果")}<NativeSelect
            id="permission-result"
            value={result}
            onChange={(event) => change(setResult, event.target.value)}
          >
            <option value="">{localize("全部权限")}</option>
            {localize(results.map((value) => (
              <option key={value} value={value}>
                {localize(value)}
              </option>
            )))}
          </NativeSelect>
        </label>
        <label htmlFor="permission-query">
          {localize("搜索操作或条件")}<div className="permission-search">
            <Search size={16} />
            <Input
              id="permission-query"
              value={query}
              placeholder={localize("搜索工时、客户确认、负责范围…")}
              onChange={(event) => change(setQuery, event.target.value)}
            />
          </div>
        </label>
      </div>
      <div className="permission-summary" aria-live="polite">
        <span>
          {localize("共")}<strong>{localize(rows.length)}</strong> {localize(" 条")}</span>
        <span>
          {localize("允许")}<strong>{localize(counts.allowed)}</strong>
        </span>
        <span>
          {localize("有条件允许")}<strong>{localize(counts.conditional)}</strong>
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            setSite('');
            setUserId(initialActorId);
            setObject('');
            setStage('');
            setResult('');
            setQuery('');
            setPage(1);
          }}
        >
          {localize("重置筛选")}</Button>
      </div>
      <div className="table-scroll permission-table-scroll">
        <table className="reference-table app-list-table permission-table">
          <caption className="sr-only">
            {localize("按发起站点、用户、业务对象和阶段查询的只读操作权限；有条件允许需同时满足人员范围和前置条件。")}</caption>
          <thead>
            <tr>
              {localize([
                '发起站点',
                '用户 / 角色',
                '业务对象',
                '业务阶段',
                '操作',
                '权限结果',
                '人员及数据范围',
                '前置条件与限制',
                '操作所在站点',
              ].map((label) => (
                <th key={label} scope="col">
                  {localize(label)}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {localize(visible.length ? (
              visible.map((row) => (
                <tr key={row.id}>
                  <td>{localize(row.site === '通用' ? '不限定站点' : row.site)}</td>
                  <td>
                    {localize(selectedUser && <strong>{localize(selectedUser.name)}</strong>)}
                    <span>{localize(permissionRoles[row.role])}</span>
                  </td>
                  <td>{localize(row.object)}</td>
                  <td>
                    <div className="permission-stages">
                      {localize((stage && row.stages.includes(stage)
                        ? [stage]
                        : row.stages
                      ).map((value) => (
                        <span key={value}>{localize(value)}</span>
                      )))}
                    </div>
                  </td>
                  <td>
                    <strong>{localize(row.action)}</strong>
                  </td>
                  <td>
                    <span
                      className="permission-result"
                      data-tone={resultTone(row.result)}
                    >
                      {localize(row.result)}
                    </span>
                  </td>
                  <td>{localize(row.scope)}</td>
                  <td>{localize(row.condition)}</td>
                  <td>{localize(row.portal)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="permission-empty">
                  {localize("没有符合当前筛选条件的权限条目")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="permission-pagination">
        <span>
          {localize("第")}{localize(rows.length ? (currentPage - 1) * pageSize + 1 : 0)}–
          {localize(Math.min(currentPage * pageSize, rows.length))} {localize(" 条，共")}{localize(rows.length)}{localize(' ')}
          {localize("条")}</span>
        <div>
          <Button
            variant="outline"
            size="sm"
            aria-label={localize("上一页权限")}
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={15} />
            {localize("上一页")}</Button>
          <span>
            {localize(currentPage)} / {localize(pages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label={localize("下一页权限")}
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            {localize("下一页")}<ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </section>
  );
}
