'use strict';

const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

let poolPromise;
let cleanupRegistered = false;
let ephemeralBranchId = null;

/**
 * Pooler URLs and `channel_binding=require` break the HTTP-based `neon()` driver.
 * WebSocket `Pool` works with pooled endpoints; strip channel binding for Node/pg compatibility.
 */
function normalizeDatabaseUrl(url) {
    const q = url.indexOf('?');
    if (q === -1) return url;
    const base = url.slice(0, q);
    const params = new URLSearchParams(url.slice(q + 1));
    params.delete('channel_binding');
    const s = params.toString();
    return s ? `${base}?${s}` : base;
}

function boolFromEnv(name, fallback) {
    const v = process.env[name];
    if (typeof v !== 'string' || !v.trim()) return fallback;
    const t = v.trim().toLowerCase();
    return !(t === '0' || t === 'false' || t === 'no' || t === 'off');
}

function readUriFromResponse(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    if (typeof data.uri === 'string' && data.uri) return data.uri;
    if (typeof data.connection_uri === 'string' && data.connection_uri) return data.connection_uri;
    return '';
}

async function neonApiRequest(pathname, options = {}) {
    const key = process.env.NEON_API_KEY;
    if (!key) throw new Error('NEON_API_KEY is missing.');
    const url = `https://console.neon.tech/api/v2${pathname}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${key.trim()}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data.message || data.error || `Neon API error (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

async function detectBranchId(projectId) {
    if (process.env.BRANCH_ID && process.env.BRANCH_ID.trim()) {
        return process.env.BRANCH_ID.trim();
    }

    if (process.env.PARENT_BRANCH_ID && process.env.PARENT_BRANCH_ID.trim()) {
        const parentId = process.env.PARENT_BRANCH_ID.trim();
        const payload = {
            branch: {
                parent_id: parentId,
                name: `local-${Date.now()}`
            }
        };
        const created = await neonApiRequest(`/projects/${projectId}/branches`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const branchId =
            created &&
            created.branch &&
            typeof created.branch.id === 'string' &&
            created.branch.id
                ? created.branch.id
                : '';
        if (!branchId) throw new Error('Neon API did not return created branch id.');
        ephemeralBranchId = branchId;
        return branchId;
    }

    const projectData = await neonApiRequest(`/projects/${projectId}`);
    const defaultBranchId =
        projectData &&
        projectData.project &&
        typeof projectData.project.default_branch_id === 'string'
            ? projectData.project.default_branch_id
            : '';
    if (defaultBranchId) return defaultBranchId;

    // Fallback for projects where default_branch_id is not returned.
    const branchesData = await neonApiRequest(`/projects/${projectId}/branches`);
    const branches =
        branchesData && branchesData.branches && Array.isArray(branchesData.branches)
            ? branchesData.branches
            : [];
    if (!branches.length) {
        throw new Error('Could not determine Neon branch id. Set BRANCH_ID in .env.');
    }
    const primary = branches.find((b) => b && b.primary && typeof b.id === 'string');
    if (primary) return primary.id;
    const first = branches.find((b) => b && typeof b.id === 'string');
    if (first) return first.id;
    throw new Error('Could not determine Neon branch id. Set BRANCH_ID in .env.');
}

function registerCleanup(projectId) {
    if (cleanupRegistered) return;
    cleanupRegistered = true;
    const shouldDelete = boolFromEnv('DELETE_BRANCH', true);
    if (!shouldDelete) return;

    const cleanup = async () => {
        if (!ephemeralBranchId) return;
        try {
            await neonApiRequest(`/projects/${projectId}/branches/${ephemeralBranchId}`, {
                method: 'DELETE'
            });
            console.log(`Deleted ephemeral Neon branch: ${ephemeralBranchId}`);
        } catch (err) {
            console.warn(`Could not delete Neon branch ${ephemeralBranchId}:`, err.message);
        }
    };

    process.once('SIGINT', async () => {
        await cleanup();
        process.exit(130);
    });
    process.once('SIGTERM', async () => {
        await cleanup();
        process.exit(143);
    });
    process.once('exit', () => {
        void cleanup();
    });
}

async function resolveDatabaseUrl() {
    const projectId = process.env.NEON_PROJECT_ID && process.env.NEON_PROJECT_ID.trim();
    const apiKey = process.env.NEON_API_KEY && process.env.NEON_API_KEY.trim();

    // Prefer Neon API-driven local development when key + project are present.
    if (projectId && apiKey) {
        const branchId = await detectBranchId(projectId);
        registerCleanup(projectId);

        const databaseName = (process.env.NEON_DATABASE || 'neondb').trim();
        const roleName = (process.env.NEON_ROLE || 'neondb_owner').trim();
        const params = new URLSearchParams({
            database_name: databaseName,
            role_name: roleName,
            branch_id: branchId
        });

        const conn = await neonApiRequest(`/projects/${projectId}/connection_uri?${params.toString()}`);
        const uri = readUriFromResponse(conn);
        if (!uri) {
            throw new Error(
                'Neon API did not return connection URI. Check NEON_PROJECT_ID/BRANCH_ID and role access.'
            );
        }
        return normalizeDatabaseUrl(uri);
    }

    const raw = process.env.DATABASE_URL;
    if (raw && raw.trim()) return normalizeDatabaseUrl(raw.trim());

    throw new Error(
        'DATABASE_URL is not set. For local Neon automation, set NEON_API_KEY and NEON_PROJECT_ID.'
    );
}

async function getPool() {
    if (!poolPromise) {
        poolPromise = (async () => {
            const connectionString = await resolveDatabaseUrl();
            const pool = new Pool({ connectionString });
            pool.on('error', (err) => {
                console.error('Neon pool error:', err);
            });
            return pool;
        })();
    }
    return poolPromise;
}

/**
 * Run a parameterized query (node-postgres style). Prefer this over the HTTP `neon()` helper for
 * Express and other long-lived Node processes — it uses WebSockets and supports pooler hostnames.
 *
 * @param {string} text
 * @param {unknown[]=} params
 */
async function query(text, params) {
    const pool = await getPool();
    return pool.query(text, params);
}

module.exports = { getPool, query };
