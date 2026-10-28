(() => {
    const configuredBaseUrl = window.AGRIMACHCONNECT_API_BASE_URL;
    const hostname = window.location.hostname || "127.0.0.1";
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const baseUrl = new URL(
        configuredBaseUrl || `${protocol}//${hostname}:5000/api`
    ).href.replace(/\/+$/, "");
    const healthUrl = `${baseUrl}/health`;

    async function request(path, options = {}) {
        if (window.location.protocol === "file:") {
            throw new Error("Serve the frontend over HTTP (for example, VS Code Live Server at http://127.0.0.1:5500) instead of opening a file:// page.");
        }

        if (
            typeof path !== "string" ||
            !path.startsWith("/") ||
            path.startsWith("//") ||
            path === "/api" ||
            path.startsWith("/api/")
        ) {
            throw new Error("Use an API route path such as /auth/login; the shared API base already includes /api.");
        }

        const requestUrl = `${baseUrl}${path}`;
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs ?? 15000;
        const { timeoutMs: ignoredTimeout, signal, ...fetchOptions } = options;
        let timedOut = false;
        const timeout = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        const abortFromCaller = () => controller.abort(signal.reason);
        signal?.addEventListener("abort", abortFromCaller, { once: true });

        let response;
        try {
            response = await fetch(requestUrl, {
                ...fetchOptions,
                signal: controller.signal
            });
        } catch (error) {
            if (timedOut) {
                throw new Error(`The API request to ${requestUrl} timed out after ${timeoutMs / 1000} seconds. Check backend and database status at ${healthUrl}.`);
            }
            if (signal?.aborted) throw error;
            throw new Error(`Could not connect to ${requestUrl}. Start the backend from the backend folder with "npm start". If it is already running, check that this page's origin is allowed by backend CORS. API health: ${healthUrl}.`);
        } finally {
            window.clearTimeout(timeout);
            signal?.removeEventListener("abort", abortFromCaller);
        }

        const responseText = await response.text();
        let data = null;
        if (responseText) {
            try {
                data = JSON.parse(responseText);
            } catch {
                if (response.ok) {
                    throw new Error(`The API returned an invalid response (HTTP ${response.status}).`);
                }
            }
        }

        if (!response.ok) {
            if (
                response.status === 403 &&
                (
                    data?.code === "ROLE_LOCATION_REQUIRED" ||
                    data?.message === "Confirm your role and location before using this service."
                ) &&
                window.location.pathname.split("/").pop() !== "select-role-location.html"
            ) {
                window.location.replace("select-role-location.html");
            }

            const message = typeof data?.message === "string"
                ? data.message
                : response.status >= 500
                    ? `The API server could not complete the request (HTTP ${response.status}). Check ${healthUrl}.`
                    : `The API request was rejected (HTTP ${response.status}).`;
            const error = new Error(`${message} (HTTP ${response.status}).`);
            error.status = response.status;
            if (typeof data?.code === "string") error.code = data.code;
            throw error;
        }

        return data;
    }

    window.AgriMachApi = Object.freeze({ baseUrl, healthUrl, request });
})();
