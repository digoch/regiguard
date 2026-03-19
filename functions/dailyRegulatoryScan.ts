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

async function processSource(source, libraryItems, customersMap, itemToCustomersMap, firmName, base44) {
  console.log(`[Scan] Processing source: ${source.name} (${source.regime})`);

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

    // REDUCE: match each library item
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

Watchlist Library Item:
- Name: ${item.item_name}
- Description: ${item.description}
- ECCN: ${item.eccn || 'N/A'}
- EU Control Number: ${item.eu_control_number || 'N/A'}
- UK Control Entry: ${item.uk_control_entry || 'N/A'}
- HS Code: ${item.hs_code || 'N/A'}
- Keywords: ${(item.keywords || []).join(', ') || 'N/A'}

Does this notice materially affect this item? Consider direct mentions, classification codes, category changes, destination restrictions, and license requirement changes.

Respond with JSON:
- is_match (boolean)
- base_severity (string): one of "low", "medium", "high", "critical" — before customer risk tuning
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

      // Fan out: one alert per linked customer
      const linkedCustomers = itemToCustomersMap[item.id] || [];
      if (!linkedCustomers.length) {
        console.log(`[Scan] Item "${item.item_name}" matched but has no linked customers — skipping.`);
        continue;
      }

      const customerAlertTasks = linkedCustomers.map(customer => () =>
        withRetry(async () => {
          const customerName = customer.customer_name || 'the client';
          const industry = customer.industry || 'their industry';
          const riskTolerance = customer.risk_tolerance || 'medium';

          // Tune severity per customer risk tolerance
          let severity = matchResult.base_severity || 'medium';
          if (riskTolerance === 'high' && severity === 'medium') severity = 'high';
          if (riskTolerance === 'low' && severity === 'high') severity = 'medium';

          // Personalize impact assessment
          const personalizedImpact = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are a compliance advisor. Personalize this impact assessment for a specific client.

Base Assessment: "${matchResult.base_impact_assessment}"

Client:
- Name: ${customerName}
- Industry: ${industry}
- Risk Tolerance: ${riskTolerance}

Rewrite the impact assessment starting with: "For ${customerName} in the ${industry} sector, this change means..."
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
            scan_timestamp: new Date().toISOString(),
          };

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

    const [sources, libraryItems, links, customers, configs] = await Promise.all([
      base44.asServiceRole.entities.RegulatorySource.filter({ is_active: true }),
      base44.asServiceRole.entities.GlobalWatchlistLibrary.filter({ status: 'active' }),
      base44.asServiceRole.entities.CustomerLibraryLink.list(),
      base44.asServiceRole.entities.Customer.list(),
      base44.asServiceRole.entities.GlobalConfig.list(),
    ]);

    // Build lookup maps
    const customersMap = Object.fromEntries(customers.map(c => [c.id, c]));

    // itemId → [customer, customer, ...]
    const itemToCustomersMap = {};
    for (const link of links) {
      if (!itemToCustomersMap[link.library_item_id]) itemToCustomersMap[link.library_item_id] = [];
      const customer = customersMap[link.customer_id];
      if (customer) itemToCustomersMap[link.library_item_id].push(customer);
    }

    const firmName = configs?.[0]?.firm_name || 'RegIntel';
    const alertEmail = configs?.[0]?.compliance_alert_email;

    console.log(`[Scan] ${sources.length} sources, ${libraryItems.length} library items, ${links.length} customer links`);

    if (!libraryItems.length || !sources.length) {
      return Response.json({ message: 'No active sources or library items. Scan skipped.' });
    }

    const sourceTasks = sources.map(source => () =>
      processSource(source, libraryItems, customersMap, itemToCustomersMap, firmName, base44)
    );
    const sourceResults = await runWithConcurrency(sourceTasks, MAX_CONCURRENCY);
    const allAlerts = sourceResults.flat().filter(Boolean);

    // Send personalized emails
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

    // Internal admin email for high/critical
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