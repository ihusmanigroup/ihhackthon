import app from './app';
import { startScheduler } from './scheduler';

const PORT = process.env.PORT || 5000;

// In serverless (Vercel) the process is invoked per-request via api/index.ts,
// so a long-running interval scheduler must not be started there.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Node.js Sales Agent Server running on http://localhost:${PORT}`);
    startScheduler();
  });
}
