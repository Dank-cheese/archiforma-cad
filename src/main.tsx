import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  handleResetAndReload = () => {
    try {
      localStorage.removeItem('archiforma_project_v1');
    } catch {
      // ignore storage errors
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-stone-50 text-stone-900 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-stone-200 rounded-lg shadow-sm p-6 space-y-4">
            <h1 className="text-lg font-semibold text-stone-900">
              ARCHIFORMA encountered a startup error
            </h1>
            <p className="text-sm text-stone-600">
              A saved project state in browser storage may be incompatible with the latest version.
            </p>
            <pre className="text-xs bg-stone-100 text-red-700 p-3 rounded overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleResetAndReload}
                className="px-4 py-2 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                Reset Saved Project &amp; Reload
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-medium rounded border border-stone-300 text-stone-700 hover:bg-stone-100 transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
