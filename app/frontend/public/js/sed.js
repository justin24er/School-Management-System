(async function () {
  const me = await initShell('SED');
  if (!me) return;

  try {
    const data = await API.get('/api/dashboard/sed');

    document.getElementById('kpi-revenue').textContent = formatMoney(data.revenue);
    document.getElementById('kpi-expenses').textContent = formatMoney(data.expenses);
    document.getElementById('kpi-profit').textContent = formatMoney(data.profit);
    document.getElementById('kpi-outstanding').textContent = formatMoney(data.outstandingFees);

    const revCtx = document.getElementById('revenue-chart');
    if (data.monthlyRevenue.length === 0 && data.monthlyExpenses.length === 0) {
      renderEmpty(revCtx.parentElement, 'No financial records for this period yet.');
    } else {
      const months = Array.from(new Set([...data.monthlyRevenue.map(m => m.month), ...data.monthlyExpenses.map(m => m.month)])).sort();
      const revMap = Object.fromEntries(data.monthlyRevenue.map(m => [m.month, m.total]));
      const expMap = Object.fromEntries(data.monthlyExpenses.map(m => [m.month, m.total]));
      renderChart('revenue-chart', revCtx, {
        type: 'bar',
        data: {
          labels: months,
          datasets: [
            { label: 'Revenue', data: months.map(m => revMap[m] || 0), backgroundColor: '#DDFBE8', borderColor: '#1E7C46', borderWidth: 1 },
            { label: 'Expenses', data: months.map(m => expMap[m] || 0), backgroundColor: '#FFDFDF', borderColor: '#A3312F', borderWidth: 1 },
          ],
        },
        options: { scales: { y: { beginAtZero: true } } },
      });
    }

    const resCtx = document.getElementById('resource-chart');
    if (data.resourceSpend.every(r => r.total === 0) || data.resourceSpend.length === 0) {
      renderEmpty(resCtx.parentElement, 'No resource expenses recorded for this period.');
    } else {
      renderChart('resource-chart', resCtx, {
        type: 'doughnut',
        data: {
          labels: data.resourceSpend.map(r => r.name),
          datasets: [{ data: data.resourceSpend.map(r => r.total), backgroundColor: ['#E77F00', '#844F0B', '#FFE2B5', '#DEE6FB'] }],
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
      });
    }

    const projCtx = document.getElementById('projects-chart');
    if (data.projects.length === 0) {
      renderEmpty(projCtx.parentElement, 'No infrastructure projects recorded.');
    } else {
      renderChart('projects-chart', projCtx, {
        type: 'bar',
        data: { labels: data.projects.map(p => p.status), datasets: [{ label: 'Projects', data: data.projects.map(p => p.n), backgroundColor: '#E77F00' }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    }

    document.getElementById('glance-list').innerHTML = `
      <div class="activity-item"><div class="dot"></div><div class="txt"><strong>${data.studentCount}</strong> active students</div></div>
      <div class="activity-item"><div class="dot"></div><div class="txt"><strong>${data.staffCount}</strong> active staff</div></div>
      <div class="activity-item"><div class="dot"></div><div class="txt"><strong>${formatMoney(data.outstandingFees)}</strong> in outstanding fees</div></div>
    `;
  } catch (err) {
    renderError(document.querySelector('.main'), err.message);
  }
})();
