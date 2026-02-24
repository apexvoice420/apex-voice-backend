const { Pool } = require('pg');
const emailService = require('./email');
const smsService = require('./sms');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

/**
 * Agent E Workflow Engine
 * 
 * Sequences:
 * - NEW_LEAD: Cold intro → 3 day follow-up → 7 day reactivation
 * - DEMO_REQUESTED: Confirmation → 1 day reminder → 1 hour before
 * - NO_ANSWER: SMS + Email follow-up
 * - COLD_LEAD: Reactivation sequence
 */

const WORKFLOWS = {
    // New cold lead sequence
    NEW_LEAD: {
        name: 'New Lead Sequence',
        steps: [
            { delay: 0, type: 'email', template: 'cold_intro' },
            { delay: 3 * 24 * 60 * 60 * 1000, type: 'email', template: 'follow_up' }, // 3 days
            { delay: 7 * 24 * 60 * 60 * 1000, type: 'sms', message: 'reengagement' }, // 7 days
            { delay: 14 * 24 * 60 * 60 * 1000, type: 'email', template: 'reactivation' } // 14 days
        ]
    },
    
    // Demo requested - confirmation sequence
    DEMO_REQUESTED: {
        name: 'Demo Confirmation',
        steps: [
            { delay: 0, type: 'email', template: 'demo_confirmation' },
            { delay: 0, type: 'sms', message: 'demo_confirmed' },
            { delay: 24 * 60 * 60 * 1000, type: 'email', template: 'demo_reminder' }, // 1 day before
            { delay: 1 * 60 * 60 * 1000, type: 'sms', message: 'demo_1hr' } // 1 hour before
        ]
    },
    
    // Call went to voicemail
    NO_ANSWER: {
        name: 'No Answer Follow-up',
        steps: [
            { delay: 5 * 60 * 1000, type: 'sms', message: 'missed_call' }, // 5 min
            { delay: 30 * 60 * 1000, type: 'email', template: 'follow_up' } // 30 min
        ]
    },
    
    // Lead has gone cold (no activity)
    COLD_LEAD: {
        name: 'Reactivation Sequence',
        steps: [
            { delay: 0, type: 'email', template: 'reactivation' },
            { delay: 7 * 24 * 60 * 60 * 1000, type: 'sms', message: 'check_in' } // 7 days
        ]
    }
};

/**
 * Start a workflow for a lead
 */
async function startWorkflow(leadId, workflowType, options = {}) {
    const workflow = WORKFLOWS[workflowType];
    if (!workflow) {
        console.error(`Unknown workflow: ${workflowType}`);
        return { success: false, error: 'Unknown workflow' };
    }

    try {
        // Get lead data
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
        if (leadResult.rows.length === 0) {
            return { success: false, error: 'Lead not found' };
        }
        const lead = leadResult.rows[0];

        // Create workflow instance
        const workflowResult = await pool.query(
            `INSERT INTO lead_workflows (lead_id, workflow_type, workflow_name, status, current_step, total_steps, started_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [leadId, workflowType, workflow.name, 'active', 0, workflow.steps.length]
        );
        
        const workflowInstance = workflowResult.rows[0];

        // Schedule all steps
        for (let i = 0; i < workflow.steps.length; i++) {
            const step = workflow.steps[i];
            const scheduledAt = new Date(Date.now() + step.delay);
            
            await pool.query(
                `INSERT INTO workflow_steps (workflow_id, lead_id, step_index, step_type, template, scheduled_at, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
                [workflowInstance.id, leadId, i, step.type, step.template || step.message, scheduledAt]
            );
        }

        console.log(`✅ Started workflow "${workflow.name}" for lead ${leadId}`);
        
        // Execute first step immediately if delay is 0
        if (workflow.steps[0].delay === 0) {
            await executeNextStep(workflowInstance.id);
        }

        return { success: true, workflowId: workflowInstance.id };

    } catch (error) {
        console.error('Start workflow error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Execute the next pending step in a workflow
 */
async function executeNextStep(workflowId) {
    try {
        // Get next pending step
        const stepResult = await pool.query(
            `SELECT ws.*, l.name, l.email, l.phone, l.business_type, lw.workflow_type
             FROM workflow_steps ws
             JOIN leads l ON ws.lead_id = l.id
             JOIN lead_workflows lw ON ws.workflow_id = lw.id
             WHERE ws.workflow_id = $1 
             AND ws.status = 'pending' 
             AND ws.scheduled_at <= NOW()
             ORDER BY ws.step_index ASC
             LIMIT 1`,
            [workflowId]
        );

        if (stepResult.rows.length === 0) {
            return { success: false, message: 'No pending steps' };
        }

        const step = stepResult.rows[0];
        const leadData = {
            ...step,
            firstName: step.name?.split(' ')[0] || 'there',
            businessType: step.business_type
        };

        let result;

        // Execute based on step type
        if (step.step_type === 'email') {
            switch (step.template) {
                case 'cold_intro':
                    result = await emailService.sendColdIntro(leadData);
                    break;
                case 'follow_up':
                    result = await emailService.sendFollowUp(leadData);
                    break;
                case 'demo_confirmation':
                case 'demo_reminder':
                    result = await emailService.sendDemoConfirmation(leadData);
                    break;
                case 'reactivation':
                    result = await emailService.sendReactivation(leadData);
                    break;
                default:
                    result = await emailService.sendColdIntro(leadData);
            }
        } else if (step.step_type === 'sms') {
            const smsMessages = {
                missed_call: `Hey ${leadData.firstName}, I tried reaching you about your ${leadData.businessType || 'service'} business. Give me a call back when you have a minute - Maurice at Apex Voice`,
                demo_confirmed: `🎉 Demo confirmed! Check your email for details. Reply to reschedule.`,
                demo_1hr: `⏰ Your demo starts in 1 hour. Here's the link: https://cal.com/maurice-pinnock-lrwndd`,
                reengagement: `Hey ${leadData.firstName}, still interested in 24/7 call answering? Reply YES or call me back.`,
                check_in: `Quick check-in - are you still taking on new customers? Reply YES to chat.`
            };
            
            result = await smsService.sendLeadSMS(
                step.phone,
                smsMessages[step.template] || smsMessages.reengagement,
                'Apex Voice Solutions'
            );
        }

        // Update step status
        await pool.query(
            `UPDATE workflow_steps SET 
                status = $1, 
                executed_at = NOW(), 
                result = $2
             WHERE id = $3`,
            [result.success ? 'completed' : 'failed', JSON.stringify(result), step.id]
        );

        // Update workflow progress
        await pool.query(
            `UPDATE lead_workflows SET 
                current_step = current_step + 1,
                last_executed_at = NOW()
             WHERE id = $1`,
            [workflowId]
        );

        // Check if workflow complete
        const workflowResult = await pool.query(
            `SELECT current_step, total_steps FROM lead_workflows WHERE id = $1`,
            [workflowId]
        );
        
        if (workflowResult.rows[0]?.current_step >= workflowResult.rows[0]?.total_steps) {
            await pool.query(
                `UPDATE lead_workflows SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                [workflowId]
            );
        }

        return result;

    } catch (error) {
        console.error('Execute step error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Process all pending workflow steps (cron job)
 */
async function processPendingSteps() {
    try {
        // Get all pending steps that are due
        const stepsResult = await pool.query(
            `SELECT DISTINCT workflow_id FROM workflow_steps 
             WHERE status = 'pending' AND scheduled_at <= NOW()`
        );

        console.log(`📧 Processing ${stepsResult.rows.length} pending workflows...`);

        for (const row of stepsResult.rows) {
            await executeNextStep(row.workflow_id);
        }

        return { processed: stepsResult.rows.length };

    } catch (error) {
        console.error('Process pending steps error:', error);
        return { error: error.message };
    }
}

/**
 * Get workflow status for a lead
 */
async function getWorkflowStatus(leadId) {
    try {
        const result = await pool.query(
            `SELECT lw.*, 
                    (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = lw.id AND status = 'completed') as completed_steps
             FROM lead_workflows lw
             WHERE lw.lead_id = $1
             ORDER BY lw.started_at DESC`,
            [leadId]
        );

        return result.rows;

    } catch (error) {
        console.error('Get workflow status error:', error);
        return [];
    }
}

/**
 * Cancel workflow
 */
async function cancelWorkflow(workflowId) {
    try {
        await pool.query(`UPDATE lead_workflows SET status = 'cancelled' WHERE id = $1`, [workflowId]);
        await pool.query(`UPDATE workflow_steps SET status = 'cancelled' WHERE workflow_id = $1 AND status = 'pending'`, [workflowId]);
        
        return { success: true };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    WORKFLOWS,
    startWorkflow,
    executeNextStep,
    processPendingSteps,
    getWorkflowStatus,
    cancelWorkflow
};
