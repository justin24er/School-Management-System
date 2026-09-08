(async function () {
  const me = await initShell('ACCOUNTANT');
  if (!me) return;

  async function loadDashboard() {
    try {
      const data = await API.get('/api/dashboard/accountant');

      document.getElementById('kpi-collected').textContent = formatMoney(data.collected);
      document.getElementById('kpi-outstanding').textContent = formatMoney(data.outstanding);
      document.getElementById('kpi-enrolled').textContent = data.enrollmentThisYear;
      document.getElementById('kpi-fee-records').textContent = data.feesByStatus.reduce((a, f) => a + f.n, 0);

      const collCtx = document.getElementById('collection-chart');
      if (data.collectionTrend.length === 0 && data.expenseTrend.length === 0) {
        renderEmpty(collCtx.parentElement, 'No collections or expenses recorded yet.');
      } else {
        const months = Array.from(new Set([...data.collectionTrend.map(m => m.month), ...data.expenseTrend.map(m => m.month)])).sort();
        const collMap = Object.fromEntries(data.collectionTrend.map(m => [m.month, m.total]));
        const expMap = Object.fromEntries(data.expenseTrend.map(m => [m.month, m.total]));
        renderChart('collection-chart', collCtx, {
          type: 'line',
          data: {
            labels: months,
            datasets: [
              { label: 'Collected', data: months.map(m => collMap[m] || 0), borderColor: '#1E7C46', backgroundColor: 'rgba(29,124,70,0.1)', fill: true, tension: 0.3 },
              { label: 'Expenses', data: months.map(m => expMap[m] || 0), borderColor: '#A3312F', backgroundColor: 'rgba(163,49,47,0.1)', fill: true, tension: 0.3 },
            ],
          },
          options: { scales: { y: { beginAtZero: true } } },
        });
      }

      const statusCtx = document.getElementById('fee-status-chart');
      if (data.feesByStatus.length === 0) {
        renderEmpty(statusCtx.parentElement, 'No fee records yet.');
      } else {
        const colors = { paid: '#DDFBE8', partial: '#FAF0DC', unpaid: '#FFDFDF', waived: '#DEE6FB' };
        renderChart('fee-status-chart', statusCtx, {
          type: 'doughnut',
          data: { labels: data.feesByStatus.map(f => f.status), datasets: [{ data: data.feesByStatus.map(f => f.n), backgroundColor: data.feesByStatus.map(f => colors[f.status] || '#ccc') }] },
          options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
        });
      }

      const paymentsHost = document.getElementById('payments-table');
      if (data.recentPayments.length === 0) {
        renderEmpty(paymentsHost, 'No payments recorded yet.');
      } else {
        paymentsHost.innerHTML = `<table><thead><tr><th>Student</th><th>Amount</th><th>Method</th><th>Status</th><th>When</th></tr></thead><tbody>
          ${data.recentPayments.map(p => `<tr><td>${p.first_name} ${p.last_name}</td><td>${formatMoney(p.amount)}</td><td>${p.method}</td><td><span class="badge ${p.status}">${p.status}</span></td><td>${timeAgo(p.created_at)}</td></tr>`).join('')}
        </tbody></table>`;
      }
    } catch (err) {
      renderError(document.querySelector('.main'), err.message);
    }
  }

  async function loadFeeOptions() {
    try {
      const res = await API.get('/api/school/fees?pageSize=100');
      const select = document.getElementById('pay-fee');
      const unpaid = res.data.filter(f => f.status !== 'paid');
      if (unpaid.length === 0) {
        select.innerHTML = '<option value="">No outstanding fee records</option>';
        return;
      }
      select.innerHTML = unpaid.map(f => `<option value="${f.public_id}">${f.first_name} ${f.last_name} — ${f.term} ${f.year} (owes ${formatMoney(f.amount_due - f.amount_paid)})</option>`).join('');
    } catch (_) { /* handled inline in modal if needed */ }
  }

  async function loadExpenseCategories() {
    try {
      const cats = await API.get('/api/school/expense-categories');
      document.getElementById('exp-category').innerHTML = cats.map(c => `<option value="${c.public_id}">${c.name}</option>`).join('');
    } catch (_) { /* non-fatal */ }
  }

  const modal = document.getElementById('payment-modal');
  document.getElementById('record-payment-btn').addEventListener('click', async () => {
    await loadFeeOptions();
    openModal(modal);
  });
  document.getElementById('payment-cancel').addEventListener('click', () => closeModal(modal));
  document.getElementById('payment-save').addEventListener('click', async () => {
    const errorEl = document.getElementById('payment-error');
    errorEl.textContent = '';
    const feeId = document.getElementById('pay-fee').value;
    if (!feeId) { errorEl.textContent = 'Select a fee record first.'; return; }
    try {
      await API.post('/api/school/payments', {
        feeId,
        amount: Number(document.getElementById('pay-amount').value),
        method: document.getElementById('pay-method').value,
      });
      closeModal(modal);
      document.getElementById('pay-amount').value = '';
      loadDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  document.getElementById('save-expense-btn').addEventListener('click', async () => {
    const resultEl = document.getElementById('expense-result');
    resultEl.textContent = '';
    try {
      await API.post('/api/school/expenses', {
        categoryId: document.getElementById('exp-category').value,
        description: document.getElementById('exp-description').value,
        amount: Number(document.getElementById('exp-amount').value),
        incurredOn: new Date().toISOString().slice(0, 10),
      });
      document.getElementById('exp-description').value = '';
      document.getElementById('exp-amount').value = '';
      resultEl.textContent = 'Expense recorded.';
      loadDashboard();
    } catch (err) {
      resultEl.textContent = err.message;
    }
  });

  loadDashboard();
  loadExpenseCategories();
})();
