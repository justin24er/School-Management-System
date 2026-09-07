const registerShift = document.getElementById("register-shift");
const loginShift = document.getElementById("login-shift");
const registrationSection = document.querySelector(".registration-section");
const loginSection = document.querySelector(".login-section");
const closeBtn = document.querySelectorAll(".close-btn");
const checkbox1 = document.getElementById("showpasswd1");
const checkbox2 = document.getElementById("showpasswd2");
const registerInputPasswd = document.querySelectorAll(".input-passwd");
const loginInputPasswd = document.getElementById("input-passwd2");
const notify = document.querySelector(".notify");

const schoolLogo = document.getElementById("school-logo-input");
const logoImg = document.getElementById("school-logo");
const schoolName = document.getElementById("school-name-input");
const usernameInput = document.getElementById("username-input");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const confirmInput = document.getElementById("confirm-input");
const errorDisplay = document.querySelector(".registration-section .error-display");
const successDisplay = document.querySelector(".registration-section .success-display");

registerShift.addEventListener("click", () => {
    registrationSection.classList.toggle("display");
    loginSection.classList.toggle("display");
});

loginShift.addEventListener("click", () => {
    registrationSection.classList.toggle("display");
    loginSection.classList.toggle("display");
});

/*-------------------------- SCHOOL LOGO PREVIEW ----------------------*/
schoolLogo.addEventListener("change", function () {
    if (!schoolLogo.files[0]) return;
    logoImg.src = URL.createObjectURL(schoolLogo.files[0]);
    logoImg.style.zIndex = '100';
    notify.setAttribute("aria-hidden", "false");
    setTimeout(() => notify.setAttribute("aria-hidden", "true"), 2000);
});

/*-------------------------- CLOSE BUTTON --------------------------*/
let timer = 1000;
let cancelTimer;
closeBtn.forEach(btn => btn.addEventListener("click", () => {
    loginSection.style.opacity = "0";
    registrationSection.style.opacity = "0";
    clearTimeout(cancelTimer);
    cancelTimer = setTimeout(() => {
        loginSection.style.opacity = "1";
        registrationSection.style.opacity = "1";
    }, timer);
}));

/*---------------------------- SHOW PASSWORD ------------------------ */
checkbox1.addEventListener("change", () => {
    registerInputPasswd.forEach(input => input.type = checkbox1.checked ? "text" : "password");
});
checkbox2.addEventListener("change", () => {
    loginInputPasswd.type = checkbox2.checked ? "text" : "password";
    document.getElementById('mfa-input').type = "text";
});

/*----------------------------- TRIAL SIGNUP --------------------------------*/
document.getElementById("trial-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    errorDisplay.textContent = "";
    successDisplay.textContent = "";

    if (!schoolName.value || !usernameInput.value || !emailInput.value || !passwordInput.value || !confirmInput.value) {
        errorDisplay.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Please fill in all required fields.`;
        return;
    }
    if (passwordInput.value !== confirmInput.value) {
        errorDisplay.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Passwords do not match.`;
        return;
    }

    const submitBtn = e.target.querySelector('.register-btn');
    submitBtn.disabled = true;
    try {
        await API.post('/api/onboarding/start-trial', {
            schoolName: schoolName.value,
            ownerUsername: usernameInput.value,
            ownerEmail: emailInput.value,
            password: passwordInput.value,
        });
        successDisplay.textContent = "Your trial has started. You can log in now.";
        setTimeout(() => {
            registrationSection.classList.add("display");
            loginSection.classList.remove("display");
            document.getElementById('login-input').value = emailInput.value;
        }, 1200);
    } catch (err) {
        errorDisplay.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message}`;
    } finally {
        submitBtn.disabled = false;
    }
});

/*----------------------------- LOGIN --------------------------------*/
const loginErrorDisplay = document.getElementById('login-error');
const mfaField = document.getElementById('mfa-field');

document.getElementById("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    loginErrorDisplay.textContent = "";

    const submitBtn = e.target.querySelector('.register-btn');
    submitBtn.disabled = true;
    try {
        const result = await API.post('/api/auth/login', {
            login: document.getElementById('login-input').value,
            password: document.getElementById('input-passwd2').value,
            mfaCode: document.getElementById('mfa-input').value,
        });
        window.location.href = result.redirectTo || '/dashboards/head-teacher.html';
    } catch (err) {
        if (err.body && err.body.mfaRequired) {
            mfaField.classList.add('show');
            loginErrorDisplay.textContent = "Enter the 6-digit code from your authenticator app.";
        } else {
            loginErrorDisplay.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message}`;
        }
    } finally {
        submitBtn.disabled = false;
    }
});

/*----------------------------- FORGOT PASSWORD --------------------------------*/
document.getElementById('forgot-link').addEventListener('click', async () => {
    const email = prompt('Enter the email address on your account:');
    if (!email) return;
    try {
        const res = await API.post('/api/auth/forgot-password', { email });
        alert(res.message);
    } catch (err) {
        alert(err.message);
    }
});

/*----------------------------- SESSION EXPIRED NOTICE --------------------------------*/
if (new URLSearchParams(window.location.search).get('sessionExpired')) {
    loginErrorDisplay.textContent = 'Your session has ended. Please log in again.';
}
