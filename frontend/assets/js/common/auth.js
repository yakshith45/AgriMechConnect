const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const message = document.getElementById("registerMessage");
        const submitButton = document.getElementById("registerSubmitBtn");
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = "Setting up account...";
        message.className = "form-feedback";
        message.textContent = "";

        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const phone = document.getElementById("phone").value.trim();
        const password = document.getElementById("password").value;
        const role = document.getElementById("role").value || "farmer";

        try {
            const data = await AgriMachApi.request("/auth/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ name, email, phone, password, role })
            });
            message.className = "form-feedback success";
            message.textContent = "Account created! Confirm your location to continue.";

            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));

            setTimeout(() => {
                window.location.href = "/pages/auth/select-role-location.html";
            }, 800);
        } catch (error) {
            console.error("Registration request failed:", error);
            message.className = "form-feedback error";
            message.textContent = error instanceof Error
                ? error.message
                : "Registration could not be completed.";
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    });
}