import { useState, useEffect } from 'react';
import { 
  Building2, 
  Target, 
  Search, 
  Kanban, 
  Send, 
  Calendar, 
  Bot, 
  ShieldCheck, 
  CheckCircle2, 
  Sparkles, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Play,
  Activity,
  Clock,
  Upload
} from 'lucide-react';
import { api } from './api';

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'company' | 'icp' | 'leads' | 'pipeline' | 'meetings' | 'activity'>('overview');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadDetail, setLeadDetail] = useState<any>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [leadsList, setLeadsList] = useState<any[]>([]);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  const [meetingsList, setMeetingsList] = useState<any[]>([]);
  const [activityLog, setActivityLog] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [lastIcpId, setLastIcpId] = useState<string | null>(null);
  const [icpMessage, setIcpMessage] = useState<string | null>(null);
  const [icpError, setIcpError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('Autonomous Agent Ready');
  const [detectingName, setDetectingName] = useState(false);
  const [companyUrl, setCompanyUrl] = useState('');
  const [structuredIcp, setStructuredIcp] = useState<any>(null);
  const [icpNormalizing, setIcpNormalizing] = useState(false);

  const stageColor = (s: string) =>
    s === 'Qualified' ? 'bg-emerald-500/20 text-emerald-300' :
    s === 'Meeting Scheduled' ? 'bg-purple-500/20 text-purple-300' :
    s === 'Interested' ? 'bg-amber-500/20 text-amber-300' :
    s === 'Not Qualified' || s === 'Not Interested' || s === 'Do Not Contact' ? 'bg-red-500/20 text-red-300' :
    s === 'Converted' ? 'bg-emerald-500/20 text-emerald-300' :
    'bg-blue-500/20 text-blue-300';

  // Form states
  const [companyName, setCompanyName] = useState('IH Academy');
  const [companyText, setCompanyText] = useState('IH Academy is a technology-focused education and professional development platform under IH Usmani Group. It provides structured major and minor courses, practical projects, assessments, certifications, internship programs, and technical challenges across software engineering, web development, artificial intelligence, and machine learning.');
  const [icpForm, setIcpForm] = useState({
    location: 'United States',
    industry: 'Education & Training',
    companySize: '50-500 employees',
    focusType: 'Problem',
    targetProblem: 'Student and learner support inquiries handled manually across courses, internships, and certificates'
  });
  const [replyInput, setReplyInput] = useState("Hi team, yes we are experiencing scaling issues with our delivery tracking support. Let's meet this Thursday at 3 PM to discuss.");

  // Fetch all pipeline and dashboard data from backend
  const refreshData = async () => {
    try {
      const [dash, leads, comp, meets, activity, fups] = await Promise.all([
        api.getDashboard().catch(() => null),
        api.getLeads().catch(() => []),
        api.getCompany().catch(() => null),
        api.getMeetings().catch(() => []),
        api.getActivity().catch(() => []),
        api.getFollowUps().catch(() => [])
      ]);
      if (dash) setDashboardData(dash);
      if (leads) setLeadsList(leads);
      if (comp) setCompanyProfile(comp);
      if (meets) setMeetingsList(meets);
      if (activity) setActivityLog(activity);
      if (fups) setFollowUps(fups);
      if (selectedLeadId) {
        const detail = await api.getLeadDetail(selectedLeadId).catch(() => null);
        if (detail) setLeadDetail(detail);
      }
    } catch (err) {
      console.error('Data fetch error:', err);
    }
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId]);

  const loadLead = async (id: string) => {
    setSelectedLeadId(id);
    setLoading(true);
    try {
      const detail = await api.getLeadDetail(id);
      setLeadDetail(detail);
      setActiveTab('leads');
    } finally {
      setLoading(false);
    }
  };

  // Fetch a website URL and auto-fill company name + description
  const fetchUrl = async () => {
    const url = companyUrl.trim();
    if (!url) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const r = await api.fetchCompanyFromUrl(url);
      if (r?.name) setCompanyName(r.name);
      if (r?.text) setCompanyText(r.text.slice(0, 3000));
      setUploadMsg(`Fetched "${r?.title || r?.name || url}" — company name & description auto-filled. Click Ingest to index it.`);
    } catch (err: any) {
      setUploadMsg('URL fetch failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  };

  // Generate a structured ICP from the raw answers (preview before saving)
  const generateStructuredIcp = async () => {
    setIcpNormalizing(true);
    setIcpError(null);
    setIcpMessage(null);
    try {
      const structured = await api.normalizeIcp(icpForm);
      setStructuredIcp(structured);
      setIcpMessage('Structured ICP generated — review the summary below, then click "Search Market & Discover Leads" to save it and start lead generation.');
    } catch (err: any) {
      setIcpError('ICP normalization failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setIcpNormalizing(false);
    }
  };

  // 1-Click End-to-End Autonomous Pipeline Demo
  const runFullAutonomousDemo = async () => {
    setLoading(true);
    setAgentStatus('Step 1/5: Ingesting Company Knowledge & RAG Chunks...');
    try {
      await api.ingestCompany(companyName, companyText);
      
      setAgentStatus('Step 2/5: Creating ICP & Staged Lead Discovery...');
      const icp = await api.createICP(icpForm);
      setLastIcpId(icp.id);
      const disc = await api.discoverLeads(icp.id);
      
      const apex = disc?.leads?.find((l: any) => l.name.includes('Apex')) || disc?.leads?.[0];
      if (apex) {
        setAgentStatus('Step 3/5: Running Deep Web Research & 92% Qualification...');
        await api.runResearch(apex.id);
        
        setAgentStatus('Step 4/5: Generating Role-Specific Personalized Outreach...');
        await api.sendOutreach(apex.id);
        
        setAgentStatus('Step 5/5: Processing Inbound Reply & Scheduling Meeting with Briefing...');
        await api.simulateReply(apex.id, replyInput);
        
        await refreshData();
        await loadLead(apex.id);
        setAgentStatus('Autonomous Sales Lifecycle Completed Successfully!');
      }
    } catch (err) {
      console.error(err);
      setAgentStatus('Demo completed with system fallback state.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#09090B] text-[#F8FAFC] font-sans antialiased overflow-hidden">
      {/* 1. SIDEBAR NAVIGATION */}
      <aside className="w-64 border-r border-[#27272A] bg-[#111113] flex flex-col justify-between p-4 select-none">
        <div>
          {/* Logo Header */}
          <div className="flex items-center gap-3 px-2 py-3 mb-6 border-b border-[#27272A]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide text-white">USMANI AI SALES AGENT</div>
              <div className="text-[11px] text-[#94A3B8] font-mono">Autonomous Sales OS</div>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: TrendingUp },
              { id: 'company', label: 'Company Knowledge', icon: Building2 },
              { id: 'icp', label: 'ICP Target Builder', icon: Target },
              { id: 'leads', label: 'Leads & Research', icon: Search },
              { id: 'pipeline', label: 'Kanban Pipeline', icon: Kanban },
              { id: 'meetings', label: 'Meetings & Briefs', icon: Calendar },
              { id: 'activity', label: 'Agent Activity', icon: Activity },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                    isActive 
                      ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30' 
                      : 'text-[#94A3B8] hover:bg-[#18181B] hover:text-white'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-[#94A3B8]'}`} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Live Autonomous Trigger & Status */}
        <div className="p-3 bg-[#18181B] border border-[#27272A] rounded-xl space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8] flex items-center gap-1.5 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Agent State
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono">LIVE</span>
          </div>
          <div className="text-[11px] text-gray-300 truncate font-mono">{agentStatus}</div>
          <button
            onClick={runFullAutonomousDemo}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all active:scale-[0.98]"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            1-Click Demo Run
          </button>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE CANVAS */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-14 border-b border-[#27272A] bg-[#111113] px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#18181B] border border-[#27272A] text-gray-400">
              Workspace: <strong className="text-white font-medium">Enterprise Production</strong>
            </span>
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Guardrails Active
            </span>
          </div>
          <div className="text-xs text-[#94A3B8] font-mono">
            Mode: <span className="text-purple-400 font-semibold">Autonomous Lifecycle</span>
          </div>
        </header>

        {/* Dynamic Tab Content */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* TAB 1: OVERVIEW DASHBOARD */}
          {activeTab === 'overview' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Total Discovered', val: dashboardData?.kpis?.totalLeads ?? leadsList.length, color: 'text-blue-400', border: 'border-blue-500/20' },
                  { label: 'Qualified Leads', val: dashboardData?.kpis?.qualified ?? leadsList.filter(l => l.stage === 'Qualified').length, color: 'text-purple-400', border: 'border-purple-500/20' },
                  { label: 'Contacted Outreach', val: dashboardData?.kpis?.contacted ?? leadsList.filter(l => l.stage === 'Contacted').length, color: 'text-amber-400', border: 'border-amber-500/20' },
                  { label: 'Booked Meetings', val: dashboardData?.kpis?.meetings ?? meetingsList.length, color: 'text-emerald-400', border: 'border-emerald-500/20' },
                ].map((kpi, idx) => (
                  <div key={idx} className={`p-4 rounded-xl bg-[#111113] border ${kpi.border} flex flex-col justify-between`}>
                    <span className="text-xs font-medium text-[#94A3B8]">{kpi.label}</span>
                    <div className={`text-3xl font-bold mt-2 font-mono ${kpi.color}`}>{kpi.val}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 p-5 bg-[#111113] border border-[#27272A] rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" /> Recent Autonomous Leads
                    </h2>
                    <button onClick={() => setActiveTab('leads')} className="text-xs text-blue-400 hover:underline">View all</button>
                  </div>
                  <div className="space-y-2">
                    {leadsList.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-4 text-center">No leads yet. Click "1-Click Demo Run" on the left!</div>
                    ) : (
                      leadsList.slice(0, 4).map((l) => (
                        <div 
                          key={l.id} 
                          onClick={() => loadLead(l.id)}
                          className="p-3 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-lg flex items-center justify-between cursor-pointer transition-all"
                        >
                          <div>
                            <div className="text-xs font-semibold text-white">{l.name}</div>
                            <div className="text-[11px] text-gray-400">{l.industry} • {l.size}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded font-mono ${stageColor(l.stage)}`}>
                              {l.stage}
                            </span>
                            <span className="text-xs font-mono font-bold text-blue-400">{l.confidence_score}%</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-5 bg-[#111113] border border-[#27272A] rounded-xl space-y-4">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-400" /> Upcoming Meetings
                  </h2>
                  <div className="space-y-3">
                    {meetingsList.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-4 text-center">No meetings booked yet.</div>
                    ) : (
                      meetingsList.map((m) => (
                        <div key={m.id} className="p-3 bg-[#18181B] border border-emerald-500/30 rounded-lg space-y-1">
                          <div className="text-xs font-semibold text-emerald-400">{m.lead_name || 'Apex Logistics'}</div>
                          <div className="text-[11px] text-gray-300 font-mono">{new Date(m.meeting_time).toLocaleDateString()} at 3:00 PM</div>
                          <a href={m.meeting_link} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 pt-1">
                            Google Meet Link <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COMPANY KNOWLEDGE & RAG */}
          {activeTab === 'company' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="p-6 bg-[#111113] border border-[#27272A] rounded-xl space-y-4">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-400" /> Company Knowledge Ingestion Layer (RAG)
                </h2>
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-xs text-gray-300 font-medium flex items-center gap-2">
                      Company Name
                      {detectingName && (
                        <span className="text-[10px] font-mono text-cyan-400 animate-pulse flex items-center gap-1">
                          <Upload className="w-3 h-3" /> Detecting company name from file...
                        </span>
                      )}
                    </label>
                    <input 
                      type="text" 
                      value={companyName} 
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-300 font-medium">Company Profile / Services Description (RAG Grounding Text)</label>
                    <textarea 
                      rows={4}
                      value={companyText}
                      onChange={(e) => setCompanyText(e.target.value)}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <button 
                    onClick={async () => {
                      setLoading(true);
                      await api.ingestCompany(companyName, companyText);
                      await refreshData();
                      setLoading(false);
                    }}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition-all"
                  >
                    {loading ? 'Ingesting Knowledge...' : 'Ingest & Index Knowledge'}
                  </button>
                  <div className="border-t border-[#27272A] pt-4">
                    <label className="text-xs text-gray-300 font-medium">Or upload a company PDF (sample company)</label>
                    <div className="flex items-center gap-3 mt-2">
                      <label className="flex items-center gap-2 px-3 py-2 bg-[#18181B] border border-[#27272A] rounded-lg text-xs text-gray-300 hover:border-blue-500 cursor-pointer transition-all">
                        <Upload className="w-4 h-4 text-blue-400" />
                        {selectedPdf ? selectedPdf.name : 'Choose PDF file'}
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setSelectedPdf(file);
                            setUploadMsg(null);
                            if (file) {
                              setDetectingName(true);
                              api.detectCompanyName(file)
                                .then((r: any) => { if (r?.name) setCompanyName(r.name); })
                                .catch(() => {})
                                .finally(() => setDetectingName(false));
                            }
                          }}
                        />
                      </label>
                      <button
                        onClick={async () => {
                          if (!selectedPdf) return;
                          setUploading(true);
                          setUploadMsg(null);
                          try {
                            const r = await api.uploadCompanyPdf(companyName, selectedPdf);
                            setUploadMsg(`Success: indexed ${r.chars} chars from "${r.profile.name}"`);
                            setSelectedPdf(null);
                            await refreshData();
                          } catch (err: any) {
                            setUploadMsg('Upload failed: ' + (err?.response?.data?.error || err.message));
                          } finally {
                            setUploading(false);
                          }
                        }}
                        disabled={uploading || !selectedPdf}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition-all"
                      >
                        {uploading ? 'Uploading & Indexing...' : 'Upload PDF & Ingest'}
                      </button>
                    </div>
                    {uploadMsg && (
                      <p className="text-xs mt-2 font-mono text-cyan-300 break-all">{uploadMsg}</p>
                    )}
                  </div>

                  <div className="border-t border-[#27272A] pt-4">
                    <label className="text-xs text-gray-300 font-medium">Or auto-fill from a company website URL</label>
                    <div className="flex items-center gap-3 mt-2">
                      <input
                        type="text"
                        value={companyUrl}
                        onChange={(e) => setCompanyUrl(e.target.value)}
                        placeholder="https://your-company.com"
                        className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <button
                        onClick={fetchUrl}
                        disabled={uploading || !companyUrl.trim()}
                        className="px-4 py-2 bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/40 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition-all"
                      >
                        {uploading ? 'Fetching...' : 'Fetch & Auto-Fill'}
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2">
                      Reads the site, detects the company name, and fills both the name and description fields for you.
                    </p>
                  </div>
                </div>
              </div>

              {companyProfile && (
                <div className="p-6 bg-[#111113] border border-blue-500/30 rounded-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">{companyProfile.name}</h3>
                      <p className="text-xs text-blue-400">{companyProfile.tagline}</p>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">RAG Indexed</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">{companyProfile.summary}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ICP BUILDER */}
          {activeTab === 'icp' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="p-6 bg-[#111113] border border-[#27272A] rounded-xl space-y-4">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-400" /> Ideal Customer Profile (ICP) Target Builder
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-300 font-medium">Target Location</label>
                    <input 
                      type="text" 
                      value={icpForm.location}
                      onChange={(e) => setIcpForm({...icpForm, location: e.target.value})}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-300 font-medium">Target Industry</label>
                    <input 
                      type="text" 
                      value={icpForm.industry}
                      onChange={(e) => setIcpForm({...icpForm, industry: e.target.value})}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-300 font-medium">Company Size</label>
                    <input 
                      type="text" 
                      value={icpForm.companySize}
                      onChange={(e) => setIcpForm({...icpForm, companySize: e.target.value})}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-300 font-medium">What do you want to target specially?</label>
                    <select
                      value={icpForm.focusType}
                      onChange={(e) => setIcpForm({...icpForm, focusType: e.target.value})}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    >
                      <option value="Problem">Problem</option>
                      <option value="Use Case">Use Case</option>
                      <option value="Service">Service</option>
                      <option value="Customer Type">Customer Type</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-300 font-medium">Describe it — problem, use case, service, or type of customer</label>
                    <input 
                      type="text" 
                      value={icpForm.targetProblem}
                      onChange={(e) => setIcpForm({...icpForm, targetProblem: e.target.value})}
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    onClick={generateStructuredIcp}
                    disabled={icpNormalizing || loading}
                    className="px-4 py-2 bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/40 rounded-lg text-xs font-semibold flex items-center gap-2 shadow transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> {icpNormalizing ? 'Normalizing...' : 'Generate Structured ICP'}
                  </button>
                  <button
                    onClick={async () => {
                      setLoading(true);
                      setIcpError(null);
                      setIcpMessage(null);
                      try {
                        const payload = {
                          ...icpForm,
                          focus: structuredIcp?.focus || icpForm.targetProblem,
                          qualificationRules: structuredIcp?.qualificationRules,
                          normalizedPrompt: structuredIcp ? JSON.stringify(structuredIcp) : undefined
                        };
                        const icp = await api.createICP(payload);
                        setLastIcpId(icp.id);
                        const disc = await api.discoverLeads(icp.id);
                        const leads = disc?.leads || [];
                        const accepted = leads.filter((l: any) => l.stage !== 'Not Qualified').length;
                        const rejected = leads.length - accepted;
                        if (accepted === 0) {
                          setIcpMessage(`Search done — ${accepted} accepted, ${rejected} rejected. No leads matched your ICP. Try industry "Education & Training", location "United States", size "50-500".`);
                        } else {
                          setIcpMessage(`Search done — ${accepted} accepted, ${rejected} rejected. Pick an accepted lead to run deep research.`);
                        }
                        await refreshData();
                        setActiveTab('leads');
                      } catch (err: any) {
                        setIcpError('Search failed: ' + (err?.response?.data?.error || err.message));
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow"
                  >
                    <Search className="w-3.5 h-3.5" /> Search Market & Discover Leads
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  First define the target customer (location, industry, size, and what to target), then discover leads — the system
                  converts your answers into a structured ICP and cheap-filters every company against it.
                </p>
                {icpError && (
                  <p className="text-[11px] font-mono text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{icpError}</p>
                )}
                {icpMessage && (
                  <p className="text-[11px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2">{icpMessage}</p>
                )}

                {structuredIcp && (
                  <div className="p-4 bg-[#0D0D12] border border-purple-500/40 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-purple-300 uppercase font-mono flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> Structured ICP Summary
                      </h4>
                      <span className="text-[10px] font-mono text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded">READY</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><span className="text-gray-500">Location:</span> <span className="text-white">{structuredIcp.location}</span></div>
                      <div><span className="text-gray-500">Industry:</span> <span className="text-white">{structuredIcp.industry}</span></div>
                      <div><span className="text-gray-500">Size:</span> <span className="text-white">{structuredIcp.sizeRange}</span></div>
                      <div><span className="text-gray-500">Focus type:</span> <span className="text-white">{structuredIcp.focusType}</span></div>
                    </div>
                    <div className="text-xs"><span className="text-gray-500">Focus:</span> <span className="text-white">{structuredIcp.focus}</span></div>
                    <div className="text-xs"><span className="text-gray-500">Persona:</span> <span className="text-white">{structuredIcp.persona}</span></div>
                    {structuredIcp.buyingSignals?.length > 0 && (
                      <div className="text-xs">
                        <span className="text-gray-500">Buying signals: </span>
                        {structuredIcp.buyingSignals.map((s: string, i: number) => (
                          <span key={i} className="text-blue-300">{i > 0 ? ', ' : ''}{s}</span>
                        ))}
                      </div>
                    )}
                    {structuredIcp.qualificationRules?.length > 0 && (
                      <div className="text-xs">
                        <span className="text-gray-500">Qualification rules: </span>
                        {structuredIcp.qualificationRules.map((s: string, i: number) => (
                          <span key={i} className="text-emerald-300">{i > 0 ? ' • ' : ''}{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: LEADS & DEEP RESEARCH DETAIL */}
          {activeTab === 'leads' && (
            leadsList.length === 0 ? (
              <div className="max-w-xl mx-auto mt-16 p-8 bg-[#111113] border border-[#27272A] rounded-2xl text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <Search className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Start with your Ideal Customer Profile</h3>
                  <p className="text-xs text-gray-400 leading-relaxed mt-2">
                    Lead generation filters the market against your ICP — location, industry, size, and what you want to target.
                    Complete your ICP first, then the leads will appear here ready for deep research.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('icp')}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 mx-auto shadow"
                >
                  <Target className="w-3.5 h-3.5" /> Go to ICP Builder
                </button>
              </div>
            ) : (
            <div className="grid grid-cols-3 gap-6 max-w-7xl mx-auto">
              <div className="col-span-1 space-y-2">
                <div className="flex items-center justify-between pb-1">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider font-mono">Discovered Leads</h3>
                  <button
                    onClick={() => api.discoverLeads(lastIcpId || undefined).then(refreshData)}
                    disabled={!lastIcpId}
                    title={!lastIcpId ? 'Define your ICP first' : 'Re-run discovery'}
                    className="text-xs text-blue-400 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    + Re-run
                  </button>
                </div>
                {leadsList.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => loadLead(lead.id)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      selectedLeadId === lead.id 
                        ? 'bg-[#18181B] border-blue-500/60 shadow-lg shadow-blue-500/10' 
                        : 'bg-[#111113] border-[#27272A] hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{lead.name}</span>
                      <span className="text-xs font-mono font-bold text-blue-400">{lead.confidence_score}%</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">{lead.industry} • {lead.location}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${stageColor(lead.stage)}`}>
                        {lead.stage}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="col-span-2 space-y-4">
                {leadDetail ? (
                  <div className="space-y-4">
                    <div className="p-5 bg-[#111113] border border-[#27272A] rounded-xl flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-white">{leadDetail.lead.name}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{leadDetail.lead.website} • {leadDetail.lead.size}</p>
                      </div>
                      <div className="flex gap-2">
                        {leadDetail.lead.stage === 'Potential' && (
                          <button
                            onClick={async () => {
                              setLoading(true);
                              await api.runResearch(leadDetail.lead.id);
                              await loadLead(leadDetail.lead.id);
                              setLoading(false);
                            }}
                            disabled={loading}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                          >
                            <Sparkles className="w-3.5 h-3.5" /> Deep Research & Qualify
                          </button>
                        )}
                        {leadDetail.lead.stage === 'Qualified' && (
                          <button
                            onClick={async () => {
                              setLoading(true);
                              await api.sendOutreach(leadDetail.lead.id);
                              await loadLead(leadDetail.lead.id);
                              setLoading(false);
                            }}
                            disabled={loading}
                            className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                          >
                            <Send className="w-3.5 h-3.5" /> Generate & Send Outreach
                          </button>
                        )}
                        {leadDetail.lead.stage === 'Contacted' && (
                          <button
                            onClick={async () => {
                              setLoading(true);
                              await api.runFollowUp(leadDetail.lead.id).catch(() => {});
                              await loadLead(leadDetail.lead.id);
                              setLoading(false);
                            }}
                            disabled={loading}
                            className="px-3 py-1.5 bg-amber-600/20 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                          >
                            <Clock className="w-3.5 h-3.5" /> Send Follow-up #2
                          </button>
                        )}
                        {leadDetail.lead.stage !== 'Do Not Contact' && leadDetail.lead.stage !== 'Not Qualified' && (
                          <button
                            onClick={async () => {
                              setLoading(true);
                              await api.markDnc(leadDetail.lead.id);
                              await loadLead(leadDetail.lead.id);
                              setLoading(false);
                            }}
                            disabled={loading}
                            className="px-3 py-1.5 bg-red-600/15 border border-red-500/40 text-red-300 rounded-lg text-xs font-semibold"
                          >
                            Do Not Contact
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="p-4 bg-[#111113] border border-purple-500/30 rounded-xl space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-purple-400 font-mono flex items-center gap-1.5">
                          <Bot className="w-4 h-4" /> AI Evaluation & Confidence Score
                        </span>
                        <span className="text-xs font-mono font-bold bg-purple-500/20 px-2 py-0.5 rounded text-purple-300">
                          {leadDetail.lead.confidence_score}% Match
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 font-mono bg-[#18181B] p-3 rounded-lg border border-[#27272A]">
                        {leadDetail.lead.score_explanation || 'Evaluation pending deep research.'}
                      </p>
                      {leadDetail.lead.recommended_service && (
                        <div className="pt-1 text-xs">
                          <strong className="text-white">Matched Service:</strong> <span className="text-blue-400">{leadDetail.lead.recommended_service}</span>
                        </div>
                      )}
                    </div>

                    {leadDetail.evidences?.length > 0 && (
                      <div className="p-4 bg-[#111113] border border-[#27272A] rounded-xl space-y-2">
                        <h4 className="text-xs font-bold text-gray-400 uppercase font-mono">Verified Research Evidence</h4>
                        <div className="space-y-2">
                          {leadDetail.evidences.map((ev: any) => (
                            <div key={ev.id} className="p-2.5 bg-[#18181B] border border-[#27272A] rounded space-y-1">
                              <div className="flex justify-between text-xs font-semibold text-white">
                                <span>{ev.title}</span>
                                <span className="text-[10px] text-emerald-400 font-mono">{ev.confidence} Confidence</span>
                              </div>
                              <p className="text-[11px] text-gray-300">{ev.snippet}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {leadDetail.contacts?.length > 0 && (
                      <div className="p-4 bg-[#111113] border border-[#27272A] rounded-xl space-y-2">
                        <h4 className="text-xs font-bold text-gray-400 uppercase font-mono">Identified Decision Makers</h4>
                        <div className="space-y-2">
                          {leadDetail.contacts.map((c: any) => (
                            <div key={c.id} className="p-2.5 bg-[#18181B] border border-[#27272A] rounded space-y-1">
                              <div className="flex justify-between text-xs font-semibold text-white">
                                <span>{c.name}</span>
                                <span className="text-[10px] text-blue-400 font-mono">{c.relevance} relevance</span>
                              </div>
                              <div className="text-[11px] text-gray-300">{c.role}</div>
                              <div className="text-[11px] text-gray-400 font-mono">{c.email} • {c.phone}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {followUps.filter((f: any) => f.lead_id === leadDetail.lead.id).length > 0 && (
                      <div className="p-4 bg-[#111113] border border-[#27272A] rounded-xl space-y-2">
                        <h4 className="text-xs font-bold text-gray-400 uppercase font-mono">Follow-Up Schedule</h4>
                        {followUps.filter((f: any) => f.lead_id === leadDetail.lead.id).map((f: any) => (
                          <div key={f.id} className="p-2.5 bg-[#18181B] border border-[#27272A] rounded flex items-center justify-between">
                            <div>
                              <div className="text-xs font-semibold text-white">Email #{f.sequence_step}</div>
                              <div className="text-[11px] text-gray-400">{f.template_prompt}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                                f.status === 'executed' ? 'bg-emerald-500/20 text-emerald-300' :
                                f.status === 'cancelled' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
                              }`}>{f.status}</span>
                              <span className="text-[10px] text-gray-500 font-mono">{new Date(f.scheduled_for).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {leadDetail.memories?.length > 0 && (
                      <div className="p-4 bg-[#111113] border border-[#27272A] rounded-xl space-y-2">
                        <h4 className="text-xs font-bold text-gray-400 uppercase font-mono">Agent Memory (Short & Long Term)</h4>
                        {leadDetail.memories.map((m: any) => (
                          <div key={m.id} className="p-2.5 bg-[#18181B] border border-[#27272A] rounded flex items-start justify-between gap-3">
                            <div>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono mr-2 ${
                                m.type === 'long_term' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                              }`}>{m.type}</span>
                              <span className="text-[11px] text-gray-300">{m.content}</span>
                            </div>
                            <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">{new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="p-4 bg-[#111113] border border-[#27272A] rounded-xl space-y-3">
                      <h4 className="text-xs font-bold text-gray-400 uppercase font-mono">Outreach & Inbound Timeline</h4>
                      {leadDetail.messages?.map((msg: any) => (
                        <div key={msg.id} className="p-3 bg-[#18181B] rounded border border-[#27272A] space-y-1">
                          <div className="text-xs font-semibold text-blue-400">{msg.direction === 'outbound' ? '🤖 Sent Outbound Email' : '👤 Inbound Prospect Reply'}</div>
                          <div className="text-xs text-gray-300 whitespace-pre-wrap font-mono">{msg.body}</div>
                        </div>
                      ))}
                      {leadDetail.lead.stage === 'Contacted' && (
                        <div className="pt-2 space-y-2">
                          <label className="text-xs text-gray-300">Simulate Inbound Prospect Reply:</label>
                          <textarea
                            rows={2}
                            value={replyInput}
                            onChange={(e) => setReplyInput(e.target.value)}
                            className="w-full bg-[#18181B] border border-[#27272A] rounded p-2 text-xs text-white font-mono"
                          />
                          <button
                            onClick={async () => {
                              setLoading(true);
                              await api.simulateReply(leadDetail.lead.id, replyInput);
                              await loadLead(leadDetail.lead.id);
                              setLoading(false);
                            }}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                          >
                            Send Reply & Book Meeting
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-12 bg-[#111113] border border-[#27272A] rounded-xl text-center text-xs text-gray-500 italic">
                    Select a lead from the left or click "1-Click Demo Run".
                  </div>
                )}
              </div>
            </div>
            ))}

          {/* TAB 5: KANBAN PIPELINE */}
          {activeTab === 'pipeline' && (
            <div className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]">
              {['Discovered', 'Potential', 'Researching', 'Qualified', 'Contacted', 'Interested', 'Meeting Scheduled', 'Converted', 'Not Qualified', 'Not Interested', 'Do Not Contact'].map((stg) => {
                const items = leadsList.filter((l) => l.stage === stg);
                const negative = stg === 'Not Qualified' || stg === 'Not Interested' || stg === 'Do Not Contact';
                const border = negative ? 'border-red-500/30' : stg === 'Meeting Scheduled' ? 'border-purple-500/30' : 'border-[#27272A]';
                const header = negative ? 'text-red-400' : stg === 'Meeting Scheduled' ? 'text-purple-400' : 'text-white';
                return (
                  <div key={stg} className={`p-3 bg-[#111113] border ${border} rounded-xl min-w-[190px] max-w-[190px] flex flex-col`}>
                    <div className="flex justify-between pb-2 border-b border-[#27272A]">
                      <span className={`text-xs font-bold font-mono ${header}`}>{stg}</span>
                      <span className={`text-[11px] px-2 bg-[#18181B] rounded font-mono ${negative ? 'text-red-400' : 'text-gray-300'}`}>{items.length}</span>
                    </div>
                    <div className="space-y-2 mt-3 flex-1 overflow-y-auto">
                      {items.map((lead) => (
                        <div key={lead.id} onClick={() => loadLead(lead.id)} className="p-2.5 bg-[#18181B] border border-[#27272A] rounded cursor-pointer hover:border-gray-500">
                          <div className="text-xs font-bold text-white">{lead.name}</div>
                          <div className="text-[10px] text-blue-400 font-mono mt-1">{lead.confidence_score}% Fit</div>
                          {lead.do_not_contact && <div className="text-[9px] text-red-400 font-mono mt-1">DNC</div>}
                        </div>
                      ))}
                      {items.length === 0 && (
                        <div className="text-[10px] text-gray-600 italic text-center py-3">—</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 6: MEETINGS & BRIEFINGS */}
          {activeTab === 'meetings' && (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-400" /> Booked Meetings & WhatsApp Admin Briefings
              </h2>
              {meetingsList.map((m) => (
                <div key={m.id} className="p-5 bg-[#111113] border border-emerald-500/40 rounded-xl space-y-3">
                  <div className="flex justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-emerald-400">{m.lead_name || 'Apex Logistics'}</h3>
                      <p className="text-xs text-gray-300 font-mono mt-0.5">{new Date(m.meeting_time).toLocaleString()}</p>
                    </div>
                    <span className="text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-300 rounded font-mono flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> WhatsApp Dispatched
                    </span>
                  </div>
                  <div className="text-xs text-gray-300"><strong>Topic:</strong> {m.service_to_discuss}</div>
                  <div className="p-3 bg-[#18181B] rounded border border-[#27272A] text-xs text-gray-300 font-mono whitespace-pre-wrap">
                    {m.key_discussion_points}
                  </div>
                  <a href={m.meeting_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                    Open Google Meet Room <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* TAB 7: AGENT ACTIVITY & AUDIT */}
          {activeTab === 'activity' && (
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-purple-400" /> Agent Activity & Audit Trail
                </h2>
                <button
                  onClick={async () => {
                    setLoading(true);
                    await api.runScheduler().catch(() => {});
                    await refreshData();
                    setLoading(false);
                  }}
                  disabled={loading}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow"
                >
                  <Clock className="w-3.5 h-3.5" /> Run Durable Jobs (Follow-ups + Reminders)
                </button>
              </div>
              <div className="space-y-2">
                {activityLog.map((a: any) => (
                  <div key={a.id} className="p-3 bg-[#111113] border border-[#27272A] rounded flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">
                        {a.agent_name} <span className="text-gray-500 font-mono text-[10px]">→ {a.step}</span>
                        {a.tool_used && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#18181B] border border-[#27272A] text-blue-400 font-mono">{a.tool_used}</span>}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">{a.decision || a.output_data}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        a.status === 'failed' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>{a.status}</span>
                      <span className="text-[10px] text-gray-500 font-mono">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {activityLog.length === 0 && (
                  <div className="text-xs text-gray-500 italic text-center py-8">No agent activity yet. Run the demo to see the audit trail.</div>
                )}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}