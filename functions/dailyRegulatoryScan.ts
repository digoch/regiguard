import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const CHUNK_SIZE = 4000; // characters per chunk
const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 4;

// Splits text into chunks of CHUNK_SIZE characters
function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push({ index: i / CHUNK_SIZE, text: text.slice(i, i + CHUNK_SIZE) });
  }
  return chunks;
}

// Exponential backoff retry wrapper
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.status === 429 || err?.message?.includes('rate limit') || err?.message?.includes('429');
      if (attempt === maxRetries || !isRateLimit) throw err;
      console.warn(`Rate limit hit. Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

// Runs async tasks with limited concurrency
async function runWithConcurrency(tasks, limit) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const p = task().then(r => { results.push(r); });
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(0, executing.findIndex(e => e === p) + 1);
    }
  }
  await Promise.all(executing);
  return results;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: admin only
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log(`[DailyRegulatoryScan] Starting scan at ${new Date().toISOString()}`);

    // 1. Load active sources, watchlist items, and config
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

    const allAlerts = [];

    // 2. For each source, fetch and parse regulatory notices
    for (const source of sources) {
      console.log(`[DailyRegulatoryScan] Processing source: ${source.name} (${source.regime})`);

      // Use LLM to fetch and extract notices from the source feed
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

      // 3. For each notice, run Map-Reduce against watchlist
      for (const notice of notices) {
        const noticeText = notice.full_text || notice.title;
        const chunks = chunkText(noticeText);

        console.log(`[DailyRegulatoryScan] Notice: "${notice.title}" → ${chunks.length} chunks`);

        // --- MAP PHASE: Summarize each chunk concurrently ---
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
        const relevantSummaries = chunkSummaries.filter(s => s && s.summary && !s.summary.includes('NO_RELEVANT_CONTENT'));

        if (!relevantSummaries.length) {
          console.log(`[DailyRegulatoryScan] No relevant content in notice: "${notice.title}"`);
          continue;
        }

        const consolidatedSummary = relevantSummaries.map(s => `[Chunk ${s.chunkIndex}] ${s.summary}`).join('\n\n');

        // --- REDUCE PHASE: Match against each watchlist item ---
        const matchTasks = watchlistItems.map(item => () =>
          withRetry(async () => {
            const MODEL = 'gemini_3_flash';
            const matchPrompt = `You are a senior export control compliance officer.

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
- severity (string): one of "low", "medium", "high", "critical" — only if is_match is true
- rationale (string): A precise, detailed explanation (2-4 sentences) of exactly WHY this notice affects this item. Reference specific regulatory language. If not a match, explain why not.
- impact_assessment (string): If is_match, describe the operational impact for a compliance officer.
- matched_chunk_indices (array of integers): The chunk indices that contained the relevant matching content.`;

            const matchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
              prompt: matchPrompt,
              model: MODEL,
              response_json_schema: {
                type: 'object',
                properties: {
                  is_match: { type: 'boolean' },
                  severity: { type: 'string' },
                  rationale: { type: 'string' },
                  impact_assessment: { type: 'string' },
                  matched_chunk_indices: { type: 'array', items: { type: 'integer' } },
                  token_usage: {
                    type: 'object',
                    properties: {
                      prompt_tokens: { type: 'integer' },
                      completion_tokens: { type: 'integer' },
                      total_tokens: { type: 'integer' },
                    }
                  }
                }
              }
            });

            return { item, notice, source, matchResult, model: MODEL };
          })
        );

        const matchResults = await runWithConcurrency(matchTasks, MAX_CONCURRENCY);

        // 4. Create ComplianceAlert for each positive match
        for (const { item, matchResult, model } of matchResults) {
          if (!matchResult?.is_match) continue;

          // Build the Audit Metadata object
          const auditMetadata = {
            model_version: model,
            chunk_indices_matched: matchResult.matched_chunk_indices || [],
            total_chunks_processed: chunks.length,
            rationale: matchResult.rationale,
            token_usage: matchResult.token_usage || null,
            scan_timestamp: new Date().toISOString(),
          };

          const alert = await base44.asServiceRole.entities.ComplianceAlert.create({
            title: `[${source.regime}] ${notice.title} — Impact on: ${item.item_name}`,
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
          console.log(`[DailyRegulatoryScan] Audit Metadata: Model=${auditMetadata.model_version}, Chunks=${auditMetadata.chunk_indices_matched}, Tokens=${auditMetadata.token_usage?.total_tokens ?? 'N/A'}`);

          allAlerts.push(alert);

          // 5. Email notification for high/critical
          if (alertEmail && ['high', 'critical'].includes(alert.ai_proposed_severity)) {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: alertEmail,
              subject: `[${alert.ai_proposed_severity.toUpperCase()}] Regulatory Alert: ${notice.title}`,
              body: `
A new ${alert.ai_proposed_severity.toUpperCase()} severity compliance alert has been generated.

Title: ${alert.title}
Notice Type: ${notice.notice_type}
Source: ${source.name} (${source.regime})
Published: ${notice.publication_date}
Source URL: ${notice.source_url}

Impact Assessment:
${matchResult.impact_assessment}

AI Rationale:
${matchResult.rationale}

--- Audit Metadata ---
Model: ${auditMetadata.model_version}
Chunk Indices Matched: ${auditMetadata.chunk_indices_matched.join(', ') || 'N/A'}
Total Chunks Processed: ${auditMetadata.total_chunks_processed}
Token Usage: ${auditMetadata.token_usage ? JSON.stringify(auditMetadata.token_usage) : 'N/A'}
Scan Timestamp: ${auditMetadata.scan_timestamp}

Please log in to review and confirm this alert.
              `.trim(),
            });
            console.log(`[DailyRegulatoryScan] 📧 Email sent for alert: "${alert.title}"`);
          }
        }
      }
    }

    const summary = `Scan complete. ${allAlerts.length} alert(s) created from ${sources.length} source(s).`;
    console.log(`[DailyRegulatoryScan] ${summary}`);
    return Response.json({ success: true, alerts_created: allAlerts.length, summary });

  } catch (error) {
    console.error('[DailyRegulatoryScan] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});