(function () {
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMessage');

  function setMessage(text, kind) {
    msg.textContent = text || '';
    msg.className = 'message' + (kind ? ' ' + kind : '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMessage('');
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول...';

    try {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage(data.error || 'فشل تسجيل الدخول', 'error');
        btn.disabled = false;
        btn.textContent = 'دخول';
        return;
      }

      setMessage('تم تسجيل الدخول بنجاح', 'success');
      window.location.href = '/dashboard';
    } catch (err) {
      setMessage('تعذر الاتصال بالخادم', 'error');
      btn
