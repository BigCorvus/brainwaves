// Import necessary classes from webgl-plot
import { WebglPlot, WebglLine, ColorRGBA } from 'https://esm.sh/webgl-plot@latest';

// Include your Biquad filter code here
/////////////////////////////////////////////////////////////
// Begin Biquad filter code (adjusted for browser use)
/////////////////////////////////////////////////////////////

class BiquadChannelFilterer {
  constructor(options = {}) {
    this.idx = 0;
    this.sps = options.sps || 250; // Corrected default SPS
    this.bandpassLower = options.bandpassLower || 0.3; // Default updated
    this.bandpassUpper = options.bandpassUpper || 70;  // Default updated

    this.useSMA4 = options.useSMA4 || false;
    this.last4 = [];
    this.filtered = 0;
    this.trimOutliers = options.trimOutliers || false;
    this.outlierTolerance = options.outlierTolerance || 0.20;
    this.useNotch50 = options.useNotch50 || false; // Default updated
    this.useNotch60 = options.useNotch60 || false;
    this.useLowpass = options.useLowpass || false;
    this.lowpassHz = options.lowpassHz || 100;
    this.useBandpass = options.useBandpass || false; // Default updated
    this.useDCBlock = options.useDCBlock || true; // Controlled by its own checkbox now
    this.DCBresonance = options.DCBresonance || 0.995;
    this.useScaling = options.useScaling || false;
    this.scalar = options.scalar || 1;

    this.notchBandwidth = options.notchBandwidth || 5;

    let sps = this.sps;
    this.reset(sps);
  }

  reset(sps = this.sps) {
    this.sps = sps;

    this.notch50 = [makeNotchFilter(50, sps, this.notchBandwidth)];
    this.notch60 = [makeNotchFilter(60, sps, this.notchBandwidth)];

    this.lp1 = [
      new Biquad('lowpass', this.lowpassHz, sps),
      new Biquad('lowpass', this.lowpassHz, sps),
      new Biquad('lowpass', this.lowpassHz, sps),
      new Biquad('lowpass', this.lowpassHz, sps)
    ];

    this.bp1 = [
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps),
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps),
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps),
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps)
    ];

    this.dcb = new DCBlocker(this.DCBresonance); // Resets DC blocker state
    this.filtered = 0;
    this.idx = 0;
    this.last4 = [];
  }

  setBandpass(bandpassLower = this.bandpassLower, bandpassUpper = this.bandpassUpper, sps = this.sps) {
    this.bandpassLower = bandpassLower;
    this.bandpassUpper = bandpassUpper;
    this.reset(sps);
  }

  setNotchBandwidth(bandwidth) {
    this.notchBandwidth = bandwidth;
    this.reset(this.sps);
  }

  apply(latestData = 0) {
    let out = latestData;
    // Ensure input is finite, otherwise filters might produce NaN/Infinity
    if (!isFinite(out)) {
        // console.warn(`Non-finite input to filter: ${out}. Using 0.`);
        out = 0;
    }

    if (this.useScaling === true) {
      out *= this.scalar;
    }
    if (this.filtered && this.trimOutliers && this.outlierTolerance) {
      if (Math.abs(out - this.filtered) > this.outlierTolerance) {
        out = this.filtered;
      }
    }
    if (this.useDCBlock === true) {
      out = this.dcb.applyFilter(out);
    }
    if (this.useSMA4 === true) {
      if (this.last4.length < 4) {
        this.last4.push(out);
      } else {
        out = this.last4.reduce((accumulator, currentValue) => accumulator + currentValue) / this.last4.length;
        this.last4.shift();
        this.last4.push(out);
      }
    }
    if (this.useNotch50 === true) {
      this.notch50.forEach((f) => {
        out = f.applyFilter(out);
      });
    }
    if (this.useNotch60 === true) {
      this.notch60.forEach((f) => {
        out = f.applyFilter(out);
      });
    }
    if (this.useLowpass === true) {
      this.lp1.forEach((f) => {
        out = f.applyFilter(out);
      });
    }
    if (this.useBandpass === true) {
      this.bp1.forEach((f) => {
        out = f.applyFilter(out);
      });
    }
    this.filtered = out;
    this.idx++;
    return out;
  }
}

class Biquad {
  constructor(type, freq, sps, Q = 1 / Math.sqrt(2), dbGain = 0) {
    let types = ['lowpass', 'highpass', 'bandpass', 'notch', 'peak', 'lowshelf', 'highshelf'];
    if (types.indexOf(type) < 0) {
      console.error("Valid types: 'lowpass','highpass','bandpass','notch','peak','lowshelf','highshelf'");
      return;
    }
    this.type = type;

    this.freq = freq;
    this.sps = sps;
    this.Q = Q;
    this.dbGain = dbGain;

    this.a0 = 0; this.a1 = 0; this.a2 = 0;
    this.b0 = 0; this.b1 = 0; this.b2 = 0;

    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;

    let A = Math.pow(10, dbGain / 40);
    let omega = 2 * Math.PI * freq / sps;
    let sn = Math.sin(omega);
    let cs = Math.cos(omega);
    let alpha = sn / (2 * Q);
    let beta = Math.sqrt(A + A);

    this[type](A, sn, cs, alpha, beta);

    if (this.a0 !== 0 && this.a0 !== 1) {
        this.b0 /= this.a0; this.b1 /= this.a0; this.b2 /= this.a0;
        this.a1 /= this.a0; this.a2 /= this.a0; this.a0 = 1;
    } else if (this.a0 === 0) {
        console.error("Biquad filter a0 coefficient is zero, filter is unstable or incorrectly configured.");
        this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a0 = 1; this.a1 = 0; this.a2 = 0;
    }
  }

  lowpass(A, sn, cs, alpha, beta) {
    this.b0 = (1 - cs) * 0.5; this.b1 = 1 - cs; this.b2 = (1 - cs) * 0.5;
    this.a0 = 1 + alpha; this.a1 = -2 * cs; this.a2 = 1 - alpha;
  }
  highpass(A, sn, cs, alpha, beta) {
    this.b0 = (1 + cs) * 0.5; this.b1 = -(1 + cs); this.b2 = (1 + cs) * 0.5;
    this.a0 = 1 + alpha; this.a1 = -2 * cs; this.a2 = 1 - alpha;
  }
  bandpass(A, sn, cs, alpha, beta) {
    this.b0 = alpha; this.b1 = 0; this.b2 = -alpha;
    this.a0 = 1 + alpha; this.a1 = -2 * cs; this.a2 = 1 - alpha;
  }
  notch(A, sn, cs, alpha, beta) {
    this.b0 = 1; this.b1 = -2 * cs; this.b2 = 1;
    this.a0 = 1 + alpha; this.a1 = -2 * cs; this.a2 = 1 - alpha;
  }
  peak(A, sn, cs, alpha, beta) {
    this.b0 = 1 + (alpha * A); this.b1 = -2 * cs; this.b2 = 1 - (alpha * A);
    this.a0 = 1 + (alpha / A); this.a1 = -2 * cs; this.a2 = 1 - (alpha / A);
  }
  lowshelf(A, sn, cs, alpha, beta) {
    this.b0 = A * ((A + 1) - (A - 1) * cs + beta * sn); this.b1 = 2 * A * ((A - 1) - (A + 1) * cs); this.b2 = A * ((A + 1) - (A - 1) * cs - beta * sn);
    this.a0 = (A + 1) + (A - 1) * cs + beta * sn; this.a1 = -2 * ((A - 1) + (A + 1) * cs); this.a2 = (A + 1) + (A - 1) * cs - beta * sn;
  }
  highshelf(A, sn, cs, alpha, beta) {
    this.b0 = A * ((A + 1) + (A - 1) * cs + beta * sn); this.b1 = -2 * A * ((A - 1) + (A + 1) * cs); this.b2 = A * ((A + 1) + (A - 1) * cs - beta * sn);
    this.a0 = (A + 1) - (A - 1) * cs + beta * sn; this.a1 = 2 * ((A - 1) - (A + 1) * cs); this.a2 = (A + 1) - (A - 1) * cs - beta * sn;
  }
  applyFilter(signal_step) {
    // Ensure input is finite
    if (!isFinite(signal_step)) {
        // console.warn(`Biquad received non-finite input: ${signal_step}. Using 0.`);
        signal_step = 0;
    }
    let y_n = this.b0 * signal_step + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;

    // Ensure output is finite
    if (!isFinite(y_n)) {
        // console.warn(`Biquad produced non-finite output: ${y_n}. Resetting filter state and returning 0.`);
        // Reset internal state to prevent propagation of NaN/Infinity
        this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
        return 0;
    }

    this.x2 = this.x1; this.x1 = signal_step; this.y2 = this.y1; this.y1 = y_n;
    return y_n;
  }
  static calcCenterFrequency(freqStart, freqEnd) { return Math.sqrt(freqStart * freqEnd); }
  static calcBandwidth(freqStart, freqEnd) { return (freqEnd - freqStart); }
  static calcBandpassQ(frequency, bandwidth, resonance = 1) {
    if (bandwidth <= 0) return 100; let Q = frequency / bandwidth;
    Q = Math.max(Q, 0.1); Q = Math.min(Q, 100); return Q;
  }
  static calcNotchQ(frequency, bandwidth, resonance = 1) {
    if (bandwidth <= 0) return 100; let Q = frequency / bandwidth;
    Q = Math.max(Q, 0.1); Q = Math.min(Q, 100); return Q;
  }
}

class DCBlocker {
  constructor(r = 0.995) { this.r = r; this.x1 = 0; this.y1 = 0; }
  applyFilter(signal_step) {
    if (!isFinite(signal_step)) {
        // console.warn(`DCBlocker received non-finite input: ${signal_step}. Using 0.`);
        signal_step = 0;
    }
    let y = signal_step - this.x1 + this.r * this.y1;
    if (!isFinite(y)){
        // console.warn(`DCBlocker produced non-finite output: ${y}. Resetting state and returning 0.`);
        this.x1 = 0; this.y1 = 0;
        return 0;
    }
    this.x1 = signal_step; this.y1 = y; return y;
  }
}

const makeNotchFilter = (frequency, sps, bandwidth) => {
  let Q = Biquad.calcNotchQ(frequency, bandwidth); return new Biquad('notch', frequency, sps, Q, 0);
};
const makeBandpassFilter = (freqStart, freqEnd, sps, resonance = 1) => {
  let centerFrequency = Biquad.calcCenterFrequency(freqStart, freqEnd);
  let bandwidth = Biquad.calcBandwidth(freqStart, freqEnd);
  let Q = Biquad.calcBandpassQ(centerFrequency, bandwidth, resonance);
  return new Biquad('bandpass', centerFrequency, sps, Q, 0);
};

/////////////////////////////////////////////////////////////
// End Biquad filter code
/////////////////////////////////////////////////////////////

document.addEventListener('DOMContentLoaded', () => {
  const eegSps = 250; const imuSps = 50;
  const displayDurationSeconds = 15;
  const numEEGPoints = eegSps * displayDurationSeconds;
  const numIMUPoints = imuSps * displayDurationSeconds;
  const numEEGChannels = 8; const numAccelChannels = 4; const numGyroChannels = 3;
  const FORBIDDEN_START_SECONDS = 0.0;

  let bluetoothDevice, bleServer, bleCharacteristic, isConnecting = false;
  let loadedData = null, isPlaybackMode = false, currentPlaybackTimeSeconds = 0, maxPlaybackTimeSeconds = 0;
  let recordedData = [];
  let connectionStartTime = null;
  let runtimeIntervalId = null;

  let touchStartX = 0;
  let touchStartY = 0;
  const swipeThreshold = 50;

  const connectButton = document.getElementById('connectButton');
  const disconnectButton = document.getElementById('disconnectButton');
  const downloadButton = document.getElementById('downloadButton');
  const loadDataButton = document.getElementById('loadDataButton');
  const fileInput = document.getElementById('fileInput');
  const fullscreenButton = document.getElementById('fullscreenButton'); // Get fullscreen button
  const navigationControls = document.getElementById('navigationControls');
  const prevPageButton = document.getElementById('prevPageButton');
  const prevSecButton = document.getElementById('prevSecButton');
  const nextSecButton = document.getElementById('nextSecButton');
  const nextPageButton = document.getElementById('nextPageButton');
  const backToLiveButton = document.getElementById('backToLiveButton');
  const timeDisplay = document.getElementById('timeDisplay');
  const connectionStatus = document.getElementById('connectionStatus');
  const logOutput = document.getElementById('logOutput');
  const runtimeClockElement = document.getElementById('runtimeClock');

  const notchFilterCheckbox = document.getElementById('notchFilterCheckbox');
  const notchBandwidthInput = document.getElementById('notchBandwidthInput');
  const bandpassFilterCheckbox = document.getElementById('bandpassFilterCheckbox');
  const bandpassLowerInput = document.getElementById('bandpassLowerInput');
  const bandpassUpperInput = document.getElementById('bandpassUpperInput');
  const dcBlockerCheckbox = document.getElementById('dcBlockerCheckbox');

  if (bandpassLowerInput) bandpassLowerInput.value = bandpassLowerInput.value || "0.3";
  if (bandpassUpperInput) bandpassUpperInput.value = bandpassUpperInput.value || "70";

  const plots = {
    eeg: setupPlot('eegCanvas', 'eegLabelCanvas', numEEGChannels, 'EEG', numEEGPoints, eegSps),
    accel: setupPlot('accelCanvas', 'accelLabelCanvas', numAccelChannels, 'Accel', numIMUPoints, imuSps),
    gyro: setupPlot('gyroCanvas', 'gyroLabelCanvas', numGyroChannels, 'Gyro', numIMUPoints, imuSps)
  };

  function setupPlot(canvasId, labelCanvasId, numChannels, type, numDataPoints, spsRate) {
    const canvas = document.getElementById(canvasId); const labelCanvas = document.getElementById(labelCanvasId);
    if (!canvas || !labelCanvas) { console.error(`Canvas elements for ${type} not found`); return null; }
    const labelCtx = labelCanvas.getContext('2d');
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    labelCanvas.width = labelCanvas.clientWidth; labelCanvas.height = labelCanvas.clientHeight;
    const webglp = new WebglPlot(canvas);
    const lines = [], dataBuffers = [], filters = [];
    let initialYScaleValue;
    if (type === 'EEG') initialYScaleValue = 50;
    else if (type === 'Accel') initialYScaleValue = 5000;
    else if (type === 'Gyro') initialYScaleValue = 5000;

    for (let i = 0; i < numChannels; i++) {
      const color = new ColorRGBA(Math.random()*0.7+0.3, Math.random()*0.7+0.3, Math.random()*0.7+0.3, 1);
      const line = new WebglLine(color, numDataPoints);
      line.lineSpaceX(-1, 2 / numDataPoints);
      const verticalMargin = 0.05, totalPlotHeight = 2.0 - 2.0 * verticalMargin, spacePerChannel = totalPlotHeight / numChannels;
      const topOfChannelArea = (1.0 - verticalMargin) - (i * spacePerChannel), offsetY = topOfChannelArea - (spacePerChannel / 2.0);
      for (let j = 0; j < numDataPoints; j++) line.setY(j, offsetY);
      lines.push(line); webglp.addLine(line); dataBuffers.push(new Float32Array(numDataPoints).fill(0));
      if (type === 'EEG') {
        const initialUseNotch = notchFilterCheckbox ? notchFilterCheckbox.checked : false;
        const initialUseBandpass = bandpassFilterCheckbox ? bandpassFilterCheckbox.checked : false;
        const initialUseDCBlock = dcBlockerCheckbox ? dcBlockerCheckbox.checked : true;
        filters.push(new BiquadChannelFilterer({
          sps: spsRate,
          useNotch50: initialUseNotch, useBandpass: initialUseBandpass,
          bandpassLower: parseFloat(bandpassLowerInput.value),
          bandpassUpper: parseFloat(bandpassUpperInput.value),
          useDCBlock: initialUseDCBlock,
          notchBandwidth: parseFloat(notchBandwidthInput.value) || 5
        }));
      }
    }
    return {
        canvas, labelCanvas, labelCtx, webglp, lines, dataBuffers, filters,
        yScale: initialYScaleValue, numChannels, type, numDataPoints, spsRate,
        playbackViewInvalidated: true
    };
  }

  window.addEventListener('resize', () => {
    Object.values(plots).forEach(plot => {
      if (plot) {
        plot.canvas.width = plot.canvas.clientWidth; plot.canvas.height = plot.canvas.clientHeight;
        plot.labelCanvas.width = plot.labelCanvas.clientWidth; plot.labelCanvas.height = plot.labelCanvas.clientHeight;
        drawGrid(plot);
        if (isPlaybackMode) plot.playbackViewInvalidated = true;
      }
    });
    // Update fullscreen button text on resize (e.g. if user exits FS with Esc)
    if (fullscreenButton) {
        if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
            fullscreenButton.textContent = 'Exit Fullscreen';
        } else {
            fullscreenButton.textContent = 'Fullscreen';
        }
    }
  });

  function animate() {
    if (isPlaybackMode) updatePlaybackDisplay(); else updateLiveDisplay();
    requestAnimationFrame(animate);
  }

  function updateLiveDisplay() {
    Object.values(plots).forEach(plot => {
      if (plot) {
        const verticalMargin = 0.05, totalPlotHeight = 2.0 - 2.0 * verticalMargin, spacePerChannel = totalPlotHeight / plot.numChannels;
        for (let i = 0; i < plot.numChannels; i++) {
          const line = plot.lines[i], dataFromBuffer = plot.dataBuffers[i];
          const topOfChannelArea = (1.0 - verticalMargin) - (i * spacePerChannel), baseLineY = topOfChannelArea - (spacePerChannel / 2.0);
          for (let j = 0; j < plot.numDataPoints; j++) {
            let valueToPlot = dataFromBuffer[j];
            if (plot.type === 'EEG') {
              valueToPlot = (valueToPlot / 1e6) * ( (spacePerChannel / 2) / (plot.yScale / 1e6) );
            } else if (plot.type === 'Accel' || plot.type === 'Gyro') {
                valueToPlot = valueToPlot * ( (spacePerChannel / 2) / plot.yScale );
            }

            if (!isFinite(valueToPlot)) {
                valueToPlot = 0;
            }
            line.setY(j, baseLineY + valueToPlot);
          }
        }
        plot.webglp.update();
      }
    });
  }

  function updatePlaybackDisplay() {
    if (!loadedData) return;
    Object.values(plots).forEach(plot => {
      if (plot) {
        const verticalMargin = 0.05, totalPlotHeight = 2.0 - 2.0 * verticalMargin, spacePerChannel = totalPlotHeight / plot.numChannels;

        if (plot.type === 'EEG' && plot.playbackViewInvalidated && plot.filters) {
            for (let k = 0; k < plot.numChannels; k++) {
                if (plot.filters[k]) {
                    plot.filters[k].reset(plot.spsRate);
                }
            }
        }

        // This is the index of the first *unique* sample (at plot.spsRate) to be displayed in the window
        const windowStartSampleIndex = Math.round(currentPlaybackTimeSeconds * plot.spsRate);

        for (let i = 0; i < plot.numChannels; i++) { // Loop for channels (e.g., X, Y, Z for IMU)
          const line = plot.lines[i];
          const topOfChannelArea = (1.0 - verticalMargin) - (i * spacePerChannel);
          const baseLineY = topOfChannelArea - (spacePerChannel / 2.0);

          for (let j = 0; j < plot.numDataPoints; j++) { // Loop for points on the screen for this channel
            let rawValue = 0;
            // dataIndexForUniqueSample is the k-th unique sample we want for the j-th point on screen
            const dataIndexForUniqueSample = windowStartSampleIndex + j;

            if (plot.type === 'EEG') {
                const dataIndex = dataIndexForUniqueSample; // EEG data is already at eegSps in loadedData.eeg
                if (loadedData.eeg && dataIndex >= 0 && dataIndex < loadedData.eeg.length) {
                    const eegDataPoint = loadedData.eeg[dataIndex];
                    if (eegDataPoint && i < eegDataPoint.length) rawValue = eegDataPoint[i];
                }
            } else if (plot.type === 'Accel') {
                // IMU data in loadedData.accel is upsampled to eegSps.
                // plot.spsRate for Accel is imuSps.
                // We need to convert dataIndexForUniqueSample (which is at imuSps) to an index for the eegSps array.
                const samplingRatio = eegSps / plot.spsRate; // e.g., 250 / 50 = 5
                const actualReadIndex = Math.floor(dataIndexForUniqueSample * samplingRatio);

                if (loadedData.accel && actualReadIndex >= 0 && actualReadIndex < loadedData.accel.length) {
                    const accelDataPoint = loadedData.accel[actualReadIndex];
                    if (accelDataPoint && i < accelDataPoint.length) rawValue = accelDataPoint[i];
                }
            } else if (plot.type === 'Gyro') {
                const samplingRatio = eegSps / plot.spsRate; // e.g., 250 / 50 = 5
                const actualReadIndex = Math.floor(dataIndexForUniqueSample * samplingRatio);

                 if (loadedData.gyro && actualReadIndex >= 0 && actualReadIndex < loadedData.gyro.length) {
                    const gyroDataPoint = loadedData.gyro[actualReadIndex];
                    if (gyroDataPoint && i < gyroDataPoint.length) rawValue = gyroDataPoint[i];
                }
            }

            let valueToPlot = rawValue;
            if (plot.type === 'EEG') {
              if (plot.filters && plot.filters[i]) valueToPlot = plot.filters[i].apply(rawValue);
              valueToPlot = (valueToPlot / 1e6) * ( (spacePerChannel / 2) / (plot.yScale / 1e6) );
            } else if (plot.type === 'Accel' || plot.type === 'Gyro') {
                valueToPlot = rawValue * ( (spacePerChannel / 2) / plot.yScale );
            }

            if (!isFinite(valueToPlot)) {
                valueToPlot = 0;
            }
            line.setY(j, baseLineY + valueToPlot);
          }
        }
        plot.webglp.update();

        if (plot.type === 'EEG') {
            plot.playbackViewInvalidated = false;
        }
      }
    });
    const displayCurrentTime = currentPlaybackTimeSeconds;
    const displayTotalTime = maxPlaybackTimeSeconds;
    timeDisplay.textContent = `${displayCurrentTime.toFixed(1)}s / ${displayTotalTime.toFixed(1)}s`;
  }

  animate();
  Object.values(plots).forEach(plot => { if (plot) drawGrid(plot); });
  updateFilterSettings();

  setupScaleButtons('eeg', plots.eeg); setupScaleButtons('accel', plots.accel); setupScaleButtons('gyro', plots.gyro);
  function setupScaleButtons(type, plot) {
    if (!plot) return;
    const scaleUpButton = document.getElementById(`${type}ScaleUpButton`);
    const scaleDownButton = document.getElementById(`${type}ScaleDownButton`);
    if (!scaleUpButton || !scaleDownButton) return;
    scaleUpButton.addEventListener('click', () => { plot.yScale /= 1.5; drawGrid(plot); if(isPlaybackMode) plot.playbackViewInvalidated = true; });
    scaleDownButton.addEventListener('click', () => { plot.yScale *= 1.5; drawGrid(plot); if(isPlaybackMode) plot.playbackViewInvalidated = true; });
  }

  function log(text) { const ts = '['+new Date().toJSON().substr(11,8)+'] '; logOutput.textContent = ts+text; console.log(ts+text); }
  function updateConnectionStatus(status) { connectionStatus.textContent = status; connectionStatus.className = status.toLowerCase().replace(/\s+/g,''); }

  async function loadCSVData(file) {
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim() !== '');
      if (lines.length < 2) { alert('CSV file is empty or has no data rows.'); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const parsedEEG = [], parsedAccel = [], parsedGyro = [];
      const eegColIndices = [];
      for (let i = 0; i < numEEGChannels; i++) {
        const idx = headers.indexOf(`eeg_ch${i + 1}`);
        if (idx === -1) { alert(`EEG Channel eeg_ch${i+1} not found in CSV.`); return; }
        eegColIndices.push(idx);
      }
      const accelCols = ['accel_x', 'accel_y', 'accel_z', 'accel_magnitude'];
      const accelColIndices = accelCols.map(name => headers.indexOf(name));
      const gyroCols = ['gyro_x', 'gyro_y', 'gyro_z'];
      const gyroColIndices = gyroCols.map(name => headers.indexOf(name));

      for (let k = 1; k < lines.length; k++) {
        const values = lines[k].split(',');
        if (values.length < headers.length) {
            continue;
        }
        const eegSamplesForRow = eegColIndices.map(idx => {
            const valStr = values[idx];
            const numVal = parseFloat(valStr);
            return isFinite(numVal) ? numVal : 0;
        });
        parsedEEG.push(eegSamplesForRow);

        if (!accelColIndices.some(idx => idx === -1)) {
            const accelSamplesForRow = accelColIndices.map(idx => {
                const valStr = values[idx];
                const numVal = parseFloat(valStr);
                return isFinite(numVal) ? numVal : 0;
            });
            parsedAccel.push(accelSamplesForRow);
        } else {
             parsedAccel.push(new Array(numAccelChannels).fill(0));
        }

        if (!gyroColIndices.some(idx => idx === -1)) {
            const gyroSamplesForRow = gyroColIndices.map(idx => {
                const valStr = values[idx];
                const numVal = parseFloat(valStr);
                return isFinite(numVal) ? numVal : 0;
            });
            parsedGyro.push(gyroSamplesForRow);
        } else {
            parsedGyro.push(new Array(numGyroChannels).fill(0));
        }
      }
      if (parsedEEG.length === 0) { alert('No valid EEG data found in CSV file.'); return; }

      while(parsedAccel.length < parsedEEG.length) parsedAccel.push(new Array(numAccelChannels).fill(0));
      while(parsedGyro.length < parsedEEG.length) parsedGyro.push(new Array(numGyroChannels).fill(0));

      loadedData = {
        eeg: parsedEEG,
        accel: parsedAccel.slice(0, parsedEEG.length), // Ensure accel/gyro have same length as EEG
        gyro: parsedGyro.slice(0, parsedEEG.length)
       };

      maxPlaybackTimeSeconds = (parsedEEG.length > 0 ? (parsedEEG.length -1) / eegSps : 0);

      const maxSeekPosInitial = Math.max(0, maxPlaybackTimeSeconds - displayDurationSeconds);
      currentPlaybackTimeSeconds = maxSeekPosInitial;

      Object.values(plots).forEach(plot => { if (plot) plot.playbackViewInvalidated = true; });
      switchToPlaybackMode();
      updatePlaybackDisplay();
      log(`Loaded CSV: ${parsedEEG.length} EEG samples. Playback duration: ~${maxPlaybackTimeSeconds.toFixed(1)}s. Initial view starts at: ${currentPlaybackTimeSeconds.toFixed(1)}s`);
    } catch (error) { console.error('Error loading CSV:', error); alert('Error loading CSV file: ' + error.message); loadedData = null; }
  }

  function navigateData(deltaSeconds) {
    if (!isPlaybackMode || !loadedData) return;
    currentPlaybackTimeSeconds += deltaSeconds;

    const maxSeekPos = Math.max(0, maxPlaybackTimeSeconds - displayDurationSeconds);
    let minSeekPos = 0.0;

    if (maxPlaybackTimeSeconds > FORBIDDEN_START_SECONDS) {
      minSeekPos = FORBIDDEN_START_SECONDS;
    }

    currentPlaybackTimeSeconds = Math.max(minSeekPos, Math.min(currentPlaybackTimeSeconds, maxSeekPos));

    Object.values(plots).forEach(plot => { if (plot) plot.playbackViewInvalidated = true; });
    updatePlaybackDisplay();
  }

  function switchToPlaybackMode() {
    isPlaybackMode = true; navigationControls.style.display = 'block';
    connectButton.disabled = true; disconnectButton.disabled = true;

    Object.values(plots).forEach(plot => { if (plot) plot.playbackViewInvalidated = true; });
    timeDisplay.textContent = `${currentPlaybackTimeSeconds.toFixed(1)}s / ${(maxPlaybackTimeSeconds > 0 ? maxPlaybackTimeSeconds : 0).toFixed(1)}s`;
    log('Switched to playback mode');
  }
  function switchToLiveMode() {
    isPlaybackMode = false; navigationControls.style.display = 'none';
    loadedData = null; currentPlaybackTimeSeconds = 0; maxPlaybackTimeSeconds = 0;
    connectButton.disabled = (bluetoothDevice && bluetoothDevice.gatt.connected);
    disconnectButton.disabled = !(bluetoothDevice && bluetoothDevice.gatt.connected);
    Object.values(plots).forEach(plot => {
        if (plot) {
            plot.dataBuffers.forEach(buffer => buffer.fill(0));
            if (plot.type === 'EEG' && plot.filters) plot.filters.forEach(f => f.reset(plot.spsRate));
        }
    });
    updateFilterSettings(); log('Switched to live mode');
  }

  function formatElapsedTime(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function updateRuntimeClock() {
    if (connectionStartTime && runtimeClockElement) {
      const elapsedMs = Date.now() - connectionStartTime;
      runtimeClockElement.textContent = `Runtime: ${formatElapsedTime(elapsedMs)}`;
    }
  }

  function exponentialBackoff(maxRetries, delay, toTry, success, fail) {
    toTry().then(result => success(result))
    .catch(error => {
      if (maxRetries === 0) return fail(error);
      log(`Retrying in ${delay}s... (${maxRetries} tries left) Error: ${error}`);
      setTimeout(() => exponentialBackoff(--maxRetries, delay*2, toTry, success, fail), delay*1000);
    });
  }
  async function connectBLE() {
    if (isConnecting || (bluetoothDevice && bluetoothDevice.gatt.connected)) return;
    try {
      if (!bluetoothDevice) {
        log('Requesting Bluetooth Device...'); updateConnectionStatus('Connecting');
        const EEG_SERVICE_UUID = '8badf00d-1212-efde-1523-785feabcd123';
        bluetoothDevice = await navigator.bluetooth.requestDevice({ filters: [ { services: [EEG_SERVICE_UUID] } ] });
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
      }
      connectGatt();
    } catch (error) { log('Failed to request device: '+error); updateConnectionStatus('Disconnected'); isConnecting = false; }
  }
  function connectGatt() {
    isConnecting = true; updateConnectionStatus('Connecting');
    exponentialBackoff(3, 2,
      () => { log(`Attempting to connect to GATT server for ${bluetoothDevice.name||bluetoothDevice.id}...`); return bluetoothDevice.gatt.connect(); },
      async (server) => {
        try {
          bleServer = server; log('Connected to GATT. Getting Service...');
          const EEG_SERVICE_UUID = '8badf00d-1212-efde-1523-785feabcd123';
          const EEG_CHARACTERISTIC_UUID = '8badf00d-1212-efde-1524-785feabcd123';
          const service = await bleServer.getPrimaryService(EEG_SERVICE_UUID);
          log('Getting Characteristic...');
          bleCharacteristic = await service.getCharacteristic(EEG_CHARACTERISTIC_UUID);
          await bleCharacteristic.startNotifications();
          bleCharacteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
          connectButton.disabled = true; disconnectButton.disabled = false; downloadButton.disabled = true;
          updateConnectionStatus('Connected'); log(`Connected to ${bluetoothDevice.name||bluetoothDevice.id} and notifications started.`);
          recordedData = []; isConnecting = false;
          connectionStartTime = Date.now();
          if (runtimeIntervalId) clearInterval(runtimeIntervalId);
          runtimeIntervalId = setInterval(updateRuntimeClock, 1000);
          updateRuntimeClock();
        } catch (error) {
          log('Failed to setup service/characteristic: '+error);
          if (bleServer && bleServer.connected) bleServer.disconnect();
          onDisconnected(false);
        }
      },
      (error) => {
        log(`Failed to connect after multiple attempts: ${error}`); updateConnectionStatus('Disconnected');
        isConnecting = false; bluetoothDevice = null;
      }
    );
  }
  function onDisconnected(attemptReconnect = true) {
    log(`Bluetooth Device ${bluetoothDevice?(bluetoothDevice.name||bluetoothDevice.id):''} disconnected.`);
    updateConnectionStatus('Disconnected'); connectButton.disabled = false; disconnectButton.disabled = true;
    downloadButton.disabled = recordedData.length === 0;
    if (bleCharacteristic) { bleCharacteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicValueChanged); bleCharacteristic = null; }
    bleServer = null; isConnecting = false;
    if (runtimeIntervalId) clearInterval(runtimeIntervalId);
    runtimeIntervalId = null; connectionStartTime = null;
    if (runtimeClockElement) runtimeClockElement.textContent = '';
  }
  function disconnectBLE() {
    isConnecting = false;
    if (bluetoothDevice && bluetoothDevice.gatt.connected) { log(`Disconnecting from ${bluetoothDevice.name||bluetoothDevice.id}...`); bluetoothDevice.gatt.disconnect(); }
    else { onDisconnected(false); }
  }
  function handleCharacteristicValueChanged(event) {
    const dataView = event.target.value; processData(dataView);
    if (recordedData.length > 0 && downloadButton.disabled) downloadButton.disabled = false;
  }

  function updateFilterSettings() {
    const useNotch = notchFilterCheckbox ? notchFilterCheckbox.checked : false;
    const notchBandwidth = notchBandwidthInput ? (parseFloat(notchBandwidthInput.value) || 5) : 5;
    const useBandpass = bandpassFilterCheckbox ? bandpassFilterCheckbox.checked : false;
    const bandpassLower = bandpassLowerInput ? (parseFloat(bandpassLowerInput.value) || 0.3) : 0.3;
    const bandpassUpper = bandpassUpperInput ? (parseFloat(bandpassUpperInput.value) || 70) : 70;
    const useDCBlock = dcBlockerCheckbox ? dcBlockerCheckbox.checked : true;

    if (plots.eeg && plots.eeg.filters) {
        for (let ch = 0; ch < numEEGChannels; ch++) {
          const filter = plots.eeg.filters[ch];
          filter.useNotch50 = useNotch;
          filter.useBandpass = useBandpass;
          filter.useDCBlock = useDCBlock;

          filter.notchBandwidth = notchBandwidth;
          filter.bandpassLower = bandpassLower;
          filter.bandpassUpper = bandpassUpper;
          filter.reset(plots.eeg.spsRate);
        }
        if (plots.eeg.filters.length > 0) {
            const firstFilter = plots.eeg.filters[0];
            log(`Filter settings: Notch=${firstFilter.useNotch50}, BP=${firstFilter.useBandpass}, DCBlock=${firstFilter.useDCBlock}, NotchBW=${firstFilter.notchBandwidth}, BP Range=${firstFilter.bandpassLower}-${firstFilter.bandpassUpper}Hz`);
        }
    }
    if (isPlaybackMode && plots.eeg) {
        plots.eeg.playbackViewInvalidated = true;
    }
    Object.values(plots).forEach(plot => { if (plot) drawGrid(plot); });
  }

  function processData(dataView) {
    const timestamp = new Date();
    const microvoltPerADCtick = (2420000 * 2) / 12 / (Math.pow(2, 24) - 1);
    const numEegSamplesInPacket = 5;
    let imuDataForPacket = {};
    if (dataView.byteLength >= 160) {
        const accelX = dataView.getInt16(135, false); const accelY = dataView.getInt16(137, false); const accelZ = dataView.getInt16(139, false);
        const accelMagnitude = Math.sqrt(accelX*accelX + accelY*accelY + accelZ*accelZ);
        const gyroX = dataView.getInt16(141, false); const gyroY = dataView.getInt16(143, false); const gyroZ = dataView.getInt16(145, false);
        const temperature = (dataView.getInt16(147, false) / 256.0) + 25.0;
        const deviceStatus = dataView.getUint8(149); const deviceTimestamp = dataView.getUint32(150, false);
        const packetIndex = dataView.getUint8(154); const commandTimestamp = dataView.getUint32(155, false);
        const incomingCommand = dataView.getUint8(159);
        imuDataForPacket = {
            accel: { x: accelX, y: accelY, z: accelZ, magnitude: accelMagnitude },
            gyro: { x: gyroX, y: gyroY, z: gyroZ },
            temperature, deviceStatus, deviceTimestamp, packetIndex, commandTimestamp, incomingCommand
        };
    }

    for (let sampleIdx = 0; sampleIdx < numEegSamplesInPacket; sampleIdx++) {
        const sampleBaseIndex = sampleIdx * 27; const eegRawValuesThisSample = [];
        for (let ch = 0; ch < 9; ch++) {
            const byteIndex = sampleBaseIndex + (ch * 3);
            if (byteIndex + 2 < 135) eegRawValuesThisSample.push(typecastInt24BigEndian(dataView, byteIndex) * microvoltPerADCtick);
            else eegRawValuesThisSample.push(0);
        }
        const currentEegForRecording = eegRawValuesThisSample.slice(1, numEEGChannels + 1);
        recordedData.push({
            timestamp: new Date(timestamp.getTime() + (sampleIdx * (1000/eegSps))).toISOString(),
            eegSamples: currentEegForRecording, imuData: imuDataForPacket // IMU data is the same for all 5 EEG samples in this packet
        });
        if (plots.eeg) {
            for (let ch = 0; ch < numEEGChannels; ch++) {
                const rawValue = eegRawValuesThisSample[ch + 1];
                let filteredValue = rawValue;
                if (plots.eeg.filters && plots.eeg.filters[ch]) filteredValue = plots.eeg.filters[ch].apply(rawValue);
                const eegBuffer = plots.eeg.dataBuffers[ch];
                eegBuffer.copyWithin(0, 1); eegBuffer[eegBuffer.length - 1] = filteredValue;
            }
        }
    }

    if (imuDataForPacket.accel && plots.accel) {
        const accelRawADCValues = [imuDataForPacket.accel.x, imuDataForPacket.accel.y, imuDataForPacket.accel.z, imuDataForPacket.accel.magnitude];
        for (let ch = 0; ch < numAccelChannels; ch++) {
            plots.accel.dataBuffers[ch].copyWithin(0, 1);
            plots.accel.dataBuffers[ch][plots.accel.dataBuffers[ch].length - 1] = accelRawADCValues[ch];
        }
    }
    if (imuDataForPacket.gyro && plots.gyro) {
        const gyroRawADCValues = [imuDataForPacket.gyro.x, imuDataForPacket.gyro.y, imuDataForPacket.gyro.z];
        for (let ch = 0; ch < numGyroChannels; ch++) {
            plots.gyro.dataBuffers[ch].copyWithin(0, 1);
            plots.gyro.dataBuffers[ch][plots.gyro.dataBuffers[ch].length - 1] = gyroRawADCValues[ch];
        }
    }
}

  function typecastInt24BigEndian(dataView, offset) {
    let value = (dataView.getUint8(offset) << 16) | (dataView.getUint8(offset + 1) << 8) | dataView.getUint8(offset + 2);
    if (value & 0x00800000) value |= 0xFF000000; return value;
  }
  function convertDataToCSV(data) {
    let csv = 'Timestamp';
    for (let i=0; i<numEEGChannels; i++) csv += `,EEG_Ch${i+1}`;
    csv += ',Accel_X,Accel_Y,Accel_Z,Accel_Magnitude,Gyro_X,Gyro_Y,Gyro_Z,Temperature,DeviceStatus,DeviceTimestamp,PacketIndex,CommandTimestamp,IncomingCommand\n';
    data.forEach(e => {
      let r = `${e.timestamp}`;
      e.eegSamples.forEach(v => { r += `,${v!=null?v:''}`; });
      if (e.imuData && e.imuData.accel) {
        r += `,${e.imuData.accel.x!=null?e.imuData.accel.x:''},${e.imuData.accel.y!=null?e.imuData.accel.y:''},${e.imuData.accel.z!=null?e.imuData.accel.z:''},${e.imuData.accel.magnitude!=null?e.imuData.accel.magnitude:''}`;
        r += `,${e.imuData.gyro.x!=null?e.imuData.gyro.x:''},${e.imuData.gyro.y!=null?e.imuData.gyro.y:''},${e.imuData.gyro.z!=null?e.imuData.gyro.z:''}`;
        r += `,${e.imuData.temperature!=null?e.imuData.temperature:''},${e.imuData.deviceStatus!=null?e.imuData.deviceStatus:''},${e.imuData.deviceTimestamp!=null?e.imuData.deviceTimestamp:''}`;
        r += `,${e.imuData.packetIndex!=null?e.imuData.packetIndex:''},${e.imuData.commandTimestamp!=null?e.imuData.commandTimestamp:''},${e.imuData.incomingCommand!=null?e.imuData.incomingCommand:''}`;
      } else { r += ',,,,,,,,,,,,'; }
      csv += r + '\n';
    }); return csv;
  }
  function drawGrid(plot) {
    if (!plot || !plot.labelCtx || !plot.labelCanvas) return;
    plot.labelCtx.clearRect(0,0,plot.labelCanvas.width,plot.labelCanvas.height);
    plot.labelCtx.strokeStyle='#444'; plot.labelCtx.lineWidth=0.5; plot.labelCtx.font='10px Arial'; plot.labelCtx.fillStyle='#ccc';
    const totalTimeVisible = plot.numDataPoints/plot.spsRate;
    for (let t=0; t<=totalTimeVisible; t+=1) {
      const x = (t/totalTimeVisible)*plot.labelCanvas.width;
      plot.labelCtx.beginPath(); plot.labelCtx.moveTo(x,0); plot.labelCtx.lineTo(x,plot.labelCanvas.height); plot.labelCtx.stroke();
      if (t%2===0 && t<totalTimeVisible) plot.labelCtx.fillText(`${totalTimeVisible-t}s`,x+2,plot.labelCanvas.height-5);
    }
    if (totalTimeVisible>0) plot.labelCtx.fillText(`0s`,plot.labelCanvas.width-15,plot.labelCanvas.height-5);
    const verticalMargin=0.05, totalPlotHeightNorm=2.0-2.0*verticalMargin, spacePerChannelNorm=totalPlotHeightNorm/plot.numChannels;
    for (let i=0; i<plot.numChannels; i++) {
      const topOfChannelNorm=(1.0-verticalMargin)-(i*spacePerChannelNorm), baseLineNorm=topOfChannelNorm-(spacePerChannelNorm/2.0);
      const baseLinePixelY=((1-baseLineNorm)/2)*plot.labelCanvas.height;
      plot.labelCtx.strokeStyle='#555'; plot.labelCtx.lineWidth=1;
      plot.labelCtx.beginPath(); plot.labelCtx.moveTo(0,baseLinePixelY); plot.labelCtx.lineTo(plot.labelCanvas.width,baseLinePixelY); plot.labelCtx.stroke();
      plot.labelCtx.strokeStyle='#333'; plot.labelCtx.lineWidth=0.5;
      const halfDivisionNorm=spacePerChannelNorm/2;
      const upperDivisionPixelY=((1-(baseLineNorm+halfDivisionNorm))/2)*plot.labelCanvas.height;
      const lowerDivisionPixelY=((1-(baseLineNorm-halfDivisionNorm))/2)*plot.labelCanvas.height;
      plot.labelCtx.beginPath(); plot.labelCtx.moveTo(0,upperDivisionPixelY); plot.labelCtx.lineTo(plot.labelCanvas.width,upperDivisionPixelY); plot.labelCtx.stroke();
      plot.labelCtx.beginPath(); plot.labelCtx.moveTo(0,lowerDivisionPixelY); plot.labelCtx.lineTo(plot.labelCanvas.width,lowerDivisionPixelY); plot.labelCtx.stroke();
      plot.labelCtx.fillStyle='#ddd'; let yLabelText; const scaleValue=plot.yScale;
      if (plot.type==='EEG') yLabelText=`Ch${i+1} (±${scaleValue.toFixed(0)}µV)`;
      else if (plot.type==='Accel') yLabelText=`${['X','Y','Z','Mag'][i]} (±${scaleValue.toFixed(0)} raw ADC)`;
      else if (plot.type==='Gyro') yLabelText=`${['X','Y','Z'][i]} (±${scaleValue.toFixed(0)} raw ADC)`;
      plot.labelCtx.fillText(yLabelText,5,baseLinePixelY-3);
    }
  }

  connectButton.addEventListener('click', connectBLE);
  disconnectButton.addEventListener('click', disconnectBLE);
  downloadButton.addEventListener('click', () => {
    if(recordedData.length>0){
      const csv=convertDataToCSV(recordedData); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url;
      link.setAttribute('download',`ble_data_${new Date().toISOString().replace(/[:.]/g,'-')}.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); log('Data downloaded.');
    } else { alert('No data to download.'); }
  });
  loadDataButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { const f=e.target.files[0]; if(f){log(`Loading: ${f.name}`);loadCSVData(f);} e.target.value=null; });

  if(prevPageButton) prevPageButton.addEventListener('click',()=>navigateData(-displayDurationSeconds));
  if(prevSecButton) prevSecButton.addEventListener('click',()=>navigateData(-1));
  if(nextSecButton) nextSecButton.addEventListener('click',()=>navigateData(1));
  if(nextPageButton) nextPageButton.addEventListener('click',()=>navigateData(displayDurationSeconds));
  if(backToLiveButton) backToLiveButton.addEventListener('click',switchToLiveMode);

  [notchFilterCheckbox, notchBandwidthInput, bandpassFilterCheckbox, bandpassLowerInput, bandpassUpperInput, dcBlockerCheckbox].forEach(el => {
    if (el) el.addEventListener('change', updateFilterSettings);
  });

  document.addEventListener('keydown', (e) => {
    if(!isPlaybackMode||!loadedData)return;
    switch(e.key){
      case 'ArrowLeft': navigateData(e.shiftKey?-displayDurationSeconds:-1); e.preventDefault(); break;
      case 'ArrowRight': navigateData(e.shiftKey?displayDurationSeconds:1); e.preventDefault(); break;
    }
  });

  // --- SWIPE GESTURE IMPLEMENTATION ---
  const canvasContainers = document.querySelectorAll('.canvas-container');

  canvasContainers.forEach(container => {
    container.addEventListener('touchstart', (e) => {
      if (!isPlaybackMode || !loadedData) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (!isPlaybackMode || !loadedData || !touchStartX || !touchStartY) return;
      const touchCurrentX = e.touches[0].clientX;
      const touchCurrentY = e.touches[0].clientY;
      const deltaX = Math.abs(touchCurrentX - touchStartX);
      const deltaY = Math.abs(touchCurrentY - touchStartY);

      if (deltaX > deltaY && deltaX > 10) {
        e.preventDefault();
      }
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
      if (!isPlaybackMode || !loadedData || touchStartX === 0) return;
      const touchEndX = e.changedTouches[0].clientX;
      const swipeDistance = touchEndX - touchStartX;

      if (Math.abs(swipeDistance) > swipeThreshold) {
        if (swipeDistance < 0) {
          log('Swipe Left detected - Next Page');
          navigateData(displayDurationSeconds);
        } else {
          log('Swipe Right detected - Previous Page');
          navigateData(-displayDurationSeconds);
        }
      }
      touchStartX = 0;
      touchStartY = 0;
    });
  });
  // --- END SWIPE GESTURE IMPLEMENTATION ---

  // --- FULLSCREEN FUNCTIONALITY ---
  function toggleFullScreen() {
    const elem = document.documentElement; // Fullscreen the whole page
    if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
      }
      if(fullscreenButton) fullscreenButton.textContent = 'Exit Fullscreen';
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      if(fullscreenButton) fullscreenButton.textContent = 'Fullscreen';
    }
  }

  if (fullscreenButton) {
    fullscreenButton.addEventListener('click', toggleFullScreen);
  }

  // Listen for fullscreen changes (e.g., user pressing Esc) to update button text
  document.addEventListener('fullscreenchange', () => {
    if (fullscreenButton) {
        fullscreenButton.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    }
  });
  document.addEventListener('webkitfullscreenchange', () => {
    if (fullscreenButton) {
        fullscreenButton.textContent = document.webkitIsFullScreen ? 'Exit Fullscreen' : 'Fullscreen';
    }
  });
  document.addEventListener('mozfullscreenchange', () => {
    if (fullscreenButton) {
        fullscreenButton.textContent = document.mozFullScreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    }
  });
  document.addEventListener('MSFullscreenChange', () => {
    if (fullscreenButton) {
        fullscreenButton.textContent = document.msFullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    }
  });
  // --- END FULLSCREEN FUNCTIONALITY ---

});
