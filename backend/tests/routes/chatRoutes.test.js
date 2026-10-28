const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");
const express = require("express");
const chatRoutes = require("../../routes/chatRoutes");

const app = express();
app.use(express.json());
app.use("/api/chat", chatRoutes);

function makeToken(user) {
    return jwt.sign(
        {
            id: user.id,
            role: user.role,
            locationConfirmed: true
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
    );
}

test("Farmer-Machinery Owner Chat System API Suite", async (t) => {
    const timestamp = Date.now();
    let farmerUser, ownerUser, thirdUser;
    let farmerToken, ownerToken, thirdToken;
    let machineRecord;
    let conversationId;

    before(async () => {
        // Create Farmer
        const farmerRes = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, allowed_roles, selected_location, selected_latitude, selected_longitude)
             VALUES ($1, $2, $3, $4, 'farmer', ARRAY['farmer']::TEXT[], 'Sullia Town', 12.561, 75.387)
             RETURNING id, name, role`,
            [`Farmer ${timestamp}`, `chat_farmer_${timestamp}@example.invalid`, "9876500001", "dummyhash"]
        );
        farmerUser = farmerRes.rows[0];
        farmerToken = makeToken(farmerUser);

        // Create Owner
        const ownerRes = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, allowed_roles, selected_location, selected_latitude, selected_longitude)
             VALUES ($1, $2, $3, $4, 'owner', ARRAY['owner']::TEXT[], 'Sullia Market', 12.562, 75.388)
             RETURNING id, name, role`,
            [`Owner ${timestamp}`, `chat_owner_${timestamp}@example.invalid`, "9876500002", "dummyhash"]
        );
        ownerUser = ownerRes.rows[0];
        ownerToken = makeToken(ownerUser);

        // Create Third User (Another Farmer)
        const thirdRes = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, allowed_roles, selected_location, selected_latitude, selected_longitude)
             VALUES ($1, $2, $3, $4, 'farmer', ARRAY['farmer']::TEXT[], 'Puttur', 12.570, 75.390)
             RETURNING id, name, role`,
            [`Other Farmer ${timestamp}`, `chat_other_${timestamp}@example.invalid`, "9876500003", "dummyhash"]
        );
        thirdUser = thirdRes.rows[0];
        thirdToken = makeToken(thirdUser);

        // Create Machinery owned by ownerUser
        const machineRes = await pool.query(
            `INSERT INTO machinery (owner_id, name, type, price, price_unit, location, latitude, longitude, availability, admin_active)
             VALUES ($1, $2, 'Tractor', 1500, 'day', 'Sullia Center', 12.561, 75.387, TRUE, TRUE)
             RETURNING id, owner_id, name`,
            [ownerUser.id, `John Deere ${timestamp}`]
        );
        machineRecord = machineRes.rows[0];
    });

    after(async () => {
        // Clean up test data cascade deletes messages and conversations
        if (farmerUser?.id) await pool.query("DELETE FROM users WHERE id = $1", [farmerUser.id]);
        if (ownerUser?.id) await pool.query("DELETE FROM users WHERE id = $1", [ownerUser.id]);
        if (thirdUser?.id) await pool.query("DELETE FROM users WHERE id = $1", [thirdUser.id]);
    });

    // Helper to perform HTTP requests to our Express app
    async function request(path, options = {}) {
        const { method = "GET", headers = {}, body } = options;
        const url = `http://127.0.0.1:${serverPort}${path}`;
        const fetchOptions = {
            method,
            headers: {
                ...(body ? { "Content-Type": "application/json" } : {}),
                ...headers
            },
            ...(body ? { body: JSON.stringify(body) } : {})
        };
        const res = await fetch(url, fetchOptions);
        let data = null;
        try {
            data = await res.json();
        } catch {
            // non-json response
        }
        return { status: res.status, ok: res.ok, body: data };
    }

    let testServer;
    let serverPort;

    before(async () => {
        await new Promise((resolve) => {
            testServer = app.listen(0, "127.0.0.1", () => {
                serverPort = testServer.address().port;
                resolve();
            });
        });
    });

    after(async () => {
        if (testServer) {
            await new Promise((resolve) => testServer.close(resolve));
        }
    });

    await t.test("Authentication: rejects unauthenticated requests to chat endpoints", async () => {
        const res = await request("/api/chat/conversations");
        assert.equal(res.status, 401);
    });

    await t.test("Self-messaging prevention: owner cannot message themselves about their own machinery", async () => {
        const res = await request("/api/chat/conversations", {
            method: "POST",
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: { machinery_id: machineRecord.id }
        });
        assert.equal(res.status, 400);
        assert.match(res.body.message, /cannot message yourself/i);
    });

    await t.test("Conversation creation: farmer can initiate conversation linked to machinery and owner", async () => {
        const res = await request("/api/chat/conversations", {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: { machinery_id: machineRecord.id }
        });
        assert.equal(res.status, 201);
        assert.ok(res.body.conversation);
        conversationId = res.body.conversation.id;
        assert.equal(res.body.conversation.farmer_id, farmerUser.id);
        assert.equal(res.body.conversation.owner_id, ownerUser.id);
        assert.equal(res.body.conversation.machinery_id, machineRecord.id);
        assert.equal(res.body.conversation.other_user.name, ownerUser.name);
        assert.equal(res.body.conversation.machinery.name, machineRecord.name);

        // Re-requesting the conversation returns the existing one without duplicate
        const repeatRes = await request("/api/chat/conversations", {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: { machinery_id: machineRecord.id }
        });
        assert.equal(repeatRes.status, 200);
        assert.equal(repeatRes.body.conversation.id, conversationId);
        assert.equal(repeatRes.body.isNew, false);
    });

    await t.test("Validation: rejects empty messages and messages exceeding length limit", async () => {
        // Empty message
        const emptyRes = await request(`/api/chat/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: { message_text: "   " }
        });
        assert.equal(emptyRes.status, 400);
        assert.match(emptyRes.body.message, /cannot be empty/i);

        // Exceeding limit
        const tooLong = "x".repeat(2001);
        const longRes = await request(`/api/chat/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: { message_text: tooLong }
        });
        assert.equal(longRes.status, 400);
        assert.match(longRes.body.message, /exceeds the limit/i);
    });

    let firstMessageId;
    await t.test("Messaging: farmer can send message; message persists with timestamp and sender", async () => {
        const text = "Hello! Is this tractor available tomorrow morning?";
        const res = await request(`/api/chat/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: { message_text: text }
        });
        assert.equal(res.status, 201);
        assert.ok(res.body.message);
        firstMessageId = res.body.message.id;
        assert.equal(res.body.message.message_text, text);
        assert.equal(res.body.message.sender_id, farmerUser.id);
        assert.equal(res.body.message.sender_name, farmerUser.name);
        assert.equal(res.body.message.is_read, false);
        assert.ok(res.body.message.created_at);
    });

    await t.test("Unread counts: owner sees unread message in conversation list and total badge", async () => {
        // Check unread count for owner
        const countRes = await request("/api/chat/unread-count", {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(countRes.status, 200);
        assert.equal(countRes.body.total_unread, 1);

        // Check owner conversation list
        const convsRes = await request("/api/chat/conversations", {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(convsRes.status, 200);
        assert.equal(convsRes.body.conversations.length, 1);
        const conv = convsRes.body.conversations[0];
        assert.equal(conv.id, conversationId);
        assert.equal(conv.unread_count, 1);
        assert.equal(conv.other_user.name, farmerUser.name);
        assert.equal(conv.last_message.message_text, "Hello! Is this tractor available tomorrow morning?");
    });

    await t.test("Privacy & Authorization: non-participant cannot read or send messages in conversation", async () => {
        // Non-participant tries to get conversation details
        const getRes = await request(`/api/chat/conversations/${conversationId}`, {
            headers: { Authorization: `Bearer ${thirdToken}` }
        });
        assert.equal(getRes.status, 403);

        // Non-participant tries to get messages
        const msgRes = await request(`/api/chat/conversations/${conversationId}/messages`, {
            headers: { Authorization: `Bearer ${thirdToken}` }
        });
        assert.equal(msgRes.status, 403);

        // Non-participant tries to send message
        const sendRes = await request(`/api/chat/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${thirdToken}` },
            body: { message_text: "Unauthorized spy message" }
        });
        assert.equal(sendRes.status, 403);
    });

    await t.test("Owner reply & read tracking: owner reading messages marks them read and replies", async () => {
        // Owner fetches messages (marking existing unread as read)
        const fetchRes = await request(`/api/chat/conversations/${conversationId}/messages`, {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(fetchRes.status, 200);
        assert.equal(fetchRes.body.messages.length, 1);
        assert.equal(fetchRes.body.marked_read_count, 1);

        // Owner total unread should now be 0
        const ownerUnreadRes = await request("/api/chat/unread-count", {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(ownerUnreadRes.body.total_unread, 0);

        // Owner sends a reply
        const replyText = "Yes, it is ready for pickup by 8 AM!";
        const replyRes = await request(`/api/chat/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: { message_text: replyText }
        });
        assert.equal(replyRes.status, 201);
        assert.equal(replyRes.body.message.message_text, replyText);
        assert.equal(replyRes.body.message.sender_id, ownerUser.id);
        const replyMessageId = replyRes.body.message.id;

        // Farmer should now have 1 unread message
        const farmerUnreadRes = await request("/api/chat/unread-count", {
            headers: { Authorization: `Bearer ${farmerToken}` }
        });
        assert.equal(farmerUnreadRes.body.total_unread, 1);

        // Polling with ?since_id=firstMessageId returns only the reply
        const pollRes = await request(`/api/chat/conversations/${conversationId}/messages?since_id=${firstMessageId}`, {
            headers: { Authorization: `Bearer ${farmerToken}` }
        });
        assert.equal(pollRes.status, 200);
        assert.equal(pollRes.body.messages.length, 1);
        assert.equal(pollRes.body.messages[0].id, replyMessageId);
        assert.equal(pollRes.body.messages[0].message_text, replyText);
    });
});
