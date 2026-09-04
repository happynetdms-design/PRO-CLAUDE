# Happynet System Fixes - Deployment Guide

## Issues Fixed

### 1. **"Unexpected token '<', Failed to execute 'json' on 'Response'" Error**
**Root Cause**: The Netlify redirect configuration was sending API requests to `index.html` instead of the serverless functions.

**Fix Applied**: Reordered `netlify.toml` redirects so:
- `/api/*` → `/.netlify/functions/:splat` (API routing) ✓ FIRST
- `/.netlify/*` → `/.netlify/:splat` (Exclude internal paths)
- `/*` → `/index.html` (SPA fallback) ✓ LAST

**Result**: API calls now properly reach the functions and return JSON.

---

### 2. **User Access & Onboarding**
**Fixes**:
- Auto-assigns "Main Branch" as default branch to new users via `ensure_default_branch_access()` SQL function
- Silenced confusing "Could not load your access" error messages
- Updated login UI to inform users about automatic branch assignment

**Result**: New users can sign in without being trapped by access errors.

---

### 3. **API Error Resilience**
**Fixes**:
- Added `safeParseJson()` helper in `js/api.js` to handle HTML error responses gracefully
- Updated critical API call paths (dashboard, assistant) to use safe parser
- Improved error messages that guide debugging

**Result**: If routing is misconfigured, the app shows useful errors instead of crashing.

---

## Deployment Checklist

### For Netlify Deployment
- [ ] Verify `netlify.toml` has correct redirect order (API before SPA)
- [ ] Ensure Node 20 is set in build environment
- [ ] Confirm functions bundler is esbuild
- [ ] Deploy and test API endpoints via `/api/me`, `/api/branches`, etc.

### For Local Development
- [ ] Run `npm install` to install dependencies
- [ ] Run `npm run dev` or `npx vite --port 4173`
- [ ] The Vite middleware in `vite.config.js` loads API handlers from `netlify/functions/`
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` for Staff & Access, branches, and all server-side database writes. The anon key cannot bypass RLS and must never be used as a service-role substitute.
- [ ] Test: `node scripts/verify_api_routing.js` (requires Vite running on http://localhost:4173)

### For Supabase Setup
- [ ] Run `supabase/ensure_default_access.sql` to enable auto-branch-assignment function

---

## Testing

### Manual Tests
1. **API Routing**: Visit `/api/me` in your browser (should return JSON, not HTML)
2. **Sign In**: Use email/password to confirm auth flow works
3. **New User**: Create account and confirm Main Branch is auto-assigned
4. **Branch Access**: Verify you can see data without "ask an admin" error

### Automated Tests
```bash
# If Vite is running on http://localhost:4173
node scripts/verify_api_routing.js

# Syntax check
node --check js/api.js js/auth.js js/dashboard.js
```

---

## Files Modified
- `netlify.toml` - Fixed redirect order
- `js/api.js` - Added safeParseJson() helper
- `js/dashboard.js` - Use safe parser for alerts
- `styles/auth.css` - Login page styling
- `supabase/ensure_default_access.sql` - Enhanced to create Main Branch if needed

---

## Common Issues & Troubleshooting

### Still seeing "Unexpected token '<'" errors?
1. Check that `netlify.toml` redirects are in the correct order
2. Verify the dev server/deployment is using the updated config
3. Clear browser cache and rebuild
4. Check Network tab in DevTools - API response should show `Content-Type: application/json`, not `text/html`

### Users still getting "ask an admin to grant access"?
1. Run `supabase/ensure_default_access.sql` on your Supabase project
2. Verify a Main Branch exists (with `code = 'main'`)
3. Check that the auto-assign function executed without errors
4. New users should get auto-assigned on their next login

---

## Next Steps
If issues persist, provide:
1. Browser console error messages (F12 → Console tab)
2. Network tab response for failed API calls
3. Netlify deployment logs (if using Netlify)
4. Supabase function execution logs (if running ensure_default_branch_access)
