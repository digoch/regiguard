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

// Fixed concurrency runner using a semaphore pattern
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

async function processSource(source, watchlistItems, base44) {
  console.log(`[DailyRegulatoryScan] Processing source: ${source.name} (${source.regime})`);

  const fetchResult = await withRetry(() =>
    base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a regulatory intelligence agent. Given the following URL for a regulatory source, 
extract all new regulatory notices published in the last 24 hours. 
Source: ${source.name}, Regime: ${source.regime}, URL: ${source.feed_url}
Scraping logic: ${source.scraping_logic}
Notice types to watch: ${source.notice_types_to_watch.join(', ')}

Return a JSON array of notices. Each notice object must have:
- title (string)
- notice_type (one of: final_rule, proposed_rule, interim_rule, guidance, amendment)
- source_url (string, full URL to the notice)
- publication_date (string, YYYY-MM-DD)
- full_text (string, full text content of the notice if available, else a detailed summary)

Return only notices from the last 24 hours. If none found, return an empty array.`,
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
  console.log(`[DailyRegulatoryScan] Found ${notices.length} notices from ${source.name}`);

  const sourceAlerts = [];

  for (const notice of notices) {
    const noticeText = notice.full_text || notice.title;
    const chunks = chunkText(noticeText);
    console.log(`[DailyRegulatoryScan] Notice: "${notice.title}" → ${chunks.length} chunks`);

    // MAP PHASE
    const mapTasks = chunks.map(chunk => () =>
      withRetry(async () => {
        const mapResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You are a trade compliance expert. Read the following excerpt (chunk ${chunk.index + 1}) from a regulatory notice and extract any relevant information about:
- Controlled items, technologies, or commodities
- Country or destination restrictions
- License requirements or changes
- Any amendments to control lists

Chunk text:
"""
${chunk.text}
"""

Return a concise summary of relevant regulatory content found in this chunk. If nothing relevant, return "NO_RELEVANT_CONTENT".`,
          model: 'gemini_3_flash',
        });
        return { chunkIndex: chunk.index, summary: mapResult };
      })
    );

    const chunkSummaries = await runWithConcurrency(mapTasks, MAX_CONCURRENCY);
    const relevantSummaries = chunkSummaries.filter(s => s?.summary && !s.summary.includes('NO_RELEVANT_CONTENT'));

    if (!relevantSummaries.length) {
      console.log(`[DailyRegulatoryScan] No relevant content in notice: "${notice.title}"`);
      continue;
    }

    const consolidatedSummary = relevantSummaries.map(s => `[Chunk ${s.chunkIndex}] ${s.summary}`).join('\n\n');

    // REDUCE PHASE
    const matchTasks = watchlistItems.map(item => () =>
      withRetry(async () => {
        const MODEL = 'gemini_3_flash';
        const matchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `You are a senior export control compliance officer.

Regulatory Notice: "${notice.title}" (${notice.notice_type}) from ${source.name} (${source.regime})
Published: ${notice.publication_date}
Source URL: ${notice.source_url}

Consolidated Regulatory Summary:
"""
${consolidatedSummary}
"""

Watchlist Item to evaluate:
- Name: ${item.item_name}
- Description: ${item.description}
- ECCN: ${item.eccn || 'N/A'}
- EU Control Number: ${item.eu_control_number || 'N/A'}
- UK Control Entry: ${item.uk_control_entry || 'N/A'}
- HS Code: ${item.hs_code || 'N/A'}
- Keywords: ${(item.keywords || []).join(', ') || 'N/A'}

Does this regulatory notice materially affect this watchlist item? Consider:
1. Direct mentions of the item, its classification codes, or synonyms
2. Broader category changes that would encompass this item
3. Destination/country restrictions relevant to this item
4. License requirement changes

Respond with a JSON object containing:
- is_match (boolean): true only if there is a clear, material impact
- severity (string): one of "low", "medium", "high", "critical"
- rationale (string): precise explanation of WHY this notice affects this item
- impact_assessment (string): operational impact for a compliance officer
- matched_chunk_indices (array of integers)`,
          model: MODEL,
          response_json_schema: {
            type: 'object',
            properties: {
              is_match: { type: 'boolean' },
              severity: { type: 'string' },
              rationale: { type: 'string' },
              impact_assessment: { type: 'string' },
              matched_chunk_indices: { type: 'array', items: { type: 'integer' } },
            }
          }
        });

        return { item, matchResult, model: MODEL };
      })
    );

    const matchResults = await runWithConcurrency(matchTasks, MAX_CONCURRENCY);

    for (const { item, matchResult, model } of matchResults) {
      if (!matchResult?.is_match) continue;

      const auditMetadata = {
        model_version: model,
        chunk_indices_matched: matchResult.matched_chunk_indices || [],
        total_chunks_processed: chunks.length,
        rationale: matchResult.rationale,
        scan_timestamp: new Date().toISOString(),
      };

      const alert = await base44.asServiceRole.entities.ComplianceAlert.create({
        title: `[${source.regime}] ${notice.title} — Impact on: ${item.item_name}`,
        customer_id: item.belongs_to_customer || null,
        source: source.id,
        notice_type: notice.notice_type,
        source_url: notice.source_url,
        publication_date: notice.publication_date,
        matched_watchlist_items: [item.id],
        summary: consolidatedSummary.slice(0, 2000),
        impact_assessment: matchResult.impact_assessment,
        ai_proposed_severity: matchResult.severity || 'medium',
        status: 'pending',
        audit_metadata: auditMetadata,
      });

      console.log(`[DailyRegulatoryScan] ✅ Alert created: "${alert.title}" | Severity: ${alert.ai_proposed_severity}`);
      sourceAlerts.push({ alert, notice, matchResult, auditMetadata });
    }
  }

  return sourceAlerts;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log(`[DailyRegulatoryScan] Starting scan at ${new Date().toISOString()}`);

    const [sources, watchlistItems, configs] = await Promise.all([
      base44.asServiceRole.entities.RegulatorySource.filter({ is_active: true }),
      base44.asServiceRole.entities.WatchlistItem.filter({ status: 'active' }),
      base44.asServiceRole.entities.GlobalConfig.list(),
    ]);

    const alertEmail = configs?.[0]?.compliance_alert_email;
    console.log(`[DailyRegulatoryScan] Loaded ${sources.length} sources, ${watchlistItems.length} watchlist items.`);

    if (!watchlistItems.length || !sources.length) {
      return Response.json({ message: 'No active sources or watchlist items. Scan skipped.' });
    }

    // Process all sources in parallel (capped at MAX_CONCURRENCY)
    const sourceTasks = sources.map(source => () => processSource(source, watchlistItems, base44));
    const sourceResults = await runWithConcurrency(sourceTasks, MAX_CONCURRENCY);
    const allAlerts = sourceResults.flat();

    // Send emails for high/critical alerts
    if (alertEmail) {
      const emailTasks = allAlerts
        .filter(({ alert }) => ['high', 'critical'].includes(alert.ai_proposed_severity))
        .map(({ alert, notice, matchResult, auditMetadata }) => () =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: alertEmail,
            subject: `[${alert.ai_proposed_severity.toUpperCase()}] Regulatory Alert: ${notice.title}`,
            body: `A new ${alert.ai_proposed_severity.toUpperCase()} severity compliance alert has been generated.

Title: ${alert.title}
Notice Type: ${notice.notice_type}
Published: ${notice.publication_date}
Source URL: ${notice.source_url}

Impact Assessment:
${matchResult.impact_assessment}

AI Rationale:
${matchResult.rationale}

Scan Timestamp: ${auditMetadata.scan_timestamp}

Please log in to review and confirm this alert.`.trim(),
          })
        );
      await runWithConcurrency(emailTasks, 3);
    }

    const summary = `Scan complete. ${allAlerts.length} alert(s) created from ${sources.length} source(s).`;
    console.log(`[DailyRegulatoryScan] ${summary}`);
    return Response.json({ success: true, alerts_created: allAlerts.length, summary });

  } catch (error) {
    console.error('[DailyRegulatoryScan] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});