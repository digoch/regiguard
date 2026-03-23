import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-react';

const TEST_LABELS = [
  { key: 'reachability', icon: '🌐', label: 'Site Reachability', desc: 'Is the site up and accessible?' },
  { key: 'recognition', icon: '📄', label: 'Document Recognition', desc: 'Is this an official government/regulatory site?' },
  { key: 'extraction', icon: '🤖', label: 'AI Extraction Simulation', desc: 'Can the AI identify key ECCN/regulatory data?' },
];

export default function SourceValidationPanel({ feedUrl, onValidated }) {
  const [validating, setValidating] = useState(false);
  const [results, setResults] = useState(null); // null = not run yet

  const runValidation = async () => {
    if (!feedUrl) return;
    setValidating(true);
    setResults(null);

    // Step 1: Real HTTP reachability check
    const reachabilityRes = await base44.functions.invoke('checkUrlReachability', { url: feedUrl });
    const realReachable = reachabilityRes?.data?.reachable ?? false;
    const realReachableReason = reachabilityRes?.data?.reason ?? 'Could not determine reachability.';

    // Step 2: LLM checks for recognition + extraction (reachability is now real, pass the result in)
    const llmResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a regulatory data quality analyst. Evaluate the following URL as a potential regulatory data source for an export control compliance platform.

URL: ${feedUrl}

Note: A live HTTP check has already confirmed that this URL is ${realReachable ? 'REACHABLE (site responded successfully)' : 'NOT REACHABLE (site did not respond or returned an error)'}.

Run these two checks and return your assessment:

1. DOCUMENT RECOGNITION: Is this URL from a government, intergovernmental, or official regulatory body? (e.g., .gov, .europa.eu, bis.gov, commerce.gov, trade.ec.europa.eu, gov.uk, customs domains, etc.) OR is it a blog, news site, or unofficial source?

2. AI EXTRACTION SIMULATION: Based on the URL and domain context, would an AI be likely to find structured regulatory content such as ECCN codes, HS codes, control list amendments, export license requirements, or country restriction notices at this URL?

Also provide a confidence_score (integer 0-100) representing overall trustworthiness as a regulatory data source. If the site is not reachable, cap confidence_score at 0.

Respond with JSON only.`,
      response_json_schema: {
        type: 'object',
        properties: {
          recognition: { type: 'boolean' },
          recognition_reason: { type: 'string' },
          extraction: { type: 'boolean' },
          extraction_reason: { type: 'string' },
          confidence_score: { type: 'integer' },
        }
      }
    });

    const combined = {
      reachability: realReachable,
      reachability_reason: realReachableReason,
      recognition: realReachable ? (llmResponse?.recognition ?? false) : false,
      recognition_reason: realReachable ? (llmResponse?.recognition_reason ?? '') : 'Skipped — site is not reachable.',
      extraction: realReachable ? (llmResponse?.extraction ?? false) : false,
      extraction_reason: realReachable ? (llmResponse?.extraction_reason ?? '') : 'Skipped — site is not reachable.',
      confidence_score: realReachable ? (llmResponse?.confidence_score ?? 0) : 0,
    };

    setResults(combined);
    setValidating(false);

    const allPass = combined.reachability && combined.recognition && combined.extraction;
    onValidated(allPass);
  };

  const allPass = results && results.reachability && results.recognition && results.extraction;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        onClick={runValidation}
        disabled={validating || !feedUrl}
        variant="outline"
        className="w-full gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
      >
        {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        {validating ? 'Validating Source...' : 'Validate Source'}
      </Button>

      {(validating || results) && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          {TEST_LABELS.map(({ key, icon, label, desc }) => {
            const passed = results?.[key];
            const reason = results?.[`${key}_reason`];
            const isLoading = validating && !results;

            return (
              <div key={key} className="flex items-start gap-3">
                <div className="mt-0.5 w-5 shrink-0">
                  {isLoading
                    ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                    : passed
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : <XCircle className="w-4 h-4 text-red-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700">{icon} {label}</p>
                  <p className="text-xs text-slate-400">{isLoading ? desc : (reason || desc)}</p>
                </div>
              </div>
            );
          })}

          {allPass && (
            <div className="mt-2 pt-3 border-t border-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">
                {results.confidence_score}% Trusted — Source validated successfully
              </span>
            </div>
          )}

          {results && !allPass && (
            <div className="mt-2 pt-3 border-t border-slate-200">
              <p className="text-xs text-red-600 font-medium">⚠ Validation failed. Please review the URL and try again.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}