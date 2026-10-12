process.env.API_PORT = '4101';
process.env.WEB_ORIGIN = 'http://localhost:5175';
await import('../apps/api/src/server.ts');
export {};
