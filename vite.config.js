const fs = require('fs');
const path = require('path');
const { loadEnv } = require('vite');

const functionsDir = path.resolve(__dirname, 'netlify/functions');
const runtimeScriptsDir = path.resolve(__dirname, 'js');

function copyRuntimeScripts(){
  return {
    name:'copy-runtime-scripts',
    closeBundle(){
      fs.cpSync(runtimeScriptsDir, path.resolve(__dirname, 'dist/js'), { recursive:true });
    }
  };
}

function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function localApi(){
  return {
    name: 'local-api-functions',
    configureServer(server){
      server.middlewares.use('/api', async (req, res) => {
        const endpoint = (req.url || '').split('?')[0].replace(/^\/+|\/+$/g, '');
        if(!/^[a-zA-Z0-9_-]+$/.test(endpoint)){
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'API endpoint not found.' }));
          return;
        }

        const functionPath = path.join(functionsDir, `${endpoint}.js`);
        if(!fs.existsSync(functionPath)){
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `API endpoint '${endpoint}' is not configured.` }));
          return;
        }

        try{
          if(!process.env.SUPABASE_SERVICE_ROLE_KEY){
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Local API requires SUPABASE_SERVICE_ROLE_KEY in .env.local for Staff & Access and server-side data operations.' }));
            return;
          }
          const eventUrl = new URL(req.url || '/', 'http://localhost');
          const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value || '']));
          const result = await require(functionPath).handler({
            httpMethod: req.method,
            headers,
            path: `/api/${endpoint}`,
            queryStringParameters: Object.fromEntries(eventUrl.searchParams.entries()),
            body: await readBody(req)
          });

          res.statusCode = result && result.statusCode || 500;
          for(const [key, value] of Object.entries(result && result.headers || {})) res.setHeader(key, value);
          res.end(result && result.body || '');
        }catch(error){
          console.error(`[local-api] ${endpoint}`, error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || 'Local API function failed to execute.' }));
        }
      });
    }
  };
}

module.exports = ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for(const [key, value] of Object.entries(env)) if(!process.env[key]) process.env[key] = value;
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  process.env.URL = process.env.URL || 'http://localhost:4173';
  return { plugins: [localApi(), copyRuntimeScripts()] };
};