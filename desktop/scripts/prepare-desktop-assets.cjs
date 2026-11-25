'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../..');
const desktop = path.resolve(__dirname, '..');
const input = path.join(root, 'static', 'images', 'apple-touch-icon.png');
const output = path.join(desktop, 'assets');

const makeIcnsChunk = (type, payload) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(payload.length + 8, 4);
    return Buffer.concat([header, payload]);
};

const makeIco = entries => {
    const header = Buffer.alloc(6 + entries.length * 16);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    let dataOffset = header.length;
    const images = [];
    entries.forEach(({size, data}, index) => {
        const offset = 6 + index * 16;
        header.writeUInt8(size === 256 ? 0 : size, offset);
        header.writeUInt8(size === 256 ? 0 : size, offset + 1);
        header.writeUInt8(0, offset + 2);
        header.writeUInt8(0, offset + 3);
        header.writeUInt16LE(1, offset + 4);
        header.writeUInt16LE(32, offset + 6);
        header.writeUInt32LE(data.length, offset + 8);
        header.writeUInt32LE(dataOffset, offset + 12);
        dataOffset += data.length;
        images.push(data);
    });
    return Buffer.concat([header, ...images]);
};

const run = async () => {
    await fs.mkdir(output, {recursive: true});
    const source = await fs.readFile(input);
    const pngBySize = new Map();
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
        pngBySize.set(size, await sharp(source).resize(size, size, {fit: 'contain', background: {r: 255, g: 255, b: 255, alpha: 0}}).png().toBuffer());
    }
    await fs.writeFile(path.join(output, 'brickwright.png'), pngBySize.get(256));
    const ico = makeIco([16, 24, 32, 48, 64, 128, 256].map(size => ({size, data: pngBySize.get(size)})));
    await fs.writeFile(path.join(output, 'brickwright.ico'), ico);
    const icnsTypes = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]);
    const chunks = [...icnsTypes].map(([size, type]) => makeIcnsChunk(type, pngBySize.get(size)));
    const icnsBody = Buffer.concat(chunks);
    const icnsHeader = Buffer.alloc(8);
    icnsHeader.write('icns', 0, 4, 'ascii');
    icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);
    await fs.writeFile(path.join(output, 'brickwright.icns'), Buffer.concat([icnsHeader, icnsBody]));
    console.log('Generated Windows ICO and macOS ICNS from the existing Brickwright robot icon.');
};

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
