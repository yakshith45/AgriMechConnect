const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const loginSuccess = document.getElementById("loginSuccess");
let loginRedirectStarted = false;

const passwordToggle = document.getElementById("loginPasswordToggle");
const passwordInput = document.getElementById("loginPassword");
if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener("click", () => {
        const showPassword = passwordInput.type === "password";
        passwordInput.type = showPassword ? "text" : "password";
        passwordToggle.textContent = showPassword ? "Hide" : "Show";
        passwordToggle.setAttribute("aria-pressed", String(showPassword));
        passwordInput.focus();
    });
}

if (new URLSearchParams(window.location.search).get("permissionsRefresh") === "required" && loginMessage) {
    loginMessage.className = "form-feedback error";
    loginMessage.textContent = "Your backend could not refresh account permissions. Log in again to load your latest session.";
}

function normalizeUserSession(user) {
    if (!user || typeof user !== "object") {
        return null;
    }

    const rawRole = typeof user.role === "string" ? user.role.trim().toLowerCase() : "";
    if (!["farmer", "owner"].includes(rawRole)) {
        return null;
    }

    return {
        ...user,
        role: rawRole,
        permitted_roles: [rawRole],
        allowed_roles: [rawRole]
    };
}

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (loginRedirectStarted) {
            return;
        }

        const message = loginMessage;
        const submitButton = document.getElementById("loginSubmitBtn");
        if (!message || !submitButton) {
            return;
        }

        const originalButtonText = submitButton.textContent;
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;

        submitButton.disabled = true;
        submitButton.textContent = "Logging in...";
        message.className = "form-feedback";
        message.textContent = "";

        try {
            const data = await AgriMachApi.request("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });

            const sessionUser = normalizeUserSession(data?.user);
            if (!data?.token || !sessionUser) {
                message.className = "form-feedback error";
                message.textContent = "The server returned an incomplete account session. Please try again.";
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
                return;
            }

            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(sessionUser));
            localStorage.removeItem("rolePermissionsToken");

            loginRedirectStarted = true;
            submitButton.textContent = "Redirecting to dashboard...";

            if (loginSuccess) {
                loginSuccess.hidden = false;
            }

            window.setTimeout(() => {
                if (sessionUser.role === "owner") {
                    window.location.assign("/pages/owner/owner-dashboard.html");
                } else {
                    window.location.assign("/pages/farmer/farmer-dashboard.html");
                }
            }, 900);
        } catch (error) {
            console.error("Login request failed:", error);
            message.className = "form-feedback error";
            message.textContent = error instanceof Error
                ? error.message
                : "Login could not be completed.";
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    });
}
