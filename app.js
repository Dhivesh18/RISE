document.addEventListener('DOMContentLoaded', () => {
  const yearNode = document.getElementById('year');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  const assetIdInput = document.getElementById('assetId');
  const siteNameInput = document.getElementById('siteName');
  const issueTypeInput = document.getElementById('issueType');
  const issueTextInput = document.getElementById('issueText');
  const severityInput = document.getElementById('severity');
  const techNameInput = document.getElementById('techName');
  const assetBadge = document.getElementById('assetBadge');
  const insightList = document.getElementById('insightList');
  const scanStatus = document.getElementById('scanStatus');
  const startScanButton = document.getElementById('startScan');
  const generateInsightButton = document.getElementById('generateInsight');
  const saveJobButton = document.getElementById('saveJob');
  const recentLogsNode = document.getElementById('recentLogs');
  const jobsCapturedNode = document.getElementById('jobsCaptured');
  const avgSkillNode = document.getElementById('avgSkill');
  const firstFixRateNode = document.getElementById('firstFixRate');
  const trainingQueueNode = document.getElementById('trainingQueue');
  const clearLogsButton = document.getElementById('clearLogs');

  const STORAGE_KEY = 'rise-work-log';

  const assetMap = {
    'HVAC-024': {
      assetId: 'HVAC-024',
      site: 'North Tower - Floor 4',
      issue: 'Cooling performance',
      note: 'Unit is running but airflow is reduced and the compressor takes too long to recover after startup.'
    },
    'ELEC-118': {
      assetId: 'ELEC-118',
      site: 'Distribution Room 2',
      issue: 'Electrical fault',
      note: 'Breaker trips after 90 seconds under full load.'
    },
    'PUMP-54': {
      assetId: 'PUMP-54',
      site: 'Water Treatment Plant',
      issue: 'Water leakage',
      note: 'Pump output is unstable with visible leakage around the mechanical seal.'
    }
  };

  const seedEntries = [
    {
      asset: 'HVAC-024',
      technician: 'A. Raman',
      issue: 'Cooling performance',
      severity: 'Medium',
      skill: 76,
      site: 'North Tower - Floor 4'
    },
    {
      asset: 'PUMP-54',
      technician: 'N. Patel',
      issue: 'Water leakage',
      severity: 'High',
      skill: 84,
      site: 'Water Treatment Plant'
    },
    {
      asset: 'ELEC-118',
      technician: 'J. Smith',
      issue: 'Electrical fault',
      severity: 'Critical',
      skill: 91,
      site: 'Distribution Room 2'
    }
  ];

  const getLogEntries = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seedEntries));
        return [...seedEntries];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : [...seedEntries];
    } catch (error) {
      return [...seedEntries];
    }
  };

  const saveLogEntries = (entries) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  };

  const buildInsight = (assetId, issueText, issueType, severity) => {
    const lowerText = issueText.toLowerCase();
    const suggestions = [];

    if (lowerText.includes('airflow') || lowerText.includes('cool') || issueType.includes('Cooling')) {
      suggestions.push('Inspect the air filter and evaporator coil for restricted airflow.');
      suggestions.push('Check refrigerant pressure and compressor start delay before replacing parts.');
      suggestions.push('Confirm capacitor health and fan motor current under load.');
    } else if (lowerText.includes('trip') || lowerText.includes('electrical') || issueType.includes('Electrical')) {
      suggestions.push('Measure breaker load and check for phase imbalance.');
      suggestions.push('Inspect terminal tightness and insulation around the failing circuit.');
      suggestions.push('Verify whether the motor inrush current exceeds the rated startup profile.');
    } else if (lowerText.includes('leak') || issueType.includes('Water')) {
      suggestions.push('Examine the seal, gasket, and housing for visible leakage paths.');
      suggestions.push('Run a pressure test to confirm whether the leak is from the pump or the fittings.');
      suggestions.push('Document fluid loss rate to support preventive maintenance planning.');
    } else {
      suggestions.push('Verify the likely failure mode against the asset maintenance history.');
      suggestions.push('Check the most probable control, mechanical, and electrical points in sequence.');
      suggestions.push('Capture evidence from the fault before making the final replacement decision.');
    }

    const severityFactor = severity === 'Critical' ? 92 : severity === 'High' ? 86 : severity === 'Medium' ? 76 : 68;
    suggestions.push(`Skill confidence for this issue: ${severityFactor}% based on asset pattern and technician observations.`);
    suggestions.push('Recommended follow-up: log repair steps, update the asset skill profile, and schedule a training check.');

    return suggestions;
  };

  const renderInsight = () => {
    const assetId = assetIdInput.value.trim() || 'HVAC-024';
    const issueType = issueTypeInput.value;
    const issueText = issueTextInput.value.trim();
    const severity = severityInput.value;

    assetBadge.textContent = assetId;

    const insights = buildInsight(assetId, issueText, issueType, severity);
    insightList.innerHTML = insights.map((item) => `<li>${item}</li>`).join('');
  };

  const updateDashboard = () => {
    const entries = getLogEntries();
    const totalJobs = entries.length;
    const avgSkill = Math.round(entries.reduce((sum, entry) => sum + Number(entry.skill || 0), 0) / totalJobs);
    const firstFix = Math.round(entries.reduce((sum, entry) => sum + (entry.severity === 'Critical' ? 71 : entry.severity === 'High' ? 78 : entry.severity === 'Medium' ? 82 : 88), 0) / totalJobs);
    const trainingQueue = entries.filter((entry) => Number(entry.skill || 0) < 80).length;

    jobsCapturedNode.textContent = String(totalJobs);
    avgSkillNode.textContent = `${avgSkill}%`;
    firstFixRateNode.textContent = `${firstFix}%`;
    trainingQueueNode.textContent = String(trainingQueue);

    recentLogsNode.innerHTML = entries.slice().reverse().slice(0, 5).map((entry) => `
      <tr>
        <td>${entry.asset}</td>
        <td>${entry.technician}</td>
        <td>${entry.issue}</td>
        <td>${entry.severity}</td>
        <td>${entry.skill}%</td>
      </tr>
    `).join('');
  };

  generateInsightButton.addEventListener('click', renderInsight);

  saveJobButton.addEventListener('click', () => {
    const record = {
      asset: assetIdInput.value.trim() || 'UNSCANNED',
      technician: techNameInput.value.trim() || 'Unassigned technician',
      issue: issueTypeInput.value,
      severity: severityInput.value,
      skill: Math.max(60, Math.min(98, Number(severityInput.value === 'Critical' ? 92 : severityInput.value === 'High' ? 86 : severityInput.value === 'Medium' ? 78 : 70))),
      site: siteNameInput.value.trim() || 'Unknown site'
    };

    const entries = getLogEntries();
    entries.push(record);
    saveLogEntries(entries);
    updateDashboard();
    scanStatus.textContent = `Saved ${record.asset} to work log.`;
  });

  clearLogsButton.addEventListener('click', () => {
    saveLogEntries([]);
    updateDashboard();
    scanStatus.textContent = 'Work log cleared.';
  });

  const applyAssetData = (assetId) => {
    const record = assetMap[assetId] || {
      assetId,
      site: 'Unmapped site',
      issue: 'General inspection',
      note: 'Asset scanned successfully. Please record the technician diagnosis.'
    };

    assetIdInput.value = record.assetId;
    siteNameInput.value = record.site;
    issueTypeInput.value = record.issue;
    issueTextInput.value = record.note;
    renderInsight();
  };

  const startScanner = async () => {
    const readerElement = document.getElementById('reader');
    if (!readerElement) return;

    if (!window.Html5Qrcode) {
      scanStatus.textContent = 'QR scanner library is not available in this browser context.';
      return;
    }

    try {
      const html5QrCode = new Html5Qrcode('reader');
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          scanStatus.textContent = `QR scanned: ${decodedText}`;
          applyAssetData(decodedText);
          html5QrCode.stop();
        },
        () => {}
      );
      scanStatus.textContent = 'Camera is on. Point the scanner at a QR code.';
    } catch (error) {
      scanStatus.textContent = 'Camera access was blocked or unavailable. Try a mock scan below.';
      console.error(error);
    }
  };

  startScanButton.addEventListener('click', startScanner);

  const demoQrCodes = ['HVAC-024', 'ELEC-118', 'PUMP-54'];
  startScanButton.addEventListener('dblclick', () => {
    const nextCode = demoQrCodes[Math.floor(Math.random() * demoQrCodes.length)];
    scanStatus.textContent = `Demo QR loaded: ${nextCode}`;
    applyAssetData(nextCode);
  });

  renderInsight();
  updateDashboard();
});
