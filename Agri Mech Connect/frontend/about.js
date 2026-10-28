const revealItems = document.querySelectorAll(
    ".about-page-hero-content, .about-page-hero-art, .about-heading, .about-story-image, .about-copy, .about-benefits, .about-how-heading, .about-how-step, .about-impact-heading, .about-impact-card, .about-page-cta"
);

if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
    revealItems.forEach((item) => item.classList.add("about-reveal"));

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }

            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px" });

    revealItems.forEach((item) => revealObserver.observe(item));
}
