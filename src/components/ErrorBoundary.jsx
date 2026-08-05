import { Component } from 'react';

/**
 * Keeps an unexpected render failure from leaving a blank page.
 *
 * An unusual bill can produce field combinations the UI didn't anticipate, and
 * a white screen gives the customer nowhere to go. This offers a way back.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No telemetry by design — nothing about a bill leaves the browser.
    console.error('WattShift render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center px-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Something went wrong at our end
        </h1>
        <p className="mt-3 text-ink-600 dark:text-ink-300">
          Your bill may be laid out in a way we haven't seen before. Nothing was
          uploaded anywhere — starting again is safe.
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary mt-7"
        >
          Start again
        </button>

        <p className="tech mt-6 break-words">{String(this.state.error?.message || '')}</p>
      </div>
    );
  }
}
