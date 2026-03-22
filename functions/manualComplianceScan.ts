/**
 * ============================================================
 * MANUAL COMPLIANCE SCAN — Intelligence Center
 * ============================================================
 * Strict 5-Step Relational Execution Path:
 *
 * Step 1 — Library Scan:    Parse notice → match against GlobalLibrary
 *                            (ECCN hard-match OR fuzzy keyword/semantic match)
 * Step 2 — Junction Lookup: For each matched item → find CustomerWatchlist entries
 * Step 3 — Attr Injection:  Pull client_specific_notes + custom_severity_override from junction
 * Step 4 — Customer Context: Pull risk_tolerance + primary_contact_email from Customer
 * Step 5 — Alert Generation: Create one ComplianceAlert per linked customer
 *
 * HARD MATCH RULE: If an ECCN code in the notice exactly matches item.eccn → always is_match=true
 * IMPACT RULE: impact_assessment = synthesis of Notice + Library Tech Specs + Client Notes
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

/**
 * Extract all ECCN-like codes from a text string.
 * ECCN format: [0-9][A-Z][0-9]{3} e.g. 3A001, 5E002, EAR99
 */
function extractEccns(text) {
  const matches = text.match(/\b([0-9][A-Z][0-9]{3}[a-z]?|EAR99)\b/g) || [];
  return matches.map(e => e.toUpperCase());
}

/**
 * STEP 1 pre-filter: Hard ECCN match check (no LLM needed).
 * Returns true if item.eccn appears in the notice text.
 */
function isHardEccnMatch(noticeText, itemEccn) {
  if (!itemEccn) return false;
  const noticeEccns = extractEccns(noticeText);
  return noticeEccns.includes(itemEccn.toUpperCase().trim());
}

const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };

function applySeverityRules(baseSeverity, riskTolerance, customOverride) {
  let severity = baseSeverity || 'medium';
  // Tune by customer risk_tolerance
  if (riskTolerance === 'high' && severityRank[severity] < severityRank['high']) severity = 'high';
  if (riskTolerance === 'low' && severity === 'high') severity = 'medium';
  // custom_severity_override from junction takes final precedence (only escalates)
  if (customOverride && severityRank[customOverride] > severityRank[severity]) {
    severity = customOverride;
  }
  return severity;
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

    // ── Load all data up-front ──────────────────────────────────────────────
    const [libraryItems, watchlistEntries, customers, configs] = await Promise.all([
      base44.asServiceRole.entities.GlobalLibrary.list(),
      base44.asServiceRole.entities.CustomerWatchlist.list(),
      base44.asServiceRole.entities.Customer.list(),
      base44.asServiceRole.entities.GlobalConfig.list(),
    ]);

    const customersMap = Object.fromEntries(customers.map(c => [c.id, c]));

    // STEP 2 — Build junction map: libraryItemId → [watchlistEntry, ...]
    const itemToWatchlistMap = {};
    for (const entry of watchlistEntries) {
      if (!itemToWatchlistMap[entry.library_item_link]) itemToWatchlistMap[entry.library_item_link] = [];
      itemToWatchlistMap[entry.library_item_link].push(entry);
    }

    const firmName = configs?.[0]?.firm_name || 'RegIntel';
    const noticeEccns = extractEccns(notice_text);
    log(`[ManualScan] ${libraryItems.length} library items | ${watchlistEntries.length} watchlist entries | ECCNs in notice: ${noticeEccns.join(', ') || 'none detected'}`);

    if (!libraryItems.length) {
      return Response.json({ logs, alerts: [], message: 'No library items found. Add items to GlobalLibrary first.' });
    }

    // ── STEP 1: Match each GlobalLibrary item against the notice ────────────
    const matchTasks = libraryItems.map(item => () =>
      withRetry(async () => {
        // Hard ECCN match — bypass LLM entirely
        const hardMatch = isHardEccnMatch(notice_text, item.eccn);
        if (hardMatch) {
          log(`[ManualScan] 🔴 HARD MATCH (ECCN ${item.eccn}) → "${item.item_name}"`);
          return {
            item,
            matchResult: {
              is_match: true,
              is_hard_match: true,
              base_severity: 'high',
              rationale: `Hard match: ECCN ${item.eccn} explicitly cited in the regulatory notice.`,
              base_impact_assessment: `This item (ECCN ${item.eccn}) is directly named in the regulatory notice and must be reviewed for compliance implications.`,
            }
          };
        }

        // Semantic + fuzzy LLM match
        const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You are a senior export control compliance officer reviewing a regulatory notice on behalf of a consulting firm.

MATCHING RULES (apply in order):
1. ECCN HARD MATCH: If the notice mentions an ECCN code that matches the item's ECCN → is_match=true, severity=high minimum.
2. KEYWORD MATCH: If the notice mentions any keyword or synonym from the item's keyword list → is_match=true.
3. FUZZY / SEMANTIC MATCH: Apply broad semantic reasoning:
   - "semiconductor" ↔ "microprocessor", "chip", "integrated circuit"
   - "drone" ↔ "UAV", "unmanned aerial vehicle"
   - "AI accelerator" ↔ "GPU", "TOPS", "neural processing unit"
   - "advanced computing" ↔ "high-performance processor", "HPC"
   - Any technology category, regime, or country restriction that plausibly applies to this item.
4. DEFAULT: When in doubt → is_match=true. Human consultants will do final review. Only set is_match=false if the notice is 100% unrelated to this item's domain.

Full Regulatory Notice:
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
- is_match (boolean): true if ANY plausible connection exists (err on the side of flagging)
- base_severity (string): "low" | "medium" | "high" | "critical"
- rationale (string): 1-2 sentences explaining exactly what triggered the match (or why excluded)
- base_impact_assessment (string): concise generic impact summary referencing the item's tech specs`,
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
        if (result?.is_match) log(`[ManualScan] ✅ Semantic match → "${item.item_name}" (${result.base_severity})`);
        return { item, matchResult: { ...result, is_hard_match: false } };
      })
    );

    const matchResults = await runWithConcurrency(matchTasks, MAX_CONCURRENCY);
    const matched = matchResults.filter(r => r?.matchResult?.is_match);
    log(`[ManualScan] ${matched.length} of ${libraryItems.length} library items matched`);

    const createdAlerts = [];

    for (const { item, matchResult } of matched) {
      // STEP 2 — Junction lookup
      const watchlistLinked = itemToWatchlistMap[item.id] || [];
      if (!watchlistLinked.length) {
        log(`[ManualScan] ⚠ "${item.item_name}" matched but no customers linked in watchlist — skipping`);
        continue;
      }

      const alertTasks = watchlistLinked.map(entry => () =>
        withRetry(async () => {
          // STEP 4 — Customer context
          const customer = customersMap[entry.customer_link];
          if (!customer) {
            log(`[ManualScan] ⚠ Watchlist entry ${entry.id} has unresolved customer_link — skipping`);
            return null;
          }

          // STEP 3 — Attribute injection from junction
          const clientNotes = entry.client_specific_notes || null;
          const customOverride = entry.custom_severity_override || null;
          const riskTolerance = customer.risk_tolerance || 'medium';

          // Severity: base → risk_tolerance tuning → custom_override escalation
          const severity = applySeverityRules(matchResult.base_severity, riskTolerance, customOverride);

          // STEP 5 — Impact assessment: synthesize Notice + Library Tech Specs + Client Notes
          const personalizedImpact = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are a senior compliance advisor at ${firmName}. Write a personalized impact assessment for a specific client.

You must synthesize THREE sources into a single, coherent assessment:

[SOURCE 1 — Regulatory Notice]
${notice_text.slice(0, 3000)}

[SOURCE 2 — Global Library Item Tech Specs]
- Item Name: ${item.item_name}
- Technical Description: ${item.technical_description}
- ECCN: ${item.eccn || 'N/A'}
- HS Code: ${item.hs_code || 'N/A'}
- Keywords: ${(item.keywords || []).join(', ') || 'N/A'}
- Match Rationale: ${matchResult.rationale}

[SOURCE 3 — Client-Specific Context]
- Client Name: ${customer.customer_name}
- Industry: ${customer.industry || 'N/A'}
- Risk Tolerance: ${riskTolerance}
${clientNotes ? `- How they use this item: "${clientNotes}"` : '- No client-specific usage notes on file.'}

Write 3-4 sentences starting with: "For ${customer.customer_name}, this regulatory change means..."
Reference the specific technical specs and how the notice change affects this client's actual use case${clientNotes ? ' as described in their notes' : ''}.
Be specific, actionable, and reference the regulatory source where possible.`,
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
              is_hard_eccn_match: matchResult.is_hard_match || false,
              rationale: matchResult.rationale,
              base_severity: matchResult.base_severity,
              risk_tolerance_applied: riskTolerance,
              custom_severity_override: customOverride,
              client_specific_notes_used: clientNotes,
              scan_timestamp: new Date().toISOString(),
            },
          });

          log(`[ManualScan] ✅ Alert → "${customer.customer_name}" | "${item.item_name}" | ${severity.toUpperCase()}${matchResult.is_hard_match ? ' [HARD ECCN MATCH]' : ''}`);
          return {
            alert,
            customer_name: customer.customer_name,
            item_name: item.item_name,
            severity,
            rationale: matchResult.rationale,
            impact_assessment: personalizedImpact,
            is_hard_match: matchResult.is_hard_match || false,
          };
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