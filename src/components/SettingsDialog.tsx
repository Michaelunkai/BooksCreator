import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { Settings } from "../types";
import { fetchJson } from "../lib/api";
import { Modal } from "./Modal";
import "../companion.css";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchJson<Settings>("/api/settings", { signal: controller.signal })
      .then(setSettings)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load connection settings.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  function change(changes: Partial<Settings>) {
    setSettings((current) => (current ? { ...current, ...changes } : current));
    setSaved(false);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await fetchJson<Settings>("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          textModel: settings.textModel.trim(),
          imageModel: settings.imageModel.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      setSettings(result);
      setApiKey("");
      setSaved(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Your connection settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Your creative connection" onClose={onClose}>
      <div className="provider-settings modal-body">
        <p className="settings-intro">
          Folio includes a free automatic local model when one is available on
          this computer, plus a browser writing model, browser art model and
          local art studies. They need no account or API key. You can optionally
          add a connected model here for hosted generations.
        </p>
        {loading && (
          <p role="status" className="settings-loading">
            <LoaderCircle size={16} className="spinning" /> Loading settings…
          </p>
        )}
        {settings && (
          <form onSubmit={save}>
            <div
              className={`provider-status ${settings.configured ? "configured" : ""}`}
            >
              <KeyRound size={17} />
              <span>
                {settings.configured
                  ? "Connected model available · offline mode remains ready"
                  : settings.localModelAvailable
                    ? `Automatic local model ready${settings.localModelName ? ` · ${settings.localModelName}` : ""}${settings.localModelContext ? ` · ${Math.round(settings.localModelContext / 1024)}k context` : ""}`
                    : "Free on-device writer ready · no key needed"}
              </span>
            </div>
            <label className="field">
              <span>Provider</span>
              <select
                value={settings.provider}
                onChange={(event) =>
                  change({
                    provider: event.target.value as Settings["provider"],
                    baseUrl:
                      event.target.value === "openai"
                        ? "https://api.openai.com/v1"
                        : settings.provider === "openai"
                          ? "http://localhost:11434/v1"
                          : settings.baseUrl,
                  })
                }
              >
                <option value="openai">OpenAI</option>
                <option value="compatible">OpenAI-compatible provider</option>
              </select>
            </label>
            {settings.provider === "compatible" && (
              <label className="field">
                <span>API base URL</span>
                <input
                  type="url"
                  value={settings.baseUrl}
                  onChange={(event) => change({ baseUrl: event.target.value })}
                  placeholder="https://your-provider.example/v1"
                  required
                />
                <small className="hint">
                  Use HTTPS, or a local provider at localhost / 127.0.0.1.
                </small>
              </label>
            )}
            <label className="field">
              <span>
                Optional API key{" "}
                {settings.configured && (
                  <span className="settings-optional">
                    · leave blank to keep current key
                  </span>
                )}
              </span>
              <input
                aria-label="API key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setSaved(false);
                }}
                placeholder={
                  settings.configured
                    ? "A key is connected. Enter a new key to replace it."
                    : "Leave blank to use Folio offline"
                }
              />
              <small className="hint">
                The key stays in server memory and is never included in book
                files. It is optional; leave this blank to use the free local
                writer, browser art model and art study.
              </small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Optional hosted writing model</span>
                <input
                  value={settings.textModel}
                  onChange={(event) =>
                    change({ textModel: event.target.value })
                  }
                  placeholder="gpt-6-astra"
                  required
                />
              </label>
              <label className="field">
                <span>Optional hosted image model</span>
                <input
                  value={settings.imageModel}
                  onChange={(event) =>
                    change({ imageModel: event.target.value })
                  }
                  placeholder="gpt-image-2"
                  required
                />
              </label>
            </div>
            <p className="hint">
              These fields only affect the optional connected model. The free
              on-device writer and browser art model work without them, and
              connected provider usage can incur charges.
            </p>
            <div className="settings-privacy">
              <ShieldCheck size={19} />
              <p>
                When you generate a draft or illustration, the selected provider
                receives the story context included in that request. Your book
                stays on this computer; only generation sends that context.
              </p>
            </div>
            <a
              className="settings-docs"
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              Optional: manage OpenAI API keys <ExternalLink size={12} />
            </a>
            <div className="settings-actions">
              {saved && (
                <span role="status">
                  <CheckCircle2 size={15} /> Settings saved
                </span>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={saving}
              >
                {saving && <LoaderCircle size={14} className="spinning" />}
                {saving ? "Saving…" : "Save connection"}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
