/**
 * ============================================================
 * SYSTEM INSTRUCTIONS — READ BEFORE MODIFYING THIS FUNCTION
 * ============================================================
 *
 * ARCHITECTURE: Hub-and-Spoke Relational Model
 *
 * DATA SOURCES (the only valid entities for matching):
 *   - GlobalLibrary      → The "Hub". Master list of controlled items (ECCNs, HS codes, etc.)
 *   - CustomerWatchlist  → The "Link" (junction table). Connects Customers to GlobalLibrary items.
 *   - Customer           → The "Spoke". Stores client profiles and alert routing info.
 *   - RegulatorySource   → The "Input". URLs and scraping logic for regulatory feeds.
 *   - ComplianceAlert    → The "Output". Stores AI-generated alerts, linked to Customer via customer_id.
 *   - GlobalConfig       → The "Branding". Firm name and alert email.
 *
 * MATCHING LOGIC RULES (STRICTLY ENFORCED):
 *   1. ALL item matching MUST query GlobalLibrary — never WatchlistItem, GlobalWatchlistLibrary, or CustomerLibraryLink.
 *   2. Customer fan-out MUST flow through CustomerWatchlist: GlobalLibrary → CustomerWatchlist → Customer.
 *   3. ComplianceAlert.customer_id MUST be set to the Customer.id from the CustomerWatchlist fan-out.
 *   4. ComplianceAlert.matched_library_items MUST contain GlobalLibrary item IDs only.
 *   5. ComplianceAlert.matched_watchlist_entries MUST contain CustomerWatchlist entry IDs only.
 *   6. NEVER read from or write to: WatchlistItem, GlobalWatchlistLibrary, CustomerLibraryLink (DELETED).
 *
 * ============================================================
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const CHUNK_SIZE = 4000;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;

function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push({ index: i / CHUNK_SIZE, text: text.slice(i, i + CHUNK_SIZE) });
  }
  return chunks;
}

async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.status === 429 || err?.message?.includes('rate limit') || err?.message?.includes('429');
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

async function processSource(source, libraryItems, customersMap, itemToWatchlistMap, firmName, base44) {
  console.log(`[Scan] Processing source: ${source.name} (${source.regime})`);

  // --- PHASE 1: Fetch notices from the regulatory source ---
  const fetchResult = await withRetry(() =>
    base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a regulatory intelligence agent. Extract all new regulatory notices published in the last 24 hours from this source.
Source: ${source.name}, Regime: ${source.regime}, URL: ${source.feed_url}
Scraping logic: ${source.scraping_logic}
Notice types to watch: ${source.notice_types_to_watch.join(', ')}

Return a JSON array of notices with fields:
- title (string)
- notice_type (one of: final_rule, proposed_rule, interim_rule, guidance, amendment)
- source_url (string)
- publication_date (string, YYYY-MM-DD)
- full_text (string)

Return only notices from the last 24 hours. If none, return empty array.`,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          notices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                notice_type: { type: 'string' },
                source_url: { type: 'string' },
                publication_date: { type: 'string' },
                full_text: { type: 'string' },
              }
            }
          }
        }
      }
    })
  );

  const notices = fetchResult?.notices || [];
  console.log(`[Scan] Found ${notices.length} notices from ${source.name}`);

  const allAlerts = [];

  for (const notice of notices) {
    const noticeText = notice.full_text || notice.title;
    const chunks = chunkText(noticeText);

    // MAP: summarise each chunk
    const mapTasks = chunks.map(chunk => () =>
      withRetry(async () => {
        const summary = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You are a trade compliance expert. Read this excerpt (chunk ${chunk.index + 1}) from a regulatory notice and extract relevant information about controlled items, technologies, country restrictions, license requirements, or control list amendments.

Chunk text:
"""
${chunk.text}
"""

Return a concise summary of relevant regulatory content. If nothing relevant, return "NO_RELEVANT_CONTENT".`,
          model: 'gemini_3_flash',
        });
        return { chunkIndex: chunk.index, summary };
      })
    );

    const chunkSummaries = await runWithConcurrency(mapTasks, MAX_CONCURRENCY);
    const relevantSummaries = chunkSummaries.filter(s => s?.summary && !s.summary.includes('NO_RELEVANT_CONTENT'));

    if (!relevantSummaries.length) {
      console.log(`[Scan] No relevant content in: "${notice.title}"`);
      continue;
    }

    const consolidatedSummary = relevantSummaries.map(s => `[Chunk ${s.chunkIndex}] ${s.summary}`).join('\n\n');

    // --- PHASE 1 (Search): Match against every GlobalLibrary item ---
    const matchTasks = libraryItems.map(item => () =>
      withRetry(async () => {
        const matchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You are a senior export control compliance officer.

Regulatory Notice: "${notice.title}" (${notice.notice_type}) from ${source.name} (${source.regime})
Published: ${notice.publication_date}
Source URL: ${notice.source_url}

Consolidated Summary:
"""
${consolidatedSummary}
"""

Global Library Item:
- Name: ${item.item_name}
- Technical Description: ${item.technical_description}
- ECCN: ${item.eccn || 'N/A'}
- EU Control Number: ${item.eu_control_number || 'N/A'}
- HS Code: ${item.hs_code || 'N/A'}
- Keywords: ${(item.keywords || []).join(', ') || 'N/A'}

Does this notice materially affect this library item? Use semantic matching on the technical description and keyword matching. Consider direct mentions, classification codes, category changes, destination restrictions, and license requirement changes.

Respond with JSON:
- is_match (boolean)
- base_severity (string): one of "low", "medium", "high", "critical"
- rationale (string)
- base_impact_assessment (string): generic impact summary for this item
- matched_chunk_indices (array of integers)`,
          model: 'gemini_3_flash',
          response_json_schema: {
            type: 'object',
            properties: {
              is_match: { type: 'boolean' },
              base_severity: { type: 'string' },
              rationale: { type: 'string' },
              base_impact_assessment: { type: 'string' },
              matched_chunk_indices: { type: 'array', items: { type: 'integer' } },
            }
          }
        });
        return { item, matchResult };
      })
    );

    const matchResults = await runWithConcurrency(matchTasks, MAX_CONCURRENCY);

    for (const { item, matchResult } of matchResults) {
      if (!matchResult?.is_match) continue;

      // --- PHASE 2 (Fan-Out): Find all customers linked via CustomerWatchlist ---
      const watchlistEntries = itemToWatchlistMap[item.id] || [];
      if (!watchlistEntries.length) {
        console.log(`[Scan] Library item "${item.item_name}" matched but has no linked customers — skipping.`);
        continue;
      }

      // --- PHASE 3 (Personalization) + PHASE 4 (Routing): One alert per customer ---
      const customerAlertTasks = watchlistEntries.map(entry => () =>
        withRetry(async () => {
          const customer = customersMap[entry.customer_link];
          if (!customer) return null;

          const customerName = customer.customer_name || 'the client';
          const industry = customer.industry || 'their industry';
          const riskTolerance = customer.risk_tolerance || 'medium';
          const clientNotes = entry.client_specific_notes || null;

          // Severity: start from base, tune by risk_tolerance, then apply custom_severity_override
          const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
          let severity = matchResult.base_severity || 'medium';

          if (riskTolerance === 'high' && severityRank[severity] < severityRank['high']) severity = 'high';
          if (riskTolerance === 'low' && severity === 'high') severity = 'medium';

          // custom_severity_override from junction table takes final precedence
          if (entry.custom_severity_override) {
            const override = entry.custom_severity_override;
            if (severityRank[override] > severityRank[severity]) {
              severity = override;
            }
          }

          // Personalized impact assessment incorporating client-specific context
          const personalizedImpact = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are a compliance advisor. Personalize this impact assessment for a specific client.

Base Assessment: "${matchResult.base_impact_assessment}"

Client:
- Name: ${customerName}
- Industry: ${industry}
- Risk Tolerance: ${riskTolerance}
${clientNotes ? `- How they use this item: "${clientNotes}"` : ''}

Rewrite the impact assessment starting with: "For ${customerName} in the ${industry} sector, this change means..."
${clientNotes ? `Specifically address how this impacts their usage: "${clientNotes}".` : ''}
Keep it concise (2-3 sentences).`,
            model: 'gemini_3_flash',
          });

          const auditMetadata = {
            model_version: 'gemini_3_flash',
            chunk_indices_matched: matchResult.matched_chunk_indices || [],
            rationale: matchResult.rationale,
            base_severity: matchResult.base_severity,
            tuned_severity: severity,
            risk_tolerance_applied: riskTolerance,
            custom_severity_override: entry.custom_severity_override || null,
            client_specific_notes_used: clientNotes || null,
            scan_timestamp: new Date().toISOString(),
          };

          // PHASE 4: target_recipient auto-populated from customer's primary_contact_email
          const alert = await base44.asServiceRole.entities.ComplianceAlert.create({
            title: `[${source.regime}] ${notice.title} — Impact on: ${item.item_name}`,
            customer_id: customer.id,
            target_recipient: customer.primary_contact_email || null,
            source: source.id,
            notice_type: notice.notice_type,
            source_url: notice.source_url,
            publication_date: notice.publication_date,
            matched_watchlist_items: [item.id],
            summary: consolidatedSummary.slice(0, 2000),
            impact_assessment: personalizedImpact,
            ai_proposed_severity: severity,
            status: 'pending',
            audit_metadata: auditMetadata,
          });

          console.log(`[Scan] ✅ Alert for "${customerName}" | Item: "${item.item_name}" | Severity: ${severity}`);
          return { alert, notice, matchResult, auditMetadata, item, customer, severity, personalizedImpact };
        })
      );

      const customerAlerts = await runWithConcurrency(customerAlertTasks, MAX_CONCURRENCY);
      allAlerts.push(...customerAlerts.filter(Boolean));
    }
  }

  return allAlerts;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log(`[Scan] Starting at ${new Date().toISOString()}`);

    const [sources, libraryItems, watchlistEntries, customers, configs] = await Promise.all([
      base44.asServiceRole.entities.RegulatorySource.filter({ is_active: true }),
      base44.asServiceRole.entities.GlobalLibrary.list(),
      base44.asServiceRole.entities.CustomerWatchlist.list(),
      base44.asServiceRole.entities.Customer.list(),
      base44.asServiceRole.entities.GlobalConfig.list(),
    ]);

    // Build lookup: customerId → customer
    const customersMap = Object.fromEntries(customers.map(c => [c.id, c]));

    // Build lookup: libraryItemId → [watchlistEntry, ...]
    // Each entry includes customer_link, library_item_link, client_specific_notes, custom_severity_override
    const itemToWatchlistMap = {};
    for (const entry of watchlistEntries) {
      if (!itemToWatchlistMap[entry.library_item_link]) itemToWatchlistMap[entry.library_item_link] = [];
      itemToWatchlistMap[entry.library_item_link].push(entry);
    }

    const firmName = configs?.[0]?.firm_name || 'RegIntel';
    const alertEmail = configs?.[0]?.compliance_alert_email;

    console.log(`[Scan] ${sources.length} sources, ${libraryItems.length} library items, ${watchlistEntries.length} watchlist entries`);

    if (!libraryItems.length || !sources.length) {
      return Response.json({ message: 'No active sources or library items. Scan skipped.' });
    }

    const sourceTasks = sources.map(source => () =>
      processSource(source, libraryItems, customersMap, itemToWatchlistMap, firmName, base44)
    );
    const sourceResults = await runWithConcurrency(sourceTasks, MAX_CONCURRENCY);
    const allAlerts = sourceResults.flat().filter(Boolean);

    // Send personalized emails to each customer
    const emailTasks = allAlerts
      .filter(({ alert }) => alert.target_recipient)
      .map(({ alert, notice, matchResult, auditMetadata, item, customer, severity, personalizedImpact }) => () =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: firmName,
          to: alert.target_recipient,
          subject: `[${firmName} Alert] Action Required for ${customer.customer_name}: ${item.item_name}`,
          body: `Dear ${customer.customer_name},

A new ${severity.toUpperCase()} severity regulatory alert has been identified that requires your attention.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALERT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Item Affected: ${item.item_name}
Notice: ${notice.title}
Regime: ${notice.notice_type?.replace(/_/g, ' ').toUpperCase()}
Published: ${notice.publication_date}
Severity: ${severity.toUpperCase()}
Source: ${notice.source_url}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPACT ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${personalizedImpact}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI RATIONALE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${matchResult.rationale}

Please log in to the compliance portal to review and confirm this alert.

Generated on ${auditMetadata.scan_timestamp} by ${firmName}.`.trim(),
        })
      );

    if (emailTasks.length > 0) {
      await runWithConcurrency(emailTasks, 3);
      console.log(`[Scan] 📧 Sent ${emailTasks.length} personalized email(s).`);
    }

    // Internal admin email for high/critical alerts
    if (alertEmail) {
      const adminTasks = allAlerts
        .filter(({ severity }) => ['high', 'critical'].includes(severity))
        .map(({ alert, notice, auditMetadata }) => () =>
          base44.asServiceRole.integrations.Core.SendEmail({
            from_name: firmName,
            to: alertEmail,
            subject: `[${alert.ai_proposed_severity.toUpperCase()}] Internal Alert: ${notice.title}`,
            body: `Internal notification: A ${alert.ai_proposed_severity.toUpperCase()} severity alert was generated.\n\nTitle: ${alert.title}\nSource: ${notice.source_url}\nScan Timestamp: ${auditMetadata.scan_timestamp}`,
          })
        );
      if (adminTasks.length > 0) await runWithConcurrency(adminTasks, 3);
    }

    const summary = `Scan complete. ${allAlerts.length} alert(s) created across ${customers.length} customer(s) from ${sources.length} source(s).`;
    console.log(`[Scan] ${summary}`);
    return Response.json({ success: true, alerts_created: allAlerts.length, summary });

  } catch (error) {
    console.error('[Scan] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});