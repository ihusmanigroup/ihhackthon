import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

export const api = {
  getHealth: () => axios.get(`${API_BASE}/health`).then(res => res.data),
  getDashboard: () => axios.get(`${API_BASE}/dashboard`).then(res => res.data),
  getCompany: () => axios.get(`${API_BASE}/company`).then(res => res.data),
  ingestCompany: (name: string, rawText: string) => axios.post(`${API_BASE}/company/ingest`, { name, rawText, sourceType: 'TEXT' }).then(res => res.data),
  createICP: (data: any) => axios.post(`${API_BASE}/icp`, data).then(res => res.data),
  discoverLeads: (icpId?: string) => axios.post(`${API_BASE}/leads/discover`, { icpId }).then(res => res.data),
  getLeads: () => axios.get(`${API_BASE}/leads`).then(res => res.data),
  getLeadDetail: (id: string) => axios.get(`${API_BASE}/leads/${id}`).then(res => res.data),
  runResearch: (id: string) => axios.post(`${API_BASE}/leads/${id}/research`).then(res => res.data),
  sendOutreach: (id: string, contactId?: string) => axios.post(`${API_BASE}/leads/${id}/outreach`, { contactId }).then(res => res.data),
  simulateReply: (id: string, replyText: string) => axios.post(`${API_BASE}/leads/${id}/reply`, { replyText }).then(res => res.data),
  getMeetings: () => axios.get(`${API_BASE}/meetings`).then(res => res.data),
};