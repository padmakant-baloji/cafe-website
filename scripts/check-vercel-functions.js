'use strict';

/**
 * Fail the deploy if api/ contains more than one Serverless Function entry.
 * Vercel Hobby allows max 12 functions; this project uses ONE (api/index.js).
 */
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..', 'api');
const ALLOWED = new Set(['index.js']);

function listApiJsFiles(dir, base = dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
            out.push(...listApiJsFiles(full, base));
        } else if (name.endsWith('.js')) {
            out.push(path.relative(base, full).split(path.sep).join('/'));
        }
    }
    return out;
}

const files = listApiJsFiles(API_DIR);
const unexpected = files.filter((file) => !ALLOWED.has(file));

if (!files.includes('index.js')) {
    console.error('Missing api/index.js — required as the single Vercel API entry.');
    process.exit(1);
}

if (unexpected.length > 0) {
    console.error(
        [
            'Vercel Hobby allows 12 Serverless Functions per deployment.',
            'This project must use ONE router: api/index.js (+ lib/vercel-api-router.js).',
            '',
            'Remove these extra api/*.js files (each file becomes its own function):',
            ...unexpected.map((file) => `  - api/${file}`),
            '',
            'Add new routes in lib/vercel-api-router.js instead.'
        ].join('\n')
    );
    process.exit(1);
}

console.log('Vercel API check OK: 1 Serverless Function (api/index.js).');
