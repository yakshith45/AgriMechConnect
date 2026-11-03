(() => {
    "use strict";

    const form = document.getElementById("adminLoginForm");
    const message = document.getElementById("adminLoginMessage");
    const submit = document.getElementById("adminLoginSubmit");

    if (!form || !message || !submit) return;

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const originalText = submit.textContent;
        submit.disabled = true;
        submit.textContent = "Signing in…";
        message.className = "admin-message";
        message.textContent = "";

        try {
            const result = await AgriMachApi.request("/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: document.getElementById("adminEmail").value.trim(),
                    password: document.getElementById("adminPassword").value
                })
            });
            if (typeof result?.token !== "string" || !result.admin || typeof result.admin.email !== "string") {
                throw new Error("The server returned an incomplete administrator session.");
            }
            localStorage.setItem("adminToken", result.token);
            localStorage.setItem("adminUser", JSON.stringify(result.admin));
            window.location.assign("/pages/admin/admin-dashboard.html");
        } catch (error) {
            console.error("Admin login request failed:", error);
            message.className = "admin-message is-error";
            message.textContent = error instanceof Error
                ? error.message
                : "Admin sign-in could not be completed.";
        } finally {
            submit.disabled = false;
            submit.textContent = originalText;
        }
    });
})();
