import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  saveRecovery = () => {
    const recovered: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("folio.emergency-workspace.v1"))
        recovered[key] = localStorage.getItem(key) ?? "";
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "folio-emergency-recovery",
            savedAt: new Date().toISOString(),
            copies: recovered,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "Folio-emergency-recovery.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-loading">
        <AlertCircle size={32} />
        <h1>The writing desk needs to reopen.</h1>
        <p>
          Your saved books remain on this computer. Download any pending
          recovery data before reopening.
        </p>
        <div className="inline-actions">
          <button className="button secondary" onClick={this.saveRecovery}>
            Download recovery data
          </button>
          <button className="button primary" onClick={() => location.reload()}>
            Reopen Folio
          </button>
        </div>
        <p className="hint">
          Emergency recovery data is a troubleshooting archive. Regular book
          backups can be restored through My library.
        </p>
      </main>
    );
  }
}
