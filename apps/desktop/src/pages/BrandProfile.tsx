import { useEffect, useState } from "react";
import {
  ExternalLink,
  Globe2,
  MessageSquare,
  Palette,
  Target,
  Users,
} from "lucide-react";
import type { Brand } from "../lib/brand";
import { api } from "../lib/api";
import { Button } from "../components/ui";
import "./BrandProfile.css";
import "../components/tabs.css";
import "../components/forms.css";

const tabs = [
  {
    name: "General",
    icon: Target,
    fields: [
      { key: "name", label: "Name" },
      { key: "company", label: "What you’re building" },
      { key: "topics", label: "Primary topics" },
    ],
  },
  {
    name: "Audience",
    icon: Users,
    fields: [{ key: "audience", label: "Target audience" }],
  },
  {
    name: "Voice",
    icon: MessageSquare,
    fields: [{ key: "voice", label: "Brand voice" }],
  },
  { name: "Colours", icon: Palette, fields: [] },
  { name: "Links", icon: Globe2, fields: [] },
] as const;
const colorFields = [
  { key: "background", label: "Background", use: "Text cards" },
  { key: "text", label: "Text", use: "Words on text cards" },
  { key: "highlight", label: "Highlight", use: "Spoken word and accents" },
] as const;

export default function BrandProfile({
  onNameChange,
}: {
  onNameChange: (name: string) => void;
}) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<string>("General");
  useEffect(() => {
    const controller = new AbortController();
    void api<Brand>("/brand-profile", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((profile) => {
        if (controller.signal.aborted) return;
        setBrand(profile);
        onNameChange(profile.name);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to load Brand Profile.",
          );
      });
    return () => controller.abort();
  }, [attempt, onNameChange]);
  const active = tabs.find((item) => item.name === tab)!;
  if (!brand)
    return (
      <div className="page-content brand-page">
        <h1 className="brand-page-heading">Brand Profile</h1>
        {error ? (
          <div className="brand-load-error">
            <p role="alert">{error}</p>
            <Button
              onClick={() => {
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p className="brand-loading" role="status">
            Loading Brand Profile…
          </p>
        )}
      </div>
    );
  return (
    <div className="page-content brand-page">
      <h1 className="brand-page-heading">Brand Profile</h1>
      <p className="preview-note">
        Your saved brand context. Manage details with Asia once chat is
        connected.
      </p>
      <div className="brand-layout">
        <nav
          className="tabs brand-tabs"
          role="tablist"
          aria-label="Brand profile sections"
          aria-orientation="horizontal"
        >
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              id={`brand-tab-${name}`}
              role="tab"
              aria-selected={tab === name}
              tabIndex={tab === name ? 0 : -1}
              aria-controls={`brand-panel-${name}`}
              className={tab === name ? "selected" : ""}
              onClick={() => setTab(name)}
              onKeyDown={(event) => {
                if (
                  !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const current = tabs.findIndex((item) => item.name === name);
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (current +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                const next = tabs[index].name;
                setTab(next);
                document.getElementById(`brand-tab-${next}`)?.focus();
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {name}
            </button>
          ))}
        </nav>
        <div
          className="brand-content"
          role="tabpanel"
          id={`brand-panel-${tab}`}
          aria-labelledby={`brand-tab-${tab}`}
        >
          {tab === "Colours" ? (
            <>
              <dl className="brand-values">
                {colorFields.map((field) => {
                  const value = brand.colors?.[field.key];
                  return (
                    <div key={field.key}>
                      <dt>
                        {field.label}{" "}
                        <span className="muted">· {field.use}</span>
                      </dt>
                      <dd className="brand-color">
                        {value ? (
                          <>
                            <span
                              className="brand-swatch"
                              style={{ backgroundColor: value }}
                              aria-hidden="true"
                            />
                            {value.toUpperCase()}
                          </>
                        ) : (
                          "Not set"
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="brand-empty">
                Brand colours will be used in your content. Profile updates are
                coming soon.
              </p>
            </>
          ) : tab === "Links" ? (
            brand.links.length ? (
              <ul className="brand-links" aria-label="Brand links">
                {brand.links.map((link) => (
                  <li className="brand-link-item" key={link.id ?? link.url}>
                    <header>
                      <div>
                        <strong>{link.name}</strong>
                        <a href={link.url} target="_blank" rel="noreferrer">
                          {link.url}
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <span className="pill">
                        {link.kind === "x"
                          ? "X"
                          : link.kind[0].toUpperCase() + link.kind.slice(1)}
                      </span>
                    </header>
                    <dl className="brand-values brand-link-values">
                      <div>
                        <dt>Access status</dt>
                        <dd>
                          {link.access_status === "granted"
                            ? "Granted"
                            : "Not granted"}
                        </dd>
                      </div>
                      {link.publishing_method && (
                        <div>
                          <dt>Publishing method</dt>
                          <dd>{link.publishing_method}</dd>
                        </div>
                      )}
                      {link.publishing_instructions && (
                        <div>
                          <dt>Publishing instructions</dt>
                          <dd>{link.publishing_instructions}</dd>
                        </div>
                      )}
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="brand-empty">No links yet.</p>
            )
          ) : (
            <dl className="brand-values">
              {active.fields.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{brand[field.key] || "Not set"}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
