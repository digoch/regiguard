import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { url } = await req.json();
    if (!url) return Response.json({ reachable: false, reason: 'No URL provided.' });

    // Validate URL format first
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ reachable: false, reason: 'URL is malformed or invalid.' });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return Response.json({ reachable: false, reason: 'URL must use HTTP or HTTPS protocol.' });
    }

    // Attempt a real HEAD request with a short timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let reachable = false;
    let reason = '';

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'LexSense-Validator/1.0' }
      });
      clearTimeout(timeout);

      if (response.ok || (response.status >= 300 && response.status < 400) || response.status === 405) {
        // 405 = Method Not Allowed (HEAD not supported) — site is still reachable
        reachable = true;
        reason = `Site responded with HTTP ${response.status}.`;
      } else {
        reachable = false;
        reason = `Site returned HTTP ${response.status} — may be blocked or non-existent.`;
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        reason = 'Request timed out — site did not respond within 8 seconds.';
      } else {
        reason = `Could not reach site: ${err.message}`;
      }
      reachable = false;
    }

    return Response.json({ reachable, reason });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});