#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const archive = process.argv[2];
const dest = process.argv[3];
const fd = fs.openSync(archive, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerStringSize = head.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerStringSize);
fs.readSync(fd, headerBuf, 0, headerStringSize, 16);
const header = JSON.parse(headerBuf.toString('utf8'));
const dataOffset = 8 + head.readUInt32LE(4); // skip the whole header pickle
let count = 0;
function walk(node, prefix) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) { walk(entry, p); continue; }
    const outPath = path.join(dest, p);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (entry.unpacked) { fs.writeFileSync(outPath, ''); continue; }
    const buf = Buffer.alloc(entry.size);
    if (entry.size > 0) fs.readSync(fd, buf, 0, entry.size, dataOffset + Number(entry.offset));
    fs.writeFileSync(outPath, buf);
    count++;
  }
}
walk(header, '');
console.log('extracted', count);
