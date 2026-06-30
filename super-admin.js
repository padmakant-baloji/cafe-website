'use strict';

const COMMISSION_RATE = 0.014;
let currentPeriod = 'today';
let summaryData = null;
let venueListData = [];
let editingVenueId = null;
let autoRefreshTimer = null;

/* ─── Helpers ────────────────────────────────────────── */

function formatMoney(paise) {
    const n = Number(paise) || 0;
    if (n >= 100) return '₹' + (n / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (n > 0) return '₹' + (n / 100).toFixed(2);
    return '₹0';
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function adminHeaders(extra = {}) {
    return window.quickkartAdminAuth.adminAuthHeaders(extra);
}

function clearCredentials() {
    window.quickkartAdminAuth.clearAdminToken();
}

/* ─── Auth ───────────────────────────────────────────── */

async function initSuperAdmin() {
    const authGate = document.getElementById('authGate');
    const dashboard = document.getElementById('dashboardWrap');

    try {
        const session = await window.quickkartAdminAuth.fetchAdminSession();
        if (!session || !session.venue) {
            clearCredentials();
            window.location.href = '/admin-login';
            return;
        }

        // Only main venue can access super admin
        if (!session.venue.isMain) {
            if (session.venue.venueType === 'grocery') {
                window.location.href = '/grocery-admin';
            } else {
                window.location.href = '/admin';
            }
            return;
        }

        authGate.hidden = true;
        dashboard.hidden = false;

        bindEvents();
        await refreshDashboard();
        startAutoRefresh();

    } catch (err) {
        console.error('Super admin init failed:', err);
        clearCredentials();
        window.location.href = '/admin-login?error=' + encodeURIComponent('Session expired. Please sign in again.');
    }
}

/* ─── Events ─────────────────────────────────────────── */

function bindEvents() {
    // Period selector
    document.querySelectorAll('.sa-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sa-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;
            refreshDashboard();
        });
    });

    // Refresh
    document.getElementById('saRefreshBtn').addEventListener('click', () => refreshDashboard());

    // Logout
    document.getElementById('saLogoutBtn').addEventListener('click', () => {
        clearCredentials();
        window.location.href = '/admin-login';
    });

    // Add venue toggle
    document.getElementById('saAddVenueBtn').addEventListener('click', () => {
        const form = document.getElementById('saAddForm');
        form.hidden = !form.hidden;
        if (!form.hidden) {
            document.getElementById('saNewVenueName').focus();
        }
    });

    document.getElementById('saCancelAddBtn').addEventListener('click', () => {
        document.getElementById('saAddForm').hidden = true;
        clearAddForm();
    });

    // Create venue
    document.getElementById('saCreateVenueBtn').addEventListener('click', createVenue);

    // Edit modal close
    document.getElementById('saEditModalClose').addEventListener('click', closeEditModal);
    document.getElementById('saEditCancelBtn').addEventListener('click', closeEditModal);
    document.getElementById('saEditSaveBtn').addEventListener('click', saveVenueEdit);

    // Close modal on overlay click
    document.getElementById('saEditModal').addEventListener('click', (e) => {
        if (e.target.id === 'saEditModal') closeEditModal();
    });

    // Auto-generate slug from name
    document.getElementById('saNewVenueName').addEventListener('input', (e) => {
        const slug = e.target.value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        document.getElementById('saNewVenueSlug').value = slug;
    });
}

/* ─── Data Fetching ──────────────────────────────────── */

async function refreshDashboard() {
    try {
        const [summaryRes, venuesRes] = await Promise.all([
            fetch(`/api/admin/all-orders-summary?period=${currentPeriod}`, {
                headers: adminHeaders(),
                cache: 'no-store'
            }),
            fetch('/api/admin/venues', {
                headers: adminHeaders(),
                cache: 'no-store'
            })
        ]);

        if (summaryRes.status === 401 || venuesRes.status === 401) {
            clearCredentials();
            window.location.href = '/admin-login';
            return;
        }

        const summary = await summaryRes.json();
        const venues = await venuesRes.json();

        if (summary.ok) {
            summaryData = summary;
            renderKpis(summary);
            renderCommissionTable(summary);
        }

        if (venues.ok && Array.isArray(venues.venues)) {
            venueListData = venues.venues;
            renderVenueGrid(venues.venues, summary);
        }

        // Update timestamp
        const updatedEl = document.getElementById('saUpdatedAt');
        if (updatedEl) {
            updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }

    } catch (err) {
        console.error('Dashboard refresh failed:', err);
    }
}

function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(refreshDashboard, 30000);
}

/* ─── Render KPIs ────────────────────────────────────── */

function renderKpis(data) {
    document.getElementById('kpiRevenue').textContent = formatMoney(data.totalRevenue);
    document.getElementById('kpiRevenueHint').textContent = `${data.totalCompletedOrders} completed orders`;

    document.getElementById('kpiCommission').textContent = formatMoney(data.totalCommission);
    document.getElementById('kpiCommissionHint').textContent = `1.4% of ${formatMoney(data.totalRevenue)}`;

    document.getElementById('kpiHotels').textContent = String(data.foodVenueCount);
    document.getElementById('kpiMarts').textContent = String(data.groceryVenueCount);

    document.getElementById('kpiOrders').textContent = String(data.totalAllOrders);
    document.getElementById('kpiOrdersHint').textContent =
        `${data.totalCompletedOrders} completed · ${data.totalPendingOrders} pending · ${data.totalActiveOrders} active`;
}

/* ─── Render Commission Table ────────────────────────── */

function renderCommissionTable(data) {
    const wrap = document.getElementById('saCommissionTable');
    if (!data.venues || data.venues.length === 0) {
        wrap.innerHTML = `
            <div class="sa-empty">
                <div class="sa-empty-icon">📊</div>
                <div class="sa-empty-text">No venue data available</div>
            </div>`;
        return;
    }

    // Filter to only show venues with some activity
    const activeVenues = data.venues.filter(v => v.totalOrders > 0 || v.completedRevenue > 0);

    let tableHtml = `
        <table class="sa-table">
            <thead>
                <tr>
                    <th>Venue</th>
                    <th>Type</th>
                    <th>Orders</th>
                    <th>Revenue</th>
                    <th>Your Commission</th>
                </tr>
            </thead>
            <tbody>`;

    if (activeVenues.length === 0) {
        tableHtml += `
            <tr>
                <td colspan="5" style="text-align:center; color:var(--text-muted); padding:1.5rem;">
                    No orders in this period
                </td>
            </tr>`;
    } else {
        for (const v of activeVenues) {
            const typeBadge = v.venueType === 'grocery'
                ? '<span class="sa-badge sa-badge--grocery">🛒 Mart</span>'
                : '<span class="sa-badge sa-badge--food">🏨 Hotel</span>';

            const mainBadge = v.isMain
                ? ' <span class="sa-badge sa-badge--main">Main</span>'
                : '';

            tableHtml += `
                <tr>
                    <td>
                        <div class="sa-venue-name">${escapeHtml(v.venueName)}${mainBadge}</div>
                        <div class="sa-venue-city">${escapeHtml(v.venueCity)}</div>
                    </td>
                    <td>${typeBadge}</td>
                    <td>${v.completedOrders} / ${v.totalOrders}</td>
                    <td class="sa-revenue-val">${formatMoney(v.completedRevenue)}</td>
                    <td class="sa-commission-val">${formatMoney(v.commission)}</td>
                </tr>`;
        }

        // Totals row
        tableHtml += `
            <tr style="background:rgba(16,185,129,0.04); font-weight:700;">
                <td colspan="3" style="text-align:right; color:var(--text-secondary);">Total</td>
                <td class="sa-revenue-val">${formatMoney(data.totalRevenue)}</td>
                <td class="sa-commission-val" style="font-size:0.9375rem;">${formatMoney(data.totalCommission)}</td>
            </tr>`;
    }

    tableHtml += '</tbody></table>';
    wrap.innerHTML = tableHtml;
}

/* ─── Render Venue Grid ──────────────────────────────── */

function renderVenueGrid(venues, summary) {
    const grid = document.getElementById('saVenueGrid');
    if (!venues || venues.length === 0) {
        grid.innerHTML = `
            <div class="sa-empty">
                <div class="sa-empty-icon">🏢</div>
                <div class="sa-empty-text">No venues found. Create your first venue above.</div>
            </div>`;
        return;
    }

    // Merge summary data with venue list
    const summaryByVenue = {};
    if (summary && summary.venues) {
        for (const sv of summary.venues) {
            summaryByVenue[sv.venueId] = sv;
        }
    }

    let html = '';
    for (const v of venues) {
        const sv = summaryByVenue[v.id] || {};
        const revenue = sv.completedRevenue || 0;
        const commission = sv.commission || 0;
        const orders = sv.totalOrders || 0;
        const active = sv.activeOrders || 0;

        const typeBadge = v.venueType === 'grocery'
            ? '<span class="sa-badge sa-badge--grocery">🛒 Mart</span>'
            : '<span class="sa-badge sa-badge--food">🏨 Hotel</span>';

        const mainBadge = v.isMain
            ? '<span class="sa-badge sa-badge--main">Main</span>'
            : '';

        const editBtn = v.isMain
            ? ''
            : `<button class="sa-btn" onclick="openEditModal(${v.id})">✏️ Edit</button>
               <button class="sa-btn" style="color: #ef4444; border-color: #fecaca; background: #fef2f2;" onclick="deleteVenue(${v.id}, '${escapeHtml(v.name)}')">🗑️ Delete</button>`;

        html += `
            <div class="sa-venue-card">
                <div class="sa-venue-card-head">
                    <div>
                        <div class="sa-venue-card-title">${escapeHtml(v.name)}</div>
                        <div class="sa-venue-card-subtitle">${escapeHtml(v.city || '')} ${v.adminUser ? '· Login: ' + escapeHtml(v.adminUser) : ''}</div>
                    </div>
                    <div style="display:flex; gap:0.3rem; flex-shrink:0;">
                        ${typeBadge}${mainBadge}
                    </div>
                </div>
                <div class="sa-venue-card-stats">
                    <div class="sa-venue-stat">
                        <div class="sa-venue-stat-label">Revenue</div>
                        <div class="sa-venue-stat-value" style="color:var(--accent-amber);">${formatMoney(revenue)}</div>
                    </div>
                    <div class="sa-venue-stat">
                        <div class="sa-venue-stat-label">Commission</div>
                        <div class="sa-venue-stat-value" style="color:var(--accent-emerald);">${formatMoney(commission)}</div>
                    </div>
                    <div class="sa-venue-stat">
                        <div class="sa-venue-stat-label">Total Orders</div>
                        <div class="sa-venue-stat-value" style="color:var(--accent-sky);">${orders}</div>
                    </div>
                    <div class="sa-venue-stat">
                        <div class="sa-venue-stat-label">Active Now</div>
                        <div class="sa-venue-stat-value" style="color:${active > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'};">${active}</div>
                    </div>
                </div>
                <div class="sa-venue-card-actions">
                    ${editBtn}
                    ${v.contactMobile ? `<span style="font-size:0.75rem; color:var(--text-muted); align-self:center;">📞 ${escapeHtml(v.contactMobile)}</span>` : ''}
                    ${v.hoursText ? `<span style="font-size:0.75rem; color:var(--text-muted); align-self:center;">🕐 ${escapeHtml(v.hoursText)}</span>` : ''}
                    ${!v.isMain && v.partnerMarkupPct != null ? `<span style="font-size:0.75rem; color:var(--text-muted); align-self:center;">💰 +${v.partnerMarkupPct}% Markup</span>` : ''}
                </div>
            </div>`;
    }

    grid.innerHTML = html;
}

/* ─── Create Venue ───────────────────────────────────── */

async function createVenue() {
    const btn = document.getElementById('saCreateVenueBtn');
    const msg = document.getElementById('saAddMsg');
    msg.textContent = '';
    msg.className = 'sa-form-msg';

    const name = document.getElementById('saNewVenueName').value.trim();
    const city = document.getElementById('saNewVenueCity').value.trim();
    const slug = document.getElementById('saNewVenueSlug').value.trim();
    const adminUser = document.getElementById('saNewVenueAdminUser').value.trim();
    const adminPass = document.getElementById('saNewVenueAdminPass').value;
    const contactMobile = document.getElementById('saNewVenueContact').value.trim();
    const hoursText = document.getElementById('saNewVenueHours').value.trim();
    const venueType = document.getElementById('saNewVenueType').value;
    const partnerMarkupPct = document.getElementById('saNewVenueMarkup').value.trim();

    if (!name) { showAddMsg('Venue name is required', true); return; }
    if (!adminUser) { showAddMsg('Admin username is required', true); return; }
    if (!adminPass || adminPass.length < 4) { showAddMsg('Password must be at least 4 characters', true); return; }

    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
        const res = await fetch('/api/admin/venues', {
            method: 'POST',
            headers: adminHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                name, city, slug, adminUser, adminPass,
                contactMobile, hoursText, venueType, partnerMarkupPct
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create venue.');

        showAddMsg('Venue created successfully!', false);
        clearAddForm();
        document.getElementById('saAddForm').hidden = true;
        await refreshDashboard();

    } catch (err) {
        showAddMsg(err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Venue';
    }
}

function showAddMsg(text, isError) {
    const msg = document.getElementById('saAddMsg');
    msg.textContent = text;
    msg.className = 'sa-form-msg ' + (isError ? 'sa-form-msg--error' : 'sa-form-msg--success');
}

function clearAddForm() {
    ['saNewVenueName', 'saNewVenueCity', 'saNewVenueSlug', 'saNewVenueAdminUser',
     'saNewVenueAdminPass', 'saNewVenueContact', 'saNewVenueHours'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('saNewVenueType').value = 'food';
    document.getElementById('saNewVenueMarkup').value = '8';
    document.getElementById('saAddMsg').textContent = '';
}

/* ─── Edit Venue ─────────────────────────────────────── */

function openEditModal(venueId) {
    const venue = venueListData.find(v => v.id === venueId);
    if (!venue) return;

    editingVenueId = venueId;

    document.getElementById('saEditName').value = venue.name || '';
    document.getElementById('saEditCity').value = venue.city || '';
    document.getElementById('saEditType').value = venue.venueType || 'food';
    document.getElementById('saEditAdminUser').value = venue.adminUser || '';
    document.getElementById('saEditAdminPass').value = '';
    document.getElementById('saEditContact').value = venue.contactMobile || '';
    document.getElementById('saEditHours').value = venue.hoursText || '';
    document.getElementById('saEditAddress').value = venue.addressLine || '';
    document.getElementById('saEditMarkup').value = venue.partnerMarkupPct ?? 0;
    document.getElementById('saEditMsg').textContent = '';

    document.getElementById('saEditModal').hidden = false;
}

function closeEditModal() {
    document.getElementById('saEditModal').hidden = true;
    editingVenueId = null;
}

async function saveVenueEdit() {
    if (!editingVenueId) return;

    const btn = document.getElementById('saEditSaveBtn');
    const msg = document.getElementById('saEditMsg');
    msg.textContent = '';

    const payload = {
        name: document.getElementById('saEditName').value.trim(),
        city: document.getElementById('saEditCity').value.trim(),
        venueType: document.getElementById('saEditType').value,
        adminUser: document.getElementById('saEditAdminUser').value.trim(),
        contactMobile: document.getElementById('saEditContact').value.trim(),
        hoursText: document.getElementById('saEditHours').value.trim(),
        addressLine: document.getElementById('saEditAddress').value.trim(),
        partnerMarkupPct: document.getElementById('saEditMarkup').value.trim()
    };

    const pass = document.getElementById('saEditAdminPass').value;
    if (pass) payload.adminPass = pass;

    if (!payload.name) {
        msg.textContent = 'Name is required';
        msg.className = 'sa-form-msg sa-form-msg--error';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const res = await fetch(`/api/admin/venues/${editingVenueId}`, {
            method: 'PATCH',
            headers: adminHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not update venue.');

        closeEditModal();
        await refreshDashboard();

    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'sa-form-msg sa-form-msg--error';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }
}

/* ─── Delete Venue ───────────────────────────────────── */

async function deleteVenue(venueId, venueName) {
    if (!confirm(`Are you sure you want to permanently delete "${venueName}" and ALL its orders and data?`)) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/venues/${venueId}`, {
            method: 'DELETE',
            headers: adminHeaders()
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not delete venue.');

        alert('Venue deleted successfully.');
        await refreshDashboard();
    } catch (err) {
        alert(err.message);
    }
}

/* ─── Init ───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', initSuperAdmin);
