const express = require('express');
const router = express.Router();
const workflow = require('../services/workflow');

/**
 * Agent E Workflow Routes
 */

// Get available workflows
router.get('/types', (req, res) => {
    res.json({
        workflows: Object.entries(workflow.WORKFLOWS).map(([key, value]) => ({
            type: key,
            name: value.name,
            steps: value.steps.length
        }))
    });
});

// Get workflow status for a lead
router.get('/lead/:leadId', async (req, res) => {
    try {
        const status = await workflow.getWorkflowStatus(req.params.leadId);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start a workflow for a lead
router.post('/start', async (req, res) => {
    try {
        const { leadId, workflowType } = req.body;
        
        if (!leadId || !workflowType) {
            return res.status(400).json({ error: 'leadId and workflowType required' });
        }
        
        const result = await workflow.startWorkflow(leadId, workflowType);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel a workflow
router.post('/:workflowId/cancel', async (req, res) => {
    try {
        const result = await workflow.cancelWorkflow(req.params.workflowId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Process pending steps (cron endpoint)
router.post('/process', async (req, res) => {
    try {
        const result = await workflow.processPendingSteps();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
