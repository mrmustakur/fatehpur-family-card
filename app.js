/**
 * app.js - Modern Dashboard Application Logic
 * Supports Multi-Tier Household Clustering, Spousal Linking,
 * Relationship Roles, 1-Click Review Resolution, and SWR In-Memory Caching.
 */

// SWR (Stale-While-Revalidate) In-Memory Cache
const swrCache = new Map();
const CACHE_TTL = 30000; // 30s TTL

// App State
const state = {
  currentNav: 'dashboard',
  tableMode: 'voters', // 'voters', 'families', or 'review'
  scopeFilter: 'all',  // 'all', 'ward_1_3', 'ward_4_6', 'ward_7_9'
  currentAdmin: {
    id: 'adm_1',
    name: 'মো: তানভীর আহমেদ',
    role: 'উপজেলা নির্বাচন অফিসার (সুপার অ্যাডমিন)',
    badge: 'Super Admin',
    initials: 'TA'
  },
  admins: [],
  metrics: null,
  voters: {
    items: [],
    total: 0,
    page: 1,
    limit: 50,
    q: '',
    ward: '',
    needs_review: null,
    loading: false
  },
  families: {
    items: [],
    total: 0,
    page: 1,
    limit: 50,
    q: '',
    ward: '',
    needs_review: null,
    loading: false
  },
  activeFamilyModal: null
};

// Bengali Number Formatter
function toBangla(n) {
  if (n === null || n === undefined) return '--';
  const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return n.toString().replace(/\d/g, d => banglaDigits[d]);
}

// Low-Latency Fetch with SWR Cache
async function cachedFetch(url, options = {}) {
  const cacheKey = url;
  const cached = swrCache.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  try {
    const res = await fetch(url, options);
    const data = await res.json();
    swrCache.set(cacheKey, { data, timestamp: now });
    return data;
  } catch (err) {
    console.error('Fetch error for', url, err);
    throw err;
  }
}

// -------------------------------------------------------------------
// Initialization
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  initAdminProfile();
  setupEventListeners();
  await loadInitialDashboardData();
});

async function loadInitialDashboardData() {
  try {
    const [metricsData, areasData] = await Promise.all([
      cachedFetch('/api/metrics'),
      cachedFetch('/api/areas')
    ]);

    state.metrics = metricsData;
    if (metricsData.admins) {
      state.admins = metricsData.admins;
      renderAdminModalList();
    }

    renderKPICards(metricsData);
    renderWardBarChart(metricsData);
    renderAnalyticsLists(metricsData);

    // Initial load for bottom table
    await fetchTableData();
  } catch (err) {
    console.error('Initial load failed:', err);
  }
}

// -------------------------------------------------------------------
// KPI Cards Rendering
// -------------------------------------------------------------------
function renderKPICards(m) {
  document.getElementById('kpiTotalVoters').textContent = m.total_voters.toLocaleString();
  document.getElementById('kpiTotalFamilies').textContent = m.total_families.toLocaleString();
  document.getElementById('kpiCouplesCount').textContent = `↗ ${m.coupled_households.toLocaleString()}`;
  document.getElementById('kpiAvgFamilySize').textContent = m.avg_family_size;
  document.getElementById('kpiNeedsReview').textContent = `${m.flagged_review_voters.toLocaleString()} voters`;

  // Sidebar counters
  document.getElementById('sidebarVoterCount').textContent = `${(m.total_voters / 1000).toFixed(1)}K`;
  document.getElementById('sidebarFamilyCount').textContent = `${(m.total_families / 1000).toFixed(1)}K`;
  document.getElementById('sidebarReviewCount').textContent = m.flagged_review_voters.toLocaleString();
  document.getElementById('pillReviewBadgeCount').textContent = m.flagged_review_voters.toLocaleString();
}

// -------------------------------------------------------------------
// Ward Distribution Bar Chart
// -------------------------------------------------------------------
function renderWardBarChart(m) {
  const wrapper = document.getElementById('wardBarsWrapper');
  if (!wrapper || !m.ward_breakdown) return;

  const wards = m.ward_breakdown;
  const maxVal = 10000;
  const highestWard = [...wards].sort((a, b) => b.total - a.total)[0];

  wrapper.innerHTML = wards.map(w => {
    const heightPct = Math.min(100, Math.max(15, Math.round((w.total / maxVal) * 100)));
    const isHighest = (w.ward_no === highestWard.ward_no);

    return `
      <div class="chart-bar-col ${isHighest ? 'highlighted' : ''}" 
           title="ওয়ার্ড ${toBangla(w.ward_no)}: সর্বমোট ${w.total.toLocaleString()} ভোটার (পুরুষ: ${w.male}, মহিলা: ${w.female})"
           onclick="filterBySpecificWard('${w.ward_no}')">
        <div class="bar-pillar" style="height: ${heightPct}%;"></div>
        <div class="bar-col-label">Ward ${w.ward_no}</div>
      </div>
    `;
  }).join('');
}

function filterBySpecificWard(wardNo) {
  if (state.tableMode === 'voters' || state.tableMode === 'review') {
    state.voters.ward = wardNo;
    state.voters.page = 1;
  } else {
    state.families.ward = wardNo;
    state.families.page = 1;
  }
  fetchTableData();
}

// -------------------------------------------------------------------
// Bottom Table Management (Voters vs Families vs Review Queue)
// -------------------------------------------------------------------
function setTableMode(mode) {
  state.tableMode = mode;
  document.getElementById('pillVotersMode').classList.toggle('active', mode === 'voters');
  document.getElementById('pillFamiliesMode').classList.toggle('active', mode === 'families');
  document.getElementById('pillReviewMode').classList.toggle('active', mode === 'review');

  const titleEl = document.getElementById('tableTitle');
  if (mode === 'voters') {
    titleEl.textContent = 'Registered Voters (নিবন্ধিত ভোটার তালিকা)';
    state.voters.needs_review = null;
    state.voters.page = 1;
  } else if (mode === 'families') {
    titleEl.textContent = 'Family Card Households (পারিবারিক কার্ড রেজিস্ট্রি)';
    state.families.needs_review = null;
    state.families.page = 1;
  } else if (mode === 'review') {
    titleEl.textContent = '⚠️ Admin Review Queue: Flagged Spouse & Parent Ties (যাচাইকরণ তালিকা)';
    state.voters.needs_review = 1;
    state.voters.page = 1;
  }

  fetchTableData();
}

async function fetchTableData() {
  if (state.tableMode === 'voters' || state.tableMode === 'review') {
    await fetchVoters();
  } else {
    await fetchFamilies();
  }
}

async function fetchVoters() {
  const offset = (state.voters.page - 1) * state.voters.limit;
  const params = new URLSearchParams({
    limit: state.voters.limit,
    offset: offset
  });

  if (state.voters.q) params.set('q', state.voters.q);
  if (state.voters.ward) params.set('ward', state.voters.ward);
  if (state.voters.needs_review !== null) params.set('needs_review', state.voters.needs_review);

  const url = `/api/voters?${params.toString()}`;
  try {
    const data = await cachedFetch(url);
    state.voters.items = data.items;
    state.voters.total = data.total;
    renderVotersTable(data);
  } catch (err) {
    console.error('Error fetching voters:', err);
  }
}

function renderVotersTable(data) {
  const thead = document.getElementById('tableHeaderCols');
  thead.innerHTML = `
    <th>Voter Name & Role</th>
    <th>Voter ID (NID)</th>
    <th>Family ID</th>
    <th>Guardian & Mother</th>
    <th>Ward & Area</th>
    <th>Status & Match</th>
    <th style="text-align: right;">Action</th>
  `;

  const tbody = document.getElementById('tableBodyRows');
  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">কোনো ভোটার রেকর্ড পাওয়া যায়নি</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(v => {
    const initials = v.name.slice(0, 2);
    
    // Role Badge
    let roleBadge = '<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #f1f4f9; color: #596173; font-weight: 600;">সদস্য</span>';
    if (v.is_head === 1) {
      roleBadge = '<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #fef08a; color: #854d0e; font-weight: 700;">👑 গৃহপ্রধান</span>';
    } else if (v.relationship_role === 'স্ত্রী' || v.relationship_role === 'Spouse') {
      roleBadge = '<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-weight: 600;">💍 স্ত্রী</span>';
    } else if (v.relationship_role === 'Son/Daughter' || v.relationship_role === 'সন্তান') {
      roleBadge = '<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #ecfdf5; color: #047857; font-weight: 600;">🧒 সন্তান</span>';
    }

    // Status Badge & Review Action
    let statusCol = `<span class="status-pill-dark">নিবন্ধিত</span>`;
    let actionBtn = `
      <button class="pill-btn" style="background: #f1f4f9; padding: 0.35rem 0.85rem;" onclick="openFamilyCardModal('${v.family_id}')">
        কার্ড দেখুন
      </button>
    `;

    if (v.needs_review === 1) {
      statusCol = `
        <div>
          <span style="font-size: 0.75rem; background: #fee2e2; color: #b91c1c; padding: 3px 8px; border-radius: 999px; font-weight: 600;">
            ⚠️ রিভিউ প্রয়োজন
          </span>
          <div style="font-size: 0.7rem; color: #ef4444; margin-top: 2px;" title="${v.review_reason || ''}">
            ${(v.review_reason || '').slice(0, 30)}...
          </div>
        </div>
      `;
      actionBtn = `
        <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
          <button class="pill-btn active" style="background: #10b981; color: #fff; padding: 0.35rem 0.75rem; font-size: 0.75rem;" onclick="resolveVoterReview(${v.id}, '${v.name}')">
            ✅ অনুমোদন
          </button>
          <button class="pill-btn" style="background: #f1f4f9; padding: 0.35rem 0.65rem;" onclick="openFamilyCardModal('${v.family_id}')">
            কার্ড
          </button>
        </div>
      `;
    }

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar-mini">${initials}</div>
            <div>
              <div style="font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
                ${v.name} ${roleBadge}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${v.occupation || 'ভোটার'} • ${v.gender} • জন্ম: ${v.dob || '--'}</div>
            </div>
          </div>
        </td>
        <td style="font-family: var(--font-sans); font-weight: 600; color: var(--text-sub);">
          #${v.voter_no}
        </td>
        <td style="font-family: var(--font-sans); font-weight: 700; color: var(--accent-blue);">
          ${v.family_id}
        </td>
        <td>
          <div style="font-size: 0.85rem; color: var(--text-main);">${v.guardian_type}: ${v.guardian_name}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">মাতা: ${v.mother_name}</div>
        </td>
        <td>
          <div style="font-weight: 600;">Ward ${v.ward_no}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${v.area_name}</div>
        </td>
        <td>${statusCol}</td>
        <td style="text-align: right;">${actionBtn}</td>
      </tr>
    `;
  }).join('');

  updateTablePagination(state.voters.page, state.voters.limit, data.total);
}

// 1-Click Review Resolution for Single Voter
async function resolveVoterReview(voterId, voterName) {
  try {
    const res = await fetch(`/api/voter/${voterId}/resolve-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: state.currentAdmin.id,
        admin_name: state.currentAdmin.name,
        notes: `অনুমোদন করেছেন ${state.currentAdmin.name}`
      })
    });
    const result = await res.json();
    if (result.success) {
      swrCache.clear();
      // Reload metrics and current table
      const metrics = await cachedFetch('/api/metrics');
      renderKPICards(metrics);
      fetchVoters();
    }
  } catch (err) {
    alert('অনুমোদনে সমস্যা হয়েছে।');
  }
}

async function fetchFamilies() {
  const offset = (state.families.page - 1) * state.families.limit;
  const params = new URLSearchParams({
    limit: state.families.limit,
    offset: offset
  });

  if (state.families.q) params.set('q', state.families.q);
  if (state.families.ward) params.set('ward', state.families.ward);

  const url = `/api/families?${params.toString()}`;
  try {
    const data = await cachedFetch(url);
    state.families.items = data.items;
    state.families.total = data.total;
    renderFamiliesTable(data);
  } catch (err) {
    console.error('Error fetching families:', err);
  }
}

function renderFamiliesTable(data) {
  const thead = document.getElementById('tableHeaderCols');
  thead.innerHTML = `
    <th>Family Card ID</th>
    <th>Household Head (গৃহপ্রধান)</th>
    <th>Ward & Area</th>
    <th>Voters Count</th>
    <th>Couple Included</th>
    <th>Status</th>
    <th style="text-align: right;">Action</th>
  `;

  const tbody = document.getElementById('tableBodyRows');
  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">কোনো পরিবার রেকর্ড পাওয়া যায়নি</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(f => {
    let statusBadge = '<span class="status-pill-ready">মুদ্রিত</span>';
    if (f.needs_review_count > 0) {
      statusBadge = `<span style="font-size: 0.75rem; background: #fee2e2; color: #b91c1c; padding: 3px 8px; border-radius: 999px; font-weight: 600;">⚠️ ${f.needs_review_count} জন রিভিউ</span>`;
    } else if (f.status === 'বিতরণ সম্পন্ন') {
      statusBadge = '<span class="status-pill-dark">বিতরণ সম্পন্ন</span>';
    }

    const coupleText = f.has_couple === 1 ? '💍 হ্যাঁ (দম্পতি)' : 'একক / অন্যান্য';

    return `
      <tr>
        <td style="font-family: var(--font-sans); font-weight: 700; color: var(--accent-blue);">
          ${f.family_id}
        </td>
        <td>
          <div style="font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 0.35rem;">
            <span>👑</span> ${f.head_name}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${f.address}</div>
        </td>
        <td>
          <div style="font-weight: 600;">Ward ${f.ward_no}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${f.area_name}</div>
        </td>
        <td style="font-family: var(--font-sans); font-weight: 700; font-size: 1rem;">
          ${f.total_voters} voters <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">(👨${f.male_count} 👩${f.female_count})</span>
        </td>
        <td style="font-size: 0.82rem; color: var(--text-sub);">
          ${coupleText}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">
          <button class="pill-btn active" style="padding: 0.35rem 0.85rem;" onclick="openFamilyCardModal('${f.family_id}')">
            কার্ড বিস্তারিত
          </button>
        </td>
      </tr>
    `;
  }).join('');

  updateTablePagination(state.families.page, state.families.limit, data.total);
}

function updateTablePagination(page, limit, total) {
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const totalPages = Math.ceil(total / limit) || 1;

  document.getElementById('tablePageStats').textContent = 
    `Showing ${start.toLocaleString()} to ${end.toLocaleString()} of ${total.toLocaleString()}`;

  document.getElementById('tablePageNum').textContent = `Page ${page} of ${totalPages}`;
}

function paginateTable(delta) {
  if (state.tableMode === 'voters' || state.tableMode === 'review') {
    const totalPages = Math.ceil(state.voters.total / state.voters.limit) || 1;
    const newPage = state.voters.page + delta;
    if (newPage >= 1 && newPage <= totalPages) {
      state.voters.page = newPage;
      fetchVoters();
    }
  } else {
    const totalPages = Math.ceil(state.families.total / state.families.limit) || 1;
    const newPage = state.families.page + delta;
    if (newPage >= 1 && newPage <= totalPages) {
      state.families.page = newPage;
      fetchFamilies();
    }
  }
}

function refreshCurrentTable() {
  swrCache.clear();
  fetchTableData();
}

// -------------------------------------------------------------------
// Scope Pills Filter
// -------------------------------------------------------------------
function filterByScope(scope, btn) {
  state.scopeFilter = scope;
  document.querySelectorAll('.time-pills .pill-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (scope === 'all') {
    state.voters.ward = '';
    state.families.ward = '';
  } else if (scope === 'ward_1_3') {
    state.voters.ward = '১';
    state.families.ward = '১';
  } else if (scope === 'ward_4_6') {
    state.voters.ward = '৪';
    state.families.ward = '৪';
  } else if (scope === 'ward_7_9') {
    state.voters.ward = '৭';
    state.families.ward = '৭';
  }

  state.voters.page = 1;
  state.families.page = 1;
  fetchTableData();
}

// -------------------------------------------------------------------
// Sidebar Navigation Switching
// -------------------------------------------------------------------
function switchNavSection(section) {
  state.currentNav = section;

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.getElementById(`nav-${section}`);
  if (activeLink) activeLink.classList.add('active');

  const dashboardView = document.getElementById('viewDashboard');
  const analyticsView = document.getElementById('viewAnalytics');
  const titleHeading = document.getElementById('pageTitleHeading');

  if (section === 'dashboard') {
    dashboardView.style.display = 'block';
    analyticsView.style.display = 'none';
    titleHeading.textContent = 'Dashboard';
  } else if (section === 'voters') {
    dashboardView.style.display = 'block';
    analyticsView.style.display = 'none';
    titleHeading.textContent = 'Voters Directory';
    setTableMode('voters');
  } else if (section === 'families') {
    dashboardView.style.display = 'block';
    analyticsView.style.display = 'none';
    titleHeading.textContent = 'Family Cards Registry';
    setTableMode('families');
  } else if (section === 'review') {
    dashboardView.style.display = 'block';
    analyticsView.style.display = 'none';
    titleHeading.textContent = 'Admin Review Queue (যাচাইকরণ তালিকা)';
    setTableMode('review');
  } else if (section === 'analytics') {
    dashboardView.style.display = 'none';
    analyticsView.style.display = 'block';
    titleHeading.textContent = 'Analytics & Insights';
  }
}

// -------------------------------------------------------------------
// Analytics Full View Lists
// -------------------------------------------------------------------
function renderAnalyticsLists(m) {
  const occList = document.getElementById('analyticsOccupationsList');
  if (occList && m.top_occupations) {
    occList.innerHTML = m.top_occupations.map(o => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--border-light);">
        <span style="font-weight: 600;">${o.occupation}</span>
        <span style="font-family: var(--font-sans); font-weight: 700; color: var(--accent-blue);">${o.count.toLocaleString()} জন</span>
      </div>
    `).join('');
  }

  const areasList = document.getElementById('analyticsAreasList');
  if (areasList && m.top_areas) {
    areasList.innerHTML = m.top_areas.map(a => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--border-light);">
        <div>
          <span style="font-weight: 600;">${a.area}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem;">Ward ${a.ward} (কোড ${a.code})</span>
        </div>
        <span style="font-family: var(--font-sans); font-weight: 700; color: var(--accent-green);">${a.count.toLocaleString()} ভোটার</span>
      </div>
    `).join('');
  }
}

// -------------------------------------------------------------------
// Family Card Modal
// -------------------------------------------------------------------
async function openFamilyCardModal(familyId) {
  const modal = document.getElementById('familyCardModal');
  modal.classList.add('active');

  document.getElementById('modalFamilyIdBadge').textContent = familyId;
  document.getElementById('modalGuardianName').textContent = 'লোড হচ্ছে...';
  document.getElementById('modalMembersTableBody').innerHTML = `
    <tr><td colspan="9" style="text-align: center; padding: 1.5rem;">সদস্যদের তথ্য লোড হচ্ছে...</td></tr>
  `;

  try {
    const data = await cachedFetch(`/api/family/${familyId}`);
    const fam = data.family;
    const members = data.members;
    state.activeFamilyModal = fam;

    document.getElementById('modalGuardianName').textContent = `${fam.head_name} (গৃহপ্রধান)`;
    document.getElementById('modalAreaName').textContent = fam.area_name;
    document.getElementById('modalWardCode').textContent = `ওয়ার্ড ${toBangla(fam.ward_no)}, কোড ${toBangla(fam.area_code)}`;
    document.getElementById('modalAddress').textContent = fam.address;
    document.getElementById('modalTotalMembers').textContent = `${toBangla(fam.total_voters)} জন (পুরুষ ${toBangla(fam.male_count)}, মহিলা ${toBangla(fam.female_count)})`;
    document.getElementById('modalCardStatus').textContent = fam.status || 'মুদ্রিত';
    document.getElementById('modalStatusSelect').value = fam.status || 'মুদ্রিত';

    const tbody = document.getElementById('modalMembersTableBody');
    tbody.innerHTML = members.map((m, idx) => {
      let roleLabel = m.is_head === 1 ? '👑 গৃহপ্রধান' : m.relationship_role;
      let statusLabel = m.needs_review === 1 ? '⚠️ রিভিউ প্রয়োজন' : 'যাচাইকৃত';

      return `
        <tr>
          <td style="font-family: var(--font-sans);">${idx + 1}</td>
          <td style="font-weight: 700; color: ${m.is_head === 1 ? '#fef08a' : '#fff'};">${roleLabel}</td>
          <td style="font-family: var(--font-sans); font-weight: 600;">${m.voter_no}</td>
          <td style="font-weight: 600;">${m.name}</td>
          <td>${m.guardian_type}: ${m.guardian_name}</td>
          <td>${m.mother_name}</td>
          <td>${m.occupation || '--'}</td>
          <td>${m.gender === 'পুরুষ' ? '👨 পুরুষ' : '👩 মহিলা'}</td>
          <td style="font-size: 0.75rem; color: ${m.needs_review === 1 ? '#fca5a5' : '#86efac'};">${statusLabel}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load family modal:', err);
  }
}

function closeFamilyCardModal() {
  document.getElementById('familyCardModal').classList.remove('active');
  state.activeFamilyModal = null;
}

// 1-Click Family Confirmation
async function resolveCurrentFamilyAll() {
  if (!state.activeFamilyModal) return;
  const fid = state.activeFamilyModal.family_id;

  try {
    const res = await fetch(`/api/family/${fid}/resolve-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: state.currentAdmin.id,
        admin_name: state.currentAdmin.name,
        notes: `পরিবার সার্বিকভাবে অনুমোদন করেছেন ${state.currentAdmin.name}`
      })
    });
    const result = await res.json();
    if (result.success) {
      swrCache.clear();
      alert(`ফ্যামিলি কার্ড ${fid} সফলভাবে অনুমোদিত হয়েছে।`);
      closeFamilyCardModal();
      const metrics = await cachedFetch('/api/metrics');
      renderKPICards(metrics);
      fetchTableData();
    }
  } catch (err) {
    alert('অনুমোদনে সমস্যা হয়েছে।');
  }
}

async function saveCardStatus() {
  if (!state.activeFamilyModal) return;
  const fid = state.activeFamilyModal.family_id;
  const newStatus = document.getElementById('modalStatusSelect').value;

  try {
    const res = await fetch(`/api/family/${fid}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: newStatus,
        admin_id: state.currentAdmin.id,
        admin_name: state.currentAdmin.name,
        notes: `স্ট্যাটাস আপডেট করেছেন ${state.currentAdmin.name}`
      })
    });
    const result = await res.json();
    if (result.success) {
      document.getElementById('modalCardStatus').textContent = newStatus;
      swrCache.clear();
      alert(`ফ্যামিলি কার্ড (${fid}) এর স্ট্যাটাস '${newStatus}' সংরক্ষিত হয়েছে।`);
      fetchTableData();
    }
  } catch (err) {
    alert('সংরক্ষণে সমস্যা হয়েছে।');
  }
}

// -------------------------------------------------------------------
// Admin Management Modal
// -------------------------------------------------------------------
function initAdminProfile() {
  const saved = localStorage.getItem('family_card_admin');
  if (saved) {
    try {
      state.currentAdmin = JSON.parse(saved);
      document.getElementById('headerAdminAvatar').textContent = state.currentAdmin.initials || 'TA';
    } catch (e) {}
  }
}

function renderAdminModalList() {
  const list = document.getElementById('adminSelectList');
  if (!list) return;

  const initials = ['TA', 'SJ', 'MR', 'AC'];

  list.innerHTML = state.admins.map((adm, idx) => {
    adm.initials = initials[idx] || 'AD';
    const isSelected = (adm.id === state.currentAdmin.id);
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem; border: 1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-light)'}; background: ${isSelected ? '#f8fafc' : '#ffffff'}; border-radius: var(--radius-md); cursor: pointer;"
           onclick="selectAdmin('${adm.id}')">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div class="user-avatar-mini" style="background: #252830; color: #fff;">${adm.initials}</div>
          <div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.9rem;">${adm.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${adm.role}</div>
          </div>
        </div>
        <span class="status-pill-dark" style="font-size: 0.7rem;">${adm.badge}</span>
      </div>
    `;
  }).join('');
}

function selectAdmin(adminId) {
  const adm = state.admins.find(a => a.id === adminId);
  if (adm) {
    state.currentAdmin = adm;
    localStorage.setItem('family_card_admin', JSON.stringify(adm));
    document.getElementById('headerAdminAvatar').textContent = adm.initials || 'AD';
    renderAdminModalList();
    toggleAdminModal(false);
  }
}

function toggleAdminModal(show) {
  const modal = document.getElementById('adminModal');
  if (modal) modal.classList.toggle('active', show);
}

// -------------------------------------------------------------------
// Speed Benchmark Modal
// -------------------------------------------------------------------
function openBenchmarkModal() {
  document.getElementById('benchmarkModal').classList.add('active');
}
function closeBenchmarkModal() {
  document.getElementById('benchmarkModal').classList.remove('active');
}

async function runBenchmarkTests() {
  const resArea = document.getElementById('benchmarkModalResults');
  resArea.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);">টেস্ট পরিচালিত হচ্ছে...</div>`;

  try {
    const res = await fetch('/api/benchmark');
    const data = await res.json();

    resArea.innerHTML = `
      <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 0.78rem; color: #065f46;">গড় রেসপন্স টাইম:</div>
          <div style="font-size: 1.6rem; font-weight: 800; font-family: var(--font-sans); color: #047857;">
            ⚡ ${data.average_latency_ms} ms
          </div>
        </div>
        <span class="status-pill-dark">${data.status}</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${data.tests.map(t => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.85rem; background: #f8fafc; border-radius: var(--radius-sm); font-size: 0.82rem;">
            <span style="font-weight: 600;">${t.title}</span>
            <span style="font-family: var(--font-sans); font-weight: 700; color: #10b981;">${t.latency_ms} ms</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    resArea.innerHTML = `<div style="color: #ef4444; padding: 1rem;">বেঞ্চমার্ক টেস্ট ব্যর্থ হয়েছে</div>`;
  }
}

// -------------------------------------------------------------------
// Event Listeners
// -------------------------------------------------------------------
let searchDebounceTimer = null;

function setupEventListeners() {
  const searchInput = document.getElementById('globalSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        const val = e.target.value.trim();
        if (state.tableMode === 'voters' || state.tableMode === 'review') {
          state.voters.q = val;
          state.voters.page = 1;
        } else {
          state.families.q = val;
          state.families.page = 1;
        }
        fetchTableData();
      }, 150);
    });
  }
}
