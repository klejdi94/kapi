import { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { KapiResponse } from '@/types';
import type { TestResult } from '@/lib/scripting';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Thinking } from '@/components/ui/Thinking';
import { generateTestScript } from '@/lib/aiTests';
import { isClaudeCliInstalled } from '@/lib/claudeCli';
import { toast } from '@/lib/toast';

/**
 * Results of the `pm.test(...)` assertions that ran against this response, plus
 * a one-click way to have Claude write those assertions from the response body.
 */
export function TestsView({
  results,
  response,
  hasScript,
  onGenerated,
}: {
  results: TestResult[];
  response: KapiResponse;
  hasScript: boolean;
  onGenerated: (script: string) => void;
}) {
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      if (!(await isClaudeCliInstalled())) {
        toast.error('Claude CLI not found', 'Install it from claude.com/product/claude-code, then try again.');
        return;
      }
      const script = await generateTestScript(response);
      if (!script) {
        toast.error("Claude didn't return a test script", 'Try again, or write the assertions by hand.');
        return;
      }
      onGenerated(script);
      toast.success('Tests generated', 'Added to the request’s Tests script — send again to run them.');
    } catch (err) {
      toast.error('Could not generate tests', (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const generateButton = (
    <Button variant="primary" onClick={generate} disabled={generating}>
      {generating ? <Thinking label="Asking Claude…" /> : <><Sparkles size={13} /> Generate tests with AI</>}
    </Button>
  );

  if (!results.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <EmptyState
          icon={<Check size={28} />}
          title={hasScript ? 'No assertions ran' : 'No tests for this request yet'}
          detail={
            hasScript
              ? 'The Tests script ran but called no pm.test(...) — check the Console for its output or errors.'
              : 'Write pm.test(...) assertions in the request’s Scripts tab, or let Claude write them from this response.'
          }
        />
        <div className="mt-3">{generateButton}</div>
      </div>
    );
  }

  const passed = results.filter((r) => r.passed).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="text-[12px] text-dim">
          <span className={passed === results.length ? 'font-semibold text-ok' : 'font-semibold text-danger'}>
            {passed}/{results.length}
          </span>{' '}
          passed
        </span>
        {generateButton}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.map((result, i) => (
          <div key={`${result.name}-${i}`} className="flex items-start gap-2 border-b border-line/60 px-3 py-2">
            {result.passed ? (
              <Check size={13} className="mt-0.5 shrink-0 text-ok" />
            ) : (
              <X size={13} className="mt-0.5 shrink-0 text-danger" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-fg">{result.name}</div>
              {result.error && <div className="mt-0.5 font-mono text-[11px] text-danger">{result.error}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
