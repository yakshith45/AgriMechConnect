const express = require("express");
const pool = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();
const MAX_MESSAGE_LENGTH = 2000;

// All chat endpoints require a valid authenticated session
router.use(authenticateToken);

function parsePositiveInteger(value, paramName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: `${paramName} must be a valid positive integer.` };
    }
    return { value: parsed };
}

// ---------------------------------------------------------------------------
// GET /api/chat/unread-count
// Returns total unread message count across all conversations for the user
// ---------------------------------------------------------------------------
router.get("/unread-count", async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(
            `SELECT COUNT(*)::INT AS total_unread
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE (c.farmer_id = $1 OR c.owner_id = $1)
               AND m.sender_id <> $1
               AND m.is_read = FALSE`,
            [userId]
        );
        res.json({ total_unread: result.rows[0]?.total_unread || 0 });
    } catch (error) {
        console.error("Failed to fetch unread count:", error.message);
        res.status(500).json({ message: "Could not fetch unread count." });
    }
});

// ---------------------------------------------------------------------------
// GET /api/chat/conversations
// Returns all conversations where user is either farmer or owner
// ---------------------------------------------------------------------------
router.get("/conversations", async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(
            `SELECT
                c.id,
                c.farmer_id,
                c.owner_id,
                c.machinery_id,
                c.created_at,
                c.updated_at,
                farmer.name AS farmer_name,
                farmer.phone AS farmer_phone,
                farmer.email AS farmer_email,
                owner.name AS owner_name,
                owner.phone AS owner_phone,
                owner.email AS owner_email,
                m.name AS machinery_name,
                m.type AS machinery_type,
                m.brand AS machinery_brand,
                m.model AS machinery_model,
                m.price AS machinery_price,
                m.price_unit AS machinery_price_unit,
                m.location AS machinery_location,
                m.image_url AS machinery_image_url,
                (
                    SELECT JSONB_BUILD_OBJECT(
                        'id', lm.id,
                        'sender_id', lm.sender_id,
                        'message_text', lm.message_text,
                        'is_read', lm.is_read,
                        'created_at', lm.created_at
                    )
                    FROM messages lm
                    WHERE lm.conversation_id = c.id
                    ORDER BY lm.created_at DESC, lm.id DESC
                    LIMIT 1
                ) AS last_message,
                (
                    SELECT COUNT(*)::INT
                    FROM messages unread_m
                    WHERE unread_m.conversation_id = c.id
                      AND unread_m.sender_id <> $1
                      AND unread_m.is_read = FALSE
                ) AS unread_count
             FROM conversations c
             JOIN users farmer ON farmer.id = c.farmer_id
             JOIN users owner ON owner.id = c.owner_id
             JOIN machinery m ON m.id = c.machinery_id
             WHERE c.farmer_id = $1 OR c.owner_id = $1
             ORDER BY c.updated_at DESC, c.id DESC`,
            [userId]
        );

        const conversations = result.rows.map(row => {
            const isFarmer = String(row.farmer_id) === String(userId);
            const otherUser = isFarmer
                ? {
                    id: row.owner_id,
                    name: row.owner_name,
                    role: "owner",
                    phone: row.owner_phone,
                    email: row.owner_email
                }
                : {
                    id: row.farmer_id,
                    name: row.farmer_name,
                    role: "farmer",
                    phone: row.farmer_phone,
                    email: row.farmer_email
                };

            return {
                id: row.id,
                farmer_id: row.farmer_id,
                owner_id: row.owner_id,
                machinery_id: row.machinery_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                user_role: isFarmer ? "farmer" : "owner",
                other_user: otherUser,
                machinery: {
                    id: row.machinery_id,
                    name: row.machinery_name,
                    type: row.machinery_type,
                    brand: row.machinery_brand,
                    model: row.machinery_model,
                    price: row.machinery_price,
                    price_unit: row.machinery_price_unit || "day",
                    location: row.machinery_location,
                    image_url: row.machinery_image_url
                },
                last_message: row.last_message || null,
                unread_count: row.unread_count || 0
            };
        });

        res.json({ conversations });
    } catch (error) {
        console.error("Failed to fetch conversations:", error.message);
        res.status(500).json({ message: "Could not fetch conversations." });
    }
});

// ---------------------------------------------------------------------------
// POST /api/chat/conversations
// Create or retrieve an existing conversation for a machinery listing
// ---------------------------------------------------------------------------
router.post("/conversations", async (req, res) => {
    try {
        const { machinery_id: rawMachineryId } = req.body;
        const parsedMachinery = parsePositiveInteger(rawMachineryId, "machinery_id");
        if (parsedMachinery.error) {
            return res.status(400).json({ message: parsedMachinery.error });
        }
        const machineryId = parsedMachinery.value;
        const userId = req.user.id;

        // Fetch machinery listing and owner
        const machineResult = await pool.query(
            `SELECT m.id, m.owner_id, m.name, m.type, m.brand, m.model,
                    m.price, m.price_unit, m.location, m.image_url,
                    u.name AS owner_name, u.phone AS owner_phone, u.email AS owner_email
             FROM machinery m
             JOIN users u ON u.id = m.owner_id
             WHERE m.id = $1`,
            [machineryId]
        );

        if (!machineResult.rows.length) {
            return res.status(404).json({ message: "Machinery listing not found." });
        }

        const machine = machineResult.rows[0];

        // Prevent users from messaging themselves
        if (String(userId) === String(machine.owner_id)) {
            return res.status(400).json({
                message: "You cannot message yourself about your own machinery."
            });
        }

        // Check if conversation already exists between this farmer and machinery
        const existingResult = await pool.query(
            `SELECT id, farmer_id, owner_id, machinery_id, created_at, updated_at
             FROM conversations
             WHERE farmer_id = $1 AND machinery_id = $2`,
            [userId, machineryId]
        );

        let conversationId;
        let isNew = false;
        let conversationRecord;

        if (existingResult.rows.length) {
            conversationRecord = existingResult.rows[0];
            conversationId = conversationRecord.id;
        } else {
            // Create conversation
            const insertResult = await pool.query(
                `INSERT INTO conversations (farmer_id, owner_id, machinery_id)
                 VALUES ($1, $2, $3)
                 RETURNING id, farmer_id, owner_id, machinery_id, created_at, updated_at`,
                [userId, machine.owner_id, machineryId]
            );
            conversationRecord = insertResult.rows[0];
            conversationId = conversationRecord.id;
            isNew = true;
        }

        // Fetch current user details for response
        const userResult = await pool.query(
            "SELECT name, phone, email FROM users WHERE id = $1",
            [userId]
        );
        const farmerInfo = userResult.rows[0] || {};

        const responsePayload = {
            id: conversationRecord.id,
            farmer_id: conversationRecord.farmer_id,
            owner_id: conversationRecord.owner_id,
            machinery_id: conversationRecord.machinery_id,
            created_at: conversationRecord.created_at,
            updated_at: conversationRecord.updated_at,
            user_role: "farmer",
            other_user: {
                id: machine.owner_id,
                name: machine.owner_name,
                role: "owner",
                phone: machine.owner_phone,
                email: machine.owner_email
            },
            machinery: {
                id: machine.id,
                name: machine.name,
                type: machine.type,
                brand: machine.brand,
                model: machine.model,
                price: machine.price,
                price_unit: machine.price_unit || "day",
                location: machine.location,
                image_url: machine.image_url
            },
            last_message: null,
            unread_count: 0
        };

        res.status(isNew ? 201 : 200).json({
            conversation: responsePayload,
            isNew
        });
    } catch (error) {
        console.error("Failed to create or fetch conversation:", error.message);
        res.status(500).json({ message: "Could not open conversation." });
    }
});

// ---------------------------------------------------------------------------
// GET /api/chat/conversations/:id
// Get conversation metadata
// ---------------------------------------------------------------------------
router.get("/conversations/:id", async (req, res) => {
    try {
        const parsedId = parsePositiveInteger(req.params.id, "conversation_id");
        if (parsedId.error) {
            return res.status(400).json({ message: parsedId.error });
        }
        const conversationId = parsedId.value;
        const userId = req.user.id;

        // Check conversation existence and participant permission
        const result = await pool.query(
            `SELECT
                c.id, c.farmer_id, c.owner_id, c.machinery_id, c.created_at, c.updated_at,
                farmer.name AS farmer_name, farmer.phone AS farmer_phone, farmer.email AS farmer_email,
                owner.name AS owner_name, owner.phone AS owner_phone, owner.email AS owner_email,
                m.name AS machinery_name, m.type AS machinery_type, m.brand AS machinery_brand,
                m.model AS machinery_model, m.price AS machinery_price, m.price_unit AS machinery_price_unit,
                m.location AS machinery_location, m.image_url AS machinery_image_url,
                (
                    SELECT COUNT(*)::INT
                    FROM messages unread_m
                    WHERE unread_m.conversation_id = c.id
                      AND unread_m.sender_id <> $1
                      AND unread_m.is_read = FALSE
                ) AS unread_count
             FROM conversations c
             JOIN users farmer ON farmer.id = c.farmer_id
             JOIN users owner ON owner.id = c.owner_id
             JOIN machinery m ON m.id = c.machinery_id
             WHERE c.id = $2`,
            [userId, conversationId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        const row = result.rows[0];
        const isFarmer = String(row.farmer_id) === String(userId);
        const isOwner = String(row.owner_id) === String(userId);

        if (!isFarmer && !isOwner) {
            return res.status(403).json({
                message: "You are not authorized to access this conversation."
            });
        }

        const otherUser = isFarmer
            ? {
                id: row.owner_id,
                name: row.owner_name,
                role: "owner",
                phone: row.owner_phone,
                email: row.owner_email
            }
            : {
                id: row.farmer_id,
                name: row.farmer_name,
                role: "farmer",
                phone: row.farmer_phone,
                email: row.farmer_email
            };

        res.json({
            conversation: {
                id: row.id,
                farmer_id: row.farmer_id,
                owner_id: row.owner_id,
                machinery_id: row.machinery_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                user_role: isFarmer ? "farmer" : "owner",
                other_user: otherUser,
                machinery: {
                    id: row.machinery_id,
                    name: row.machinery_name,
                    type: row.machinery_type,
                    brand: row.machinery_brand,
                    model: row.machinery_model,
                    price: row.machinery_price,
                    price_unit: row.machinery_price_unit || "day",
                    location: row.machinery_location,
                    image_url: row.machinery_image_url
                },
                unread_count: row.unread_count || 0
            }
        });
    } catch (error) {
        console.error("Failed to fetch conversation details:", error.message);
        res.status(500).json({ message: "Could not fetch conversation." });
    }
});

// ---------------------------------------------------------------------------
// GET /api/chat/conversations/:id/messages
// Fetch message history for a conversation; automatically marks messages read
// Optional query: ?since_id=123 for polling new messages
// ---------------------------------------------------------------------------
router.get("/conversations/:id/messages", async (req, res) => {
    try {
        const parsedId = parsePositiveInteger(req.params.id, "conversation_id");
        if (parsedId.error) {
            return res.status(400).json({ message: parsedId.error });
        }
        const conversationId = parsedId.value;
        const userId = req.user.id;

        // Verify participation
        const convCheck = await pool.query(
            "SELECT id, farmer_id, owner_id FROM conversations WHERE id = $1",
            [conversationId]
        );

        if (!convCheck.rows.length) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        const conv = convCheck.rows[0];
        const isParticipant = String(conv.farmer_id) === String(userId) ||
                              String(conv.owner_id) === String(userId);
        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not authorized to view messages in this conversation."
            });
        }

        const sinceId = req.query.since_id ? Number(req.query.since_id) : null;
        if (req.query.since_id && (!Number.isInteger(sinceId) || sinceId < 0)) {
            return res.status(400).json({ message: "Invalid since_id parameter." });
        }

        const messagesResult = await pool.query(
            `SELECT
                m.id,
                m.conversation_id,
                m.sender_id,
                u.name AS sender_name,
                u.role AS sender_role,
                m.message_text,
                m.is_read,
                m.created_at
             FROM messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id = $1
               AND ($2::BIGINT IS NULL OR m.id > $2::BIGINT)
             ORDER BY m.created_at ASC, m.id ASC
             LIMIT 300`,
            [conversationId, sinceId]
        );

        // Mark unread messages sent by the other party as read
        const updateReadResult = await pool.query(
            `UPDATE messages
             SET is_read = TRUE
             WHERE conversation_id = $1
               AND sender_id <> $2
               AND is_read = FALSE
             RETURNING id`,
            [conversationId, userId]
        );

        res.json({
            messages: messagesResult.rows,
            marked_read_count: updateReadResult.rowCount
        });
    } catch (error) {
        console.error("Failed to fetch messages:", error.message);
        res.status(500).json({ message: "Could not fetch messages." });
    }
});

// ---------------------------------------------------------------------------
// POST /api/chat/conversations/:id/messages
// Send a new message in a conversation
// ---------------------------------------------------------------------------
router.post("/conversations/:id/messages", async (req, res) => {
    try {
        const parsedId = parsePositiveInteger(req.params.id, "conversation_id");
        if (parsedId.error) {
            return res.status(400).json({ message: parsedId.error });
        }
        const conversationId = parsedId.value;
        const userId = req.user.id;

        // Verify participation
        const convCheck = await pool.query(
            "SELECT id, farmer_id, owner_id FROM conversations WHERE id = $1",
            [conversationId]
        );

        if (!convCheck.rows.length) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        const conv = convCheck.rows[0];
        const isParticipant = String(conv.farmer_id) === String(userId) ||
                              String(conv.owner_id) === String(userId);
        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not authorized to send messages in this conversation."
            });
        }

        // Validate message_text
        const rawText = req.body.message_text;
        if (typeof rawText !== "string") {
            return res.status(400).json({ message: "Message content must be text." });
        }

        const trimmedText = rawText.trim();
        if (trimmedText.length === 0) {
            return res.status(400).json({ message: "Message content cannot be empty." });
        }

        if (trimmedText.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                message: `Message exceeds the limit of ${MAX_MESSAGE_LENGTH} characters.`
            });
        }

        // Insert message
        const insertResult = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, message_text)
             VALUES ($1, $2, $3)
             RETURNING id, conversation_id, sender_id, message_text, is_read, created_at`,
            [conversationId, userId, trimmedText]
        );

        // Update conversation updated_at so it rises to top of list
        await pool.query(
            "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
            [conversationId]
        );

        // Fetch sender details
        const senderResult = await pool.query(
            "SELECT name, role FROM users WHERE id = $1",
            [userId]
        );
        const sender = senderResult.rows[0] || {};

        const createdMessage = {
            ...insertResult.rows[0],
            sender_name: sender.name || "User",
            sender_role: sender.role || "user"
        };

        res.status(201).json({
            message: createdMessage
        });
    } catch (error) {
        console.error("Failed to send message:", error.message);
        res.status(500).json({ message: "Could not send message." });
    }
});

// ---------------------------------------------------------------------------
// POST /api/chat/conversations/:id/read
// Explicitly mark conversation messages as read
// ---------------------------------------------------------------------------
router.post("/conversations/:id/read", async (req, res) => {
    try {
        const parsedId = parsePositiveInteger(req.params.id, "conversation_id");
        if (parsedId.error) {
            return res.status(400).json({ message: parsedId.error });
        }
        const conversationId = parsedId.value;
        const userId = req.user.id;

        // Verify participation
        const convCheck = await pool.query(
            "SELECT id, farmer_id, owner_id FROM conversations WHERE id = $1",
            [conversationId]
        );

        if (!convCheck.rows.length) {
            return res.status(404).json({ message: "Conversation not found." });
        }

        const conv = convCheck.rows[0];
        const isParticipant = String(conv.farmer_id) === String(userId) ||
                              String(conv.owner_id) === String(userId);
        if (!isParticipant) {
            return res.status(403).json({
                message: "You are not authorized to access this conversation."
            });
        }

        const updateResult = await pool.query(
            `UPDATE messages
             SET is_read = TRUE
             WHERE conversation_id = $1
               AND sender_id <> $2
               AND is_read = FALSE
             RETURNING id`,
            [conversationId, userId]
        );

        res.json({
            success: true,
            marked_read: updateResult.rowCount
        });
    } catch (error) {
        console.error("Failed to mark messages as read:", error.message);
        res.status(500).json({ message: "Could not update read status." });
    }
});

module.exports = router;
