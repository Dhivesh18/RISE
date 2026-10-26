"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AssetQrGenerator } from "@/components/asset-qr-generator";
import { PulseDashboard } from "@/components/pulse-dashboard";
import { RealtimeAssist } from "@/components/realtime-assist";
import "@/components/rise-workspace.css";

type AssetRecord = {
  assetId: string;
  site: string;
  issue: string;
  note: string;
};

type WorkLogEntry = {
  asset: string;
  technician: string;
  issue: string;
  severity: string;
  skill: number;
  site: string;
};

type TabId = "job" | "pulse" | "assets" | "log";
type Theme = "light" | "dark";

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("rise-theme-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("rise-theme-change", onStoreChange);
  };
}

function getStoredTheme(): Theme {
  return window.localStorage.getItem("rise-theme") === "dark" ? "dark" : "light";
}

function getServerTheme(): Theme {
  return "light";
}

const sampleAssets: Record<string, AssetRecord> = {
  "HVAC-024": {
    assetId: "HVAC-024",
    site: "North Tower - Floor 4",
    issue: "Cooling performance",
    note: "Unit is running but airflow is reduced and the compressor takes too long to recover after startup.",
  },
  "ELEC-118": {
    assetId: "ELEC-118",
    site: "Distribution Room 2",
    issue: "Electrical fault",
    note: "Breaker trips after 90 seconds under full load.",
  },
  "PUMP-54": {
    assetId: "PUMP-54",
    site: "Water Treatment Plant",
    issue: "Water leakage",
    note: "Pump output is unstable with visible leakage around the mechanical seal.",
  },
};

const tabs: { id: TabId; label: string }[] = [
  { id: "job", label: "Rise Assist" },
  { id: "pulse", label: "Pulse" },
  { id: "assets", label: "Asset Setup" },
  { id: "log", label: "Work log" },
];

export function RiseWorkspace() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanControlsRef = useRef<{ stop: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("job");
  const theme = useSyncExternalStore(subscribeToTheme, getStoredTheme, getServerTheme);
  const [assetId, setAssetId] = useState("");
  const [assetLoaded, setAssetLoaded] = useState(false);
  const [site, setSite] = useState("");
  const [issue, setIssue] = useState("General inspection");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [technician, setTechnician] = useState("");
  const [logs, setLogs] = useState<WorkLogEntry[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/work-orders")
      .then(async (response) => {
        if (!response.ok) throw new Error("API unavailable");
        return (await response.json()) as WorkLogEntry[];
      })
      .then((entries) => {
        if (active) {
          setLogs(entries);
          setApiOnline(true);
        }
      })
      .catch(() => {
        if (active) setApiOnline(false);
      });
    return () => {
      active = false;
      scanControlsRef.current?.stop();
    };
  }, []);

  const selectTheme = (nextTheme: Theme) => {
    window.localStorage.setItem("rise-theme", nextTheme);
    window.dispatchEvent(new Event("rise-theme-change"));
  };

  const applyAsset = async (id: string) => {
    const normalizedId = id.trim();
    if (!normalizedId) {
      setStatus("Enter an asset ID or scan its QR code.");
      return;
    }
    let record: AssetRecord | undefined;
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(normalizedId)}`);
      if (response.ok) record = (await response.json()) as AssetRecord;
    } catch {
      record = sampleAssets[normalizedId];
    }
    if (!record) {
      setAssetId(normalizedId);
      setAssetLoaded(false);
      setStatus(`Asset ${normalizedId} was not found. Register it in Assets & QR first.`);
      return;
    }
    setAssetId(record.assetId);
    setAssetLoaded(true);
    setSite(record.site);
    setIssue(record.issue);
    setDescription(record.note);
    setStatus(`Asset ${record.assetId} loaded.`);
  };

  const stopScan = () => {
    scanControlsRef.current?.stop();
    scanControlsRef.current = null;
    setScanning(false);
  };

  const startScan = async () => {
    if (!videoRef.current) return;
    try {
      const reader = new BrowserQRCodeReader();
      setScanning(true);
      setStatus("Starting camera...");
      scanControlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _error, controls) => {
        scanControlsRef.current = controls;
        if (result) {
          stopScan();
          void applyAsset(result.getText());
        }
      });
      setStatus("Camera on. Hold an asset QR code in the frame.");
    } catch {
      setScanning(false);
      setStatus("Camera unavailable. Check permission or enter the asset ID instead.");
    }
  };

  const saveWorkOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, site, issue, description, severity, technician }),
      });
      const result = (await response.json()) as WorkLogEntry & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Could not save job.");
      setLogs((current) => [result, ...current]);
      setApiOnline(true);
      setStatus("Job saved to the work log.");
      setDescription("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save job. Check the API connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rise-app" data-theme={theme}>
      <header className="app-header">
        <a className="app-brand" href="#job" aria-label="Rise home">
          <span className="app-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4 19h5v-5h5V9h5V4m-5 0h5v5" />
            </svg>
          </span>
          <span className="app-brand-copy">
            <span className="app-brand-name">RISE</span>
            <span className="app-brand-tagline">Real-time Intelligence for Skills &amp; Execution</span>
          </span>
        </a>
        <div className="theme-switch" role="group" aria-label="Color theme">
          <button type="button" aria-label="Light mode" title="Light mode" aria-pressed={theme === "light"} onClick={() => selectTheme("light")}>
            <span aria-hidden="true">☼</span>
          </button>
          <button type="button" aria-label="Dark mode" title="Dark mode" aria-pressed={theme === "dark"} onClick={() => selectTheme("dark")}>
            <span aria-hidden="true">☾</span>
          </button>
        </div>
        <div className={`connection-state ${apiOnline ? "connected" : "disconnected"}`}>
          <span />{apiOnline ? "Connected" : "Offline"}
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Main sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            aria-current={activeTab === tab.id ? "page" : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "log" && logs.length > 0 && <span className="tab-count">{logs.length}</span>}
          </button>
        ))}
      </nav>

      <main className="workspace-main">
        {activeTab === "pulse" && <PulseDashboard />}

        {activeTab === "job" && (
          <section className="workspace-view" aria-labelledby="job-title">
            <div className="view-heading">
              <div>
                <p className="view-kicker">TECHNICIAN SUPPORT</p>
                <h1 id="job-title">Rise Assist</h1>
                <p>Scan a QR code or enter an asset ID to get help for that equipment.</p>
              </div>
            </div>

            <div className={`job-layout ${assetLoaded ? "" : "asset-entry-layout"}`}>
              <section className="workspace-panel identify-panel" aria-labelledby="asset-heading">
                <div className="panel-title-row">
                  <div className="step-number">1</div>
                  <div>
                    <h2 id="asset-heading">Identify asset</h2>
                    <p>Scan its QR code or enter the ID.</p>
                  </div>
                </div>
                <div className="scan-frame">
                  <video ref={videoRef} className="scanner-video" muted playsInline />
                  {!scanning && <div className="scanner-corners" aria-hidden="true" />}
                  <span className="scanner-badge">{scanning ? "CAMERA ON" : "QR SCAN"}</span>
                </div>
                <div className="scan-controls">
                  {scanning ? (
                    <button className="button secondary" type="button" onClick={stopScan}>Stop camera</button>
                  ) : (
                    <button className="button primary" type="button" onClick={() => void startScan()}>Scan QR</button>
                  )}
                </div>
                <label className="form-row" htmlFor="workspace-asset-id">
                  <span>Or enter asset ID</span>
                  <div className="inline-field">
                    <input id="workspace-asset-id" value={assetId} onChange={(event) => setAssetId(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void applyAsset(assetId); } }} placeholder="e.g. HVAC-024" />
                    <button className="button secondary" type="button" onClick={() => void applyAsset(assetId)}>Load</button>
                  </div>
                </label>
                {status && <p className="workspace-status" role="status">{status}</p>}
              </section>
            </div>

            {assetLoaded && (
              <>
                <section className="workspace-panel loaded-asset" aria-labelledby="loaded-asset-title">
                  <div>
                    <p className="view-kicker">ASSET DETAILS</p>
                    <h2 id="loaded-asset-title">{assetId}</h2>
                  </div>
                  <dl>
                    <div><dt>Site</dt><dd>{site}</dd></div>
                    <div><dt>Asset type</dt><dd>{issue}</dd></div>
                    <div className="asset-note"><dt>Service note</dt><dd>{description}</dd></div>
                  </dl>
                  <button className="button secondary" type="button" onClick={() => { setAssetLoaded(false); setAssetId(""); setSite(""); setDescription(""); setStatus(""); }}>Change asset</button>
                </section>

                <RealtimeAssist context={{ assetId, site, issue, description, severity }} />

                <details className="assist-disclosure">
                  <summary><span>Save this as a work order</span><span className="assist-summary-hint">Optional</span></summary>
                  <form className="job-form work-order-form" onSubmit={(event) => void saveWorkOrder(event)}>
                    <label className="form-row" htmlFor="workspace-issue">
                      <span>Issue type</span>
                      <select id="workspace-issue" value={issue} onChange={(event) => setIssue(event.target.value)} required>
                        <option>Cooling performance</option><option>Electrical fault</option><option>Water leakage</option><option>No airflow</option><option>Unusual noise</option><option>General inspection</option>
                      </select>
                    </label>
                    <label className="form-row" htmlFor="workspace-description">
                      <span>Work notes</span>
                      <textarea id="workspace-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the issue or work completed..." rows={3} maxLength={5000} required />
                    </label>
                    <div className="form-row split-fields">
                      <label htmlFor="workspace-severity"><span>Severity</span><select id="workspace-severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label>
                      <label htmlFor="workspace-technician"><span>Technician</span><input id="workspace-technician" value={technician} onChange={(event) => setTechnician(event.target.value)} placeholder="Name" maxLength={160} required /></label>
                    </div>
                    <button className="button primary save-job" type="submit" disabled={saving}>{saving ? "Saving..." : "Save work order"}</button>
                    {status && <p className="workspace-status" role="status">{status}</p>}
                  </form>
                </details>
              </>
            )}
          </section>
        )}

        {activeTab === "assets" && (
          <section className="workspace-view" aria-labelledby="assets-title">
            <div className="view-heading">
              <div>
                <p className="view-kicker">EQUIPMENT</p>
                <h1 id="assets-title">Asset Setup</h1>
                <p>Register equipment and create printable QR labels.</p>
              </div>
            </div>
            <AssetQrGenerator />
          </section>
        )}

        {activeTab === "log" && (
          <section className="workspace-view" aria-labelledby="log-title">
            <div className="view-heading">
              <div>
                <p className="view-kicker">SAVED WORK</p>
                <h1 id="log-title">Work log</h1>
                <p>{logs.length} {logs.length === 1 ? "job" : "jobs"} saved.</p>
              </div>
              <button className="button primary" type="button" onClick={() => setActiveTab("job")}>New job</button>
            </div>
            {logs.length === 0 ? (
              <div className="empty-state">
                <strong>No jobs yet</strong>
                <p>Saved jobs will appear here.</p>
                <button className="button primary" type="button" onClick={() => setActiveTab("job")}>Create first job</button>
              </div>
            ) : (
              <div className="workspace-panel log-panel">
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Asset</th><th>Site</th><th>Issue</th><th>Severity</th><th>Technician</th></tr></thead>
                    <tbody>
                      {logs.map((entry, index) => (
                        <tr key={`${entry.asset}-${index}`}>
                          <td>{entry.asset}</td><td>{entry.site}</td><td>{entry.issue}</td><td>{entry.severity}</td><td>{entry.technician}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
