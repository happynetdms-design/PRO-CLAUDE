// Starts Google sign-in. The browser never touches a Supabase key for
// this — it just asks this endpoint for a URL and redirects to it, exactly
// like clicking any other external "Sign in with Google" link.
//
// PKCE is handled manually here rather than via supabase-js's own OAuth
// helper, because that helper assumes a browser client that can persist
// the code_verifier in localStorage between the "start" and "callback"
// steps. Both steps here are separate, stateless Netlify Functions with
// no shared memory — so the verifier is generated here and stashed in
// oauth_pkce_state (hfms_foundation_fix_18_oauth_pkce.sql), keyed by a
// random `state` value that Google/Supabase will echo back on the
// callback, letting that function look the verifier back up.
const crypto = require('crypto');
const { adminClient, json } = require('./_lib/supabase');

function base64url(buffer){
  return buffer.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  if(!process.env.SUPABASE_URL){
    return json(500, { error: 'SUPABASE_URL is not configured for this site.' });
  }

  try{
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`;
    const redirectTo = `${siteUrl}/api/google-oauth-callback`;

    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(24));

    const admin = adminClient();
    const { error: insertErr } = await admin.from('oauth_pkce_state').insert({ state, code_verifier: codeVerifier });
    if(insertErr){
      console.error('oauth_pkce_state insert error', insertErr);
      return json(500, { error: 'Google sign-in is not fully set up yet — the oauth_pkce_state table is missing. Run hfms_foundation_fix_18_oauth_pkce.sql on this project.' });
    }

    // Opportunistic cleanup of abandoned flows — never blocks this request.
    admin.from('oauth_pkce_state').delete().lt('created_at', new Date(Date.now() - 10*60*1000).toISOString()).then(()=>{}, ()=>{});

    const authorizeUrl = `${process.env.SUPABASE_URL}/auth/v1/authorize?` + new URLSearchParams({
      provider: 'google',
      redirect_to: redirectTo,
      code_challenge: codeChallenge,
      code_challenge_method: 's256',
      state
    }).toString();

    return json(200, { url: authorizeUrl });
  }catch(e){
    console.error('google-oauth-start error', e);
    return json(500, { error: 'Unexpected error starting Google sign-in.' });
  }
};
