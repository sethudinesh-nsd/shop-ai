// ---------- View switching ----------
const signinView = document.getElementById('signinView');
const signupView = document.getElementById('signupView');
const goToSignup = document.getElementById('goToSignup');
const goToSignin = document.getElementById('goToSignin');

goToSignup.addEventListener('click', (e) => {
  e.preventDefault();
  signinView.classList.add('hidden');
  signupView.classList.remove('hidden');
  document.title = 'Sign up';
});

goToSignin.addEventListener('click', (e) => {
  e.preventDefault();
  signupView.classList.add('hidden');
  signinView.classList.remove('hidden');
  document.title = 'Sign in';
});

// ---------- Password show/hide (sign up view) ----------
const pwInput = document.getElementById('pwInput');
const togglePw = document.getElementById('togglePw');
const eyeIcon = document.getElementById('eyeIcon');

togglePw.addEventListener('click', () => {
  const isPassword = pwInput.type === 'password';
  pwInput.type = isPassword ? 'text' : 'password';
  eyeIcon.innerHTML = isPassword
    ? '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 1l22 22" stroke-linecap="round"/>'
    : '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>';
});