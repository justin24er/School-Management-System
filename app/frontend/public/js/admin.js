(async function () {
  const me = await initShell('PLATFORM_ADMIN');
  if (!me) return;

  async function loadSummary() {
    try {
      const [summary, health] = await Promise.all([
        API.get('/api/dashboard/admin'),
        API.get('/api/admin/system-health'),
      ]);

      document.getElementById('kpi-total').textContent = summary.totalSchools;
      const activeTrial = summary.byStatus.filter(s => ['active', 'trial'].includes(s.status)).reduce((a, s) => a + s.n, 0);
      document.getElementById('kpi-active').textContent = activeTrial;
      document.getElementById('kpi-students').textContent = summary.totalStudents.toLocaleString();
      document.getElementById('kpi-incidents').textContent = health.openIncidents;

      const growthCtx = document.getElementById('growth-chart');
      if (summary.schoolGrowth.length === 0) {
        renderEmpty(growthCtx.parentElement, 'No schools registered yet.');
      } else {
        renderChart('growth-chart', growthCtx, {
          type: 'line',
          data: {
            labels: summary.schoolGrowth.map(g => g.month),
            datasets: [{ label: 'New schools', data: summary.schoolGrowth.map(g => g.n), borderColor: '#E77F00', backgroundColor: 'rgba(231,127,0,0.12)', fill: true, tension: 0.3 }],
          },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });
      }

      const statusCtx = document.getElementById('status-chart');
      if (summary.byStatus.length === 0) {
        renderEmpty(statusCtx.parentElement, 'No schools registered yet.');
      } else {
        const colors = { trial: '#FAF0DC', active: '#DDFBE8', expiring_soon: '#FFE2B5', expired: '#FFDFDF', frozen: '#BBB7AD', grace_period: '#DEE6FB', suspended: '#844F0B', cancelled: '#181513' };
        renderChart('status-chart', statusCtx, {
          type: 'doughnut',
          data: {
            labels: summary.byStatus.map(s => s.status.replace('_', ' ')),
            datasets: [{ data: summary.byStatus.map(s => s.n), backgroundColor: summary.byStatus.map(s => colors[s.status] || '#ccc') }],
          },
          options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
        });
      }
    } catch (err) {
      renderError(document.getElementById('growth-chart').parentElement, err.message);
    }
  }

  async function loadSchools() {
    const host = document.getElementById('schools-table');
    try {
      const schools = await API.get('/api/admin/schools');
      document.getElementById('schools-count').textContent = `${schools.length} total`;
      if (schools.length === 0) return renderEmpty(host, 'No schools have registered yet.');

      host.innerHTML = `<table>
        <thead><tr><th>School</th><th>Status</th><th>Users</th><th>Students</th><th>Staff</th><th>Registered</th><th></th></tr></thead>
        <tbody>${schools.map(s => `
          <tr>
            <td>${s.name}</td>
            <td><span class="badge ${s.status}">${s.status.replace('_', ' ')}</span></td>
            <td>${s.user_count}</td>
            <td>${s.student_count}</td>
            <td>${s.staff_count}</td>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
            <td><button class="btn btn-outline view-school" data-id="${s.public_id}" data-name="${s.name}" data-status="${s.status}">View</button></td>
          </tr>`).join('')}
        </tbody></table>`;

      host.querySelectorAll('.view-school').forEach(btn => btn.addEventListener('click', () => openSchoolModal(btn.dataset.id, btn.dataset.name, btn.dataset.status)));
    } catch (err) {
      renderError(host, err.message);
    }
  }

  async function loadSecurityEvents() {
    const host = document.getElementById('security-table');
    try {
      const events = await API.get('/api/admin/security-events');
      if (events.length === 0) return renderEmpty(host, 'No security events recorded.');
      host.innerHTML = `<table><thead><tr><th>Type</th><th>When</th><th>IP</th></tr></thead><tbody>
        ${events.slice(0, 15).map(e => `<tr><td>${e.type.replace(/_/g, ' ')}</td><td>${timeAgo(e.created_at)}</td><td>${e.ip_address || '—'}</td></tr>`).join('')}
      </tbody></table>`;
    } catch (err) { renderError(host, err.message); }
  }

  async function loadIncidents() {
    const host = document.getElementById('incidents-list');
    try {
      const incidents = await API.get('/api/admin/incidents');
      const open = incidents.filter(i => !['resolved', 'closed'].includes(i.status));
      if (open.length === 0) return renderEmpty(host, 'No open incidents. All systems normal.');
      host.innerHTML = open.slice(0, 6).map(i => `
        <div class="activity-item">
          <div class="dot"></div>
          <div class="txt"><strong>${i.title}</strong><br><span class="badge ${i.severity}">${i.severity}</span> <span class="when">${timeAgo(i.detected_at)}</span></div>
        </div>`).join('');
    } catch (err) { renderError(host, err.message); }
  }

  async function openSchoolModal(publicId, name, status) {
    const backdrop = document.getElementById('school-modal-backdrop');
    const body = document.getElementById('school-modal-body');
    document.getElementById('school-modal-title').textContent = name;
    body.innerHTML = '<div class="loading-state">Loading...</div>';
    openModal(backdrop);

    try {
      const detail = await API.get(`/api/admin/schools/${publicId}`);
      const isFrozenOrExpired = ['frozen', 'expired', 'suspended', 'grace_period'].includes(detail.school.status);
      body.innerHTML = `
        <p style="margin-bottom:10px;"><span class="badge ${detail.school.status}">${detail.school.status.replace('_', ' ')}</span></p>
        <p style="font-size:var(--fs-400); color:var(--authentic-grey); margin-bottom:10px;">
          Subscription ends: ${detail.school.subscriptionEndsAt ? new Date(detail.school.subscriptionEndsAt).toLocaleDateString() : '—'}<br>
          Registered: ${new Date(detail.school.createdAt).toLocaleDateString()}<br>
          Accounts: ${detail.users.length}
        </p>
        <p style="font-size:var(--fs-300); color:var(--authentic-grey);">Financial records are private to the school and are not visible to platform administrators.</p>
        <div class="actions" style="margin-top:14px;">
          ${isFrozenOrExpired
            ? `<button class="btn btn-primary" id="unfreeze-btn">Restore service (+30 days)</button>`
            : `<button class="btn btn-danger" id="freeze-btn">Freeze school</button>`}
        </div>`;

      const freezeBtn = document.getElementById('freeze-btn');
      if (freezeBtn) freezeBtn.addEventListener('click', async () => {
        const reason = prompt('Reason for freezing this school (required, for the audit log):');
        if (!reason) return;
        await API.post(`/api/admin/schools/${publicId}/freeze`, { reason });
        closeModal(backdrop);
        loadSchools();
      });
      const unfreezeBtn = document.getElementById('unfreeze-btn');
      if (unfreezeBtn) unfreezeBtn.addEventListener('click', async () => {
        await API.post(`/api/admin/schools/${publicId}/unfreeze`, { extendDays: 30 });
        closeModal(backdrop);
        loadSchools();
      });
    } catch (err) {
      renderError(body, err.message);
    }
  }

  document.getElementById('close-school-modal').addEventListener('click', () => {
    closeModal(document.getElementById('school-modal-backdrop'));
  });

  document.getElementById('issue-voucher-btn').addEventListener('click', async () => {
    const durationDays = Number(document.getElementById('voucher-duration').value);
    const resultEl = document.getElementById('voucher-result');
    try {
      const res = await API.post('/api/admin/vouchers', { durationDays });
      resultEl.innerHTML = `Voucher code: <strong>${res.code}</strong><br>Share this with the school to redeem.`;
    } catch (err) {
      resultEl.textContent = err.message;
    }
  });

  loadSummary();
  loadSchools();
  loadSecurityEvents();
  loadIncidents();
})();
