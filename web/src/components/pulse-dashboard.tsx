"use client";

import { useEffect, useState } from "react";

type MachineReading = {
  assetId: string;
  name: string;
  site: string;
  temperature: number;
  vibration: number | null;
  runtime: number;
  status: "Normal" | "Attention";
  history: number[];
};

const initialReadings: MachineReading[] = [
  {
    assetId: "HVAC-024",
    name: "Air handling unit",
    site: "North Tower · Floor 4",
    temperature: 46.8,
    vibration: 4.2,
    runtime: 82,
    status: "Attention",
    history: [42, 43, 43, 45, 44, 46, 47, 46],
  },
  {
    assetId: "PUMP-54",
    name: "Process water pump",
    site: "Water Treatment Plant",
    temperature: 38.1,
    vibration: 2.1,
    runtime: 67,
    status: "Normal",
    history: [36, 37, 36, 38, 39, 38, 37, 38],
  },
  {
    assetId: "ELEC-118",
    name: "Distribution panel",
    site: "Distribution Room 2",
    temperature: 31.4,
    vibration: null,
    runtime: 94,
    status: "Normal",
    history: [30, 31, 30, 32, 31, 31, 30, 31],
  },
];

function nextReadings(current: MachineReading[]): MachineReading[] {
  return current.map((machine) => {
    const movement = (Math.random() - 0.5) * 1.2;
    const temperature = Math.max(18, Math.min(85, machine.temperature + movement));
    return {
      ...machine,
      temperature: Number(temperature.toFixed(1)),
      vibration: machine.vibration === null
        ? null
        : Number(Math.max(0.4, machine.vibration + (Math.random() - 0.5) * 0.3).toFixed(1)),
      history: [...machine.history.slice(1), Number(temperature.toFixed(1))],
    };
  });
}

export function PulseDashboard() {
  const [readings, setReadings] = useState(initialReadings);
  const [selectedAsset, setSelectedAsset] = useState(initialReadings[0].assetId);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const selectedMachine = readings.find((machine) => machine.assetId === selectedAsset) ?? readings[0];
  const attentionCount = readings.filter((machine) => machine.status === "Attention").length;
  const averageRuntime = Math.round(readings.reduce((sum, machine) => sum + machine.runtime, 0) / readings.length);
  const chartPoints = selectedMachine.history
    .map((value, index) => `${index * 100 / (selectedMachine.history.length - 1)},${92 - (value - 20) * 1.15}`)
    .join(" ");

  useEffect(() => {
    const update = () => {
      setReadings(nextReadings);
      setUpdatedAt(new Date());
    };
    update();
    const interval = window.setInterval(update, 5000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="workspace-view pulse-view" aria-labelledby="pulse-title">
      <div className="view-heading pulse-heading">
        <div>
          <p className="view-kicker">OPERATIONS OVERVIEW</p>
          <h1 id="pulse-title">Pulse</h1>
          <p>Equipment signals and attention points across your sites.</p>
        </div>
        <div className="pulse-simulation-tag"><span aria-hidden="true" /> DEMO SIMULATION</div>
      </div>

      <div className="pulse-demo-notice" role="note">
        <strong>Sample telemetry only</strong>
        <span>No machines are connected. Values change every few seconds to demonstrate the monitoring view.</span>
      </div>

      <div className="pulse-metrics" aria-label="Demo fleet summary">
        <div className="pulse-metric"><span>Assets monitored</span><strong>{readings.length}</strong><small>Sample assets</small></div>
        <div className="pulse-metric"><span>Needs attention</span><strong className="metric-attention">{attentionCount}</strong><small>Simulated alert state</small></div>
        <div className="pulse-metric"><span>Average runtime</span><strong>{averageRuntime}<small className="metric-unit">%</small></strong><small>Across sample assets</small></div>
      </div>

      <div className="pulse-content-grid">
        <section className="pulse-section" aria-labelledby="machine-status-title">
          <div className="pulse-section-heading">
            <div>
              <h2 id="machine-status-title">Machine status</h2>
              <p>Example readings · temperature, vibration and runtime</p>
            </div>
            <span className="pulse-updated">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Starting…"}</span>
          </div>
          <div className="pulse-table-scroll">
            <table className="pulse-table">
              <thead><tr><th>Asset</th><th>Temperature</th><th>Vibration</th><th>Runtime</th><th>Status</th></tr></thead>
              <tbody>
                {readings.map((machine) => (
                  <tr key={machine.assetId} className={machine.assetId === selectedAsset ? "selected" : ""}>
                    <td>
                      <button className="pulse-asset-select" type="button" onClick={() => setSelectedAsset(machine.assetId)} aria-pressed={machine.assetId === selectedAsset}>
                        <strong>{machine.assetId}</strong><span>{machine.name} · {machine.site}</span>
                      </button>
                    </td>
                    <td>{machine.temperature.toFixed(1)} <small>°C</small></td>
                    <td>{machine.vibration === null ? "—" : <>{machine.vibration.toFixed(1)} <small>mm/s</small></>}</td>
                    <td>{machine.runtime}<small>%</small></td>
                    <td><span className={`machine-state ${machine.status === "Attention" ? "attention" : "normal"}`}><span />{machine.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pulse-section pulse-detail" aria-labelledby="trend-title">
          <div className="pulse-section-heading">
            <div>
              <h2 id="trend-title">Temperature trend</h2>
              <p>{selectedMachine.assetId} · sample readings</p>
            </div>
            <strong className="pulse-current-reading">{selectedMachine.temperature.toFixed(1)}°C</strong>
          </div>
          <div className="pulse-chart" role="img" aria-label={`Simulated temperature trend for ${selectedMachine.assetId}`}>
            <div className="chart-guide chart-guide-top"><span>60°C</span></div>
            <div className="chart-guide chart-guide-bottom"><span>20°C</span></div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline className="pulse-chart-area" points={`0,100 ${chartPoints} 100,100`} />
              <polyline className="pulse-chart-line" points={chartPoints} />
            </svg>
          </div>
          <div className="pulse-chart-axis"><span>Earlier</span><span>Now</span></div>
        </section>
      </div>

      <section className="pulse-alert-section" aria-labelledby="alerts-title">
        <div className="pulse-section-heading">
          <div><h2 id="alerts-title">Attention queue</h2><p>Illustrative status, not a machine alarm</p></div>
          <span className="pulse-alert-count">{attentionCount}</span>
        </div>
        {readings.filter((machine) => machine.status === "Attention").map((machine) => (
          <button className="pulse-alert-row" key={machine.assetId} type="button" onClick={() => setSelectedAsset(machine.assetId)}>
            <span className="alert-indicator" aria-hidden="true">!</span>
            <span><strong>{machine.assetId} · Vibration watch</strong><small>{machine.site} · Example alert for the demo</small></span>
            <span className="alert-value">{machine.vibration?.toFixed(1)} mm/s</span>
          </button>
        ))}
      </section>
    </section>
  );
}