(async function () {
  const me = await initShell('HEAD_TEACHER');
  if (!me) return;

  async function loadDashboard() {
    try {
      const data = await API.get('/api/dashboard/head-teacher');

      document.getElementById('kpi-students').textContent = data.studentCount;
      document.getElementById('kpi-teachers').textContent = data.teacherCount;
      document.getElementById('kpi-subjects').textContent = data.subjectPerformance.length;
      document.getElementById('kpi-projects').textContent = data.projects.filter(p => p.status === 'active').length;

      const subjCtx = document.getElementById('subject-chart');
      if (data.subjectPerformance.length === 0) {
        renderEmpty(subjCtx.parentElement, 'No academic records have been entered yet.');
      } else {
        renderChart('subject-chart', subjCtx, {
          type: 'bar',
          data: { labels: data.subjectPerformance.map(s => s.subject), datasets: [{ label: 'Average score', data: data.subjectPerformance.map(s => s.average), backgroundColor: '#E77F00' }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
        });
      }

      const classCtx = document.getElementById('class-chart');
      if (data.classPerformance.length === 0) {
        renderEmpty(classCtx.parentElement, 'No class-level academic records yet.');
      } else {
        renderChart('class-chart', classCtx, {
          type: 'bar',
          data: { labels: data.classPerformance.map(c => c.class), datasets: [{ label: 'Average score', data: data.classPerformance.map(c => c.average), backgroundColor: '#844F0B' }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
        });
      }

      const trendCtx = document.getElementById('trend-chart');
      if (data.annualTrend.length === 0) {
        renderEmpty(trendCtx.parentElement, 'Not enough historical data for a trend yet.');
      } else {
        renderChart('trend-chart', trendCtx, {
          type: 'line',
          data: { labels: data.annualTrend.map(t => t.year), datasets: [{ label: 'Average score', data: data.annualTrend.map(t => t.average), borderColor: '#E77F00', backgroundColor: 'rgba(231,127,0,0.12)', fill: true, tension: 0.3 }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
        });
      }

      const resourceHost = document.getElementById('resource-list');
      if (data.resourceExpenses.length === 0 || data.resourceExpenses.every(r => r.total === 0)) {
        renderEmpty(resourceHost, 'No resource or infrastructure expenses recorded yet.');
      } else {
        resourceHost.innerHTML = data.resourceExpenses.map(r => `
          <div class="activity-item"><div class="dot"></div><div class="txt">${r.name}: <strong>${formatMoney(r.total)}</strong></div></div>
        `).join('');
      }

      const projectsHost = document.getElementById('projects-list');
      if (data.projects.length === 0) {
        renderEmpty(projectsHost, 'No infrastructure projects yet.');
      } else {
        projectsHost.innerHTML = data.projects.map(p => `
          <div class="activity-item"><div class="dot"></div><div class="txt"><strong>${p.name}</strong><br>
          <span class="badge ${p.status}">${p.status}</span> <span class="when">Budget ${formatMoney(p.budget)}</span></div></div>
        `).join('');
      }
    } catch (err) {
      renderError(document.querySelector('.main'), err.message);
    }
  }

  let studentClasses = [];

  async function loadClassOptions() {
    try {
      studentClasses = await API.get('/api/school/classes');
      const filterSelect = document.getElementById('student-filter-class');
      const modalSelect = document.getElementById('ns-class');
      const optionsHtml = studentClasses.map(c => `<option value="${c.public_id}">${c.name}</option>`).join('');
      filterSelect.innerHTML = '<option value="">All classes</option>' + optionsHtml;
      modalSelect.innerHTML = '<option value="">Unassigned</option>' + optionsHtml;
    } catch (_) { /* filters/modal just show "All classes" / "Unassigned" only */ }
  }

  function currentFilters() {
    const params = new URLSearchParams();
    const search = document.getElementById('student-search').value.trim();
    const classId = document.getElementById('student-filter-class').value;
    const status = document.getElementById('student-filter-status').value;
    if (search) params.set('search', search);
    if (classId) params.set('classId', classId);
    if (status) params.set('status', status);
    params.set('pageSize', '15');
    return params.toString();
  }

  async function loadStudents() {
    const host = document.getElementById('students-table');
    try {
      const res = await API.get(`/api/school/students?${currentFilters()}`);
      document.getElementById('students-count').textContent = `${res.total} total`;
      if (res.data.length === 0) return renderEmpty(host, 'No students match these filters.');
      host.innerHTML = `<table><thead><tr><th>Name</th><th>Admission No.</th><th>Class</th><th>Status</th></tr></thead><tbody>
        ${res.data.map(s => `<tr><td>${s.first_name} ${s.last_name}</td><td>${s.admission_no}</td><td>${s.class_name || '—'}</td><td><span class="badge ${s.status}">${s.status}</span></td></tr>`).join('')}
      </tbody></table>`;
    } catch (err) { renderError(host, err.message); }
  }

  // Debounce the search box so we're not firing a request on every
  // keystroke; the two dropdowns re-query immediately since those are
  // deliberate, infrequent choices rather than typing.
  let searchDebounce;
  document.getElementById('student-search').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadStudents, 300);
  });
  document.getElementById('student-filter-class').addEventListener('change', loadStudents);
  document.getElementById('student-filter-status').addEventListener('change', loadStudents);

  const modal = document.getElementById('add-student-modal');
  document.getElementById('add-student-btn').addEventListener('click', () => openModal(modal));
  document.getElementById('add-student-cancel').addEventListener('click', () => closeModal(modal));
  document.getElementById('add-student-save').addEventListener('click', async () => {
    const errorEl = document.getElementById('add-student-error');
    errorEl.textContent = '';
    try {
      await API.post('/api/school/students', {
        firstName: document.getElementById('ns-first').value,
        lastName: document.getElementById('ns-last').value,
        admissionNo: document.getElementById('ns-admission').value,
        classId: document.getElementById('ns-class').value || null,
        gender: document.getElementById('ns-gender').value,
      });
      closeModal(modal);
      ['ns-first', 'ns-last', 'ns-admission'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('ns-class').value = '';
      loadStudents();
      loadDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  loadDashboard();
  loadClassOptions();
  loadStudents();
})();
