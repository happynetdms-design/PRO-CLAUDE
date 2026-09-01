// Google (via Supabase) redirects the browser here after consent, with a
// `code` and the `state` value minted by google-oauth-start.js. This
// looks up the matching code_verifier (stashed server-side because these
// two steps are separate, stateless functions — see that file's comment)
// and exchanges the code for a session via a direct call to Supabase's
// token endpoint, bypassing the JS client's own OAuth/PKCE handling
// entirely, since that assumes a browser-persisted verifier this
// architecture doesn't have.
const { adminClient } = require('./_lib/supabase');

function htmlResponse(status, body){
  return { statusCode: status, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body };
}
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function errorPage(message){
  const safe = escapeHtml(message);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in failed — Happynet</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;background:#F5F1E7;color:#132339;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px;}
  .card{background:#FFFDF8;padding:36px 40px;border-radius:14px;box-shadow:0 6px 20px rgba(19,35,57,.1); max-width:440px;}
  h2{margin:0 0 10px;} p{color:#3B4B63; line-height:1.5;}
  a{display:inline-block;margin-top:16px;background:#D9A441;color:#132339;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:9px;}
</style></head>
<body><div class="card"><h2>Google sign-in didn't complete</h2><p>${safe}</p><a href="/">Back to sign in</a></div></body></html>`;
}
function successPage(session){
  const sessionLiteral = JSON.stringify(session);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in… — Happynet</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#0F1B2C;color:#EDE7D8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}</style>
</head><body><div id="msg">Signing you in…</div>
<script>
  try {
    const payload = ${sessionLiteral};
    localStorage.setItem('happynet_session', JSON.stringify(payload));
    sessionStorage.setItem('happynet_session', JSON.stringify(payload));
    window.location.replace('/');
  } catch(e) {
    document.getElementById('msg').textContent = 'Could not complete sign-in: ' + e.message;
  }
</script></body></html>`;
}

exports.handler = async (event) => {
  const { code, state, error: oauthError, error_description } = event.queryStringParameters || {};

  if(oauthError){
    return htmlResponse(200, errorPage(error_description || oauthError || 'Google sign-in was cancelled.'));
  }
  if(!code || !state){
    return htmlResponse(400, errorPage('Google\'s response was missing required information. Please try signing in again.'));
  }

  try{
    const admin = adminClient();

    const { data: pkceRow, error: lookupErr } = await admin
      .from('oauth_pkce_state').select('code_verifier').eq('state', state).maybeSingle();
    if(lookupErr || !pkceRow){
      return htmlResponse(200, errorPage('This sign-in link has expired or was already used. Please try signing in again.'));
    }
    // Single-use: delete immediately so the same state can never be replayed.
    await admin.from('oauth_pkce_state').delete().eq('state', state);

    const redirectUri = `${process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`}/api/google-oauth-callback`;
    const tokenRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY },
      body: JSON.stringify({
        code,
        code_verifier: pkceRow.code_verifier,
        redirect_uri: redirectUri
      })
    });
    const tokenBody = await tokenRes.json();
    if(!tokenRes.ok || !tokenBody.access_token){
      console.error('google-oauth token exchange failed', tokenBody);
      return htmlResponse(200, errorPage(tokenBody.error_description || tokenBody.msg || 'Could not complete sign-in with Google.'));
    }

    const session = {
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token,
      expires_at: tokenBody.expires_at || (Math.floor(Date.now()/1000) + (tokenBody.expires_in || 3600)),
      token: tokenBody.access_token,
      user: { id: tokenBody.user && tokenBody.user.id, email: tokenBody.user && tokenBody.user.email }
    };
    return htmlResponse(200, successPage(session));
  }catch(e){
    console.error('google-oauth-callback error', e);
    return htmlResponse(200, errorPage('Unexpected error completing sign-in.'));
  }
};
