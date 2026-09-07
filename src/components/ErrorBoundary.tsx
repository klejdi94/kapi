import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * There was no error boundary anywhere in the app before this — an uncaught
 * render error in ANY component blanked the entire window with nothing to
 * go on (no devtools in a release build to check the console), which is
 * exactly what made a real crash here indistinguishable from "black screen,
 * no idea why". This at least surfaces the actual error and stack in the UI
 * itself, and offers a reload instead of a dead window.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#0b0d10] p-8 text-[#e7eaef]">
        <h1 className="text-[15px] font-semibold">kapi hit an error it couldn't recover from</h1>
        <p className="max-w-xl text-center text-[12.5px] text-[#99a1ad]">
          Nothing was lost — your data on disk is untouched. This is the actual error, so it can get fixed instead of just
          disappearing into a black screen.
        </p>
        <pre className="max-h-[40vh] max-w-3xl overflow-auto rounded-md border border-[#262c35] bg-[#121519] p-3 text-left font-mono text-[11px] leading-relaxed text-[#f2615c]">
          {error.message}
          {'\n'}
          {error.stack}
          {info?.componentStack}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-md bg-[#8b7cff] px-4 py-2 text-[12.5px] font-medium text-[#0b0d10]"
        >
          Reload
        </button>
      </div>
    );
  }
}
