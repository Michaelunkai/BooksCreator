import { createApp } from "./server/app.js";

const app = createApp({
  autoLocalModel: false,
  dataDir: process.env.VERCEL ? "/tmp/folio-data" : undefined,
});

export default app;
