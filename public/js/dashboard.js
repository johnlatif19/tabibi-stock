(function () {
  const state = {
    medicines: [],
    people: [],
    showArchived: false
  };

  const els = {
    statTypes: document.getElementById('statTypes'),
    statStrips: document.getElementById('statStrips'),
    statAvailable: document.getElementById('statAvailable'),
    statLow: document.getElementById('statLow'),
    statOut: document.getElementById('statOut'),
    statUnregistered: document.getElementById('statUnregistered'),
    medicinesBody: document.getElementById('medicinesBody'),
    medicinesBody2: document.getElementById('medicinesBody2'),
    historyBody: document.getElementById('historyBody'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalContent: document.getElementById('modalContent'),
    toast: document.getElementById('toast'),
    sidebar: document.getElementById('sidebar'),
    menuToggle: document.getElementById('menuToggle'),
    logoutBtn: document.getElementById('logoutBtn'),
    purchaseBtn: document.getElementById('purchaseBtn'),
    addMedicineBtn: document.getElementById('addMedicineBtn'),
    addMedicineBtn2: document.getElementById('addMedicineBtn2'),
    initSeedBtn: document.getElementById('initSeedBtn'),
    refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
    filterType: document.getElementById('filterType'),
    searchMedicines: document.getElementById('searchMedicines'),
    filterPerson: document.getElementById('filterPerson'),
    filterStatus: document.getElementById('filterStatus'),
    showArchivedToggle: document.getElementById('showArchivedToggle')
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (res.status === 401) {
      window.location.replace('/login');
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'خطأ');
    return data;
  }

  function toast(text, kind) {
    els.toast.textContent = text;
    els.toast.className = 'toast ' + (kind || '');
    els.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add('hidden'), 3000);
  }

  function openModal(html) {
    els.modalContent.innerHTML = html;
    els.modalBackdrop.classList.remove('hidden');
  }

  function closeModal() {
    els.modalBackdrop.classList.add('hidden');
    els.modalContent.innerHTML = '';
  }

  els.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === els.modalBackdrop) closeModal();
  });

  function statusClass(status) {
    return 'badge ' + status;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function loadDashboard() {
    try {
      const data = await api('/api/dashboard');
      els.statTypes.textContent = data.totalTypes;
      els.statStrips.textContent = data.totalStrips;
      els.statAvailable.textContent = data.available;
      els.statLow.textContent = data.low;
      els.statOut.textContent = data.out;
      els.statUnregistered.textContent = data.unregistered;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadMedicines() {
    try {
      const url = '/api/medicines' + (state.showArchived ? '?includeArchived=true' : '');
      const data = await api(url);
      state.medicines = data.items;
      renderMedicinesTable();
      renderMedicinesPage();
      populatePeopleFilter();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderMedicinesTable() {
    const items = state.medicines.filter((m) => !m.archived);
    if (!items.length) {
      els.medicinesBody.innerHTML = '<tr><td colspan="5" class="empty">لا توجد علاجات</td></tr>';
      return;
    }
    els.medicinesBody.innerHTML = items.map((m) => {
      const qty = m.quantity === null ? '—' : m.quantity;
      return `
        <tr>
          <td>${escapeHtml(m.name)}</td>
          <td>${escapeHtml(m.person)}</td>
          <td>${qty}</td>
          <td><span class="${statusClass(m.status)}">${escapeHtml(m.statusLabel)}</span></td>
          <td class="row-actions">
            <button class="btn small" data-action="use" data-id="${m.id}">استخدام شريط</button>
            <button class="btn small primary" data-action="purchase" data-id="${m.id}">شراء علاج</button>
            <button class="btn small ghost" data-action="details" data-id="${m.id}">تفاصيل</button>
          </td>
        </tr>
      `;
    }).join('');

    els.medicinesBody.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleRowAction(btn.dataset.action, btn.dataset.id));
    });
  }

  function populatePeopleFilter() {
    const people = Array.from(new Set(state.medicines.map((m) => m.person))).sort((a, b) => a.localeCompare(b, 'ar'));
    const current = els.filterPerson.value;
    els.filterPerson.innerHTML = '<option value="">كل الأشخاص</option>' +
      people.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (people.includes(current)) els.filterPerson.value = current;
  }

  function getFilteredMedicines() {
    const q = (els.searchMedicines.value || '').trim().toLowerCase();
    const person = els.filterPerson.value;
    const status = els.filterStatus.value;
    return state.medicines.filter((m) => {
      if (!state.showArchived && m.archived) return false;
      if (person && m.person !== person) return false;
      if (status && m.status !== status) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderMedicinesPage() {
    const items = getFilteredMedicines();
    if (!items.length) {
      els.medicinesBody2.innerHTML = '<tr><td colspan="7" class="empty">لا توجد نتائج</td></tr>';
      return;
    }
    els.medicinesBody2.innerHTML = items.map((m) => {
      const qty = m.quantity === null ? '—' : m.quantity;
      const archivedTag = m.archived ? ' <span class="badge unregistered">مؤرشف</span>' : '';
      return `
        <tr>
          <td>${escapeHtml(m.name)}${archivedTag}</td>
          <td>${escapeHtml(m.person)}</td>
          <td>${qty}</td>
          <td>${m.stripsPerBox}</td>
          <td>${m.lowStockThreshold}</td>
          <td><span class="${statusClass(m.status)}">${escapeHtml(m.statusLabel)}</span></td>
          <td class="row-actions">
            <button class="btn small primary" data-action="purchase" data-id="${m.id}">شراء</button>
            <button class="btn small" data-action="use" data-id="${m.id}">استخدام</button>
            <button class="btn small ghost" data-action="details" data-id="${m.id}">تفاصيل</button>
            <button class="btn small ghost" data-action="edit" data-id="${m.id}">تعديل</button>
            <button class="btn small ghost" data-action="archive" data-id="${m.id}">${m.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</button>
          </td>
        </tr>
      `;
    }).join('');

    els.medicinesBody2.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handlePageAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleRowAction(action, id) {
    const med = state.medicines.find((m) => m.id === id);
    if (!med) return;
    if (action === 'use') return useStrip(med);
    if (action === 'purchase') return purchaseModal(med);
    if (action === 'details') return detailsModal(med);
  }

  async function handlePageAction(action, id) {
    const med = state.medicines.find((m) => m.id === id);
    if (!med) return;
    if (action === 'use') return useStrip(med);
    if (action === 'purchase') return purchaseModal(med);
    if (action === 'details') return detailsModal(med);
    if (action === 'edit') return editModal(med);
    if (action === 'archive') return archiveConfirm(med);
  }

  function archiveConfirm(med) {
    const willArchive = !med.archived;
    openModal(`
      <h3>${willArchive ? 'أرشفة' : 'إلغاء أرشفة'}: ${escapeHtml(med.name)}</h3>
      <p>${willArchive ? 'سيتم إخفاء العلاج من القوائم النشطة، ويمكن استرجاعه لاحقًا.' : 'سيتم إرجاع العلاج للقوائم النشطة.'}</p>
      <div class="modal-actions">
        <button class="btn" id="cancelBtn">إلغاء</button>
        <button class="btn primary" id="confirmBtn">تأكيد</button>
      </div>
    `);
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('confirmBtn').onclick = async () => {
      try {
        await api(`/api/medicines/${med.id}/archive`, {
          method: 'POST',
          body: JSON.stringify({ archived: willArchive })
        });
        closeModal();
        toast(willArchive ? 'تمت الأرشفة' : 'تم إلغاء الأرشفة', 'success');
        await refreshAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  async function useStrip(med) {
    if (med.quantity === null) {
      toast('لم يتم تسجيل المخزون لهذا العلاج', 'error');
      return;
    }
    if (med.quantity <= 0) {
      toast('العلاج خلص، سجّل عملية شراء أولاً', 'error');
      return;
    }
    openModal(`
      <h3>تأكيد استخدام شريط</h3>
      <p>هل تريد استخدام شريط واحد من <b>${escapeHtml(med.name)}</b>؟</p>
      <div class="modal-actions">
        <button class="btn" id="cancelBtn">إلغاء</button>
        <button class="btn primary" id="confirmBtn">تأكيد</button>
      </div>
    `);
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('confirmBtn').onclick = async () => {
      try {
        await api(`/api/medicines/${med.id}/use`, {
          method: 'POST',
          body: JSON.stringify({ count: 1 })
        });
        closeModal();
        toast('تم استخدام شريط', 'success');
        await refreshAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function purchaseModal(med) {
    openModal(`
      <h3>شراء علاج: ${escapeHtml(med.name)}</h3>
      <form id="purchaseForm">
        <label>نوع الشراء
          <select id="purchaseType">
            <option value="box">علبة</option>
            <option value="strips">شرايط</option>
          </select>
        </label>
        <label>الكمية
          <input type="number" id="purchaseQty" min="1" value="1" required />
        </label>
        <label>تاريخ الشراء
          <input type="date" id="purchaseDate" />
        </label>
        <label>السعر (اختياري)
          <input type="number" id="purchasePrice" min="0" step="0.01" />
        </label>
        <label>ملاحظات (اختياري)
          <input type="text" id="purchaseNotes" maxlength="500" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelBtn">إلغاء</button>
          <button type="submit" class="btn primary">تأكيد الشراء</button>
        </div>
      </form>
    `);
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('purchaseForm').onsubmit = async (e) => {
      e.preventDefault();
      const purchaseType = document.getElementById('purchaseType').value;
      const quantity = parseInt(document.getElementById('purchaseQty').value, 10);
      const priceRaw = document.getElementById('purchasePrice').value;
      const price = priceRaw === '' ? null : parseFloat(priceRaw);
      const notes = document.getElementById('purchaseNotes').value;
      const purchaseDate = document.getElementById('purchaseDate').value || null;

      if (!quantity || quantity < 1) return toast('الكمية غير صحيحة', 'error');

      try {
        const result = await api(`/api/medicines/${med.id}/purchase`, {
          method: 'POST',
          body: JSON.stringify({ purchaseType, quantity, price, notes, purchaseDate })
        });
        closeModal();
        toast(`تمت إضافة ${result.stripsAdded} شريط. الإجمالي الآن ${result.after}`, 'success');
        await refreshAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  async function detailsModal(med) {
    try {
      const d = await api(`/api/medicines/${med.id}`);
      const qty = d.quantity === null ? '—' : d.quantity;
      const boxes = d.completeBoxes === null ? '—' : d.completeBoxes;
      const leftover = d.leftoverStrips === null ? '—' : d.leftoverStrips;
      const historyRows = d.history.map((h) => `
        <tr>
          <td>${h.createdAt ? new Date(h.createdAt).toLocaleString('ar-EG') : '—'}</td>
          <td>${escapeHtml(h.type)}</td>
          <td>${h.quantityChange}</td>
          <td>${h.quantityAfter}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" class="empty">لا يوجد سجل</td></tr>';

      openModal(`
        <h3>تفاصيل: ${escapeHtml(d.name)}</h3>
        <p>الشخص: <b>${escapeHtml(d.person)}</b></p>
        <p>الكمية الحالية: <b>${qty}</b> شريط</p>
        <p>عدد الشرايط بالعلبة: <b>${d.stripsPerBox}</b></p>
        <p>العلب الكاملة المكافئة: <b>${boxes}</b> (وباقي ${leftover} شريط)</p>
        <p>حد المخزون القليل: <b>${d.lowStockThreshold}</b></p>
        <p class="hint">هذه حسابات تعبئة مكافئة وليست بالضرورة علب مغلقة فعلية.</p>

        <h4>آخر الحركات</h4>
        <table class="table small">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>التغيير</th><th>بعد</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>

        <div class="modal-actions">
          <button class="btn" id="cancelBtn">إغلاق</button>
          <button class="btn primary" id="editBtn">تعديل الإعدادات</button>
        </div>
      `);
      document.getElementById('cancelBtn').onclick = closeModal;
      document.getElementById('editBtn').onclick = () => editModal(d);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function editModal(med) {
    openModal(`
      <h3>تعديل إعدادات: ${escapeHtml(med.name)}</h3>
      <form id="editForm">
        <label>اسم العلاج <input type="text" id="editName" value="${escapeHtml(med.name)}" required /></label>
        <label>الشخص <input type="text" id="editPerson" value="${escapeHtml(med.person)}" required /></label>
        <label>عدد الشرايط بالعلبة <input type="number" id="editSpb" min="1" value="${med.stripsPerBox}" required /></label>
        <label>حد المخزون القليل <input type="number" id="editLst" min="0" value="${med.lowStockThreshold}" required /></label>
        <label>ملاحظات <input type="text" id="editNotes" maxlength="500" value="${escapeHtml(med.notes || '')}" /></label>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelBtn">إلغاء</button>
          <button type="submit" class="btn primary">حفظ</button>
        </div>
      </form>
    `);
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('editForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/medicines/${med.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: document.getElementById('editName').value.trim(),
            person: document.getElementById('editPerson').value.trim(),
            stripsPerBox: parseInt(document.getElementById('editSpb').value, 10),
            lowStockThreshold: parseInt(document.getElementById('editLst').value, 10),
            notes: document.getElementById('editNotes').value
          })
        });
        closeModal();
        toast('تم الحفظ', 'success');
        await refreshAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function addMedicineModal() {
    openModal(`
      <h3>إضافة علاج جديد</h3>
      <form id="addForm">
        <label>اسم العلاج <input type="text" id="addName" required /></label>
        <label>الشخص <input type="text" id="addPerson" required /></label>
        <label>الكمية الحالية (اتركها فارغة إن كانت غير معروفة)
          <input type="number" id="addQty" min="0" />
        </label>
        <label>عدد الشرايط بالعلبة <input type="number" id="addSpb" min="1" value="3" required /></label>
        <label>حد المخزون القليل <input type="number" id="addLst" min="0" value="2" required /></label>
        <label>ملاحظات <input type="text" id="addNotes" maxlength="500" /></label>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelBtn">إلغاء</button>
          <button type="submit" class="btn primary">إضافة</button>
        </div>
      </form>
    `);
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('addForm').onsubmit = async (e) => {
      e.preventDefault();
      const qtyRaw = document.getElementById('addQty').value;
      try {
        await api('/api/medicines', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('addName').value.trim(),
            person: document.getElementById('addPerson').value.trim(),
            quantity: qtyRaw === '' ? null : parseInt(qtyRaw, 10),
            stripsPerBox: parseInt(document.getElementById('addSpb').value, 10),
            lowStockThreshold: parseInt(document.getElementById('addLst').value, 10),
            notes: document.getElementById('addNotes').value
          })
        });
        closeModal();
        toast('تمت الإضافة', 'success');
        await refreshAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  async function loadHistory() {
    try {
      const type = els.filterType.value;
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      const data = await api('/api/history?' + params.toString());
      if (!data.items.length) {
        els.historyBody.innerHTML = '<tr><td colspan="7" class="empty">لا يوجد سجل</td></tr>';
        return;
      }
      els.historyBody.innerHTML = data.items.map((h) => `
        <tr>
          <td>${h.createdAt ? new Date(h.createdAt).toLocaleString('ar-EG') : '—'}</td>
          <td>${escapeHtml(h.medicineName)}</td>
          <td>${escapeHtml(h.person)}</td>
          <td>${escapeHtml(h.type)}</td>
          <td>${h.quantityBefore}</td>
          <td>${h.quantityChange}</td>
          <td>${h.quantityAfter}</td>
        </tr>
      `).join('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function refreshAll() {
    await Promise.all([loadDashboard(), loadMedicines()]);
  }

  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
      const view = link.dataset.view;
      document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
      const target = document.getElementById('view-' + view);
      if (target) target.classList.remove('hidden');
      if (view === 'history') loadHistory();
      els.sidebar.classList.remove('open');
    });
  });

  els.menuToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));
  els.logoutBtn.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.replace('/login');
  });
  els.purchaseBtn.addEventListener('click', () => {
    if (!state.medicines.length) return toast('أضف علاجًا أولاً', 'error');
    const first = state.medicines[0];
    purchaseModal(first);
  });
  els.addMedicineBtn.addEventListener('click', addMedicineModal);
  els.addMedicineBtn2.addEventListener('click', addMedicineModal);
  els.initSeedBtn.addEventListener('click', async () => {
    try {
      await api('/api/init', { method: 'POST' });
      toast('تمت التهيئة', 'success');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  els.refreshHistoryBtn.addEventListener('click', loadHistory);
  els.filterType.addEventListener('change', loadHistory);
  els.searchMedicines.addEventListener('input', renderMedicinesPage);
  els.filterPerson.addEventListener('change', renderMedicinesPage);
  els.filterStatus.addEventListener('change', renderMedicinesPage);
  els.showArchivedToggle.addEventListener('click', () => {
    state.showArchived = !state.showArchived;
    els.showArchivedToggle.textContent = state.showArchived ? 'إخفاء المؤرشفة' : 'عرض المؤرشفة';
    loadMedicines();
  });

  (async function init() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        window.location.replace('/login');
        return;
      }
    } catch {
      window.location.replace('/login');
      return;
    }
    await refreshAll();
  })();
})();
