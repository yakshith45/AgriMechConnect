(() => {
    "use strict";

    const content = document.getElementById("adminContent");
    const token = localStorage.getItem("adminToken");
    const navLinks = [...document.querySelectorAll(".admin-nav-link")];
    const labels = {
        overview: "Overview",
        "owner-requests": "Owner Access Requests",
        users: "Users",
        machinery: "Machinery",
        bookings: "Bookings",
        audit: "Audit & reports",
        settings: "Settings"
    };
    const viewState = {};
    let currentSection = "overview";
    let activeUserDetails = null;

    function clearAdminSession() {
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminUser");
        window.location.replace("admin-login.html");
    }

    if (!token) {
        clearAdminSession();
        return;
    }

    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined && text !== null) element.textContent = String(text);
        if (className) element.className = className;
        return element;
    }

    function button(text, className, handler, type = "button") {
        const element = node("button", text, `admin-button${className ? ` ${className}` : ""}`);
        element.type = type;
        if (handler) element.addEventListener("click", handler);
        return element;
    }

    function readAdmin() {
        try {
            return JSON.parse(localStorage.getItem("adminUser") || "null");
        } catch {
            return null;
        }
    }

    function setAdminIdentity(admin) {
        const name = typeof admin?.name === "string" && admin.name.trim() ? admin.name.trim() : "Administrator";
        const email = typeof admin?.email === "string" ? admin.email : "";
        document.getElementById("adminUserName").textContent = name;
        document.getElementById("adminUserEmail").textContent = email;
        document.getElementById("adminAvatar").textContent = name.slice(0, 1).toUpperCase();
    }

    function errorText(error) {
        return error instanceof Error ? error.message : "The request could not be completed.";
    }

    async function api(path, options = {}) {
        try {
            return await AgriMachApi.request(path, {
                ...options,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(options.headers || {})
                }
            });
        } catch (error) {
            if (error?.status === 401 || error?.status === 403) {
                clearAdminSession();
                throw error;
            }
            throw error;
        }
    }

    function sendJson(method, payload) {
        return {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        };
    }

    function showState(message, isError = false) {
        content.replaceChildren(node("div", message, `admin-state${isError ? " admin-error" : ""}`));
    }

    function displayValue(value, fallback = "—") {
        if (value === null || value === undefined || value === "") return fallback;
        if (typeof value === "object") return fallback;
        return String(value);
    }

    function pick(object, keys, fallback = "") {
        for (const key of keys) {
            const value = object?.[key];
            if (value !== undefined && value !== null && value !== "") return value;
        }
        return fallback;
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function pageHeading(title, description) {
        const header = node("div", undefined, "admin-page-heading");
        const copy = document.createElement("div");
        copy.append(node("h1", title), node("p", description));
        header.append(copy);
        return header;
    }

    function badge(value) {
        const text = displayValue(value, "Unknown");
        const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return node("span", text, `admin-badge is-${normalized}`);
    }

    function summaryValue(summary, keys) {
        for (const key of keys) {
            if (summary?.[key] !== undefined && summary[key] !== null) return summary[key];
        }
        return 0;
    }

    async function renderOverview() {
        showState("Loading overview…");
        try {
            const data = await api("/admin/overview");
            const summary = data?.summary || data?.counts || {};
            const section = document.createDocumentFragment();
            section.append(
                pageHeading("Good day", "A live view of activity across the AgriMachConnect marketplace.")
            );
            const stats = node("div", undefined, "admin-stat-grid");
            [
                ["Total users", ["totalUsers", "users", "userCount"]],
                ["Farmer accounts", ["farmerAccounts"]],
                ["Owner accounts", ["ownerAccounts"]],
                ["Pending owner requests", ["pendingOwnerRequests", "ownerRequests", "pendingRequests"], "owner-requests"],
                ["Machinery listings", ["totalMachinery", "machinery", "machineryCount", "activeMachinery"], "machinery"],
                ["Available machinery", ["availableMachinery"], "machinery"],
                ["Total bookings", ["totalBookings", "bookings", "bookingCount"], "bookings"],
                ["Pending bookings", ["pendingBookings"], "bookings"]
            ].forEach(([label, keys, targetSection]) => {
                const card = node("article", undefined, "admin-stat-card");
                card.append(node("span", label), node("strong", displayValue(summaryValue(summary, keys), "0")));
                if (targetSection) {
                    card.style.cursor = "pointer";
                    card.setAttribute("title", `Click to open ${labels[targetSection] || targetSection}`);
                    card.addEventListener("click", () => renderSection(targetSection));
                }
                stats.append(card);
            });
            section.append(stats);

            // Dedicated Owner Access Requests Section on Overview
            const requestsPanel = node("section", undefined, "admin-panel");
            requestsPanel.id = "overviewOwnerRequestsSection";
            requestsPanel.style.marginBottom = "24px";

            const reqHeadingWrap = node("div", undefined, "admin-panel-heading-wrap");
            reqHeadingWrap.style.display = "flex";
            reqHeadingWrap.style.justifyContent = "space-between";
            reqHeadingWrap.style.alignItems = "center";
            reqHeadingWrap.style.flexWrap = "wrap";
            reqHeadingWrap.style.gap = "12px";
            reqHeadingWrap.style.marginBottom = "14px";

            const reqTitleBox = document.createElement("div");
            reqTitleBox.append(
                node("h2", "Owner Access Requests"),
                node("p", "Pending requests from registered Farmers to receive Machinery Owner access.")
            );

            const viewAllBtn = button("View all requests →", "admin-button-subtle", () => renderSection("owner-requests"));
            reqHeadingWrap.append(reqTitleBox, viewAllBtn);
            requestsPanel.append(reqHeadingWrap);

            try {
                const pendingData = await api("/admin/owner-requests?status=pending&limit=10");
                const pendingItems = getItems(pendingData);
                if (!pendingItems.length) {
                    const emptyState = node("div", "No pending owner access requests at this time.", "admin-state");
                    emptyState.style.padding = "24px 16px";
                    requestsPanel.append(emptyState);
                } else {
                    const tableScroll = node("div", undefined, "admin-table-scroll");
                    const table = node("table", undefined, "admin-table");
                    const thead = document.createElement("thead");
                    const headRow = document.createElement("tr");
                    ["Applicant", "Email", "Phone", "Request Date", "Status", "Actions"].forEach(h => headRow.append(node("th", h)));
                    thead.append(headRow);
                    table.append(thead);

                    const tbody = document.createElement("tbody");
                    pendingItems.forEach(item => {
                        const row = document.createElement("tr");
                        textCell(row, pick(item, ["name", "fullName", "applicantName"], "Applicant"), "admin-cell-primary");
                        textCell(row, pick(item, ["email", "applicantEmail"], "—"));
                        textCell(row, pick(item, ["phone"], "—"));
                        textCell(row, formatDate(pick(item, ["requested_at", "createdAt", "created_at", "requestedAt"], "")));

                        const statusTd = document.createElement("td");
                        statusTd.append(badge(pick(item, ["status", "state"], "Pending")));
                        row.append(statusTd);

                        const id = pick(item, ["id", "requestId", "userId"], "");
                        const actions = [
                            {
                                label: "Approve",
                                className: "admin-button-primary",
                                handler: async () => {
                                    if (!window.confirm(`Approve owner access for ${item.name || item.email}? This grants Machinery Owner permissions while preserving Farmer access.`)) return;
                                    await performAction(
                                        () => api(`/admin/owner-requests/${encodeURIComponent(id)}/approve`, sendJson("POST", {})),
                                        "Owner access approved.",
                                        renderOverview
                                    );
                                }
                            },
                            {
                                label: "Reject",
                                className: "admin-button-danger",
                                handler: async () => {
                                    const reason = window.prompt("Enter a reason for rejecting this request:");
                                    if (reason === null) return;
                                    if (!reason.trim()) {
                                        window.alert("A rejection reason is required.");
                                        return;
                                    }
                                    if (!window.confirm(`Reject owner access request for ${item.name || item.email}?`)) return;
                                    await performAction(
                                        () => api(`/admin/owner-requests/${encodeURIComponent(id)}/reject`, sendJson("POST", { reason: reason.trim() })),
                                        "Owner access request rejected.",
                                        renderOverview
                                    );
                                }
                            }
                        ];
                        actionCell(row, actions);
                        tbody.append(row);
                    });
                    table.append(tbody);
                    tableScroll.append(table);
                    requestsPanel.append(tableScroll);
                }
            } catch (reqErr) {
                console.error("Could not load pending requests for overview:", reqErr);
                requestsPanel.append(node("div", "Could not load owner access requests.", "admin-state admin-error"));
            }

            section.append(requestsPanel);

            const panels = node("div", undefined, "admin-overview-grid");
            const statusPanel = node("section", undefined, "admin-panel");
            statusPanel.append(node("h2", "Bookings by status"));
            const statusList = node("ul", undefined, "admin-booking-chart");
            const statuses = data?.bookingsByStatus;
            const statusEntries = Array.isArray(statuses)
                ? statuses.map(item => [pick(item, ["status", "name"], "Unknown"), pick(item, ["count", "total"], 0)])
                : Object.entries(statuses || {});
            if (!statusEntries.length) statusList.append(node("li", "No booking status data available.", "admin-state"));
            const maxStatusCount = Math.max(1, ...statusEntries.map(([, count]) => Number(count) || 0));
            statusEntries.forEach(([status, count]) => {
                const row = node("li", undefined, "admin-booking-chart-row");
                const label = node("span", `${status} · ${displayValue(count, "0")}`);
                const track = node("span", undefined, "admin-booking-chart-track");
                const bar = node("span", undefined, "admin-booking-chart-bar");
                bar.style.width = `${Math.max(0, (Number(count) || 0) / maxStatusCount * 100)}%`;
                track.append(bar);
                row.append(label, track);
                statusList.append(row);
            });
            statusPanel.append(statusList);

            const activityPanel = node("section", undefined, "admin-panel");
            activityPanel.append(node("h2", "Recent activity"));
            const activityList = node("ul", undefined, "admin-activity-list");
            const activities = Array.isArray(data?.recentActivity) ? data.recentActivity : [];
            if (!activities.length) activityList.append(node("li", "No recent activity.", "admin-state"));
            activities.forEach(item => {
                const row = node("li", undefined, "admin-activity-item");
                const summaryText = pick(item, ["description", "action", "message", "event"], "Activity recorded");
                row.append(node("span", summaryText));
                row.append(node("time", formatDate(pick(item, ["createdAt", "created_at", "timestamp", "date"], ""))));
                activityList.append(row);
            });
            activityPanel.append(activityList);
            panels.append(statusPanel, activityPanel);
            section.append(panels);
            content.replaceChildren(section);
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    function makeControl(labelText, value, options = {}) {
        const label = node("label", undefined, options.className || "");
        label.append(node("span", labelText));
        let control;
        if (options.choices) {
            control = document.createElement("select");
            control.className = "admin-control";
            options.choices.forEach(([optionValue, optionLabel]) => {
                const option = node("option", optionLabel);
                option.value = optionValue;
                control.append(option);
            });
            control.value = value || "";
        } else {
            control = document.createElement("input");
            control.className = "admin-control";
            control.type = "search";
            control.value = value || "";
            control.placeholder = options.placeholder || "Search";
        }
        label.append(control);
        return { label, control };
    }

    function ensureState(section) {
        if (!viewState[section]) viewState[section] = { page: 1, search: "", status: "", role: "", sort: "created", order: "desc" };
        return viewState[section];
    }

    function getItems(data) {
        return Array.isArray(data?.items) ? data.items
            : Array.isArray(data?.results) ? data.results
                : Array.isArray(data?.data) ? data.data : [];
    }

    function getPagination(data, itemCount, page) {
        const pagination = data?.pagination || {};
        const total = Number(pick(pagination, ["total", "totalItems", "count"], NaN));
        const pageSize = Number(pick(pagination, ["pageSize", "limit", "perPage"], 10));
        const totalPagesValue = Number(pick(pagination, ["totalPages", "pages", "pageCount"], NaN));
        const totalPages = Number.isFinite(totalPagesValue)
            ? totalPagesValue
            : Number.isFinite(total) && pageSize > 0
                ? Math.max(1, Math.ceil(total / pageSize))
                : itemCount >= pageSize ? page + 1 : Math.max(1, page);
        return {
            total: Number.isFinite(total) ? total : null,
            page,
            totalPages: Math.max(1, totalPages),
            pageSize: pageSize > 0 ? pageSize : 10
        };
    }

    function makePagination(pagination, reload) {
        const footer = node("div", undefined, "admin-pagination");
        const totalText = pagination.total === null
            ? `Page ${pagination.page} of ${pagination.totalPages}`
            : `${pagination.total} result${pagination.total === 1 ? "" : "s"} · Page ${pagination.page} of ${pagination.totalPages}`;
        footer.append(node("span", totalText));
        const controls = node("div", undefined, "admin-pagination-controls");
        const previous = button("Previous", "", () => {
            if (pagination.page <= 1) return;
            ensureState(currentSection).page -= 1;
            reload();
        });
        previous.disabled = pagination.page <= 1;
        const next = button("Next", "", () => {
            if (pagination.page >= pagination.totalPages) return;
            ensureState(currentSection).page += 1;
            reload();
        });
        next.disabled = pagination.page >= pagination.totalPages;
        controls.append(previous, next);
        footer.append(controls);
        return footer;
    }

    function textCell(row, value, className = "") {
        const cell = document.createElement("td");
        if (className) cell.append(node("span", displayValue(value), className));
        else cell.textContent = displayValue(value);
        row.append(cell);
        return cell;
    }

    function tablePanel(headers, items, rowRenderer, pagination, reload) {
        const panel = node("section", undefined, "admin-table-panel");
        const scroll = node("div", undefined, "admin-table-scroll");
        const table = node("table", undefined, "admin-table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        headers.forEach(title => headerRow.append(node("th", title)));
        thead.append(headerRow);
        table.append(thead);
        const tbody = document.createElement("tbody");
        if (!items.length) {
            const row = document.createElement("tr");
            const empty = node("td", "No records match your search.", "admin-empty");
            empty.colSpan = headers.length;
            row.append(empty);
            tbody.append(row);
        } else {
            items.forEach(item => {
                const row = document.createElement("tr");
                rowRenderer(row, item);
                tbody.append(row);
            });
        }
        table.append(tbody);
        scroll.append(table);
        panel.append(scroll, makePagination(pagination, reload));
        return panel;
    }

    function actionCell(row, actions) {
        const cell = document.createElement("td");
        const group = node("div", undefined, "admin-row-actions");
        actions.forEach(action => group.append(button(action.label, action.className || "", action.handler)));
        cell.append(group);
        row.append(cell);
    }

    function queryFor(section, state) {
        const params = new URLSearchParams();
        if (state.search) params.set("search", state.search);
        params.set("page", String(state.page));
        if (section === "owner-requests" || section === "bookings" || section === "machinery") {
            if (state.status) params.set("status", state.status);
        }
        if (section === "users") {
            if (state.role) params.set("role", state.role);
            if (state.status) params.set("status", state.status);
        }
        if (section === "bookings") {
            params.set("sort", state.sort);
            params.set("order", state.order);
        }
        return params.toString();
    }

    function setToolbar(root, section, state, reload, choices) {
        const toolbar = node("form", undefined, "admin-toolbar");
        toolbar.addEventListener("submit", event => {
            event.preventDefault();
            state.search = search.control.value.trim();
            state.page = 1;
            reload();
        });
        const search = makeControl("Search", state.search, { placeholder: choices.searchPlaceholder || "Search" });
        toolbar.append(search.label);
        if (choices.filters) {
            choices.filters.forEach(filter => {
                const control = makeControl(filter.label, state[filter.key], {
                    choices: filter.choices,
                    className: "admin-filter"
                });
                control.control.addEventListener("change", () => {
                    state[filter.key] = control.control.value;
                    state.page = 1;
                    reload();
                });
                toolbar.append(control.label);
            });
        }
        if (choices.sortChoices) {
            const sortControl = makeControl("Sort by", state.sort, {
                choices: choices.sortChoices,
                className: "admin-filter"
            });
            sortControl.control.addEventListener("change", () => {
                state.sort = sortControl.control.value;
                state.page = 1;
                reload();
            });
            const orderControl = makeControl("Order", state.order, {
                choices: [["desc", "Descending"], ["asc", "Ascending"]],
                className: "admin-filter"
            });
            orderControl.control.addEventListener("change", () => {
                state.order = orderControl.control.value;
                state.page = 1;
                reload();
            });
            toolbar.append(sortControl.label, orderControl.label);
        }
        toolbar.append(button("Search", "admin-button-primary", null, "submit"));
        root.append(toolbar);
    }

    async function renderOwnerRequests() {
        const section = "owner-requests";
        const state = ensureState(section);
        showState("Loading owner requests…");
        try {
            const data = await api(`/admin/owner-requests?${queryFor(section, state)}`);
            const items = getItems(data);
            const pagination = getPagination(data, items.length, state.page);
            const root = document.createDocumentFragment();
            root.append(pageHeading("Owner Access Requests", "Review requests from farmers seeking Machinery Owner access."));
            const toolbarRoot = document.createElement("div");
            setToolbar(toolbarRoot, section, state, renderOwnerRequests, {
                searchPlaceholder: "Search applicant, email or request",
                filters: [{ key: "status", label: "Request status", choices: [
                    ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"],
                    ["revoked", "Revoked"], ["all", "All statuses"]
                ] }]
            });
            root.append(toolbarRoot);
            root.append(tablePanel(["Applicant", "Email", "Phone", "Current roles", "Request Date", "Status", "Actions"], items, (row, item) => {
                textCell(row, pick(item, ["name", "fullName", "applicantName"], "Applicant"), "admin-cell-primary");
                textCell(row, pick(item, ["email", "applicantEmail"], ""));
                textCell(row, pick(item, ["phone"], "—"));
                textCell(row, Array.isArray(item.current_roles) ? item.current_roles.join(", ") : "—");
                textCell(row, formatDate(pick(item, ["requested_at", "createdAt", "created_at", "requestedAt"], "")));
                const statusCell = document.createElement("td");
                statusCell.append(badge(pick(item, ["status", "state"], "Pending")));
                row.append(statusCell);
                const id = pick(item, ["id", "requestId", "userId"], "");
                const status = String(pick(item, ["status", "state"], "pending")).toLowerCase();
                const actions = [];
                if (id && status === "pending") {
                    actions.push({
                        label: "Approve",
                        className: "admin-button-primary",
                        handler: async () => {
                            if (!window.confirm(`Approve owner access for ${item.name || item.email}? This grants the applicant Machinery Owner permissions while preserving Farmer access.`)) return;
                            await performAction(() => api(`/admin/owner-requests/${encodeURIComponent(id)}/approve`, sendJson("POST", {})), "Owner access approved.", renderOwnerRequests);
                        }
                    });
                    actions.push({
                        label: "Reject",
                        className: "admin-button-danger",
                        handler: async () => {
                            const reason = window.prompt("Enter a reason for rejecting this request:");
                            if (reason === null) return;
                            if (!reason.trim()) {
                                window.alert("A rejection reason is required.");
                                return;
                            }
                            if (!window.confirm(`Reject owner access request for ${item.name || item.email}?`)) return;
                            await performAction(() => api(`/admin/owner-requests/${encodeURIComponent(id)}/reject`, sendJson("POST", { reason: reason.trim() })), "Owner access request rejected.", renderOwnerRequests);
                        }
                    });
                }
                actionCell(row, actions.length ? actions : [{ label: "No actions", className: "" }]);
            }, pagination, renderOwnerRequests));
            content.replaceChildren(root);
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    function renderUserDetails(data, item) {
        activeUserDetails = { data, item };
        const existing = document.getElementById("adminUserDetails");
        if (existing) existing.remove();
        const panel = node("section", undefined, "admin-user-details");
        panel.id = "adminUserDetails";
        const user = data?.user || item;
        panel.append(node("h2", `User details · ${displayValue(pick(user, ["name", "fullName", "email"], "User"))}`));
        const profile = node("div", undefined, "admin-profile-grid");
        [
            ["User ID", pick(user, ["id", "userId"], "—")],
            ["Email", pick(user, ["email"], "—")],
            ["Phone", pick(user, ["phone"], "—")],
            ["Registered", formatDate(pick(user, ["created_at", "createdAt"], ""))],
            ["Roles", (user?.permitted_roles || user?.allowed_roles || []).join(", ") || pick(user, ["role"], "—")],
            ["Account status", user?.is_suspended ? "Suspended" : "Active"],
            ["Selected location", pick(user, ["selected_location"], "—")],
            ["Coordinates", user?.selected_latitude == null || user?.selected_longitude == null
                ? "—" : `${user.selected_latitude}, ${user.selected_longitude}`]
        ].forEach(([label, value]) => {
            const item = node("div", undefined, "admin-profile-item");
            item.append(node("span", label), node("strong", value));
            profile.append(item);
        });
        panel.append(profile);
        const details = node("div", undefined, "admin-detail-columns");
        const machinery = Array.isArray(data?.machinery) ? data.machinery : [];
        const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
        [
            ["Machinery", machinery.map(entry =>
                `${displayValue(pick(entry, ["id"], "—"))} · ${displayValue(pick(entry, ["name", "title", "category"], "Machinery listing"))} · ${displayValue(pick(entry, ["price"], "—"))} · ${displayValue(pick(entry, ["availability"], "Unknown"))}`)],
            ["Bookings", bookings.map(entry =>
                `${displayValue(pick(entry, ["id", "bookingId"], "Booking"))} · ${displayValue(pick(entry, ["machinery_name"], "Machinery"))} · ${formatDate(pick(entry, ["booking_date"], ""))} · ${displayValue(pick(entry, ["status"], "Unknown"))} · ${displayValue(pick(entry, ["estimated_total"], "—"))}`)]
        ].forEach(([title, values]) => {
            const column = document.createElement("div");
            column.append(node("h3", `${title} (${values.length})`));
            const list = document.createElement("ul");
            if (!values.length) list.append(node("li", `No ${title.toLowerCase()} found.`));
            values.forEach(value => list.append(node("li", value)));
            column.append(list);
            details.append(column);
        });
        panel.append(details);

        const roleForm = node("form", undefined, "admin-role-options");
        roleForm.setAttribute("aria-label", "Update user roles");
        const currentRoles = Array.isArray(user?.permitted_roles)
            ? user.permitted_roles
            : Array.isArray(user?.allowed_roles)
                ? user.allowed_roles
                : Array.isArray(user?.roles)
                    ? user.roles
            : [user?.role].filter(Boolean);
        ["farmer", "owner"].forEach(role => {
            const label = node("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = role;
            checkbox.checked = currentRoles.includes(role);
            label.append(checkbox, document.createTextNode(` ${role[0].toUpperCase()}${role.slice(1)}`));
            roleForm.append(label);
        });
        const saveRoles = button("Save roles", "admin-button-primary", null, "submit");
        roleForm.append(saveRoles);
        roleForm.addEventListener("submit", async event => {
            event.preventDefault();
            const roles = [...roleForm.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
            if (!window.confirm("Update this user's roles?")) return;
            const id = pick(user, ["id", "userId"], "");
            if (!id) return;
            await performAction(() => api(`/admin/users/${encodeURIComponent(id)}/roles`, sendJson("PATCH", { roles })), "User roles updated.", () => loadUsers(true));
        });
        panel.append(node("h3", "Roles"));
        panel.append(roleForm);
        return panel;
    }

    async function loadUsers(preserveDetails = false) {
        const section = "users";
        const state = ensureState(section);
        showState("Loading users…");
        try {
            const data = await api(`/admin/users?${queryFor(section, state)}`);
            const items = getItems(data);
            const pagination = getPagination(data, items.length, state.page);
            const root = document.createDocumentFragment();
            root.append(pageHeading("Users", "Search accounts, inspect activity, and manage marketplace access."));
            const toolbarRoot = document.createElement("div");
            setToolbar(toolbarRoot, section, state, loadUsers, {
                searchPlaceholder: "Name, email or user ID",
                filters: [
                    { key: "role", label: "Role", choices: [["", "All roles"], ["farmer", "Farmer"], ["owner", "Owner"]] },
                    { key: "status", label: "Account status", choices: [["", "All statuses"], ["active", "Active"], ["suspended", "Suspended"]] }
                ]
            });
            root.append(toolbarRoot);
            root.append(tablePanel(["User", "Roles", "Status", "Joined", "Actions"], items, (row, item) => {
                const id = pick(item, ["id", "userId"], "");
                const userName = pick(item, ["name", "fullName"], "Unknown user");
                const userCell = document.createElement("td");
                userCell.append(node("span", userName, "admin-cell-primary"));
                userCell.append(node("span", pick(item, ["email"], id), "admin-cell-secondary"));
                row.append(userCell);
                textCell(row, Array.isArray(item.permitted_roles) ? item.permitted_roles.join(", ")
                    : Array.isArray(item.allowed_roles) ? item.allowed_roles.join(", ")
                        : Array.isArray(item.roles) ? item.roles.join(", ") : pick(item, ["role"], "—"));
                const status = item.is_suspended === true || item.suspended === true
                    ? "suspended" : pick(item, ["status"], "active");
                const statusCell = document.createElement("td");
                statusCell.append(badge(status));
                row.append(statusCell);
                textCell(row, formatDate(pick(item, ["createdAt", "created_at", "joinedAt"], "")));
                const suspended = item.is_suspended === true || item.suspended === true || String(status).toLowerCase() === "suspended";
                const actions = [{
                    label: "View",
                    handler: async () => {
                        try {
                            const details = await api(`/admin/users/${encodeURIComponent(id)}`);
                            const pane = renderUserDetails(details, item);
                            const prior = document.getElementById("adminUserDetails");
                            if (prior) prior.remove();
                            content.append(pane);
                        } catch (error) {
                            showState(errorText(error), true);
                        }
                    }
                }];
                actions.push({
                    label: suspended ? "Restore" : "Suspend",
                    className: suspended ? "admin-button-gold" : "admin-button-danger",
                    handler: async () => {
                        const nextSuspended = !suspended;
                        const verb = nextSuspended ? "suspend" : "restore access for";
                        if (!window.confirm(`Are you sure you want to ${verb} ${userName}?`)) return;
                        await performAction(() => api(`/admin/users/${encodeURIComponent(id)}/status`, sendJson("PATCH", { suspended: nextSuspended })), `User ${nextSuspended ? "suspended" : "restored"}.`, loadUsers);
                    }
                });
                actionCell(row, actions);
            }, pagination, loadUsers));
            content.replaceChildren(root);
            if (preserveDetails && activeUserDetails) {
                const id = pick(activeUserDetails.item, ["id", "userId"], "");
                if (id) {
                    const details = await api(`/admin/users/${encodeURIComponent(id)}`);
                    content.append(renderUserDetails(details, activeUserDetails.item));
                }
            }
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    async function renderMachinery() {
        const section = "machinery";
        const state = ensureState(section);
        showState("Loading machinery…");
        try {
            const data = await api(`/admin/machinery?${queryFor(section, state)}`);
            const items = getItems(data);
            const pagination = getPagination(data, items.length, state.page);
            const root = document.createDocumentFragment();
            root.append(pageHeading("Machinery", "Review marketplace listings and manage their visibility."));
            const toolbarRoot = document.createElement("div");
            setToolbar(toolbarRoot, section, state, renderMachinery, {
                searchPlaceholder: "Listing, owner, brand or category",
                filters: [{ key: "status", label: "Listing status", choices: [["", "All statuses"], ["active", "Active"], ["inactive", "Inactive"]] }]
            });
            root.append(toolbarRoot);
            root.append(tablePanel(["ID", "Listing", "Category", "Owner", "Price", "Location", "Availability", "Listed", "Status", "Actions"], items, (row, item) => {
                const id = pick(item, ["id", "machineryId"], "");
                const title = pick(item, ["name", "title", "model"], "Machinery listing");
                const listingCell = document.createElement("td");
                textCell(row, id);
                const imageUrl = pick(item, ["image_url", "imageUrl"], "");
                if (typeof imageUrl === "string" && imageUrl) {
                    try {
                        const parsedImageUrl = new URL(imageUrl, window.location.href);
                        if (["http:", "https:"].includes(parsedImageUrl.protocol)) {
                            const image = document.createElement("img");
                            image.src = parsedImageUrl.href;
                            image.alt = "";
                            image.loading = "lazy";
                            image.className = "admin-listing-thumbnail";
                            listingCell.append(image);
                        }
                    } catch {
                        console.warn("Skipping invalid machinery listing image URL.");
                    }
                }
                listingCell.append(node("span", title, "admin-cell-primary"));
                listingCell.append(node("span", pick(item, ["brand", "registrationNumber"], id), "admin-cell-secondary"));
                row.append(listingCell);
                textCell(row, pick(item, ["type", "category"], "—"));
                textCell(row, `${displayValue(pick(item, ["owner_name", "ownerName", "owner", "owner_email"], "—"))} (#${displayValue(item.owner_id, "—")})`);
                textCell(row, pick(item, ["price"], "—"));
                const coordinates = item.latitude == null || item.longitude == null
                    ? "Coordinates unavailable"
                    : `${item.latitude}, ${item.longitude}`;
                textCell(row, `${displayValue(item.location, "—")} · ${coordinates}`);
                textCell(row, item.availability === true ? "Available" : "Unavailable");
                textCell(row, formatDate(pick(item, ["created_at", "createdAt"], "")));
                const active = item.admin_active !== false && item.active !== false &&
                    String(pick(item, ["status"], "active")).toLowerCase() !== "inactive";
                const statusCell = document.createElement("td");
                statusCell.append(badge(active ? "active" : "inactive"));
                row.append(statusCell);
                actionCell(row, [{
                    label: active ? "Deactivate" : "Activate",
                    className: active ? "admin-button-danger" : "admin-button-primary",
                    handler: async () => {
                        if (!window.confirm(`${active ? "Deactivate" : "Activate"} this machinery listing?`)) return;
                        await performAction(() => api(`/admin/machinery/${encodeURIComponent(id)}/status`, sendJson("PATCH", { active: !active })), `Listing ${active ? "deactivated" : "activated"}.`, renderMachinery);
                    }
                }]);
            }, pagination, renderMachinery));
            content.replaceChildren(root);
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    async function renderBookings() {
        const section = "bookings";
        const state = ensureState(section);
        showState("Loading bookings…");
        try {
            const data = await api(`/admin/bookings?${queryFor(section, state)}`);
            const items = getItems(data);
            const pagination = getPagination(data, items.length, state.page);
            const root = document.createDocumentFragment();
            root.append(pageHeading("Bookings", "Monitor rental activity and cancel bookings when necessary."));
            const toolbarRoot = document.createElement("div");
            setToolbar(toolbarRoot, section, state, renderBookings, {
                searchPlaceholder: "Booking, farmer or machinery",
                filters: [{ key: "status", label: "Booking status", choices: [
                    ["", "All statuses"], ["pending", "Pending"], ["accepted", "Accepted"],
                    ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["completed", "Completed"]
                ] }],
                sortChoices: [["created", "Creation date"], ["date", "Booking date"], ["status", "Status"], ["rental", "Rental total"]]
            });
            root.append(toolbarRoot);
            root.append(tablePanel(["Booking ID", "Farmer", "Machinery", "Owner", "Date & time", "Rate / total", "Status", "Actions"], items, (row, item) => {
                const id = pick(item, ["id", "bookingId"], "");
                textCell(row, id, "admin-cell-primary");
                textCell(row, `${displayValue(pick(item, ["farmer_name", "farmerName", "farmer"], "—"))} (#${displayValue(item.farmer_id, "—")})`);
                textCell(row, `${displayValue(pick(item, ["machinery_name", "machineryName", "machinery"], "—"))} (#${displayValue(item.machinery_id, "—")})`);
                textCell(row, `${displayValue(item.owner_name, "—")} (#${displayValue(item.owner_id, "—")})`);
                const dateTime = [
                    formatDate(pick(item, ["booking_date", "bookingDate"], "")),
                    pick(item, ["start_time"], ""),
                    pick(item, ["end_time"], ""),
                    `Created ${formatDate(pick(item, ["created_at", "createdAt"], ""))}`
                ].filter(Boolean).join(" · ");
                textCell(row, dateTime);
                textCell(row, `${displayValue(item.rental_rate, "—")} / ${displayValue(item.rental_unit, "—")} · total ${displayValue(item.estimated_total, "—")}`);
                const status = pick(item, ["status"], "unknown");
                const statusCell = document.createElement("td");
                statusCell.append(badge(status));
                row.append(statusCell);
                const cancellable = !["cancelled", "completed", "rejected"].includes(String(status).toLowerCase());
                actionCell(row, cancellable ? [{
                    label: "Cancel booking",
                    className: "admin-button-danger",
                    handler: async () => {
                        const reason = window.prompt("Enter a reason for cancelling this booking:");
                        if (reason === null) return;
                        if (!reason.trim()) {
                            window.alert("A cancellation reason is required.");
                            return;
                        }
                        if (!window.confirm("Cancel this booking? This action may notify both parties.")) return;
                        await performAction(() => api(`/admin/bookings/${encodeURIComponent(id)}/status`, sendJson("PATCH", { status: "cancelled", reason: reason.trim() })), "Booking cancelled.", renderBookings);
                    }
                }] : [{ label: "No actions" }]);
            }, pagination, renderBookings));
            content.replaceChildren(root);
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    async function renderAudit() {
        const section = "audit";
        const state = ensureState(section);
        showState("Loading audit events…");
        try {
            const data = await api(`/admin/audit?${queryFor(section, state)}`);
            const items = getItems(data);
            const pagination = getPagination(data, items.length, state.page);
            const root = document.createDocumentFragment();
            root.append(pageHeading("Audit & reports", "Read-only records of administrator and account activity."));
            const toolbarRoot = document.createElement("div");
            setToolbar(toolbarRoot, section, state, renderAudit, {
                searchPlaceholder: "Search actor, action, target or date"
            });
            root.append(toolbarRoot);
            root.append(tablePanel(["When", "Actor", "Action", "Target", "Details"], items, (row, item) => {
                textCell(row, formatDate(pick(item, ["createdAt", "created_at", "timestamp"], "")));
                textCell(row, pick(item, ["admin_name", "adminName", "actorName", "actorEmail", "actor"], "—"));
                textCell(row, pick(item, ["action", "event", "type"], "—"));
                const entityType = pick(item, ["entity_type", "targetType", "entity"], "—");
                const entityId = pick(item, ["entity_id", "targetId"], "");
                textCell(row, entityId ? `${entityType} #${entityId}` : entityType);
                const detail = item?.details && typeof item.details === "object"
                    ? JSON.stringify(item.details)
                    : pick(item, ["details", "description", "summary"], "—");
                textCell(row, detail);
            }, pagination, renderAudit));
            content.replaceChildren(root);
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    function renderSettings() {
        const root = document.createDocumentFragment();
        root.append(pageHeading("Settings", "Update your administrator password and protect your account."));
        const panel = node("section", undefined, "admin-settings-card");
        panel.append(node("h2", "Change password"));
        panel.append(node("p", "Use a strong, unique password. Your current password is required to make this change."));
        const form = document.createElement("form");
        [
            ["Current password", "currentPassword", "current-password"],
            ["New password", "newPassword", "new-password"],
            ["Confirm new password", "confirmPassword", "new-password"]
        ].forEach(([labelText, name, autocomplete]) => {
            const label = node("label", undefined, "admin-field");
            label.append(node("span", labelText));
            const input = document.createElement("input");
            input.className = "admin-control";
            input.type = "password";
            input.name = name;
            input.autocomplete = autocomplete;
            input.required = true;
            if (name === "newPassword") input.minLength = 12;
            label.append(input);
            form.append(label);
        });
        const feedback = node("p", "", "admin-message");
        feedback.setAttribute("role", "status");
        feedback.setAttribute("aria-live", "polite");
        form.append(feedback, button("Change password", "admin-button-primary", null, "submit"));
        form.addEventListener("submit", async event => {
            event.preventDefault();
            const formData = new FormData(form);
            const currentPassword = formData.get("currentPassword");
            const newPassword = formData.get("newPassword");
            const confirmPassword = formData.get("confirmPassword");
            if (newPassword !== confirmPassword) {
                feedback.className = "admin-message is-error";
                feedback.textContent = "The new passwords do not match.";
                return;
            }
            if (!window.confirm("Change your administrator password now?")) return;
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            feedback.textContent = "";
            try {
                await api("/admin/change-password", sendJson("POST", { currentPassword, newPassword }));
                form.reset();
                feedback.className = "admin-message is-success";
                feedback.textContent = "Password changed successfully.";
            } catch (error) {
                feedback.className = "admin-message is-error";
                feedback.textContent = errorText(error);
            } finally {
                submitButton.disabled = false;
            }
        });
        panel.append(form);
        root.append(panel);
        content.replaceChildren(root);
    }

    async function performAction(action, successText, reload) {
        showState("Saving changes…");
        try {
            await action();
            await reload();
            const notice = node("p", successText, "admin-message is-success");
            content.prepend(notice);
        } catch (error) {
            showState(errorText(error), true);
        }
    }

    function renderSection(section) {
        currentSection = section;
        activeUserDetails = null;
        document.getElementById("adminSectionName").textContent = labels[section] || "Overview";
        navLinks.forEach(link => {
            const active = link.dataset.section === section;
            link.classList.toggle("is-active", active);
            link.setAttribute("aria-current", active ? "page" : "false");
        });
        document.getElementById("adminSidebar").classList.remove("is-open");
        document.getElementById("adminScrim").hidden = true;
        document.getElementById("adminMenuToggle").setAttribute("aria-expanded", "false");
        const renderers = {
            overview: renderOverview,
            "owner-requests": renderOwnerRequests,
            users: loadUsers,
            machinery: renderMachinery,
            bookings: renderBookings,
            audit: renderAudit,
            settings: renderSettings
        };
        renderers[section]();
    }

    navLinks.forEach(link => link.addEventListener("click", () => renderSection(link.dataset.section)));
    document.getElementById("adminLogout").addEventListener("click", () => {
        if (!window.confirm("Log out of the administrator console?")) return;
        api("/admin/logout", sendJson("POST", {}))
            .catch(error => {
                console.error("Admin logout could not revoke the server-side session:", error);
                window.alert("You will be signed out of this browser, but the server could not revoke this token. It may remain valid until it expires.");
            })
            .finally(() => {
                localStorage.removeItem("adminToken");
                localStorage.removeItem("adminUser");
                window.location.replace("admin-login.html");
            });
    });
    const sidebar = document.getElementById("adminSidebar");
    const scrim = document.getElementById("adminScrim");
    const menuToggle = document.getElementById("adminMenuToggle");
    function closeMenu() {
        sidebar.classList.remove("is-open");
        scrim.hidden = true;
        menuToggle.setAttribute("aria-expanded", "false");
    }
    menuToggle.addEventListener("click", () => {
        const open = !sidebar.classList.contains("is-open");
        sidebar.classList.toggle("is-open", open);
        scrim.hidden = !open;
        menuToggle.setAttribute("aria-expanded", String(open));
    });
    scrim.addEventListener("click", closeMenu);

    async function start() {
        try {
            const session = await api("/admin/session");
            if (!session?.admin) {
                clearAdminSession();
                return;
            }
            localStorage.setItem("adminUser", JSON.stringify(session.admin));
            setAdminIdentity(session.admin);
            renderSection("overview");
        } catch (error) {
            if (error?.status !== 401 && error?.status !== 403) {
                showState(errorText(error), true);
            }
        }
    }

    setAdminIdentity(readAdmin());
    start();
})();
