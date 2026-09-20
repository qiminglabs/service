// ZIP (stored entries, UTF-8 names). Keep original bytes and file formats.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function safeDownloadName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').trim() || '未命名文件';
}
export async function createDownloadZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  if (!files.length) throw new Error('请选择需要下载的交付物。');
  if (files.length > 65535 || files.reduce((total, file) => total + file.blob.size, 0) > 0xffff0000)
    throw new Error('文件总量过大，请分批下载。');
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  const used = new Set<string>();
  let offset = 0;
  for (const file of files) {
    const original = safeDownloadName(file.name);
    const dot = original.lastIndexOf('.');
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const extension = dot > 0 ? original.slice(dot) : '';
    let unique = original;
    for (let suffix = 2; used.has(unique.toLowerCase()); suffix++) unique = `${stem} (${suffix})${extension}`;
    used.add(unique.toLowerCase());
    const name = new TextEncoder().encode(unique);
    if (name.length > 65535) throw new Error('文件名称过长，无法打包。');
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true); // 1980-01-01
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const directory = new Uint8Array(46 + name.length);
    const record = new DataView(directory.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x800, true);
    record.setUint16(14, 33, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, bytes.length, true);
    record.setUint32(24, bytes.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    directory.set(name, 46);
    parts.push(local, file.blob);
    central.push(directory);
    offset += local.length + bytes.length;
  }
  const size = central.reduce((sum, record) => sum + record.length, 0);
  if (offset + size + 22 > 0xffffffff) throw new Error('文件总量过大，请分批下载。');
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
