// Import necessary classes from webgl-plot
import { WebglPlot, WebglLine, ColorRGBA } from 'https://esm.sh/webgl-plot@latest';

// Include your Biquad filter code here
/////////////////////////////////////////////////////////////
// Begin Biquad filter code (adjusted for browser use)
/////////////////////////////////////////////////////////////

class BiquadChannelFilterer {

  constructor(options = {}) {
    this.idx = 0;
    this.sps = options.sps || 512;
    this.bandpassLower = options.bandpassLower || 3;
    this.bandpassUpper = options.bandpassUpper || 45;

    this.useSMA4 = options.useSMA4 || false;
    this.last4 = [];
    this.filtered = 0;
    this.trimOutliers = options.trimOutliers || false;
    this.outlierTolerance = options.outlierTolerance || 0.20;
    this.useNotch50 = options.useNotch50 || true;
    this.useNotch60 = options.useNotch60 || false;
    this.useLowpass = options.useLowpass || false;
    this.lowpassHz = options.lowpassHz || 100;
    this.useBandpass = options.useBandpass || false;
    this.useDCBlock = options.useDCBlock || true;
    this.DCBresonance = options.DCBresonance || 0.995;
    this.useScaling = options.useScaling || false;
    this.scalar = options.scalar || 1;

    this.notchBandwidth = options.notchBandwidth || 5; // Default notch bandwidth

    let sps = this.sps;
    this.reset(sps);
  }

  reset(sps = this.sps) {
    this.sps = sps;

    // Recreate notch filters with updated sps and bandwidth
    this.notch50 = [
      makeNotchFilter(50, sps, this.notchBandwidth)
    ];

    this.notch60 = [
      makeNotchFilter(60, sps, this.notchBandwidth)
    ];

    // Recreate lowpass filters
    this.lp1 = [
      new Biquad('lowpass', this.lowpassHz, sps),
      new Biquad('lowpass', this.lowpassHz, sps),
      new Biquad('lowpass', this.lowpassHz, sps),
      new Biquad('lowpass', this.lowpassHz, sps)
    ];

    // Recreate bandpass filters
    this.bp1 = [
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps),
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps),
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps),
      makeBandpassFilter(this.bandpassLower, this.bandpassUpper, sps)
    ];

    // Reset DC Blocker
    this.dcb = new DCBlocker(this.DCBresonance);

    // Reset internal states
    this.filtered = 0;
    this.idx = 0;
    this.last4 = [];
  }

  setBandpass(bandpassLower = this.bandpassLower, bandpassUpper = this.bandpassUpper, sps = this.sps) {
    this.bandpassLower = bandpassLower;
    this.bandpassUpper = bandpassUpper;
    this.bp1 = [
      makeBandpassFilter(bandpassLower, bandpassUpper, sps),
      makeBandpassFilter(bandpassLower, bandpassUpper, sps),
      makeBandpassFilter(bandpassLower, bandpassUpper, sps),
      makeBandpassFilter(bandpassLower, bandpassUpper, sps)
    ];
  }

  setNotchBandwidth(bandwidth) {
    this.notchBandwidth = bandwidth;
    this.reset(this.sps);
  }

  apply(latestData = 0) {
    let out = latestData;
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

    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;

    let A = Math.pow(10, dbGain / 40);
    let omega = 2 * Math.PI * freq / sps;
    let sn = Math.sin(omega);
    let cs = Math.cos(omega);
    let alpha = sn / (2 * Q);
    let beta = Math.sqrt(A + A);

    this[type](A, sn, cs, alpha, beta);

    // Scale constants
    this.b0 /= this.a0;
    this.b1 /= this.a0;
    this.b2 /= this.a0;
    this.a1 /= this.a0;
    this.a2 /= this.a0;
  }

  lowpass(A, sn, cs, alpha, beta) {
    this.b0 = (1 - cs) * 0.5;
    this.b1 = 1 - cs;
    this.b2 = (1 - cs) * 0.5;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cs;
    this.a2 = 1 - alpha;
  }

  highpass(A, sn, cs, alpha, beta) {
    this.b0 = (1 + cs) * 0.5;
    this.b1 = -(1 + cs);
    this.b2 = (1 + cs) * 0.5;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cs;
    this.a2 = 1 - alpha;
  }

  bandpass(A, sn, cs, alpha, beta) {
    this.b0 = alpha;
    this.b1 = 0;
    this.b2 = -alpha;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cs;
    this.a2 = 1 - alpha;
  }

  notch(A, sn, cs, alpha, beta) {
    this.b0 = 1;
    this.b1 = -2 * cs;
    this.b2 = 1;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cs;
    this.a2 = 1 - alpha;
  }

  peak(A, sn, cs, alpha, beta) {
    this.b0 = 1 + (alpha * A);
    this.b1 = -2 * cs;
    this.b2 = 1 - (alpha * A);
    this.a0 = 1 + (alpha / A);
    this.a1 = -2 * cs;
    this.a2 = 1 - (alpha / A);
  }

  lowshelf(A, sn, cs, alpha, beta) {
    this.b0 = A * ((A + 1) - (A - 1) * cs + beta * sn);
    this.b1 = 2 * A * ((A - 1) - (A + 1) * cs);
    this.b2 = A * ((A + 1) - (A - 1) * cs - beta * sn);
    this.a0 = (A + 1) + (A + 1) * cs + beta * sn;
    this.a1 = -2 * ((A - 1) + (A + 1) * cs);
    this.a2 = (A + 1) + (A - 1) * cs - beta * sn;
  }

  highshelf(A, sn, cs, alpha, beta) {
    this.b0 = A * ((A + 1) + (A - 1) * cs + beta * sn);
    this.b1 = -2 * A * ((A - 1) + (A + 1) * cs);
    this.b2 = A * ((A + 1) - (A - 1) * cs - beta * sn);
    this.a0 = (A + 1) - (A + 1) * cs - beta * sn;
    this.a1 = 2 * ((A - 1) - (A + 1) * cs);
    this.a2 = (A + 1) - (A - 1) * cs - beta * sn;
  }

  applyFilter(signal_step) {
    let y = this.b0 * signal_step + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = signal_step;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  static calcCenterFrequency(freqStart, freqEnd) {
    return (freqStart + freqEnd) / 2;
  }

  static calcBandwidth(freqStart, freqEnd) {
    return (freqEnd - freqStart);
  }

  static calcBandpassQ(frequency, bandwidth, resonance = 1) {
    let Q = frequency / bandwidth;
    // Limit Q-factor to prevent instability
    Q = Math.max(Q, 0.5);  // Minimum Q-factor
    Q = Math.min(Q, 15);   // Maximum Q-factor
    return Q;
  }

  static calcNotchQ(frequency, bandwidth, resonance = 1) {
    let Q = frequency / bandwidth;
    // Limit Q-factor to prevent instability
    Q = Math.max(Q, 0.5);  // Minimum Q-factor
    Q = Math.min(Q, 15);   // Maximum Q-factor
    return Q;
  }
}

class DCBlocker {

  constructor(r = 0.995) {
    this.r = r;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  applyFilter(signal_step) {
    this.x2 = this.x1;
    this.x1 = signal_step;
    let y = this.x1 - this.x2 + this.r * this.y1;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// Helper functions
const makeNotchFilter = (frequency, sps, bandwidth) => {
  let Q = Biquad.calcNotchQ(frequency, bandwidth);
  return new Biquad('notch', frequency, sps, Q, 0);
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
  // Canvas setup
  const canvas = document.getElementById('canvas');
  const labelCanvas = document.getElementById('labelCanvas');
  const labelCtx = labelCanvas.getContext('2d');

  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  // Set canvas dimensions
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  labelCanvas.width = labelCanvas.clientWidth;
  labelCanvas.height = labelCanvas.clientHeight;

  // Handle window resize
  window.addEventListener('resize', () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    labelCanvas.width = labelCanvas.clientWidth;
    labelCanvas.height = labelCanvas.clientHeight;
    drawGrid(); // Redraw grid on resize
  });

  // Initialize WebGLPlot
  const webglp = new WebglPlot(canvas);

  const numPoints = 3750; // 250 Hz * 15 seconds
  const numChannels = 8;

  // Create lines and data buffers for each channel
  const lines = [];
  const dataBuffers = [];
  const filters = []; // Filters for each channel

  const sps = 250; // Sampling rate in Hz

  for (let i = 0; i < numChannels; i++) {
    const color = new ColorRGBA(Math.random(), Math.random(), Math.random(), 1);
    const line = new WebglLine(color, numPoints);
    line.lineSpaceX(-1, 2 / numPoints);

    // Offset each line vertically
    const offsetY = ((numChannels - i - 0.5) / numChannels) * (2 - 0.2) - (2 - 0.2) / 2;

    for (let j = 0; j < numPoints; j++) {
      line.setY(j, offsetY);
    }

    lines.push(line);
    webglp.addLine(line);

    // Initialize data buffer for the channel
    dataBuffers.push(new Float32Array(numPoints).fill(0));

    // Initialize filters for the channel
    filters.push(new BiquadChannelFilterer({
      sps: sps,
      useNotch50: true,
      useBandpass: false,
      bandpassLower: 3,
      bandpassUpper: 45,
      useDCBlock: true,
      notchBandwidth: 5 // Default notch bandwidth
    }));
  }

  let yScale = 10.0; // Adjusted initial magnification

  const verticalMargin = 0.1; // Margin of 0.1 units at top and bottom
  const verticalRange = 2 - 2 * verticalMargin;

  // Animation loop
  function animate() {
    // Update the lines with data from buffers
    for (let i = 0; i < numChannels; i++) {
      const line = lines[i];
      const data = dataBuffers[i];
      const offsetY = ((numChannels - i - 0.5) / numChannels) * verticalRange - (verticalRange / 2);

      for (let j = 0; j < numPoints; j++) {
        // Convert data from µV to V before scaling
        line.setY(j, (data[j] / 1e6) * yScale + offsetY);
      }
    }
    webglp.update();
    requestAnimationFrame(animate);
  }

  animate();
  drawGrid(); // Initial grid drawing

  // Scaling buttons
  const scaleUpButton = document.getElementById('scaleUpButton');
  const scaleDownButton = document.getElementById('scaleDownButton');

  scaleUpButton.addEventListener('click', () => {
    yScale *= 1.2;
    drawGrid(); // Update grid when scaling
  });

  scaleDownButton.addEventListener('click', () => {
    yScale /= 1.2;
    drawGrid(); // Update grid when scaling
  });

  // BLE connection variables
  let bleDevice;
  let bleServer;
  let bleCharacteristic;

  const connectButton = document.getElementById('connectButton');
  const disconnectButton = document.getElementById('disconnectButton');
  const downloadButton = document.getElementById('downloadButton');

  connectButton.addEventListener('click', () => {
    connectBLE();
  });

  disconnectButton.addEventListener('click', () => {
    disconnectBLE();
  });

  downloadButton.addEventListener('click', () => {
    if (recordedData.length > 0) {
      // Generate CSV file
      const csvContent = convertDataToCSV(recordedData);

      // Create a Blob from the CSV content
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

      // Create a link to download the Blob
      const url = URL.createObjectURL(blob);

      // Create a temporary link element
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.setAttribute('download', `eeg_data_${new Date().toISOString()}.csv`);
      downloadLink.click();

      // Clean up
      URL.revokeObjectURL(url);

      // Optionally, clear the recorded data after download
      recordedData = [];
      downloadButton.disabled = true; // Disable download button
    } else {
      alert('No data available to download.');
    }
  });

  async function connectBLE() {
    try {
      console.log('Requesting Bluetooth Device...');
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['8badf00d-1212-efde-1523-785feabcd123'] }],
      });

      console.log('Connecting to GATT Server...');
      bleServer = await bleDevice.gatt.connect();

      console.log('Getting Service...');
      const service = await bleServer.getPrimaryService('8badf00d-1212-efde-1523-785feabcd123');

      console.log('Getting Characteristic...');
      bleCharacteristic = await service.getCharacteristic('8badf00d-1212-efde-1524-785feabcd123');

      // Enable notifications
      await bleCharacteristic.startNotifications();

      bleCharacteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);

      connectButton.disabled = true;
      disconnectButton.disabled = false;
      downloadButton.disabled = true; // Disable the download button when connected

      // Clear any previous data
      recordedData = [];

      console.log('Connected and notifications started.');
    } catch (error) {
      console.error('Failed to connect: ', error);
    }
  }

  function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
      bleDevice.gatt.disconnect();
      console.log('Device disconnected.');

      // Stop notifications
      if (bleCharacteristic) {
        bleCharacteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
      }

      disconnectButton.disabled = true;
      connectButton.disabled = false;
      downloadButton.disabled = false; // Enable download button after disconnect
    }
  }

  function handleCharacteristicValueChanged(event) {
    const dataView = event.target.value;
    processData(dataView);
  }

  // Filter controls
  const notchFilterCheckbox = document.getElementById('notchFilterCheckbox');
  const notchBandwidthInput = document.getElementById('notchBandwidthInput');
  const bandpassFilterCheckbox = document.getElementById('bandpassFilterCheckbox');
  const bandpassLowerInput = document.getElementById('bandpassLowerInput');
  const bandpassUpperInput = document.getElementById('bandpassUpperInput');

  // Event listeners for filter controls
  notchFilterCheckbox.addEventListener('change', updateFilterSettings);
  notchBandwidthInput.addEventListener('change', updateFilterSettings);
  bandpassFilterCheckbox.addEventListener('change', updateFilterSettings);
  bandpassLowerInput.addEventListener('change', updateFilterSettings);
  bandpassUpperInput.addEventListener('change', updateFilterSettings);

  function updateFilterSettings() {
    const useNotch = notchFilterCheckbox.checked;
    const notchBandwidth = parseFloat(notchBandwidthInput.value);
    const useBandpass = bandpassFilterCheckbox.checked;
    const bandpassLower = parseFloat(bandpassLowerInput.value);
    const bandpassUpper = parseFloat(bandpassUpperInput.value);

    for (let ch = 0; ch < numChannels; ch++) {
      const filter = filters[ch];
      filter.useNotch50 = useNotch;
      filter.useBandpass = useBandpass;
      filter.bandpassLower = bandpassLower;
      filter.bandpassUpper = bandpassUpper;
      filter.setNotchBandwidth(notchBandwidth);

      // Reinitialize filters with new settings
      filter.reset(sps);
      if (useBandpass) {
        filter.setBandpass(bandpassLower, bandpassUpper, sps);
      }
    }
  }

  // Array to store data packets and timestamps
  let recordedData = []; // Each element will be an object: { timestamp: Date, samples: [...] }

  function processData(dataView) {
    // Convert DataView to Uint8Array
    const data = new Uint8Array(dataView.buffer);

    // Get the current timestamp
    const timestamp = new Date();

    // Constants
    const microvoltPerADCtick = (2420000 * 2) / 12 / (Math.pow(2, 24) - 1);

    // Process EEG data
    for (let i = 0; i < 135; i += 27) {
      const sample = [];

      for (let j = 0; j < 9; j++) {
        const byteIndex = i + 3 * j;

        const bytes = [
          data[byteIndex + 2],
          data[byteIndex + 1],
          data[byteIndex],
        ];

        const adcValue = typecastInt24(bytes);
        const microVolts = adcValue * microvoltPerADCtick;
        sample.push(microVolts);
      }

      // Store the sample along with the timestamp
      recordedData.push({
        timestamp: timestamp.toISOString(),
        samples: sample.slice(1, numChannels + 1) // Exclude metadata at index 0
      });

      // Update data buffers for channels (excluding metadata at index 0)
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = dataBuffers[ch];

        // Shift data left
        channelData.copyWithin(0, 1);

        // Apply filters to the new data point
        let filteredValue = sample[ch + 1]; // sample[0] is metadata

        filteredValue = filters[ch].apply(filteredValue);

        // Append new filtered data
        channelData[channelData.length - 1] = filteredValue;
      }
    }
  }

  // Helper function to convert 3 bytes into a signed 24-bit integer
  function typecastInt24(bytes) {
    // bytes[0]: LSB, bytes[2]: MSB
    let value = (bytes[2] << 16) | (bytes[1] << 8) | bytes[0];
    // Sign correction
    if (value & 0x800000) {
      value |= 0xFF000000;
    }
    return value;
  }

  // Function to convert recorded data to CSV
  function convertDataToCSV(data) {
    // Create CSV header
    let csvContent = 'Timestamp';

    // Add channel headers
    for (let i = 0; i < numChannels; i++) {
      csvContent += `,Ch${i + 1}`;
    }
    csvContent += '\n';

    // Add data rows
    data.forEach(entry => {
      let row = `${entry.timestamp}`;
      entry.samples.forEach(value => {
        row += `,${value}`;
      });
      csvContent += row + '\n';
    });

    return csvContent;
  }

  // Function to draw grid lines and labels
  function drawGrid() {
    // Clear the canvas
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);

    // Set styles
    labelCtx.strokeStyle = '#444'; // Grid line color
    labelCtx.lineWidth = 1;
    labelCtx.font = '12px Arial';
    labelCtx.fillStyle = '#fff'; // Text color

    // Draw vertical lines every 1 second
    const totalTime = numPoints / sps; // Total time in seconds, should be 10
    const pixelsPerSecond = labelCanvas.width / totalTime;

    for (let t = 0; t <= totalTime; t += 1) {
      const x = ((totalTime - t) / totalTime) * labelCanvas.width;
      labelCtx.beginPath();
      labelCtx.moveTo(x, 0);
      labelCtx.lineTo(x, labelCanvas.height);
      labelCtx.stroke();

      // Time labels every 2 seconds to avoid overlap
      if (t % 2 === 0) {
        labelCtx.fillText(`${t}s`, x + 2, labelCanvas.height - 2);
      }
    }

    // Draw y-axis labels for each channel
    for (let i = 0; i < numChannels; i++) {
      const offsetY = ((numChannels - i - 0.5) / numChannels) * verticalRange - (verticalRange / 2);
      const y = ((-offsetY + verticalRange / 2) / verticalRange) * labelCanvas.height;

      // Compute total microvolt range per channel
      const totalMicrovoltRange = (verticalRange / numChannels / yScale) * 1e6; // in µV

      // Draw horizontal line at center of each channel
      labelCtx.strokeStyle = '#666';
      labelCtx.beginPath();
      labelCtx.moveTo(0, y);
      labelCtx.lineTo(labelCanvas.width, y);
      labelCtx.stroke();

      // Draw y-axis labels
      labelCtx.fillStyle = '#fff';
      const yLabel = `Ch${i + 1} ±${(totalMicrovoltRange / 2).toFixed(0)}µV`;
      labelCtx.fillText(yLabel, 2, y - 5);
    }
  }
});
