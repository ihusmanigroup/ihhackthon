import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query } from './db/db';
import {
  ingestCompanyKnowledge,
  discoverAndFilterLeads,
  performDeepResearchAndQualification,
  generateAndSendOutreach,
  processInboundResponse,
  retrieveKnowledge,
  getActivityLogs,
  getFollowUps,
  markDoNotContact,
  executeFollowUp,
  runSchedulerOnce
} from './services/agentEngine';
import { startScheduler } from './scheduler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), demoMode: process.env.DEMO_MODE === 'true' });
});

// 2. Dashboard KPIs & Snapshot
app.get('/api/dashboard', async (req, res) => {
  try {
    const leadsCount = await query(`SELECT COUNT(*) FROM leads`);
    const qualifiedCount = await query(`SELECT COUNT(*) FROM leads WHERE stage = 'Qualified'`);
    const contactedCount = await query(`SELECT COUNT(*) FROM leads WHERE stage = 'Contacted'`);
    const meetingsCount = await query(`SELECT COUNT(*) FROM meetings`);
    const recentLeads = await query(`SELECT * FROM leads ORDER BY created_at DESC LIMIT 8`);
    const upcomingMeetings = await query(`SELECT m.*, l.name as lead_name FROM meetings m JOIN leads l ON m.lead_id = l.id ORDER BY m.meeting_time ASC LIMIT 5`);

    res.json({
      kpis: {
        totalLeads: parseInt(leadsCount.rows[0]?.count || '0'),
        qualified: parseInt(qualifiedCount.rows[0]?.count || '0'),
        contacted: parseInt(contactedCount.rows[0]?.count || '0'),
        meetings: parseInt(meetingsCount.rows[0]?.count || '0')
      },
      recentLeads: recentLeads.rows,
      upcomingMeetings: upcomingMeetings.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Company Ingestion (RAG)
app.post('/api/company/ingest', async (req, res) => {
  try {
    const { name, rawText, sourceType } = req.body;
    const profile = await ingestCompanyKnowledge(
      name || 'AgentHack AI Corp',
      rawText || 'We build AI agents for sales and support automation.',
      sourceType || 'TEXT'
    );
    res.json({ success: true, profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/company', async (req, res) => {
  try {
    const profile = await query(`SELECT * FROM company_profiles ORDER BY created_at DESC LIMIT 1`);
    res.json(profile.rows[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. ICP Creation
app.post('/api/icp', async (req, res) => {
  try {
    const { location, industry, companySize, targetProblem, exclusions } = req.body;
    const result = await query(
      `INSERT INTO icps (location, industry, company_size, target_problem, exclusions)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [location, industry, companySize, targetProblem, exclusions]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Leads Endpoints
app.post('/api/leads/discover', async (req, res) => {
  try {
    const { icpId } = req.body;
    const leads = await discoverAndFilterLeads(icpId);
    res.json({ success: true, count: leads.length, leads });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads', async (req, res) => {
  try {
    const leads = await query(`SELECT * FROM leads ORDER BY created_at DESC`);
    res.json(leads.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/:id', async (req, res) => {
  try {
    const lead = await query(`SELECT * FROM leads WHERE id = $1`, [req.params.id]);
    if (!lead.rows[0]) return res.status(404).json({ error: 'Lead not found' });

    const evidences = await query(`SELECT * FROM research_evidences WHERE lead_id = $1 ORDER BY created_at ASC`, [req.params.id]);
    const contacts = await query(`SELECT * FROM contacts WHERE lead_id = $1 ORDER BY relevance DESC`, [req.params.id]);
    const messages = await query(`SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at ASC`, [req.params.id]);
    const memories = await query(`SELECT * FROM memories WHERE lead_id = $1 ORDER BY created_at DESC`, [req.params.id]);
    const followUps = await query(`SELECT * FROM follow_up_tasks WHERE lead_id = $1`, [req.params.id]);
    const meetings = await query(`SELECT * FROM meetings WHERE lead_id = $1`, [req.params.id]);

    res.json({
      lead: lead.rows[0],
      evidences: evidences.rows,
      contacts: contacts.rows,
      messages: messages.rows,
      memories: memories.rows,
      followUps: followUps.rows,
      meetings: meetings.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Deep Research Trigger
app.post('/api/leads/:id/research', async (req, res) => {
  try {
    const updated = await performDeepResearchAndQualification(req.params.id);
    res.json({ success: true, lead: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Outreach Trigger
app.post('/api/leads/:id/outreach', async (req, res) => {
  try {
    const { contactId } = req.body;
    const msg = await generateAndSendOutreach(req.params.id, contactId);
    res.json({ success: true, message: msg });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Inbound Reply Simulation
app.post('/api/leads/:id/reply', async (req, res) => {
  try {
    const { replyText } = req.body;
    const result = await processInboundResponse(req.params.id, replyText);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Meetings List
app.get('/api/meetings', async (req, res) => {
  try {
    const result = await query(`SELECT m.*, l.name as lead_name FROM meetings m JOIN leads l ON m.lead_id = l.id ORDER BY m.meeting_time ASC`);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. RAG Semantic Retrieval over company knowledge
app.post('/api/company/retrieve', async (req, res) => {
  try {
    const { profileId, query: q, topK } = req.body;
    const hits = await retrieveKnowledge(profileId, q || 'customer support automation', topK || 3);
    res.json({ success: true, hits });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Agent Activity / Audit Log
app.get('/api/activity', async (req, res) => {
  try {
    res.json(await getActivityLogs(parseInt(req.query.limit as string) || 50));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Follow-Up Tasks
app.get('/api/followups', async (req, res) => {
  try {
    res.json(await getFollowUps());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Execute a specific follow-up now (Email #2)
app.post('/api/leads/:id/followup', async (req, res) => {
  try {
    const followUps = await query(`SELECT id FROM follow_up_tasks WHERE lead_id = $1 AND status = 'pending' ORDER BY scheduled_for ASC`, [req.params.id]);
    const task = followUps.rows[0];
    if (!task) return res.status(404).json({ error: 'No pending follow-up for this lead' });
    const msg = await executeFollowUp(task.id);
    res.json({ success: true, message: msg });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Mark Do Not Contact
app.post('/api/leads/:id/dnc', async (req, res) => {
  try {
    const lead = await markDoNotContact(req.params.id);
    res.json({ success: true, lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Manual scheduler run (durable jobs: follow-ups + reminders)
app.post('/api/scheduler/run', async (req, res) => {
  try {
    const result = await runSchedulerOnce();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js Sales Agent Server running on http://localhost:${PORT}`);
  startScheduler();
});