/**
 * ============================================================
 * MANUAL COMPLIANCE SCAN — Intelligence Center
 * ============================================================
 * Takes a pasted regulatory notice text and runs the full
 * Hub-and-Spoke matching pipeline:
 *   GlobalLibrary → CustomerWatchlist → Customer → ComplianceAlert
 *
 * MATCHING RULES (same as dailyRegulatoryScan):
 *   1. Match against GlobalLibrary ONLY — never legacy entities.
 *   2. Fan-out via CustomerWatchlist junction only.
 *   3. Write ComplianceAlert with customer_id + matched_library_items.
 * ============================================================
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 2;

async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let delay = 800;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.status === 429 || err?.message?.includes('rate limit');
      if (attempt === maxRetries || !isRateLimit) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { notice_text, notice_title, notice_type, source_url, publication_date } = body;

    if (!notice_text?.trim()) {
      return Response.json({ error: 'notice_text is required' }, { status: 400 });
    }

    const logs = [];
    const log = (msg) => { console.log(msg); logs.push(msg); };

    log(`[ManualScan] Started by ${user.email} at ${new Date().toISOString()}`);

    const [libraryItems, watchlistEntries, customers, configs] = await Promise.all([
      base44.asServiceRole.entities.GlobalLibrary.list(),
      base44.asServiceRole.entities.CustomerWatchlist.list(),
      base44.asServiceRole.entities.Customer.list(),
      base44.asServiceRole.entities.GlobalConfig.list(),
    ]);

    const customersMap = Object.fromEntries(customers.map(c => [c.id, c]));
    const itemToWatchlistMap = {};
    for (const entry of watchlistEntries) {
      if (!itemToWatchlistMap[entry.library_item_link]) itemToWatchlistMap[entry.library_item_link] = [];
      itemToWatchlistMap[entry.library_item_link].push(entry);
    }

    const firmName = configs?.[0]?.firm_name || 'RegIntel';
    log(`[ManualScan] ${libraryItems.length} library items, ${watchlistEntries.length} watchlist entries`);

    if (!libraryItems.length) {
      return Response.json({ logs, alerts: [], message: 'No library items found. Add items to GlobalLibrary first.' });
    }

    // Match each GlobalLibrary item against the pasted notice
    const matchTasks = libraryItems.map(item => () =>
      withRetry(async () => {
        const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You are a senior export control compliance officer reviewing a regulatory notice on behalf of a consulting firm.

Your task is to determine whether this regulatory notice is POTENTIALLY RELEVANT to the library item below.
Use a LOW threshold — flag as a match if there is ANY plausible connection, including:
  - Exact ECCN code match (e.g., notice mentions "3A001" and item has ECCN 3A001)
  - Keyword overlap (e.g., notice says "semiconductors", item is "microprocessor" — flag it)
  - Broad category overlap (e.g., notice affects "integrated circuits" and item is a chip)
  - Related technology (e.g., notice mentions "TOPS", "AI chips", "advanced computing" and item is a high-performance processor)
  - Any country, license, or classification change that could apply to this item's technology category
  - Fuzzy / synonym matches: "semiconductor" ↔ "microprocessor", "drone" ↔ "UAV", "AI accelerator" ↔ "GPU"

When in doubt, set is_match=true so a human consultant can review. It is better to over-flag than to miss a relevant regulation.
Only set is_match=false if the notice is completely unrelated to this item's technology domain.

Full Regulatory Notice Text:
"""
${notice_text}
"""

Global Library Item:
- Name: ${item.item_name}
- Technical Description: ${item.technical_description}
- ECCN: ${item.eccn || 'N/A'}
- EU Control Number: ${item.eu_control_number || 'N/A'}
- HS Code: ${item.hs_code || 'N/A'}
- Keywords: ${(item.keywords || []).join(', ') || 'N/A'}

Respond with JSON:
- is_match (boolean): true if ANY plausible connection exists
- base_severity (string): one of "low", "medium", "high", "critical"
- rationale (string): 1-2 sentences explaining the connection found (or why definitively excluded)
- base_impact_assessment (string): if match, generic impact summary for this item`,
          model: 'gemini_3_flash',
          response_json_schema: {
            type: 'object',
            properties: {
              is_match: { type: 'boolean' },
              base_severity: { type: 'string' },
              rationale: { type: 'string' },
              base_impact_assessment: { type: 'string' },
            }
          }
        });
        return { item, matchResult: result };
      })
    );

    const matchResults = await runWithConcurrency(matchTasks, MAX_CONCURRENCY);
    const matched = matchResults.filter(r => r?.matchResult?.is_match);
    log(`[ManualScan] ${matched.length} of ${libraryItems.length} library items matched`);

    const createdAlerts = [];

    for (const { item, matchResult } of matched) {
      const watchlistLinked = itemToWatchlistMap[item.id] || [];
      if (!watchlistLinked.length) {
        log(`[ManualScan] "${item.item_name}" matched but no customers linked — skipping`);
        continue;
      }

      const alertTasks = watchlistLinked.map(entry => () =>
        withRetry(async () => {
          const customer = customersMap[entry.customer_link];
          if (!customer) return null;

          const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
          let severity = matchResult.base_severity || 'medium';
          if (entry.custom_severity_override && severityRank[entry.custom_severity_override] > severityRank[severity]) {
            severity = entry.custom_severity_override;
          }

          const personalizedImpact = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are a compliance advisor. Personalize this impact assessment for a specific client.

Base Assessment: "${matchResult.base_impact_assessment}"

Client:
- Name: ${customer.customer_name}
- Industry: ${customer.industry || 'N/A'}
- Risk Tolerance: ${customer.risk_tolerance || 'medium'}
${entry.client_specific_notes ? `- How they use this item: "${entry.client_specific_notes}"` : ''}

Rewrite starting with: "For ${customer.customer_name}, this change means..."
Keep it to 2-3 sentences.`,
            model: 'gemini_3_flash',
          });

          const alert = await base44.asServiceRole.entities.ComplianceAlert.create({
            title: `[MANUAL SCAN] ${notice_title || 'Pasted Notice'} — Impact on: ${item.item_name}`,
            customer_id: customer.id,
            target_recipient: customer.primary_contact_email || null,
            source: 'manual_scan',
            notice_type: notice_type || 'guidance',
            source_url: source_url || 'manual://intelligence-center',
            publication_date: publication_date || new Date().toISOString().split('T')[0],
            matched_library_items: [item.id],
            matched_watchlist_entries: [entry.id],
            summary: notice_text.slice(0, 1500),
            impact_assessment: personalizedImpact,
            ai_proposed_severity: severity,
            status: 'pending',
            audit_metadata: {
              source: 'manual_scan',
              scanned_by: user.email,
              model_version: 'gemini_3_flash',
              rationale: matchResult.rationale,
              base_severity: matchResult.base_severity,
              scan_timestamp: new Date().toISOString(),
            },
          });

          log(`[ManualScan] ✅ Alert → "${customer.customer_name}" | "${item.item_name}" | ${severity.toUpperCase()}`);
          return { alert, customer_name: customer.customer_name, item_name: item.item_name, severity, rationale: matchResult.rationale, impact_assessment: personalizedImpact };
        })
      );

      const results = await runWithConcurrency(alertTasks, MAX_CONCURRENCY);
      createdAlerts.push(...results.filter(Boolean));
    }

    log(`[ManualScan] Done. ${createdAlerts.length} alert(s) created.`);
    return Response.json({ success: true, logs, alerts: createdAlerts, total: createdAlerts.length });

  } catch (error) {
    console.error('[ManualScan] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});