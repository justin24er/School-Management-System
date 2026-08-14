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
const loginBtn = document.querySelector(".login-btn");

const schoolLogo = document.getElementById("school-logo-input");
const logoImg = document.getElementById("school-logo");
const schoolName = document.getElementById("school-name-input");
const roleInput = document.getElementById("role-select-input");
const usernameInput = document.getElementById("username-input");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const confirmInput = document.getElementById("confirm-input");
const errorDisplay = document.querySelector(".error-display")



registerShift.addEventListener("click", function() {
    registrationSection.classList.toggle("display");
    loginSection.classList.toggle("display");
});

loginShift.addEventListener("click", () => {
    registrationSection.classList.toggle("display");
    loginSection.classList.toggle("display")
});


/*--------------------------SCHOOL LOGO PROFILE HANDLING----------------------*/
schoolLogo.addEventListener("change", function(){
     logoImg.src = URL.createObjectURL(schoolLogo.files[0]);
     logoImg.style.zIndex = '100';

     notify.setAttribute("aria-hidden", "false");
     setTimeout(() => {
        notify.setAttribute("aria-hidden", "true");
    },2000)
});
/*--------------------------SCHOOL LOGO PROFILE ENDS HERE---------------------*/

/*-------------------------- CLOSE BUTTON SECTION --------------------------*/
let timer = 1000;
let cancelTimer

closeBtn.forEach(btn => btn.addEventListener("click", () => {
    loginSection.style.opacity = "0";
    registrationSection.style.opacity = "0";
    clearTimeout(cancelTimer);

    cancelTimer = setTimeout(() => {
        loginSection.style.opacity = "1";
        registrationSection.style.opacity = "1";
    },timer)

})
);
/*---------------------------- CLOSE BUTTON ENDS HERE ---------------------------*/



/*---------------------------- CHECKBOX OPERATION SECTION------------------------ */

checkbox1.addEventListener("change", function() {
    registerInputPasswd.forEach(input => 
        input.type = checkbox1.checked? "text": "password"
    )
});

checkbox2.addEventListener("change", () => {
    loginInputPasswd.type = checkbox2.checked? "text": "password"
});

/*----------------------------- CHECKBOX OPERATION ENDS HERE-----------------------*/

/*----------------------------- BUTTON LOGIN IMPLEMENTATION------------------------*/
const originalContent = loginBtn.innerHTML;

loginBtn.addEventListener("mouseenter", displayIcon);
function displayIcon() {
    loginBtn.innerHTML = "";
    loginBtn.innerHTML = `Login <i class="fa-solid fa-person-running"></i>`;
}

loginBtn.addEventListener("mouseleave", removeIcon);
function removeIcon() {
    loginBtn.innerHTML = "";
    loginBtn.innerHTML = originalContent;
}
/*------------------------------BUTTON LOGIN ENDS HERE------------------------------*/


/*----------------------------- REGISTRATION HANDLING--------------------------------*/
registrationSection.firstElementChild.addEventListener("submit", handleRegistration);

function handleRegistration() {
    // check for empty inputs 
    if(!schoolLogo.files[0] ||
        schoolName.value === "" ||
        roleInput.value === "" ||
        usernameInput.value === "" ||
        emailInput.value === ""  ||
        passwordInput.value === "" ||
        confirmInput.value === "" 
    ) {
        errorDisplay.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> fill all the credentials`;
        setTimeout(() => {
            errorDisplay.innerHTML = "";
        },2000)        


    }
}
/*--THERE COMES A FULL AMMENDMENTS SECTION FROM SHOES PROJECT--*/