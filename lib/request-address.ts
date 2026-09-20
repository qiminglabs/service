export const addressParts = ['province', 'city', 'detail'] as const;
export const skipAddressChoice = '暂不选择';
export type RequestAddress = Record<(typeof addressParts)[number], string>;
export function readAddress(value: string): RequestAddress {
  try {
    const parsed = JSON.parse(value);
    const address = Object.fromEntries(
      addressParts.map((key) => [
        key,
        typeof parsed?.[key] === 'string' ? parsed[key] : '',
      ]),
    ) as RequestAddress;
    return address;
  } catch {
    return { province: '', city: '', detail: value };
  }
}
export function writeAddress(address: RequestAddress): string {
  return addressParts.some((key) => address[key].trim())
    ? JSON.stringify({ kind: 'address', ...address })
    : '';
}
export function isAddressValue(value: string): boolean {
  try {
    return JSON.parse(value)?.kind === 'address';
  } catch {
    return false;
  }
}
export function addressComplete(value: string): boolean {
  const address = readAddress(value);
  return Boolean(address.detail.trim());
}
export function addressLabel(value: string): string {
  const address = readAddress(value);
  return [
    ...new Set(
      addressParts
        .map((key) => address[key].trim())
        .filter((part) => part && part !== skipAddressChoice),
    ),
  ].join(' ');
}
