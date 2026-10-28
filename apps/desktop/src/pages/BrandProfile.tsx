import { useEffect, useState, type FormEvent } from "react";
import {
  ExternalLink,
  FolderGit2,
  Globe2,
  MessageSquare,
  Palette,
  Target,
  Users,
} from "lucide-react";
import type { Brand, BrandProject } from "../lib/brand";
import { api } from "../lib/api";
import { Button } from "../components/ui";
import Markdown from "../components/Markdown";
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
  { name: "Voice", icon: MessageSquare, fields: [] },
  { name: "Colours", icon: Palette, fields: [] },
  { name: "Links", icon: Globe2, fields: [] },
  { name: "Projects", icon: FolderGit2, fields: [] },
] as const;
const colorFields = [
  { key: "background", label: "Background", use: "Text cards" },
  { key: "text", label: "Text", use: "Words on text cards" },
  { key: "highlight", label: "Highlight", use: "Spoken word and accents" },
] as const;

export default function BrandProfile({
  onNameChange,
  notify,
}: {
  onNameChange: (name: string) => void;
  notify: (message: string) => void;
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
        Your saved brand context. Ask Orca in Agent chat to change it.
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
          {tab === "Voice" ? (
            <Voice />
          ) : tab === "Projects" ? (
            <Projects brand={brand} onChange={setBrand} notify={notify} />
          ) : tab === "Colours" ? (
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
                Used in every video Orca makes. Ask Orca to change them.
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

/** voice.md, the voice Orca writes in: picked in onboarding, learned from posts and edits. */
function Voice() {
  const [voice, setVoice] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<{ content: string }>("/brand-profile/voice", {
      signal: controller.signal,
    })
      .then(({ content }) =>
        // The frontmatter is Orca's own index line, not part of the voice.
        setVoice(content.replace(/^---\n[\s\S]*?\n---\n/, "").trim()),
      )
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to load voice.",
          );
      });
    return () => controller.abort();
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (voice === null)
    return (
      <p className="brand-loading" role="status">
        Loading voice…
      </p>
    );
  return voice ? (
    <>
      <div className="brand-voice">
        <Markdown text={voice} />
      </div>
      <p className="brand-empty">
        Orca writes in this voice and updates it from your posts and edits. Ask
        Orca to change it.
      </p>
    </>
  ) : (
    <p className="brand-empty">
      No voice yet. Orca asks about it in onboarding and learns it from your
      posts.
    </p>
  );
}

type Draft = Omit<BrandProject, "id"> & { id?: string };

/** Folders where the founder builds: added with the system picker, read by Orca. */
function Projects({
  brand,
  onChange,
  notify,
}: {
  brand: Brand;
  onChange: (brand: Brand) => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => onChange(await api<Brand>("/brand-profile"));
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    act(async () => {
      const path = await window.postorca?.projectFolder.choose();
      if (!path) return;
      setDraft({
        name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? "",
        path,
        description: "",
      });
    });
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    void act(async () => {
      if (draft.id) {
        await api(`/brand-profile/projects/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
          }),
        });
      } else {
        const { createdRoutine } = await api<{
          createdRoutine: { title: string; account: string } | null;
        }>("/brand-profile/projects", {
          method: "POST",
          body: JSON.stringify(draft),
        });
        if (createdRoutine)
          notify(
            `Added the “${createdRoutine.title}” routine: weekdays at 6 PM for ${createdRoutine.account}.`,
          );
      }
      setDraft(null);
      await reload();
    });
  };
  const remove = (project: BrandProject) =>
    act(async () => {
      await api(`/brand-profile/projects/${project.id}`, { method: "DELETE" });
      setRemoving(null);
      await reload();
    });
  return (
    <div className="brand-projects">
      <p className="brand-empty">
        Folders where you build. Orca reads what changes in them (commits, docs,
        designs) to suggest posts from your work. It never reads .env files,
        keys or credentials.
      </p>
      {brand.projects.length > 0 && (
        <ul className="brand-links" aria-label="Projects">
          {brand.projects.map((project) =>
            draft?.id === project.id ? null : (
              <li className="brand-link-item" key={project.id}>
                <header>
                  <div>
                    <strong>{project.name}</strong>
                    <span className="muted brand-project-path">
                      {project.path}
                    </span>
                  </div>
                  {removing === project.id ? (
                    <span className="brand-project-actions brand-project-confirm">
                      Remove? Orca will stop reading it.
                      <Button
                        disabled={busy}
                        onClick={() => void remove(project)}
                      >
                        Remove
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <div className="brand-project-actions">
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDraft({ ...project })}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRemoving(project.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </header>
                <p>{project.description || "No description."}</p>
              </li>
            ),
          )}
        </ul>
      )}
      {draft ? (
        <form className="brand-project-form" onSubmit={save}>
          <span className="muted brand-project-path">{draft.path}</span>
          <label>
            Name
            <input
              value={draft.name}
              maxLength={80}
              required
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </label>
          <label>
            What it is
            <textarea
              value={draft.description}
              maxLength={500}
              rows={2}
              placeholder="e.g. PostOrca: an AI agent that grows a founder's personal brand"
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <div className="brand-project-actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {draft.id ? "Save" : "Add project"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : window.postorca ? (
        <Button disabled={busy} onClick={() => void add()}>
          Add project folder
        </Button>
      ) : (
        <p className="brand-empty">
          Open the desktop app to add project folders.
        </p>
      )}
    </div>
  );
}
