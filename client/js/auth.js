document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const resetForm = document.getElementById('reset-form');
  const loginMessage = document.getElementById('login-message');
  const registerMessage = document.getElementById('register-message');
  const resetMessage = document.getElementById('reset-message');
  let registering = false;

  function showSection(name) {
    for (const sectionName of ['login', 'register', 'reset']) {
      const section = document.getElementById(`${sectionName}-section`);
      if (section) section.classList.toggle('hidden', sectionName !== name);
    }
    for (const message of [loginMessage, registerMessage, resetMessage]) {
      if (message) message.className = 'form-message';
    }
  }

  function showMessage(element, text, type = 'error') {
    if (!element) return;
    element.textContent = text;
    element.className = `form-message ${type}`;
  }

  function setLoading(button, loading, originalText) {
    if (!button) return;
    button.disabled = loading;
    if (loading) {
      button.innerHTML = '<span class="spinner"></span> Đang xử lý...';
    } else {
      button.textContent = originalText;
    }
  }

  async function routeAuthenticatedUser(user) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/device/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showMessage(loginMessage, data.error || 'Tài khoản chưa có hồ sơ hợp lệ. Vui lòng thử lại.');
        await auth.signOut();
        return;
      }
      window.location.href = '/dashboard';
    } catch (error) {
      showMessage(loginMessage, `Không thể kiểm tra hồ sơ: ${error.message}`);
      await auth.signOut();
    }
  }

  document.getElementById('show-register')?.addEventListener('click', (event) => {
    event.preventDefault();
    showSection('register');
  });
  document.getElementById('show-login')?.addEventListener('click', (event) => {
    event.preventDefault();
    showSection('login');
  });
  document.getElementById('show-reset')?.addEventListener('click', (event) => {
    event.preventDefault();
    showSection('reset');
  });
  document.getElementById('show-login-from-reset')?.addEventListener('click', (event) => {
    event.preventDefault();
    showSection('login');
  });

  auth.onAuthStateChanged((user) => {
    if (user && !registering) {
      routeAuthenticatedUser(user).catch((error) => {
        showMessage(loginMessage, `Không thể kiểm tra hồ sơ: ${error.message}`);
      });
    }
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('login-btn');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    setLoading(button, true, 'Đăng nhập');

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      const messages = {
        'auth/invalid-email': 'Email không hợp lệ.',
        'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
        'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau.',
      };
      showMessage(loginMessage, messages[error.code] || error.message);
    } finally {
      setLoading(button, false, 'Đăng nhập');
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('register-btn');
    const productCode = document.getElementById('register-product-code').value.trim().toUpperCase();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm').value;

    if (!productCode || productCode.length !== 6) {
      showMessage(registerMessage, 'Mã sản phẩm phải gồm 6 ký tự.');
      return;
    }
    if (password.length < 6) {
      showMessage(registerMessage, 'Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      showMessage(registerMessage, 'Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(button, true, 'Đăng ký');
    registering = true;
    let createdUser = null;
    try {
      const validateResponse = await fetch('/api/product/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode }),
      });
      const validateData = await validateResponse.json();
      if (!validateData.valid) {
        showMessage(registerMessage, 'Mã sản phẩm không hợp lệ.');
        return;
      }

      const credential = await auth.createUserWithEmailAndPassword(email, password);
      createdUser = credential.user;
      const idToken = await createdUser.getIdToken();
      const profileRes = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ productCode }),
      });
      const profileData = await profileRes.json();
      if (!profileRes.ok || !profileData.success) {
        throw new Error(profileData.error || 'Không thể tạo hồ sơ tài khoản.');
      }
      await auth.signOut();
      showMessage(
        registerMessage,
        'Đăng ký thành công! Bạn có thể đăng nhập ngay.',
        'success'
      );
      registerForm.reset();
    } catch (error) {
      if (createdUser) {
        await createdUser.delete().catch(() => auth.signOut());
      }
      const messages = {
        'auth/email-already-in-use': 'Email này đã được sử dụng.',
        'auth/invalid-email': 'Email không hợp lệ.',
        'auth/weak-password': 'Mật khẩu chưa đủ mạnh.',
      };
      showMessage(registerMessage, messages[error.code] || error.message);
    } finally {
      registering = false;
      setLoading(button, false, 'Đăng ký');
    }
  });

  resetForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('reset-btn');
    const email = document.getElementById('reset-email').value.trim();
    setLoading(button, true, 'Gửi email khôi phục');

    try {
      await auth.sendPasswordResetEmail(email);
      showMessage(resetMessage, 'Đã gửi email khôi phục mật khẩu.', 'success');
    } catch (error) {
      showMessage(resetMessage, error.code === 'auth/invalid-email' ? 'Email không hợp lệ.' : error.message);
    } finally {
      setLoading(button, false, 'Gửi email khôi phục');
    }
  });
});
