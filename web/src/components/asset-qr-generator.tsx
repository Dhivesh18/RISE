"use client";

import { useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";

type AssetPayload = {
  assetId: string;
  site: string;
  issue: string;
  note: string;
};

export function AssetQrGenerator() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [asset, setAsset] = useState<AssetPayload>({
    assetId: "HVAC-024",
    site: "North Tower - Floor 4",
    issue: "Cooling performance",
    note: "Unit is running but airflow is reduced and the compressor takes too long to recover after startup.",
  });
  const [registeredAsset, setRegisteredAsset] = useState<AssetPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);

  const updateField = (field: keyof AssetPayload, value: string) => {
    setAsset((current) => ({ ...current, [field]: value }));
    setRegisteredAsset(null);
    setStatus("");
  };

  const registerAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setStatusIsError(false);
    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(asset),
      });
      const result = (await response.json()) as { detail?: string; created?: boolean };
      if (!response.ok) throw new Error(result.detail ?? "Could not register asset");
      setRegisteredAsset(asset);
      setStatus(`${result.created ? "Asset created" : "Asset saved"}. This QR will open its Rise record when scanned.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not register asset");
      setStatusIsError(true);
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = () => {
    const svg = previewRef.current?.querySelector("svg");
    if (!svg || !registeredAsset) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${registeredAsset.assetId.replace(/[^a-z0-9_-]/gi, "-")}-rise-qr.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="tool-panel qr-tool" aria-labelledby="qr-generator-title">
      <div className="tool-heading">
        <div>
          <span className="eyebrow dark">Asset setup</span>
          <h3 id="qr-generator-title">Create an asset QR</h3>
        </div>
        <span className="tool-index">01 / 02</span>
      </div>
      <div className="qr-tool-grid">
        <form className="qr-form" onSubmit={registerAsset}>
          <label className="form-row">
            <span>Asset ID</span>
            <input value={asset.assetId} onChange={(event) => updateField("assetId", event.target.value)} required maxLength={80} />
          </label>
          <label className="form-row">
            <span>Site</span>
            <input value={asset.site} onChange={(event) => updateField("site", event.target.value)} required maxLength={200} />
          </label>
          <label className="form-row">
            <span>Asset / issue type</span>
            <input value={asset.issue} onChange={(event) => updateField("issue", event.target.value)} required maxLength={120} />
          </label>
          <label className="form-row">
            <span>Service note</span>
            <textarea value={asset.note} onChange={(event) => updateField("note", event.target.value)} required maxLength={3000} rows={3} />
          </label>
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? "Registering asset..." : "Register & create QR"}
          </button>
          {status && <p className={`qr-status ${statusIsError ? "error" : "success"}`} role="status">{status}</p>}
        </form>
        <div className="qr-preview-area">
          {registeredAsset ? (
            <>
              <div className="asset-label" ref={previewRef}>
                <QRCodeSVG value={registeredAsset.assetId} size={196} level="H" includeMargin />
                <strong>{registeredAsset.assetId}</strong>
                <span>{registeredAsset.site}</span>
              </div>
              <button className="button secondary" type="button" onClick={downloadQr}>Download SVG label</button>
            </>
          ) : (
            <div className="qr-empty">
              <div className="qr-empty-mark" aria-hidden="true">QR</div>
              <strong>Asset label preview</strong>
              <span>Register the asset to create a scannable label.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
