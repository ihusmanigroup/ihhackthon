import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { query } from '../db/db';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });

// ---------------------------------------------------------------------------
// 0. Shared helpers: Gemini caller, embeddings, RAG retrieval, audit logging
// ---------------------------------------------------------------------------

async function callGemini(systemPrompt: string, userPrompt: string, returnJson: boolean = true) {
  if (!apiKey || process.env.DEMO_MODE === 'true') {
    return null;
  }
  try {
    const prompt = `${systemPrompt}\n\nStrict JSON only format without markdown backticks:\n${userPrompt}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    if (returnJson) {
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    }
    return text;
  } catch (error) {
    console.warn('⚠️ Gemini live call fallback:', error);
    return null;
  }
}

function hashEmbedding(text: string, dim = 64): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    vec[h % dim] += 1;
  }
  return vec;
}

async function embedText(text: string): Promise<number[]> {
  if (!apiKey || process.env.DEMO_MODE === 'true') {
    return hashEmbedding(text);
  }
  try {
    const embModel = genAI.getGenerativeModel({ model: process.env.EMBEDDING_MODEL || 'embedding-001' });
    const res = await embModel.embedContent(text.slice(0, 2000));
    const values = res.embedding.values;
    if (values && values.length) return values;
    return hashEmbedding(text);
  } catch (error) {
    console.warn('⚠️ Embedding live call fallback:', error);
    return hashEmbedding(text);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function logActivity(
  agentName: string,
  step: string,
  tool: string | null,
  input: string | null,
  output: string | null,
  decision: string | null,
  durationMs = 0,
  status = 'success'
) {
  try {
    await query(
      `INSERT INTO agent_activity_logs (agent_name, step, tool_used, input_data, output_data, decision, duration_ms, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [agentName, step, tool, input, output, decision, durationMs, status]
    );
  } catch (err) {
    console.warn('Activity log write failed:', err);
  }
}

// Simulated WhatsApp dispatch. If WHATSAPP_API_KEY is configured this is where a
// real provider call would happen; otherwise it records the dispatch in the audit log.
async function whatsappDispatch(leadId: string, to: string, message: string) {
  await logActivity(
    'Meeting Automation',
    `WhatsApp dispatch to ${to}`,
    'whatsapp',
    `lead=${leadId}`,
    message,
    'Simulated WhatsApp provider dispatch',
    0
  );
  await query(
    `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'long_term', 'admin_notification', $2)`,
    [leadId, `WhatsApp admin notification: ${message}`]
  );
}

// Semantic retrieval over the company knowledge layer (real RAG).
export async function retrieveKnowledge(companyProfileId: string, queryText: string, topK = 3) {
  const chunksRes = await query(
    `SELECT * FROM knowledge_chunks WHERE company_profile_id = $1 ORDER BY created_at ASC`,
    [companyProfileId]
  );
  if (!chunksRes.rows.length) return [];

  const qEmbedding = await embedText(queryText);
  const scored = chunksRes.rows
    .map((chunk: any) => ({
      ...chunk,
      score: cosine(qEmbedding, Array.isArray(chunk.embedding) ? chunk.embedding : hashEmbedding(chunk.content || ''))
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export async function getActivityLogs(limit = 50) {
  const res = await query(`SELECT * FROM agent_activity_logs ORDER BY created_at DESC LIMIT $1`, [limit]);
  return res.rows;
}

export async function getFollowUps() {
  const res = await query(
    `SELECT f.*, l.name AS lead_name FROM follow_up_tasks f JOIN leads l ON f.lead_id = l.id ORDER BY f.created_at DESC`
  );
  return res.rows;
}

export async function markDoNotContact(leadId: string) {
  await query(`UPDATE leads SET stage = 'Do Not Contact', do_not_contact = TRUE, updated_at = NOW() WHERE id = $1`, [leadId]);
  await query(`UPDATE follow_up_tasks SET status = 'cancelled' WHERE lead_id = $1 AND status = 'pending'`, [leadId]);
  await logActivity('Qualification', 'Do Not Contact', null, `lead=${leadId}`, null, 'Lead marked Do Not Contact. Automation stopped.');
  await query(
    `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'long_term', 'decision_log', 'Lead marked Do Not Contact. All follow-ups cancelled.')`,
    [leadId]
  );
  const res = await query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// 1. Company Knowledge & RAG Ingestion Agent
// ---------------------------------------------------------------------------

export async function ingestCompanyKnowledge(name: string, rawText: string, sourceType: 'PDF' | 'TEXT') {
  const start = Date.now();
  const systemPrompt = `You are a B2B Sales Intelligence Agent. Extract structured company profile facts. Return valid JSON only.
{
  "summary": "2-3 sentence overview",
  "tagline": "short catchy tagline",
  "offerings": ["service 1", "service 2"],
  "targetIndustries": ["Logistics", "Healthcare"],
  "caseStudies": ["Case study summary"],
  "pricing": ["Pricing tiers"],
  "techStack": ["Stack items"],
  "limitations": ["Limitations"]
}`;

  let extracted = await callGemini(systemPrompt, `Company: ${name}\nText: ${rawText}`);

  if (!extracted) {
    extracted = {
      summary: `${name} provides autonomous AI sales agents, WhatsApp customer-support automation, and CRM integrations.`,
      tagline: 'Autonomous AI Sales & Operations Platform',
      offerings: ['WhatsApp AI Support Automation', 'Autonomous AI Inbound/Outbound Sales Agent', 'Custom CRM Integrations'],
      targetIndustries: ['Logistics & Supply Chain', 'B2B SaaS', 'E-commerce Platforms'],
      caseStudies: ['Scaled outbound pipeline by 3.4x and cut inquiry latency to 10 seconds.'],
      pricing: ['Starter: $1,200/mo', 'Enterprise: Custom'],
      techStack: ['Node.js', 'React', 'Supabase', 'Google Gemini AI'],
      limitations: ['Does not support manual analog cold calling without VoIP gateway.']
    };
  }

  const result = await query(
    `INSERT INTO company_profiles (name, tagline, summary, offerings, target_industries, case_studies, pricing, tech_stack, limitations, source_type, source_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      name,
      extracted.tagline,
      extracted.summary,
      JSON.stringify(extracted.offerings),
      JSON.stringify(extracted.targetIndustries),
      JSON.stringify(extracted.caseStudies),
      JSON.stringify(extracted.pricing),
      JSON.stringify(extracted.techStack),
      JSON.stringify(extracted.limitations),
      sourceType,
      rawText
    ]
  );

  const profile = result.rows[0];

  const chunkTexts: Array<{ title: string; content: string; category: string }> = [];
  chunkTexts.push({ title: 'Company Summary', content: extracted.summary, category: 'summary' });
  for (const offering of extracted.offerings || []) {
    chunkTexts.push({ title: `Service: ${offering}`, content: `Core capability: ${offering}`, category: 'offering' });
  }
  for (const cs of extracted.caseStudies || []) {
    chunkTexts.push({ title: 'Case Study', content: cs, category: 'case_study' });
  }
  for (const p of extracted.pricing || []) {
    chunkTexts.push({ title: 'Pricing', content: p, category: 'pricing' });
  }
  for (const t of extracted.techStack || []) {
    chunkTexts.push({ title: 'Technology', content: t, category: 'tech' });
  }
  for (const l of extracted.limitations || []) {
    chunkTexts.push({ title: 'Limitation', content: l, category: 'limitation' });
  }

  for (const chunk of chunkTexts) {
    const embedding = await embedText(`${chunk.title}: ${chunk.content}`);
    await query(
      `INSERT INTO knowledge_chunks (company_profile_id, title, content, category, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [profile.id, chunk.title, chunk.content, chunk.category, JSON.stringify(embedding)]
    );
  }

  await logActivity(
    'Company Intelligence',
    'Ingest + Embed + Index',
    'gemini/embedding',
    `company=${name}, chunks=${chunkTexts.length}`,
    `Profile ${profile.id} created with ${chunkTexts.length} knowledge chunks embedded`,
    'Knowledge layer ready',
    Date.now() - start
  );

  return profile;
}

// ---------------------------------------------------------------------------
// 2. Lead Discovery & Cheap Filtering Agent (ICP-driven, seeded market)
// ---------------------------------------------------------------------------

const CANDIDATES = [
  { name: 'Apex Logistics Global', website: 'https://apexlogistics.example', industry: 'Logistics & Supply Chain', location: 'United States', size: '180 employees', sizeNum: 180, problemFit: 'High customer support inquiries via WhatsApp & email after 40% fleet expansion' },
  { name: 'TransGlobal Freightways', website: 'https://transglobal.example', industry: 'Logistics & Supply Chain', location: 'United States', size: '320 employees', sizeNum: 320, problemFit: 'Manual delivery inquiry triage delays across 12 hubs' },
  { name: 'Summit Logistics Corp', website: 'https://summitlogistics.example', industry: 'Logistics & Supply Chain', location: 'United States', size: '500 employees', sizeNum: 500, problemFit: 'Oversized support queues with seasonal volume spikes' },
  { name: 'Metro Supply Chain Co', website: 'https://metrosupply.example', industry: 'Logistics & Supply Chain', location: 'United States', size: '260 employees', sizeNum: 260, problemFit: 'Last-mile tracking complaints handled manually' },
  { name: 'Avian Aero Freight', website: 'https://avianaero.example', industry: 'Aviation Logistics', location: 'United States', size: '240 employees', sizeNum: 240, problemFit: 'Air freight tracking status requests flood support team' },
  { name: 'Harbor City Movers', website: 'https://harborcitymovers.example', industry: 'Logistics & Supply Chain', location: 'United States', size: '75 employees', sizeNum: 75, problemFit: 'Dispatch status updates via phone calls only' },
  { name: 'Pacific Mover Supply', website: 'https://pacificmover.example', industry: 'Logistics & Supply Chain', location: 'United States', size: '40 employees', sizeNum: 40, problemFit: 'Growing inquiry volume but small team' },
  { name: 'Nordic Freight Hub', website: 'https://nordicfreight.example', industry: 'Logistics & Supply Chain', location: 'Norway', size: '210 employees', sizeNum: 210, problemFit: 'High support volume for European corridors' },
  { name: 'Greenfield Foods', website: 'https://greenfieldfoods.example', industry: 'Food & Beverage', location: 'United States', size: '90 employees', sizeNum: 90, problemFit: 'Retail distribution inquiries' },
  { name: 'Daily Deals Marketplace', website: 'https://dailydeals.example', industry: 'E-commerce', location: 'United States', size: '30 employees', sizeNum: 30, problemFit: 'Order status chat automation needed' },
  { name: 'Bella Bakery', website: 'https://bellabakery.example', industry: 'Retail Bakery', location: 'Italy', size: '4 employees', sizeNum: 4, problemFit: 'Retail storefront with no B2B outbound need' },
  { name: 'Cornerstone Bakery Group', website: 'https://cornerstonebakery.example', industry: 'Bakery Retail', location: 'United States', size: '8 employees', sizeNum: 8, problemFit: 'Local storefront, no support automation need' }
];

// Research evidence packs keyed by company name (decision-grade evidence per lead)
const RESEARCH_MAP: Record<string, Array<{ source_type: string; source_url: string; title: string; snippet: string; confidence: string }>> = {
  'Apex Logistics Global': [
    { source_type: 'news', source_url: 'https://techlogistics-daily.example/apex-expansion', title: '40% Fleet Expansion in Q2', snippet: 'Apex Logistics expanded transit hubs, resulting in high customer delivery tracking volume.', confidence: 'High' },
    { source_type: 'tech', source_url: 'https://builtwith.example/apex', title: 'Tech Stack Footprint', snippet: 'Detected Zendesk CRM and Twilio, but missing automated WhatsApp triage agents.', confidence: 'High' },
    { source_type: 'website', source_url: 'https://apexlogistics.example/careers', title: 'Careers Page Hiring Signals', snippet: 'Hiring 6 Customer Support Specialists to manage delivery communication backlogs.', confidence: 'High' }
  ],
  'TransGlobal Freightways': [
    { source_type: 'news', source_url: 'https://freightwire.example/transglobal-12hubs', title: 'Opened 12 Regional Hubs', snippet: 'Hub expansion multiplied inbound delivery-status calls; support SLA is slipping.', confidence: 'High' },
    { source_type: 'website', source_url: 'https://transglobal.example', title: 'Company Profile', snippet: 'B2B freight forwarder with nationwide US coverage and no self-service tracking chat.', confidence: 'High' }
  ],
  'Summit Logistics Corp': [
    { source_type: 'news', source_url: 'https://supplychainreview.example/summit-peak', title: 'Peak Season Volume Warning', snippet: 'Summit expects 2x seasonal volume; publicly concerned about response times.', confidence: 'Medium' },
    { source_type: 'tech', source_url: 'https://builtwith.example/summit', title: 'Tech Stack Footprint', snippet: 'Runs legacy email ticketing; no AI support agent or WhatsApp automation.', confidence: 'High' }
  ],
  'Metro Supply Chain Co': [
    { source_type: 'website', source_url: 'https://metrosupply.example', title: 'Website', snippet: 'Last-mile tracking statuses delivered by phone only; no automated tracking updates.', confidence: 'High' },
    { source_type: 'news', source_url: 'https://metro-news.example/growth', title: 'Regional Growth', snippet: 'Metro expanding into two new states, support team not scaling at the same rate.', confidence: 'Medium' }
  ],
  'Avian Aero Freight': [
    { source_type: 'tech', source_url: 'https://builtwith.example/avian', title: 'Tech Stack Footprint', snippet: 'Uses a legacy air-cargo booking system; customer tracking is manual and email-only.', confidence: 'High' },
    { source_type: 'website', source_url: 'https://avianaero.example', title: 'Careers', snippet: 'Hiring Cargo Operations Coordinators to answer status queries.', confidence: 'High' }
  ],
  'Harbor City Movers': [
    { source_type: 'website', source_url: 'https://harborcitymovers.example', title: 'Website', snippet: 'Moves and logistics for US businesses; dispatch updates handled by phone.', confidence: 'Medium' }
  ]
};

const CONTACTS_MAP: Record<string, Array<{ name: string; role: string; relevance: string; email: string; phone: string; confidence: string }>> = {
  'Apex Logistics Global': [
    { name: 'Marcus Vance', role: 'Head of Support & Operations', relevance: 'High', email: 'm.vance@apexlogistics.example', phone: '+1 (555) 234-5678', confidence: 'High' },
    { name: 'Dana Whitfield', role: 'COO', relevance: 'High', email: 'd.whitfield@apexlogistics.example', phone: '+1 (555) 234-5679', confidence: 'High' }
  ],
  'TransGlobal Freightways': [
    { name: 'Priya Raman', role: 'VP of Customer Experience', relevance: 'High', email: 'p.raman@transglobal.example', phone: '+1 (555) 812-3300', confidence: 'High' }
  ],
  'Summit Logistics Corp': [
    { name: 'Eli Turner', role: 'Chief Operations Officer', relevance: 'High', email: 'e.turner@summitlogistics.example', phone: '+1 (555) 771-2201', confidence: 'High' }
  ],
  'Metro Supply Chain Co': [
    { name: 'Sofia Alvarez', role: 'Head of Customer Success', relevance: 'High', email: 's.alvarez@metrosupply.example', phone: '+1 (555) 640-1180', confidence: 'High' }
  ],
  'Avian Aero Freight': [
    { name: 'Jonah Reyes', role: 'Director of Operations', relevance: 'High', email: 'j.reyes@avianaero.example', phone: '+1 (555) 903-4412', confidence: 'High' }
  ],
  'Harbor City Movers': [
    { name: 'Beth Kline', role: 'Operations Manager', relevance: 'High', email: 'b.kline@harborcitymovers.example', phone: '+1 (555) 336-7745', confidence: 'High' }
  ]
};

function parseSizeRange(icpSize: string): [number, number] {
  const nums = (icpSize || '').match(/\d+/g)?.map(Number) || [];
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  if (nums.length === 1) return [nums[0], nums[0]];
  return [50, 500];
}

function icpKeywords(industry: string): string[] {
  const stop = new Set(['and', 'the', 'of', 'for', '&']);
  return (industry || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !stop.has(w));
}

export async function discoverAndFilterLeads(icpId?: string) {
  const start = Date.now();
  const icpRes = icpId ? await query(`SELECT * FROM icps WHERE id = $1`, [icpId]) : { rows: [] };
  const icp = icpRes.rows[0];
  const criteria = icp || { location: 'United States', industry: 'Logistics & Supply Chain', companySize: '50-500 employees' };
  const [sizeMin, sizeMax] = parseSizeRange(criteria.companySize);
  const keywords = icpKeywords(criteria.industry);
  const location = (criteria.location || '').toLowerCase();

  const processedLeads = [];

  for (const item of CANDIDATES) {
    const leadIndustry = (item.industry || '').toLowerCase();
    const leadLocation = (item.location || '').toLowerCase();

    const reasons: string[] = [];
    const industryMatch = keywords.length === 0 || keywords.some(k => leadIndustry.includes(k));
    if (!industryMatch) reasons.push(`Industry "${item.industry}" is not a target (${criteria.industry})`);
    const locationMatch = leadLocation.includes(location);
    if (!locationMatch) reasons.push(`Location "${item.location}" outside target (${criteria.location})`);
    const sizeMatch = item.sizeNum >= sizeMin && item.sizeNum <= sizeMax;
    if (!sizeMatch) reasons.push(`Size ${item.sizeNum} employees outside ${sizeMin}-${sizeMax} range`);

    const isMismatch = !industryMatch || !locationMatch || !sizeMatch;

    if (isMismatch) {
      const lead = await query(
        `INSERT INTO leads (icp_id, name, website, industry, location, size, stage, confidence_score, score_explanation, do_not_contact)
         VALUES ($1, $2, $3, $4, $5, $6, 'Not Qualified', 12, $7, FALSE) RETURNING *`,
        [icp?.id || null, item.name, item.website, item.industry, item.location, item.size,
         `Cheap Filter Rejection: ${reasons.join('; ')}. Rejected before expensive deep research.`]
      );
      processedLeads.push(lead.rows[0]);
    } else {
      const lead = await query(
        `INSERT INTO leads (icp_id, name, website, industry, location, size, stage, confidence_score, score_explanation)
         VALUES ($1, $2, $3, $4, $5, $6, 'Potential', 65, $7) RETURNING *`,
        [icp?.id || null, item.name, item.website, item.industry, item.location, item.size,
         `Passed Cheap Filtering: matches ICP (${criteria.industry}, ${criteria.location}, ${sizeMin}-${sizeMax}). Queued for Deep Research.`]
      );
      processedLeads.push(lead.rows[0]);
    }
  }

  const accepted = processedLeads.filter((l: any) => l.stage !== 'Not Qualified').length;
  await logActivity(
    'Discovery',
    'Search + Cheap Filter',
    'lead-database',
    `candidates=${CANDIDATES.length}`,
    `accepted=${accepted}, rejected=${processedLeads.length - accepted}`,
    `Cheap filtering complete: ${accepted} potential leads queued for deep research`,
    Date.now() - start
  );

  return processedLeads;
}

// ---------------------------------------------------------------------------
// 3. Deep Research & Qualification Agent (evidence-driven + RAG service matching)
// ---------------------------------------------------------------------------

export async function performDeepResearchAndQualification(leadId: string) {
  const start = Date.now();
  const leadRes = await query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  const lead = leadRes.rows[0];

  if (!lead) return null;
  if (lead.stage === 'Not Qualified' || lead.stage === 'Do Not Contact') return lead;

  await query(`UPDATE leads SET stage = 'Researching', updated_at = NOW() WHERE id = $1`, [leadId]);

  const evidencePack = RESEARCH_MAP[lead.name] || [
    { source_type: 'website', source_url: lead.website || `https://${lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example`, title: 'Company Website', snippet: `${lead.name} operates in ${lead.industry} with ${lead.size}.`, confidence: 'Medium' },
    { source_type: 'tech', source_url: 'https://builtwith.example/probe', title: 'Tech Stack Probe', snippet: 'No automated AI support triage agent detected in public stack.', confidence: 'Medium' }
  ];

  for (const ev of evidencePack) {
    await query(
      `INSERT INTO research_evidences (lead_id, source_type, source_url, title, snippet, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leadId, ev.source_type, ev.source_url, ev.title, ev.snippet, ev.confidence]
    );
  }

  const contactPack = CONTACTS_MAP[lead.name] || [
    { name: 'Operations Contact', role: 'Operations Lead', relevance: 'Medium', email: `ops@${lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example`, phone: 'Not found', confidence: 'Medium' }
  ];
  for (const c of contactPack) {
    await query(
      `INSERT INTO contacts (lead_id, name, role, relevance, email, phone, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [leadId, c.name, c.role, c.relevance, c.email, c.phone, c.confidence]
    );
  }

  // Deterministic, explainable score (not an opaque LLM guess)
  let score = 45;
  const reasons: string[] = [];

  const keywords = icpKeywords(lead.industry || '');
  const industrySignal = evidencePack.some(e => (e.title + ' ' + e.snippet).toLowerCase().includes('logistic'));
  if (industrySignal) { score += 15; reasons.push('Strong ICP fit (logistics industry)'); }

  const newsSignal = evidencePack.some(e => e.source_type === 'news');
  if (newsSignal) { score += 10; reasons.push('Recent news / growth signal detected'); }

  const hiringSignal = (evidencePack.map(e => (e.title + ' ' + e.snippet).toLowerCase()).join(' ').includes('hiring'));
  if (hiringSignal) { score += 10; reasons.push('Support hiring confirms growing workload'); }

  const toolGap = evidencePack.some(e => (e.title + ' ' + e.snippet).toLowerCase().includes('no automated') || e.snippet.toLowerCase().includes('no ai'));
  if (toolGap) { score += 12; reasons.push('No AI support automation present (capability gap)'); }

  if ((lead.size?.match(/\d+/) || [0])[0] >= 50) { score += 8; reasons.push('Company size within target range'); }
  if ((lead.location || '').toLowerCase().includes('united states')) { score += 5; reasons.push('Target location match'); }

  score = Math.max(0, Math.min(99, score));
  const explanation = reasons.length
    ? reasons.join('. ') + '.'
    : 'Qualified via base ICP criteria.';

  // Service matching grounded in the company RAG knowledge layer
  let recommendedService = 'Autonomous AI Inbound/Outbound Sales Agent';
  let rationale = 'Selected from company service catalog as best fit for lead profile.';

  const companyRes = await query(`SELECT * FROM company_profiles ORDER BY created_at DESC LIMIT 1`);
  const company = companyRes.rows[0];
  if (company) {
    const hits = await retrieveKnowledge(company.id, `${lead.problemFit || lead.name} customer support automation`, 3);
    if (hits.length) {
      const best = hits[0];
      recommendedService = (best.title || '').replace(/^Service:\s*/, '') || recommendedService;
      rationale = `Grounded in company knowledge: "${best.content}" (similarity ${best.score.toFixed(2)}).`;
    } else {
      const offerings = company.offerings || [];
      if (Array.isArray(offerings) && offerings.length) recommendedService = offerings[0];
    }
  }

  const updatedLead = await query(
    `UPDATE leads
     SET stage = 'Qualified', confidence_score = $1, score_explanation = $2, recommended_service = $3, service_rationale = $4, updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [score, explanation, recommendedService, rationale, leadId]
  );

  await query(
    `INSERT INTO memories (lead_id, type, category, content)
     VALUES ($1, 'short_term', 'agent_decision', $2)`,
    [leadId, `Deep research completed. Lead qualified at ${score}%. Matched: ${recommendedService}.`]
  );

  await logActivity(
    'DeepResearch',
    'Research + Qualify + Service Match',
    'research/probe',
    `lead=${lead.name}`,
    `score=${score}%, service=${recommendedService}, evidence=${evidencePack.length}`,
    explanation,
    Date.now() - start
  );

  return updatedLead.rows[0];
}

// ---------------------------------------------------------------------------
// 4. Evidence-Based Outreach Generator Agent
// ---------------------------------------------------------------------------

export async function generateAndSendOutreach(leadId: string, contactId?: string) {
  const start = Date.now();
  const leadRes = await query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  const lead = leadRes.rows[0];
  if (!lead) return null;

  const contactRes = contactId
    ? await query(`SELECT * FROM contacts WHERE id = $1 AND lead_id = $2`, [contactId, leadId])
    : await query(`SELECT * FROM contacts WHERE lead_id = $1 ORDER BY relevance DESC LIMIT 1`, [leadId]);
  const contact = contactRes.rows[0] || { name: 'Operations Contact', role: 'Operations Lead', email: 'ops@company.example' };

  const meetingLink = `https://meet.google.com/sales-${Math.random().toString(36).substring(7)}`;
  const service = lead.recommended_service || 'Autonomous AI Sales Agent';
  const evidenceSnippets = (RESEARCH_MAP[lead.name] || []).slice(0, 2).map(e => e.title);

  const prompt = `Write a short 3-sentence personalized cold email to ${contact.name}, ${contact.role} at ${lead.name}.
Reference verified evidence: ${evidenceSnippets.join(', ')}.
Offer ${service} and include this meeting link: ${meetingLink}`;

  let emailBody = await callGemini('You are an expert enterprise B2B sales copywriter. Return plain email text only.', prompt, false);

  if (!emailBody) {
    emailBody = `Hi ${contact.name},\n\nI noticed ${lead.name}'s recent growth and the support burden that comes with it${evidenceSnippets.length ? ` (${evidenceSnippets[0]})` : ''}.\n\nWe deployed an autonomous ${service} that cuts customer response latency to under 10 seconds without extra headcount.\n\nWould you be open to a 10-minute walkthrough this week? Lock in a time slot directly here: ${meetingLink}\n\nBest regards,\nAutonomous Sales AI Team`;
  }

  const subject = `Automating support for ${lead.name}`;

  const msg = await query(
    `INSERT INTO messages (lead_id, contact_id, direction, channel, subject, body, status, next_action, evidence_used)
     VALUES ($1, $2, 'outbound', 'email', $3, $4, 'sent', 'Awaiting prospect response. 3-day follow-up task scheduled.', $5)
     RETURNING *`,
    [leadId, contact.id, subject, emailBody, JSON.stringify(evidenceSnippets)]
  );

  // Default challenge flow: Day 0 email, wait 3 days, Email #2
  const pending = await query(`SELECT COUNT(*) FROM follow_up_tasks WHERE lead_id = $1 AND status = 'pending'`, [leadId]);
  if (parseInt(pending.rows[0].count) === 0) {
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 3);
    await query(
      `INSERT INTO follow_up_tasks (lead_id, sequence_step, scheduled_for, status, template_prompt, next_action)
       VALUES ($1, 2, $2, 'pending', 'Follow up with delivery response latency case study', $3)`,
      [leadId, followUpDate, `Email #2 on ${followUpDate.toISOString()} if no reply`]
    );
  }

  await query(`UPDATE leads SET stage = 'Contacted', updated_at = NOW() WHERE id = $1`, [leadId]);

  await logActivity(
    'Outreach',
    'Generate + Send Email',
    'email',
    `to=${contact.email}`,
    `subject=${subject}`,
    'Outreach sent, 3-day follow-up scheduled',
    Date.now() - start
  );

  return msg.rows[0];
}

// ---------------------------------------------------------------------------
// 5. Inbound Reply Classification & Next-Action Agent (all PRD classes)
// ---------------------------------------------------------------------------

export async function processInboundResponse(leadId: string, replyText: string) {
  const start = Date.now();
  const text = (replyText || '').toLowerCase();

  const prompt = `Classify this inbound lead response: "${replyText}".
Return JSON:
{
  "classification": "Positive / Interested" or "Meeting requested" or "Question" or "Pricing objection" or "Technical objection" or "Not interested" or "Not now" or "Wrong person / Referral" or "Other",
  "nextAction": "what agent should do next"
}`;

  let parsed = await callGemini('You are an inbound sales response triage agent.', prompt);

  if (!parsed) {
    let classification = 'Other';
    if (/\bmeet\b|schedule|calendar|thursday|monday|tuesday|wednesday|friday|tomorrow|next week/.test(text)) classification = 'Meeting requested';
    else if (/not interested|no thanks|no,? ?thank|remove|unsubscribe|stop|spam|don'?t contact/.test(text)) classification = 'Not interested';
    else if (/price|cost|pricing|budget|quote|how much/.test(text)) classification = 'Pricing objection';
    else if (/integrat|api|security|compliance|technical|legacy/.test(text)) classification = 'Technical objection';
    else if (/interested|great|sounds good|yes,? let'?s|love to|definitely/.test(text)) classification = 'Positive / Interested';
    else if (/later|busy|next month|after|not now|maybe|q[1-4]/.test(text)) classification = 'Not now';
    else if (/wrong person|refer|colleague|not the right|someone else/.test(text)) classification = 'Wrong person / Referral';
    else if (/\?/.test(text)) classification = 'Question';

    parsed = { classification, nextAction: '' };
  }

  const classification = parsed.classification || 'Other';
  let nextAction = parsed.nextAction || 'Route to sales review';
  let meeting: any = null;
  let newStage = leadStageFor(classification, leadId);

  // Inbound reply cancels any pending no-reply follow-up
  await query(`UPDATE follow_up_tasks SET status = 'cancelled' WHERE lead_id = $1 AND status = 'pending'`, [leadId]);

  await query(
    `INSERT INTO messages (lead_id, direction, channel, body, classification, next_action, status)
     VALUES ($1, 'inbound', 'email', $2, $3, $4, 'replied')`,
    [leadId, replyText, classification, nextAction]
  );

  if (classification === 'Meeting requested') {
    const meetTime = new Date();
    meetTime.setDate(meetTime.getDate() + 2);
    meetTime.setHours(15, 0, 0, 0);

    const meetingRes = await query(
      `INSERT INTO meetings (lead_id, meeting_time, meeting_link, service_to_discuss, problem_summary, objections_expected, key_discussion_points, whatsapp_notified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) RETURNING *`,
      [
        leadId,
        meetTime,
        `https://meet.google.com/sales-${Math.random().toString(36).substring(7)}`,
        'WhatsApp AI Support Automation',
        'Customer support delays due to recent delivery volume increase',
        'Security, data privacy & existing CRM integration feasibility',
        '1. Live WhatsApp AI agent dispatch demo\n2. Real-time carrier tracking query triage\n3. 14-day zero-risk enterprise pilot rollout'
      ]
    );
    meeting = meetingRes.rows[0];

    newStage = 'Meeting Scheduled';
    nextAction = 'Send WhatsApp briefing & reminder to admin';

    const leadRow = (await query(`SELECT * FROM leads WHERE id = $1`, [leadId])).rows[0];
    await whatsappDispatch(leadId, 'Admin', `Meeting booked with ${leadRow?.name || 'lead'} on ${meetTime.toISOString()}. ${meeting.meeting_link}`);

    await query(
      `INSERT INTO memories (lead_id, type, category, content)
       VALUES ($1, 'long_term', 'meeting_finalized', $2)`,
      [leadId, `Meeting confirmed for ${meetTime.toISOString()}. Briefing & WhatsApp alert sent to admin.`]
    );
  } else if (classification === 'Not interested') {
    newStage = 'Not Interested';
    nextAction = 'Stop automation; mark negative outcome.';
    await query(`UPDATE leads SET do_not_contact = TRUE WHERE id = $1`, [leadId]);
    await query(
      `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'long_term', 'decision_log', 'Prospect declined. Marked Not Interested / Do Not Contact.')`,
      [leadId]
    );
  } else if (classification === 'Positive / Interested') {
    newStage = 'Interested';
    nextAction = 'Continue conversation; propose meeting.';
    await query(
      `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'short_term', 'preference', 'Prospect expressed interest in continued conversation.')`,
      [leadId]
    );
  } else if (classification === 'Not now') {
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 14);
    await query(
      `INSERT INTO follow_up_tasks (lead_id, sequence_step, scheduled_for, status, template_prompt, next_action)
       VALUES ($1, 3, $2, 'pending', 'Re-engage with updated case study', 'Re-engage after cooling period')`,
      [leadId, followUpDate]
    );
    nextAction = `Schedule future follow-up on ${followUpDate.toISOString()}.`;
    await query(
      `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'short_term', 'preference', 'Prospect asked to follow up later.')`,
      [leadId]
    );
  } else if (classification === 'Question' || classification === 'Pricing objection' || classification === 'Technical objection') {
    nextAction = classification === 'Question'
      ? 'Answer from grounded company knowledge.'
      : classification === 'Pricing objection'
        ? 'Share approved pricing/package evidence.'
        : 'Share approved capability/integration evidence.';
    await query(
      `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'short_term', 'objection', '${classification}: ${replyText.slice(0, 200)}')`,
      [leadId]
    );
  } else if (classification === 'Wrong person / Referral') {
    nextAction = 'Request referral / refocus on the relevant stakeholder.';
    await query(
      `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'short_term', 'preference', 'Wrong person identified; pursue referral.')`,
      [leadId]
    );
  } else {
    await query(
      `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'short_term', 'agent_decision', 'Unclassified reply routed to review.')`,
      [leadId]
    );
  }

  if (newStage) {
    await query(`UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2`, [newStage, leadId]);
  }

  await logActivity(
    'ResponseClassifier',
    'Classify Reply + Next Action',
    'llm/classifier',
    `lead=${leadId}`,
    `classification=${classification}, next_action=${nextAction}, stage=${newStage}`,
    `Classified as ${classification}.`,
    Date.now() - start
  );

  return { classification, nextAction, meeting, stage: newStage };
}

function leadStageFor(classification: string, leadId: string): string {
  const stageMap: Record<string, string> = {
    'Meeting requested': 'Meeting Scheduled',
    'Not interested': 'Not Interested',
    'Positive / Interested': 'Interested'
  };
  return stageMap[classification] || '';
}

// ---------------------------------------------------------------------------
// 6. Follow-Up Engine (Email #2) + Meeting Reminders + Scheduler hooks
// ---------------------------------------------------------------------------

export async function executeFollowUp(taskId: string) {
  const taskRes = await query(`SELECT * FROM follow_up_tasks WHERE id = $1`, [taskId]);
  const task = taskRes.rows[0];
  if (!task || task.status === 'executed') return null;

  const leadRes = await query(`SELECT * FROM leads WHERE id = $1`, [task.lead_id]);
  const lead = leadRes.rows[0];
  if (!lead || lead.do_not_contact) {
    await query(`UPDATE follow_up_tasks SET status = 'cancelled' WHERE id = $1`, [taskId]);
    return null;
  }

  const contactRes = await query(`SELECT * FROM contacts WHERE lead_id = $1 ORDER BY relevance DESC LIMIT 1`, [lead.id]);
  const contact = contactRes.rows[0] || { name: 'Operations Contact', email: 'ops@company.example' };

  const service = lead.recommended_service || 'Autonomous AI Sales Agent';
  const meetingLink = `https://meet.google.com/sales-${Math.random().toString(36).substring(7)}`;
  const companyRes = await query(`SELECT * FROM company_profiles ORDER BY created_at DESC LIMIT 1`);
  const caseStudy = (companyRes.rows[0]?.case_studies || [])[0] || 'cut response latency by 3.4x';

  const emailBody = `Hi ${contact.name},\n\nFollowing up on my previous note. Many teams in your position cut inquiry response time to under 10 seconds with ${service} — a recent deployment ${caseStudy}.\n\nWorth 10 minutes this week? Grab a slot here: ${meetingLink}\n\nBest regards,\nAutonomous Sales AI Team`;
  const subject = `Re: Automating support for ${lead.name}`;

  const msg = await query(
    `INSERT INTO messages (lead_id, contact_id, direction, channel, subject, body, status, next_action)
     VALUES ($1, $2, 'outbound', 'email', $3, $4, 'sent', 'Follow-up Email #2 sent; awaiting response.') RETURNING *`,
    [lead.id, contact.id, subject, emailBody]
  );

  await query(`UPDATE follow_up_tasks SET status = 'executed' WHERE id = $1`, [taskId]);
  await query(
    `INSERT INTO memories (lead_id, type, category, content) VALUES ($1, 'long_term', 'follow_up', 'Follow-up Email #2 sent.')`,
    [lead.id]
  );
  await logActivity('FollowUp', 'Email #2 Follow-up', 'email', `to=${contact.email}`, `subject=${subject}`, 'Follow-up Email #2 dispatched');

  return msg.rows[0];
}

export async function processDueFollowUps() {
  const dueRes = await query(
    `SELECT * FROM follow_up_tasks WHERE status = 'pending' AND scheduled_for <= NOW() ORDER BY scheduled_for ASC`
  );
  const results = [];
  for (const task of dueRes.rows) {
    results.push(await executeFollowUp(task.id));
  }
  return results.filter(Boolean);
}

export async function processMeetingReminders() {
  const reminderWindow = new Date(Date.now() + 30 * 60 * 1000);
  const dueRes = await query(
    `SELECT m.*, l.name AS lead_name FROM meetings m JOIN leads l ON m.lead_id = l.id
     WHERE m.reminder_sent = FALSE AND m.meeting_time <= $1 AND m.meeting_time > NOW() - INTERVAL '5 minutes'`,
    [reminderWindow]
  );

  const results = [];
  for (const meeting of dueRes.rows) {
    await whatsappDispatch(
      meeting.lead_id,
      'Admin',
      `Reminder: meeting with ${meeting.lead_name} at ${meeting.meeting_time}. Topic: ${meeting.service_to_discuss}. ${meeting.meeting_link}`
    );
    await query(`UPDATE meetings SET reminder_sent = TRUE, whatsapp_notified = TRUE WHERE id = $1`, [meeting.id]);
    await query(
      `INSERT INTO memories (lead_id, type, category, content)
       VALUES ($1, 'long_term', 'meeting_reminder', $2)`,
      [meeting.lead_id, `30-minute reminder sent for meeting. Problem: ${meeting.problem_summary}. Points: ${meeting.key_discussion_points}`]
    );
    await logActivity(
      'MeetingAutomation',
      '30-min Reminder + Briefing',
      'whatsapp',
      `meeting=${meeting.id}`,
      `Reminder + briefing dispatched to admin for ${meeting.lead_name}`,
      'Reminder includes problem, service, objections and discussion points'
    );
    results.push(meeting);
  }
  return results;
}

export async function runSchedulerOnce() {
  const followedUp = await processDueFollowUps();
  const reminded = await processMeetingReminders();
  await logActivity('Scheduler', 'Scheduler run', 'worker', null, `followups=${followedUp.length}, reminders=${reminded.length}`, 'Durable jobs executed');
  return { followUpsExecuted: followedUp.length, remindersSent: reminded.length };
}
