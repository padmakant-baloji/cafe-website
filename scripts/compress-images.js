#!/usr/bin/env node
'use strict';

/**
 * Re-compress images under ./images in place (JPEG: mozjpeg; PNG: max compression).
 * Run: `yarn images:compress`
 */

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'images');
const JPEG_QUALITY = 68;

async function collectImages(dir) {
    const out = [];
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...(await collectImages(p)));
        } else if (/\.(jpe?g|png)$/i.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

async function compressOne(absPath) {
    const ext = path.extname(absPath).toLowerCase();
    const buf = await fs.readFile(absPath);
    const origSize = buf.length;
    const tmp = `${absPath}.${process.pid}.tmp`;

    let pipeline = sharp(buf).rotate();

    if (ext === '.jpg' || ext === '.jpeg') {
        pipeline = pipeline.jpeg({
            quality: JPEG_QUALITY,
            mozjpeg: true,
            progressive: true
        });
    } else if (ext === '.png') {
        pipeline = pipeline.png({ compressionLevel: 9, effort: 10 });
    } else {
        return { absPath, skipped: true, reason: 'unsupported type' };
    }

    const outBuf = await pipeline.toBuffer();
    if (outBuf.length >= origSize * 0.99) {
        return { absPath, skipped: true, reason: 'already small', origSize, newSize: outBuf.length };
    }

    await fs.writeFile(tmp, outBuf);
    await fs.rename(tmp, absPath);

    return { absPath, saved: true, origSize, newSize: outBuf.length };
}

async function main() {
    const files = await collectImages(ROOT);
    if (files.length === 0) {
        console.log('No images under', ROOT);
        return;
    }

    let totalBefore = 0;
    let totalAfter = 0;
    let nSaved = 0;

    for (const f of files) {
        const r = await compressOne(f);
        if (r.saved) {
            nSaved += 1;
            totalBefore += r.origSize;
            totalAfter += r.newSize;
            const pct = ((1 - r.newSize / r.origSize) * 100).toFixed(1);
            console.log(
                path.relative(path.join(__dirname, '..'), r.absPath),
                ` ${(r.origSize / 1024).toFixed(1)}KB → ${(r.newSize / 1024).toFixed(1)}KB (−${pct}%)`
            );
        } else if (r.skipped) {
            console.log(
                'skip',
                path.relative(path.join(__dirname, '..'), r.absPath),
                '—',
                r.reason
            );
        }
    }

    if (nSaved) {
        console.log(
            `\nCompressed ${nSaved} file(s): ~${(totalBefore / 1024).toFixed(0)}KB → ~${(totalAfter / 1024).toFixed(0)}KB total.`
        );
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
