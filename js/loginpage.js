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
  resetSignin();
});

goToSignin.addEventListener('click', (e) => {
  e.preventDefault();
  signupView.classList.add('hidden');
  signinView.classList.remove('hidden');
  document.title = 'Sign in';
  resetSignup();
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

// ==========================================================================
// CLERK AUTHENTICATION
// ==========================================================================
// Each flow (sign in / sign up) is a small explicit state machine:
//   currentStep + render(step) fully re-renders the dynamic parts of the
// form for that step (the .stack-extra container + submit button label),
// instead of patching the DOM piecemeal. This makes it safe to move
// forward/back through steps without stray leftover fields.
//
// Errors and info messages always render into the reserved #signin/signupErrorArea
// below the "Sign up" / "Sign in" footer switch-line -- never inside .stack --
// so the form, buttons, and footer never move position.

const HOME_URL = 'index.html';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClerk() {
  return window.ShopAIAuth.ready;
}

function showMessage(areaId, message, kind) {
  const area = document.getElementById(areaId);
  if (!area) return;
  area.innerHTML = '';
  const el = document.createElement('p');
  el.className = `auth-message ${kind === 'info' ? 'is-info' : 'is-error'}`;
  el.textContent = message;
  area.appendChild(el);
}

function clearMessage(areaId) {
  const area = document.getElementById(areaId);
  if (area) area.innerHTML = '';
}

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    // Capture whatever label is currently showing -- not just once via `||`,
    // which previously froze this at the very first busy call ("Create
    // account") and made every later step revert to that stale text.
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel || 'Please wait…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

// Never surface a raw Clerk error to the user. Map known error codes to
// clean copy; anything unrecognized falls back to a generic message.
function friendlyErrorMessage(err, fallback) {
  const code = err && err.errors && err.errors[0] && err.errors[0].code;
  switch (code) {
    case 'form_identifier_not_found':
      return "We couldn't find an account with this email. Please sign up first.";
    case 'form_password_incorrect':
      return 'Incorrect password. Please try again.';
    case 'form_code_incorrect':
      return 'That code is incorrect or expired.';
    case 'form_identifier_exists':
      return 'An account with this email already exists. Please sign in instead.';
    case 'form_param_format_invalid':
      return 'Please enter a valid email address.';
    case 'strategy_for_user_invalid':
    case 'form_param_unknown':
    case 'identification_claimed':
      // The email_code strategy was reported as supported but rejected --
      // most likely a Clerk Dashboard setting (see summary in chat).
      return 'Email verification code isn\u2019t available for this account right now. Please use Continue with Google instead.';
    default:
      return fallback;
  }
}

// Builds one .field.input-field row matching the existing markup exactly.
function buildFieldRow({ id, type, placeholder, iconPath, value, locked }) {
  const field = document.createElement('div');
  field.className = 'field input-field' + (locked ? ' is-locked' : '');

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a9a96" stroke-width="1.8">${iconPath}</svg>`;
  field.appendChild(icon);

  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.placeholder = placeholder;
  if (value !== undefined) input.value = value;
  if (locked) input.disabled = true;
  field.appendChild(input);

  return { field, input };
}

function buildButton({ text, className }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  return btn;
}

const LOCK_ICON = '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>';
const CODE_ICON = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9h8M8 13h5"/>';

// If a session already exists, skip straight to Home.
(async () => {
  try {
    const clerk = await getClerk();
    if (clerk.isSignedIn) {
      window.location.href = HOME_URL;
    }
  } catch (err) {
    console.error('Clerk failed to load:', err);
  }
})();

// ==========================================================================
// SIGN IN state machine
//   steps: 'email' -> 'password' | 'google-only' -> 'code'
// ==========================================================================
const signinEmailInput = signinView.querySelector('.field.input-field input[type="email"]');
const signinExtra = document.getElementById('signinExtra');
const signinSubmitBtn = signinView.querySelector('.btn-primary');

let signinStep = 'email';
let signinEmail = '';
let signinEmailCodeFactor = null; // { strategy: 'email_code', emailAddressId } when available

function resetSignin() {
  signinStep = 'email';
  signinEmail = '';
  signinEmailCodeFactor = null;
  signinEmailInput.value = '';
  signinEmailInput.disabled = false;
  signinEmailInput.closest('.field').classList.remove('is-locked');
  signinExtra.innerHTML = '';
  signinSubmitBtn.textContent = 'Continue';
  setBusy(signinSubmitBtn, false);
  delete signinSubmitBtn.dataset.originalLabel;
  clearMessage('signinErrorArea');
}

function renderSigninStep() {
  signinExtra.innerHTML = '';
  const isEmailStep = signinStep === 'email';
  signinEmailInput.disabled = !isEmailStep;
  signinEmailInput.closest('.field').classList.toggle('is-locked', !isEmailStep);

  if (signinStep === 'email') {
    signinSubmitBtn.textContent = 'Continue';
    signinSubmitBtn.style.display = '';
    return;
  }

  if (signinStep === 'password') {
    const { field, input } = buildFieldRow({
      id: 'signinPwInput',
      type: 'password',
      placeholder: 'Enter your password',
      iconPath: LOCK_ICON,
    });
    signinExtra.appendChild(field);
    signinSubmitBtn.textContent = 'Sign in';
    signinSubmitBtn.style.display = '';
    input.focus();
    return;
  }

  if (signinStep === 'google-only') {
    const info = document.createElement('p');
    info.className = 'info-text';
    info.textContent = 'Your account uses Google sign-in.';
    signinExtra.appendChild(info);

    const continueWithGoogle = buildButton({ text: 'Continue with Google', className: 'btn-secondary' });
    continueWithGoogle.addEventListener('click', () => startGoogleOAuth('signin'));
    signinExtra.appendChild(continueWithGoogle);

    if (signinEmailCodeFactor && signinEmailCodeFactor.emailAddressId) {
      const sendCode = buildButton({ text: 'Send verification code', className: 'btn-secondary' });
      sendCode.addEventListener('click', handleSendSigninCode);
      signinExtra.appendChild(sendCode);
    }

    // This step's actions are the buttons above, not the main submit button.
    signinSubmitBtn.style.display = 'none';
    return;
  }

  if (signinStep === 'code') {
    const { field, input } = buildFieldRow({
      id: 'signinCodeInput',
      type: 'text',
      placeholder: 'Enter the 6-digit code',
      iconPath: CODE_ICON,
    });
    input.inputMode = 'numeric';
    signinExtra.appendChild(field);

    const resend = document.createElement('a');
    resend.href = '#';
    resend.textContent = 'Resend code';
    resend.style.cssText = 'display:block;margin-top:2px;font-size:12px;font-weight:600;color:var(--ink);text-decoration:none;';
    resend.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleSendSigninCode({ silent: true });
      showMessage('signinErrorArea', 'A new code has been sent.', 'info');
    });
    signinExtra.appendChild(resend);

    signinSubmitBtn.textContent = 'Verify code';
    signinSubmitBtn.style.display = '';
    input.focus();
    return;
  }
}

async function handleSendSigninCode() {
  clearMessage('signinErrorArea');

  if (!signinEmailCodeFactor || !signinEmailCodeFactor.emailAddressId) {
    // Shouldn't be reachable since the button is only rendered when this
    // is true, but guard anyway rather than sending a malformed request.
    showMessage('signinErrorArea', 'Email verification code isn\u2019t available for this account.', 'error');
    return;
  }

  try {
    const clerk = await getClerk();
    await clerk.client.signIn.prepareFirstFactor({
      strategy: 'email_code',
      emailAddressId: signinEmailCodeFactor.emailAddressId,
    });
    signinStep = 'code';
    renderSigninStep();
  } catch (err) {
    // TEMP DEBUG -- log the actual Clerk error so the real failure code can
    // be identified (e.g. a strategy disabled in the Clerk Dashboard vs. a
    // malformed request). Remove once confirmed against the live instance.
    console.error('[auth debug] prepareFirstFactor(email_code) failed:', err);
    showMessage('signinErrorArea', friendlyErrorMessage(err, 'Could not send a verification code. Please try again.'), 'error');
  }
}

async function handleSigninSubmit() {
  clearMessage('signinErrorArea');

  if (signinStep === 'email') {
    const email = signinEmailInput.value.trim();
    if (!email || !EMAIL_RE.test(email)) {
      showMessage('signinErrorArea', 'Please enter a valid email address.', 'error');
      return;
    }

    setBusy(signinSubmitBtn, true, 'Checking…');
    try {
      const clerk = await getClerk();
      const attempt = await clerk.client.signIn.create({ identifier: email });
      signinEmail = email;

      const factors = attempt.supportedFirstFactors || [];
      const hasPassword = factors.some((f) => f.strategy === 'password');
      signinEmailCodeFactor = factors.find((f) => f.strategy === 'email_code') || null;

      // TEMP DEBUG -- inspect the real shape Clerk returns for this account
      // before assuming email_code is or isn't usable. Remove once confirmed
      // against the live Clerk instance. No sensitive data (no password/code)
      // is logged here.
      console.log('[auth debug] supportedFirstFactors:', factors);
      console.log('[auth debug] email_code factor:', signinEmailCodeFactor);

      signinStep = hasPassword ? 'password' : 'google-only';
      renderSigninStep();
    } catch (err) {
      showMessage('signinErrorArea', friendlyErrorMessage(err, 'Something went wrong. Please try again.'), 'error');
    } finally {
      setBusy(signinSubmitBtn, false);
    }
    return;
  }

  if (signinStep === 'password') {
    const pwField = document.getElementById('signinPwInput');
    const password = pwField ? pwField.value : '';
    if (!password) {
      showMessage('signinErrorArea', 'Enter your password.', 'error');
      return;
    }

    setBusy(signinSubmitBtn, true, 'Signing in…');
    try {
      const clerk = await getClerk();
      const result = await clerk.client.signIn.attemptFirstFactor({ strategy: 'password', password });

      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        window.location.href = HOME_URL;
        return;
      }

      showMessage('signinErrorArea', 'Additional verification is required. Please try again.', 'error');
    } catch (err) {
      showMessage('signinErrorArea', friendlyErrorMessage(err, 'Sign in failed. Please try again.'), 'error');
    } finally {
      setBusy(signinSubmitBtn, false);
    }
    return;
  }

  if (signinStep === 'code') {
    const codeField = document.getElementById('signinCodeInput');
    const code = codeField ? codeField.value.trim() : '';
    if (!code) {
      showMessage('signinErrorArea', 'Enter the code we emailed you.', 'error');
      return;
    }

    setBusy(signinSubmitBtn, true, 'Verifying…');
    try {
      const clerk = await getClerk();
      const result = await clerk.client.signIn.attemptFirstFactor({ strategy: 'email_code', code });

      // TEMP DEBUG -- remove once confirmed against the live Clerk instance.
      console.log('[auth debug] signIn email_code result:', result.status, result.createdSessionId);

      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        window.location.href = HOME_URL;
        return;
      }

      if (result.status === 'needs_second_factor') {
        showMessage('signinErrorArea', 'Your account needs an additional verification step that isn\u2019t supported here yet. Please contact support.', 'error');
        return;
      }

      showMessage('signinErrorArea', 'Verification incomplete. Please check the code and try again.', 'error');
    } catch (err) {
      console.error('[auth debug] signIn attemptFirstFactor(email_code) failed:', err);
      showMessage('signinErrorArea', friendlyErrorMessage(err, 'That code is incorrect or expired.'), 'error');
    } finally {
      setBusy(signinSubmitBtn, false);
    }
    return;
  }
}

signinSubmitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  handleSigninSubmit();
});

// ==========================================================================
// SIGN UP state machine
//   steps: 'details' -> 'verify'
// ==========================================================================
const fullNameInput = document.getElementById('fullNameInput');
const signupEmailInput = signupView.querySelector('input[type="email"]');
const signupExtra = document.getElementById('signupExtra');
const signupSubmitBtn = signupView.querySelector('.btn-primary');

let signupStep = 'details';

function resetSignup() {
  signupStep = 'details';
  fullNameInput.value = '';
  signupEmailInput.value = '';
  pwInput.value = '';
  fullNameInput.closest('.field').style.display = '';
  signupEmailInput.closest('.field').style.display = '';
  pwInput.closest('.field').style.display = '';
  signupExtra.innerHTML = '';
  signupSubmitBtn.textContent = 'Create account';
  setBusy(signupSubmitBtn, false);
  delete signupSubmitBtn.dataset.originalLabel;
  clearMessage('signupErrorArea');
}

function splitFullName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift() || '';
  const lastName = parts.join(' ');
  return { firstName, lastName };
}

async function handleSignupSubmit() {
  clearMessage('signupErrorArea');

  if (signupStep === 'details') {
    const fullName = fullNameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = pwInput.value;

    if (!fullName) {
      showMessage('signupErrorArea', 'Enter your full name.', 'error');
      return;
    }
    if (!email || !EMAIL_RE.test(email)) {
      showMessage('signupErrorArea', 'Please enter a valid email address.', 'error');
      return;
    }
    if (!password) {
      showMessage('signupErrorArea', 'Create a password to continue.', 'error');
      return;
    }

    const { firstName, lastName } = splitFullName(fullName);

    setBusy(signupSubmitBtn, true, 'Creating account…');
    try {
      const clerk = await getClerk();
      const signUpParams = { emailAddress: email, password, firstName };
      if (lastName) signUpParams.lastName = lastName;
      await clerk.client.signUp.create(signUpParams);
      await clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });

      fullNameInput.closest('.field').style.display = 'none';
      signupEmailInput.closest('.field').style.display = 'none';
      pwInput.closest('.field').style.display = 'none';

      signupExtra.innerHTML = '';
      const { field, input } = buildFieldRow({
        id: 'signupCodeInput',
        type: 'text',
        placeholder: 'Enter the 6-digit code',
        iconPath: CODE_ICON,
      });
      input.inputMode = 'numeric';
      signupExtra.appendChild(field);

      const resend = document.createElement('a');
      resend.href = '#';
      resend.textContent = 'Resend code';
      resend.style.cssText = 'display:block;margin-top:2px;font-size:12px;font-weight:600;color:var(--ink);text-decoration:none;';
      resend.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const c = await getClerk();
          await c.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
          showMessage('signupErrorArea', 'A new code has been sent.', 'info');
        } catch (err) {
          showMessage('signupErrorArea', friendlyErrorMessage(err, 'Could not resend the code. Try again shortly.'), 'error');
        }
      });
      signupExtra.appendChild(resend);

      signupSubmitBtn.textContent = 'Verify email';
      signupStep = 'verify';
      input.focus();
    } catch (err) {
      showMessage('signupErrorArea', friendlyErrorMessage(err, 'Could not create your account. Try again.'), 'error');
    } finally {
      setBusy(signupSubmitBtn, false);
    }
    return;
  }

  // signupStep === 'verify'
  const codeField = document.getElementById('signupCodeInput');
  const code = codeField ? codeField.value.trim() : '';
  if (!code) {
    showMessage('signupErrorArea', 'Enter the code we emailed you.', 'error');
    return;
  }

  setBusy(signupSubmitBtn, true, 'Verifying…');
  try {
    const clerk = await getClerk();
    const result = await clerk.client.signUp.attemptEmailAddressVerification({ code });

    // TEMP DEBUG -- inspect the actual SignUp resource Clerk returns after a
    // verification attempt. No sensitive data (no password/code) is logged.
    // Remove once confirmed against the live Clerk instance.
    console.log('[auth debug] signUp verification result:', {
      status: result.status,
      createdSessionId: result.createdSessionId,
      missingFields: result.missingFields,
      unverifiedFields: result.unverifiedFields,
    });

    if (result.status === 'complete') {
      await clerk.setActive({ session: result.createdSessionId });
      window.location.href = HOME_URL;
      return;
    }

    // The code itself was accepted -- Clerk did not throw a code error --
    // so it would be wrong to tell the user their OTP was incorrect. If the
    // account is missing other requirements, say so plainly instead of
    // blaming the code.
    if (result.status === 'missing_requirements') {
      const missing = (result.missingFields && result.missingFields.length)
        ? result.missingFields.join(', ')
        : 'additional information';
      console.warn('[auth debug] Signup requires fields beyond email verification:', result.missingFields, result.unverifiedFields);
      showMessage(
        'signupErrorArea',
        `Your email was verified, but your account needs ${missing} to finish setting up. Please contact support.`,
        'error'
      );
      return;
    }

    showMessage(
      'signupErrorArea',
      'Your email was verified, but we couldn\u2019t finish creating your account. Please try again or contact support.',
      'error'
    );
  } catch (err) {
    console.error('[auth debug] attemptEmailAddressVerification failed:', err);
    showMessage('signupErrorArea', friendlyErrorMessage(err, 'That code is incorrect or expired.'), 'error');
  } finally {
    setBusy(signupSubmitBtn, false);
  }
}

signupSubmitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  handleSignupSubmit();
});

// ==========================================================================
// GOOGLE OAUTH
// ==========================================================================
const googleBtnSignin = document.getElementById('googleBtnSignin');
const googleBtnSignup = document.getElementById('googleBtnSignup');

async function startGoogleOAuth(view) {
  try {
    const clerk = await getClerk();
    const redirectUrl = new URL('sso-callback.html', window.location.href).toString();
    const redirectUrlComplete = new URL(HOME_URL, window.location.href).toString();

    if (view === 'signin') {
      await clerk.client.signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl,
        redirectUrlComplete,
      });
    } else {
      await clerk.client.signUp.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl,
        redirectUrlComplete,
      });
    }
  } catch (err) {
    const areaId = view === 'signin' ? 'signinErrorArea' : 'signupErrorArea';
    showMessage(areaId, friendlyErrorMessage(err, 'Google sign-in failed. Try again.'), 'error');
  }
}

if (googleBtnSignin) {
  googleBtnSignin.addEventListener('click', () => startGoogleOAuth('signin'));
}
if (googleBtnSignup) {
  googleBtnSignup.addEventListener('click', () => startGoogleOAuth('signup'));
}