const contactForm = document.getElementById("contactForm");
const contactFeedback = document.getElementById("contactFormFeedback");

contactForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const fields = Array.from(contactForm.querySelectorAll("input, textarea"));
    const invalidFields = fields.filter((field) => !field.validity.valid);

    fields.forEach((field) => {
        if (field.validity.valid) {
            field.removeAttribute("aria-invalid");
        } else {
            field.setAttribute("aria-invalid", "true");
        }
    });

    if (invalidFields.length > 0) {
        contactFeedback.className = "contact-page-form-feedback error";
        contactFeedback.textContent = "Please complete all fields and enter a valid email address.";
        invalidFields[0].focus();
        contactForm.reportValidity();
        return;
    }

    const formData = new FormData(contactForm);
    const body = [
        `Name: ${formData.get("name")}`,
        `Email: ${formData.get("email")}`,
        "",
        formData.get("message")
    ].join("\n");
    const composeUrl = new URL("https://mail.google.com/mail/");
    composeUrl.search = new URLSearchParams({
        view: "cm",
        fs: "1",
        to: "sulliayakshith@gmail.com",
        su: formData.get("subject"),
        body
    }).toString();
    const composeWindow = window.open(composeUrl.toString(), "_blank");

    if (!composeWindow) {
        contactFeedback.className = "contact-page-form-feedback error";
        contactFeedback.textContent = "Your browser blocked the Gmail draft. Use the email link above to contact us.";
        return;
    }

    composeWindow.opener = null;
    contactFeedback.className = "contact-page-form-feedback success";
    contactFeedback.textContent = "A Gmail draft was opened in a new tab. Your message has not been sent; review and send it in Gmail.";
});

contactForm.addEventListener("input", (event) => {
    const field = event.target;

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        if (field.validity.valid) {
            field.removeAttribute("aria-invalid");
        }

        const allFieldsValid = Array.from(contactForm.querySelectorAll("input, textarea"))
            .every((contactField) => contactField.validity.valid);
        if (allFieldsValid && contactFeedback.textContent === "Please complete all fields and enter a valid email address.") {
            contactFeedback.className = "contact-page-form-feedback";
            contactFeedback.textContent = "";
        }
    }
});
