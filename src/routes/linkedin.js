/**
 * LinkedIn Posting API Routes
 * Handles scheduling, queue management, and publishing
 */

const express = require('express');
const router = express.Router();
const linkedin = require('../services/linkedin');

// Check if LinkedIn is configured
router.get('/status', async (req, res) => {
    const configured = linkedin.isConfigured();
    
    let profileInfo = null;
    if (configured) {
        try {
            profileInfo = await linkedin.getProfileInfo();
        } catch (e) {
            profileInfo = { error: e.message };
        }
    }

    res.json({
        configured,
        profile: profileInfo,
        message: configured ? 'LinkedIn agent ready' : 'Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD in environment'
    });
});

// Get all scheduled posts
router.get('/posts', async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const result = await db.query(`
            SELECT * FROM linkedin_posts 
            ORDER BY scheduled_for ASC
        `);
        
        res.json({ posts: result.rows });
    } catch (error) {
        console.error('Error fetching LinkedIn posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

// Schedule a new post
router.post('/posts', async (req, res) => {
    const db = req.app.locals.db;
    const { content, imageUrl, scheduledFor, timezone = 'America/New_York' } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'Content is required' });
    }

    // Default to next morning at 8 AM if no schedule provided
    let scheduledTime;
    if (scheduledFor) {
        scheduledTime = new Date(scheduledFor);
    } else {
        // Default: next morning at 8 AM
        const now = new Date();
        scheduledTime = new Date(now);
        scheduledTime.setDate(scheduledTime.getDate() + 1);
        scheduledTime.setHours(8, 0, 0, 0);
    }

    try {
        const result = await db.query(`
            INSERT INTO linkedin_posts (content, image_url, scheduled_for, timezone, status)
            VALUES ($1, $2, $3, $4, 'scheduled')
            RETURNING *
        `, [content, imageUrl || null, scheduledTime, timezone]);

        res.status(201).json({ 
            success: true, 
            post: result.rows[0],
            message: `Post scheduled for ${scheduledTime.toLocaleString('en-US', { timeZone: timezone })}`
        });
    } catch (error) {
        console.error('Error scheduling LinkedIn post:', error);
        res.status(500).json({ error: 'Failed to schedule post' });
    }
});

// Update a scheduled post
router.put('/posts/:id', async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;
    const { content, imageUrl, scheduledFor } = req.body;

    try {
        const result = await db.query(`
            UPDATE linkedin_posts 
            SET 
                content = COALESCE($1, content),
                image_url = COALESCE($2, image_url),
                scheduled_for = COALESCE($3, scheduled_for),
                updated_at = NOW()
            WHERE id = $4 AND status = 'scheduled'
            RETURNING *
        `, [content, imageUrl, scheduledFor, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found or already published' });
        }

        res.json({ success: true, post: result.rows[0] });
    } catch (error) {
        console.error('Error updating LinkedIn post:', error);
        res.status(500).json({ error: 'Failed to update post' });
    }
});

// Delete a scheduled post
router.delete('/posts/:id', async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;

    try {
        const result = await db.query(`
            DELETE FROM linkedin_posts 
            WHERE id = $1 AND status = 'scheduled'
            RETURNING id
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found or already published' });
        }

        res.json({ success: true, message: 'Post deleted' });
    } catch (error) {
        console.error('Error deleting LinkedIn post:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// Publish a post immediately (manual trigger)
router.post('/posts/:id/publish', async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;

    if (!linkedin.isConfigured()) {
        return res.status(400).json({ 
            error: 'LinkedIn not configured',
            message: 'Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD environment variables'
        });
    }

    try {
        // Get the post
        const postResult = await db.query('SELECT * FROM linkedin_posts WHERE id = $1', [id]);
        const post = postResult.rows[0];

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (post.status === 'published') {
            return res.status(400).json({ error: 'Post already published' });
        }

        // Mark as publishing
        await db.query("UPDATE linkedin_posts SET status = 'publishing' WHERE id = $1", [id]);

        // Publish to LinkedIn
        let result;
        if (post.image_url) {
            result = await linkedin.postWithImage(post.content, post.image_url);
        } else {
            result = await linkedin.postText(post.content);
        }

        if (result.success) {
            // Update post status
            await db.query(`
                UPDATE linkedin_posts 
                SET status = 'published', published_at = NOW(), error_message = NULL
                WHERE id = $1
            `, [id]);

            res.json({ 
                success: true, 
                message: 'Post published to LinkedIn',
                publishedAt: new Date().toISOString()
            });
        } else {
            // Mark as failed
            await db.query(`
                UPDATE linkedin_posts 
                SET status = 'failed', error_message = $1
                WHERE id = $2
            `, [result.error, id]);

            res.status(500).json({ 
                success: false, 
                error: result.error,
                message: 'Failed to publish post'
            });
        }

    } catch (error) {
        console.error('Publish error:', error);
        
        // Mark as failed
        await db.query(`
            UPDATE linkedin_posts 
            SET status = 'failed', error_message = $1
            WHERE id = $2
        `, [error.message, id]);

        res.status(500).json({ error: error.message });
    }
});

// Get post history (published posts)
router.get('/history', async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const result = await db.query(`
            SELECT * FROM linkedin_posts 
            WHERE status IN ('published', 'failed')
            ORDER BY published_at DESC NULLS LAST
            LIMIT 50
        `);
        
        res.json({ history: result.rows });
    } catch (error) {
        console.error('Error fetching post history:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Process scheduled posts (called by cron job)
router.post('/process-queue', async (req, res) => {
    const db = req.app.locals.db;

    if (!linkedin.isConfigured()) {
        return res.status(400).json({ error: 'LinkedIn not configured' });
    }

    try {
        // Get posts scheduled for now or earlier
        const result = await db.query(`
            SELECT * FROM linkedin_posts 
            WHERE status = 'scheduled' 
            AND scheduled_for <= NOW()
            ORDER BY scheduled_for ASC
            LIMIT 5
        `);

        const postsToPublish = result.rows;
        const results = [];

        for (const post of postsToPublish) {
            // Mark as publishing
            await db.query("UPDATE linkedin_posts SET status = 'publishing' WHERE id = $1", [post.id]);

            // Publish
            let publishResult;
            if (post.image_url) {
                publishResult = await linkedin.postWithImage(post.content, post.image_url);
            } else {
                publishResult = await linkedin.postText(post.content);
            }

            if (publishResult.success) {
                await db.query(`
                    UPDATE linkedin_posts 
                    SET status = 'published', published_at = NOW()
                    WHERE id = $1
                `, [post.id]);
                results.push({ id: post.id, status: 'published' });
            } else {
                await db.query(`
                    UPDATE linkedin_posts 
                    SET status = 'failed', error_message = $1
                    WHERE id = $2
                `, [publishResult.error, post.id]);
                results.push({ id: post.id, status: 'failed', error: publishResult.error });
            }

            // Random delay between posts
            await linkedin.randomDelay(3000, 6000);
        }

        res.json({ 
            processed: results.length,
            results 
        });

    } catch (error) {
        console.error('Queue processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Close browser session
router.post('/disconnect', async (req, res) => {
    await linkedin.closeBrowser();
    res.json({ success: true, message: 'LinkedIn session closed' });
});

module.exports = router;
