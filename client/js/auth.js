// ============================================================
// Authentication Module
// ============================================================
// Xử lý đăng nhập, đăng ký, quên mật khẩu với Firebase Auth.
// Chuyển hướng đến dashboard.html sau khi đăng nhập thành công.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM Elements ──
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const resetForm = document.getElementById('reset-form');

  const showRegisterLink = document.getElementById('show-register');
  const showLoginLink = document.getElementById('show-login');
  const showResetLink = document.getElementById('show-reset');
  const showLoginFromReset = document.getElementById('show-login-from-reset');

  const loginMessage = document.getElementById('login-message');
  const registerMessage = document.getElementById('register-message');
  const resetMessage = document.getElementById('reset-message');

  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  const resetBtn = document.getElementById('reset-btn');

  // ── Kiểm tra trạng thái đăng nhập ──
  auth.onAuthStateChanged((user) => {
    if (user) {
      // Đã đăng nhập → chuyển đến Dashboard
      window.location.href = '/dashboard';
    }
  });

  // ── Chuyển đổi giữa các form ──
  if (showRegisterLink) {
    showRegisterLink.addEventListener('click', (e) => {
      e.preventDefault();
      toggleForms('register');
    });
  }

  if (showLoginLink) {
    showLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      toggleForms('login');
    });
  }

  if (showResetLink) {
    showResetLink.addEventListener('click', (e) => {
      e.preventDefault();
      toggleForms('reset');
    });
  }

  if (showLoginFromReset) {
    showLoginFromReset.addEventListener('click', (e) => {
      e.preventDefault();
      toggleForms('login');
    });
  }

  /**
   * Hiện/ẩn các form Login, Register, Reset.
   * @param {'login'|'register'|'reset'} formName
   */
  function toggleForms(formName) {
    const forms = {
      login: document.getElementById('login-section'),
      register: document.getElementById('register-section'),
      reset: document.getElementById('reset-section'),
    };

    Object.keys(forms).forEach((key) => {
      if (forms[key]) {
        forms[key].classList.toggle('hidden', key !== formName);
      }
    });

    // Clear messages
    clearMessages();
  }

  function clearMessages() {
    [loginMessage, registerMessage, resetMessage].forEach((el) => {
      if (el) {
        el.textContent = '';
        el.className = 'form-message';
      }
    });
  }

  /**
   * Hiển thị thông báo trên form.
   */
  function showMessage(element, text, type = 'error') {
    if (!element) return;
    element.textContent = text;
    element.className = `form-message ${type}`;
  }

  /**
   * Set trạng thái loading cho button.
   */
  function setLoading(button, isLoading, originalText) {
    if (!button) return;
    if (isLoading) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Đang xử lý...';
    } else {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  // ══════════════════════════════════════════
  // ĐĂNG NHẬP
  // ══════════════════════════════════════════
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();

      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      if (!email || !password) {
        showMessage(loginMessage, 'Vui lòng nhập đầy đủ email và mật khẩu.');
        return;
      }

      setLoading(loginBtn, true, 'Đăng nhập');

      try {
        await auth.signInWithEmailAndPassword(email, password);
        showMessage(loginMessage, 'Đăng nhập thành công! Đang chuyển hướng...', 'success');
        // onAuthStateChanged sẽ tự redirect
      } catch (error) {
        const errorMessages = {
          'auth/user-not-found': 'Tài khoản không tồn tại.',
          'auth/wrong-password': 'Mật khẩu không đúng.',
          'auth/invalid-email': 'Email không hợp lệ.',
          'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau.',
          'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
        };
        showMessage(loginMessage, errorMessages[error.code] || `Lỗi: ${error.message}`);
      } finally {
        setLoading(loginBtn, false, 'Đăng nhập');
      }
    });
  }

  // ══════════════════════════════════════════
  // ĐĂNG KÝ
  // ══════════════════════════════════════════
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();

      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const confirmPassword = document.getElementById('register-confirm').value;

      if (!email || !password || !confirmPassword) {
        showMessage(registerMessage, 'Vui lòng điền đầy đủ thông tin.');
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

      setLoading(registerBtn, true, 'Đăng ký');

      try {
        await auth.createUserWithEmailAndPassword(email, password);
        showMessage(registerMessage, 'Đăng ký thành công! Đang chuyển hướng...', 'success');
        // onAuthStateChanged sẽ tự redirect
      } catch (error) {
        const errorMessages = {
          'auth/email-already-in-use': 'Email này đã được sử dụng.',
          'auth/invalid-email': 'Email không hợp lệ.',
          'auth/weak-password': 'Mật khẩu quá yếu. Cần ít nhất 6 ký tự.',
        };
        showMessage(registerMessage, errorMessages[error.code] || `Lỗi: ${error.message}`);
      } finally {
        setLoading(registerBtn, false, 'Đăng ký');
      }
    });
  }

  // ══════════════════════════════════════════
  // QUÊN MẬT KHẨU
  // ══════════════════════════════════════════
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();

      const email = document.getElementById('reset-email').value.trim();

      if (!email) {
        showMessage(resetMessage, 'Vui lòng nhập email.');
        return;
      }

      setLoading(resetBtn, true, 'Gửi email khôi phục');

      try {
        await auth.sendPasswordResetEmail(email);
        showMessage(
          resetMessage,
          'Đã gửi email khôi phục mật khẩu! Kiểm tra hộp thư của bạn.',
          'success'
        );
      } catch (error) {
        const errorMessages = {
          'auth/user-not-found': 'Email không tồn tại trong hệ thống.',
          'auth/invalid-email': 'Email không hợp lệ.',
        };
        showMessage(resetMessage, errorMessages[error.code] || `Lỗi: ${error.message}`);
      } finally {
        setLoading(resetBtn, false, 'Gửi email khôi phục');
      }
    });
  }
});
