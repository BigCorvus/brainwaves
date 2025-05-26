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

    this.dcb = new DCBlocker(this.DCBresonance);
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
    Q = Math.max(Q, 0.5);
    Q = Math.min(Q, 15);
    return Q;
  }

  static calcNotchQ(frequency, bandwidth, resonance = 1) {
    let Q = frequency / bandwidth;
    Q = Math.max(Q, 0.5);
    Q = Math.min(Q, 15);
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
  // Constants
  const sps = 250; // Sampling rate in Hz
  const numPoints = 3750; // 250 Hz * 15 seconds
  const numEEGChannels = 8;
  const numAccelChannels = 4; // X, Y, Z, Magnitude
  const numGyroChannels = 3; // X, Y, Z

  // BLE connection variables
  let bluetoothDevice;
  let bleServer;
  let bleCharacteristic;
  let isConnecting = false;

  // Data playback variables
  let loadedData = null;
  let isPlaybackMode = false;
  let currentTimeIndex = 0;
  let maxTimeIndex = 0;
  let recordedData = [];

  // Get DOM elements
  const connectButton = document.getElementById('connectButton');
  const disconnectButton = document.getElementById('disconnectButton');
  const downloadButton = document.getElementById('downloadButton');
  const loadDataButton = document.getElementById('loadDataButton');
  const fileInput = document.getElementById('fileInput');
  const navigationControls = document.getElementById('navigationControls');
  const prevPageButton = document.getElementById('prevPageButton');
  const prevSecButton = document.getElementById('prevSecButton');
  const nextSecButton = document.getElementById('nextSecButton');
  const nextPageButton = document.getElementById('nextPageButton');
  const backToLiveButton = document.getElementById('backToLiveButton');
  const timeDisplay = document.getElementById('timeDisplay');
  const connectionStatus = document.getElementById('connectionStatus');
  const logOutput = document.getElementById('logOutput');
  
  // Filter controls
  const notchFilterCheckbox = document.getElementById('notchFilterCheckbox');
  const notchBandwidthInput = document.getElementById('notchBandwidthInput');
  const bandpassFilterCheckbox = document.getElementById('bandpassFilterCheckbox');
  const bandpassLowerInput = document.getElementById('bandpassLowerInput');
  const bandpassUpperInput = document.getElementById('bandpassUpperInput');

  // Canvas and plot setup
  const plots = {
    eeg: setupPlot('eegCanvas', 'eegLabelCanvas', numEEGChannels, 'EEG'),
    accel: setupPlot('accelCanvas', 'accelLabelCanvas', numAccelChannels, 'Accel'),
    gyro: setupPlot('gyroCanvas', 'gyroLabelCanvas', numGyroChannels, 'Gyro')
  };

  function setupPlot(canvasId, labelCanvasId, numChannels, type) {
    const canvas = document.getElementById(canvasId);
    const labelCanvas = document.getElementById(labelCanvasId);

    if (!canvas) {
      console.error(`Canvas element ${canvasId} not found`);
      return null;
    }

    if (!labelCanvas) {
      console.error(`Label canvas element ${labelCanvasId} not found`);
      return null;
    }

    const labelCtx = labelCanvas.getContext('2d');

    // Set canvas dimensions
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    labelCanvas.width = labelCanvas.clientWidth;
    labelCanvas.height = labelCanvas.clientHeight;

    // Initialize WebGLPlot
    const webglp = new WebglPlot(canvas);
    const lines = [];
    const dataBuffers = [];
    const filters = [];

    let yScale = 1.0; // Base scale for all plot types
    
    // Set initial Y-axis range based on plot type
    let yRange;
    if (type === 'EEG') {
      yRange = 70e-6; // 70µV/div in Volts
    } else if (type === 'Accel') {
      yRange = 5000; // 5000 units/div for accelerometer
    } else if (type === 'Gyro') {
      yRange = 1500; // 1500 units/div for gyroscope
    }

    // Create lines and data buffers for each channel
    for (let i = 0; i < numChannels; i++) {
      const color = new ColorRGBA(
        Math.random() * 0.8 + 0.2,
        Math.random() * 0.8 + 0.2,
        Math.random() * 0.8 + 0.2,
        1
      );
      const line = new WebglLine(color, numPoints);
      line.lineSpaceX(-1, 2 / numPoints);

      // Offset each line vertically
      const verticalMargin = 0.1;
      const verticalRange = 2 - 2 * verticalMargin;
      const offsetY = ((numChannels - i - 0.5) / numChannels) * verticalRange - (verticalRange / 2);

      for (let j = 0; j < numPoints; j++) {
        line.setY(j, offsetY);
      }

      lines.push(line);
      webglp.addLine(line);

      // Initialize data buffer for the channel
      dataBuffers.push(new Float32Array(numPoints).fill(0));

      // Initialize filters for EEG channels only
      if (type === 'EEG') {
        filters.push(new BiquadChannelFilterer({
          sps: sps,
          useNotch50: true,
          useBandpass: false,
          bandpassLower: 3,
          bandpassUpper: 45,
          useDCBlock: true,
          notchBandwidth: 5
        }));
      }
    }

    return {
      canvas,
      labelCanvas,
      labelCtx,
      webglp,
      lines,
      dataBuffers,
      filters,
      yScale,
      yRange,
      numChannels,
      type
    };
  }

  // Handle window resize
  window.addEventListener('resize', () => {
    Object.values(plots).forEach(plot => {
      if (plot) {
        plot.canvas.width = plot.canvas.clientWidth;
        plot.canvas.height = plot.canvas.clientHeight;
        plot.labelCanvas.width = plot.labelCanvas.clientWidth;
        plot.labelCanvas.height = plot.labelCanvas.clientHeight;
        drawGrid(plot);
      }
    });
  });

  // Animation loop
  function animate() {
    if (isPlaybackMode) {
      updatePlaybackDisplay();
    } else {
      updateLiveDisplay();
    }
    requestAnimationFrame(animate);
  }

  function updateLiveDisplay() {
    Object.values(plots).forEach(plot => {
      if (plot) {
        const verticalMargin = 0.1;
        const verticalRange = 2 - 2 * verticalMargin;

        for (let i = 0; i < plot.numChannels; i++) {
          const line = plot.lines[i];
          const data = plot.dataBuffers[i];
          
          // Fixed baseline positions - equally distributed
          const offsetY = ((plot.numChannels - i - 0.5) / plot.numChannels) * verticalRange - (verticalRange / 2);

          for (let j = 0; j < numPoints; j++) {
            let value = data[j];
            
            // Apply proper scaling based on plot type
            if (plot.type === 'EEG') {
              // Apply filters based on current settings for EEG data
              value = applyVisualizationFilters(value, i);
              
              // Convert µV to normalized value, then scale by yRange
              // Value scaling is independent of baseline spacing
              value = (value / 1e6) / plot.yRange;
            } else {
              // For IMU data, scale by yRange
              value = value / plot.yRange;
            }
            
            // Add scaled value to FIXED baseline position
            line.setY(j, offsetY + value);
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
        const verticalMargin = 0.1;
        const verticalRange = 2 - 2 * verticalMargin;

        for (let i = 0; i < plot.numChannels; i++) {
          const line = plot.lines[i];
          
          // Fixed baseline positions - equally distributed
          const offsetY = ((plot.numChannels - i - 0.5) / plot.numChannels) * verticalRange - (verticalRange / 2);

          for (let j = 0; j < numPoints; j++) {
            const timeIndex = currentTimeIndex + (j / sps);
            const dataIndex = Math.floor(timeIndex * sps);
            
            let value = 0;
            if (dataIndex >= 0 && dataIndex < loadedData.length) {
              const dataPoint = loadedData[dataIndex];
              
              if (plot.type === 'EEG' && dataPoint.eegSamples && i < dataPoint.eegSamples.length) {
                value = dataPoint.eegSamples[i];
                
                // Apply filters based on current settings
                value = applyVisualizationFilters(value, i);
                
                // Convert µV to normalized value, then scale by yRange
                value = (value / 1e6) / plot.yRange;
              } else if (plot.type === 'Accel' && dataPoint.imuData) {
                const accelValues = [
                  dataPoint.imuData.accel.x,
                  dataPoint.imuData.accel.y, 
                  dataPoint.imuData.accel.z,
                  dataPoint.imuData.accel.magnitude
                ];
                if (i < accelValues.length) {
                  value = accelValues[i] / plot.yRange;
                }
              } else if (plot.type === 'Gyro' && dataPoint.imuData) {
                const gyroValues = [
                  dataPoint.imuData.gyro.x,
                  dataPoint.imuData.gyro.y,
                  dataPoint.imuData.gyro.z
                ];
                if (i < gyroValues.length) {
                  value = gyroValues[i] / plot.yRange;
                }
              }
            }
            
            // Add scaled value to FIXED baseline position
            line.setY(j, offsetY + value);
          }
        }
        plot.webglp.update();
      }
    });

    // Update time display
    const currentTime = currentTimeIndex;
    const totalTime = maxTimeIndex;
    timeDisplay.textContent = `${currentTime.toFixed(1)}s / ${totalTime.toFixed(1)}s`;
  }

  // New function to apply visualization filters on-the-fly
  function applyVisualizationFilters(value, channelIndex) {
    if (!notchFilterCheckbox.checked && !bandpassFilterCheckbox.checked) {
      return value; // No filtering
    }

    // Create temporary filter with current settings
    const tempFilter = new BiquadChannelFilterer({
      sps: sps,
      useNotch50: notchFilterCheckbox.checked,
      useBandpass: bandpassFilterCheckbox.checked,
      bandpassLower: parseFloat(bandpassLowerInput.value) || 3,
      bandpassUpper: parseFloat(bandpassUpperInput.value) || 45,
      useDCBlock: true,
      notchBandwidth: parseFloat(notchBandwidthInput.value) || 5
    });

    return tempFilter.apply(value);
  }

  animate();

  // Initial grid drawing
  Object.values(plots).forEach(plot => {
    if (plot) drawGrid(plot);
  });

  // Scaling buttons
  setupScaleButtons('eeg', plots.eeg);
  setupScaleButtons('accel', plots.accel);
  setupScaleButtons('gyro', plots.gyro);

  function setupScaleButtons(type, plot) {
    if (!plot) {
      console.warn(`Plot ${type} not available, skipping scale buttons`);
      return;
    }

    const scaleUpButton = document.getElementById(`${type}ScaleUpButton`);
    const scaleDownButton = document.getElementById(`${type}ScaleDownButton`);

    if (!scaleUpButton || !scaleDownButton) {
      console.warn(`Scale buttons for ${type} not found`);
      return;
    }

    scaleUpButton.addEventListener('click', () => {
      plot.yRange /= 1.2; // Decrease range = zoom in (more sensitive)
      drawGrid(plot);
    });

    scaleDownButton.addEventListener('click', () => {
      plot.yRange *= 1.2; // Increase range = zoom out (less sensitive)
      drawGrid(plot);
    });
  }

  // Debug: Check if all elements are found
  console.log('DOM Elements found:');
  console.log('connectButton:', connectButton);
  console.log('loadDataButton:', loadDataButton);
  console.log('fileInput:', fileInput);
  console.log('navigationControls:', navigationControls);
  console.log('plots:', plots);

  if (!connectButton) {
    console.error('Connect button not found!');
  }
  if (!loadDataButton) {
    console.error('Load data button not found!');
  }
  if (!fileInput) {
    console.error('File input not found!');
  }
  if (!plots.eeg) {
    console.error('EEG plot setup failed!');
  }
  if (!plots.accel) {
    console.error('Accel plot setup failed!');
  }
  if (!plots.gyro) {
    console.error('Gyro plot setup failed!');
  }

  // Logging function
  function log(text) {
    const timestamp = '[' + new Date().toJSON().substr(11, 8) + '] ';
    logOutput.textContent = timestamp + text;
    console.log(timestamp + text);
  }

  // Status update function
  function updateConnectionStatus(status) {
    connectionStatus.textContent = status;
    connectionStatus.className = status.toLowerCase().replace(' ', '');
  }

  // Data loading and navigation functions
  async function loadCSVData(file) {
    try {
      const text = await file.text();
      const lines = text.split('\n');
      const headers = lines[0].split(',');
      
      // Find column indices
      const timestampIndex = headers.findIndex(h => h.trim().toLowerCase().includes('timestamp'));
      const eegStartIndex = headers.findIndex(h => h.includes('EEG_Ch1'));
      const accelXIndex = headers.findIndex(h => h.includes('Accel_X'));
      const gyroXIndex = headers.findIndex(h => h.includes('Gyro_X'));
      
      if (timestampIndex === -1 || eegStartIndex === -1) {
        alert('Invalid CSV format. Missing required columns.');
        return;
      }
      
      const parsedData = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = line.split(',');
        if (values.length < headers.length) continue;
        
        // Parse EEG data
        const eegSamples = [];
        for (let j = 0; j < numEEGChannels; j++) {
          const value = parseFloat(values[eegStartIndex + j]);
          eegSamples.push(isNaN(value) ? 0 : value);
        }
        
        // Parse IMU data
        let imuData = {
          accel: { x: 0, y: 0, z: 0, magnitude: 0 },
          gyro: { x: 0, y: 0, z: 0 },
          temperature: 0,
          deviceStatus: 0,
          deviceTimestamp: 0,
          packetIndex: 0,
          commandTimestamp: 0,
          incomingCommand: 0
        };
        
        if (accelXIndex !== -1) {
          imuData.accel.x = parseFloat(values[accelXIndex]) || 0;
          imuData.accel.y = parseFloat(values[accelXIndex + 1]) || 0;
          imuData.accel.z = parseFloat(values[accelXIndex + 2]) || 0;
          imuData.accel.magnitude = parseFloat(values[accelXIndex + 3]) || 0;
        }
        
        if (gyroXIndex !== -1) {
          imuData.gyro.x = parseFloat(values[gyroXIndex]) || 0;
          imuData.gyro.y = parseFloat(values[gyroXIndex + 1]) || 0;
          imuData.gyro.z = parseFloat(values[gyroXIndex + 2]) || 0;
        }
        
        // Parse additional IMU fields if available
        const tempIndex = headers.findIndex(h => h.includes('Temperature'));
        if (tempIndex !== -1) {
          imuData.temperature = parseFloat(values[tempIndex]) || 0;
        }
        
        parsedData.push({
          timestamp: values[timestampIndex],
          eegSamples: eegSamples,
          imuData: imuData
        });
      }
      
      if (parsedData.length === 0) {
        alert('No valid data found in CSV file.');
        return;
      }
      
      loadedData = parsedData;
      maxTimeIndex = (loadedData.length - 1) / sps;
      currentTimeIndex = 0;
      
      switchToPlaybackMode();
      
      log(`Loaded ${loadedData.length} data points (${maxTimeIndex.toFixed(1)}s)`);
      
    } catch (error) {
      console.error('Error loading CSV:', error);
      alert('Error loading CSV file: ' + error.message);
    }
  }

  function navigateData(deltaSeconds) {
    if (!isPlaybackMode || !loadedData) return;
    
    currentTimeIndex += deltaSeconds;
    currentTimeIndex = Math.max(0, Math.min(currentTimeIndex, maxTimeIndex - 15));
    
    updateTimeDisplay();
  }

  function updateTimeDisplay() {
    if (timeDisplay) {
      timeDisplay.textContent = `${currentTimeIndex.toFixed(1)}s / ${maxTimeIndex.toFixed(1)}s`;
    }
  }

  function switchToPlaybackMode() {
    isPlaybackMode = true;
    navigationControls.style.display = 'block';
    
    // Disable live controls
    connectButton.disabled = true;
    disconnectButton.disabled = true;
    
    updateTimeDisplay();
    log('Switched to playback mode');
  }

  function switchToLiveMode() {
    isPlaybackMode = false;
    navigationControls.style.display = 'none';
    
    // Re-enable live controls
    connectButton.disabled = false;
    disconnectButton.disabled = !bluetoothDevice || !bluetoothDevice.gatt.connected;
    
    log('Switched to live mode');
  }

  // Exponential backoff for reconnection
  function exponentialBackoff(max, delay, toTry, success, fail) {
    toTry().then(result => success(result))
    .catch(_ => {
      if (max === 0) {
        return fail();
      }
      log('Retrying in ' + delay + 's... (' + max + ' tries left)');
      setTimeout(function() {
        exponentialBackoff(--max, delay * 2, toTry, success, fail);
      }, delay * 1000);
    });
  }

  async function connectBLE() {
    if (isConnecting) return;
    
    try {
      if (!bluetoothDevice) {
        log('Requesting Bluetooth Device...');
        updateConnectionStatus('Connecting');
        bluetoothDevice = await navigator.bluetooth.requestDevice({
          filters: [{ services: ['8badf00d-1212-efde-1523-785feabcd123'] }],
        });
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
      }
      
      connect();
    } catch (error) {
      log('Failed to request device: ' + error);
      updateConnectionStatus('Disconnected');
      isConnecting = false;
    }
  }

  function connect() {
    isConnecting = true;
    updateConnectionStatus('Connecting');
    
    exponentialBackoff(3, 2,
      function toTry() {
        log('Connecting to Bluetooth Device...');
        return bluetoothDevice.gatt.connect();
      },
      async function success(server) {
        try {
          bleServer = server;
          log('Getting Service...');
          const service = await bleServer.getPrimaryService('8badf00d-1212-efde-1523-785feabcd123');
          
          log('Getting Characteristic...');
          bleCharacteristic = await service.getCharacteristic('8badf00d-1212-efde-1524-785feabcd123');
          
          await bleCharacteristic.startNotifications();
          bleCharacteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
          
          connectButton.disabled = true;
          disconnectButton.disabled = false;
          downloadButton.disabled = true;
          updateConnectionStatus('Connected');
          log('Connected and notifications started.');
          
          recordedData = [];
          isConnecting = false;
        } catch (error) {
          log('Failed to setup service: ' + error);
          onDisconnected();
        }
      },
      function fail() {
        log('Failed to reconnect after multiple attempts.');
        updateConnectionStatus('Disconnected');
        isConnecting = false;
      }
    );
  }

  function onDisconnected() {
    log('Bluetooth Device disconnected');
    updateConnectionStatus('Disconnected');
    
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    downloadButton.disabled = recordedData.length === 0;
    
    if (bleCharacteristic) {
      bleCharacteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
    }
    
    // Auto-reconnect if device is still available and we're not manually disconnecting
    if (bluetoothDevice && bluetoothDevice.gatt && !isConnecting) {
      setTimeout(() => {
        if (!isConnecting) {
          log('Attempting to reconnect...');
          connect();
        }
      }, 2000);
    }
  }

  function disconnectBLE() {
    isConnecting = false;
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
      bluetoothDevice.gatt.disconnect();
      log('Device manually disconnected.');
      
      if (bleCharacteristic) {
        bleCharacteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
      }
      
      disconnectButton.disabled = true;
      connectButton.disabled = false;
      downloadButton.disabled = recordedData.length === 0;
      updateConnectionStatus('Disconnected');
    }
  }

  function handleCharacteristicValueChanged(event) {
    const dataView = event.target.value;
    processData(dataView);
  }

  function updateFilterSettings() {
    const useNotch = notchFilterCheckbox.checked;
    const notchBandwidth = parseFloat(notchBandwidthInput.value);
    const useBandpass = bandpassFilterCheckbox.checked;
    const bandpassLower = parseFloat(bandpassLowerInput.value);
    const bandpassUpper = parseFloat(bandpassUpperInput.value);

    for (let ch = 0; ch < numEEGChannels; ch++) {
      const filter = plots.eeg.filters[ch];
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

  function processData(dataView) {
    // Convert DataView to Uint8Array
    const data = new Uint8Array(dataView.buffer);

    // Get the current timestamp
    const timestamp = new Date();

    // Constants
    const microvoltPerADCtick = (2420000 * 2) / 12 / (Math.pow(2, 24) - 1);

    // Process EEG data (first 135 bytes)
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

      // Parse IMU data from the packet (based on MATLAB code)
      let imuData = {};
      
      // Accelerometer data (bytes 136-141, little endian as per MATLAB)
      const accelX = typecastInt16([data[136], data[137]]); // Little endian: LSB first
      const accelY = typecastInt16([data[138], data[139]]);
      const accelZ = typecastInt16([data[140], data[141]]);
      
      // Calculate magnitude like in MATLAB
      const accelMagnitude = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
      
      // Gyroscope data (bytes 142-147, little endian as per MATLAB)
      const gyroX = typecastInt16([data[142], data[143]]); // Little endian: LSB first
      const gyroY = typecastInt16([data[144], data[145]]);
      const gyroZ = typecastInt16([data[146], data[147]]);
      
      // Temperature (bytes 148-149, little endian as per MATLAB)
      const temperature = typecastInt16([data[148], data[149]]) / 256 + 25;
      
      // Device status (byte 150, as per MATLAB: deviceStatus=data(150))
      const deviceStatus = data[150];
      
      // Device timestamp (bytes 151-154, big endian as per MATLAB)
      const deviceTimestamp = typecastUint32BigEndian([data[151], data[152], data[153], data[154]]);
      
      // Packet index (byte 155, as per MATLAB: packetIndex=data(155))
      const packetIndex = data[155];
      
      // Command timestamp (bytes 156-159, big endian as per MATLAB)
      const commandTimestamp = typecastUint32BigEndian([data[156], data[157], data[158], data[159]]);
      
      // Incoming command (byte 160, as per MATLAB: incomingCommand=data(160))
      const incomingCommand = data[160];

      imuData = {
        accel: { x: accelX, y: accelY, z: accelZ, magnitude: accelMagnitude },
        gyro: { x: gyroX, y: gyroY, z: gyroZ },
        temperature,
        deviceStatus,
        deviceTimestamp,
        packetIndex,
        commandTimestamp,
        incomingCommand
      };

      // Store RAW data (unfiltered) for CSV export
      recordedData.push({
        timestamp: timestamp.toISOString(),
        eegSamples: sample.slice(1, numEEGChannels + 1), // Exclude metadata at index 0
        imuData: imuData
      });

      // Update EEG data buffers for DISPLAY (store raw data, filter applied during visualization)
      for (let ch = 0; ch < numEEGChannels; ch++) {
        const channelData = plots.eeg.dataBuffers[ch];
        
        // Shift data left
        channelData.copyWithin(0, 1);
        
        // Store RAW data - filtering now happens during visualization
        let rawValue = sample[ch + 1]; // sample[0] is metadata
        
        // Append new raw data
        channelData[channelData.length - 1] = rawValue;
      }

      // Update Accelerometer data buffers
      const accelValues = [accelX, accelY, accelZ, accelMagnitude];
      for (let ch = 0; ch < numAccelChannels; ch++) {
        const channelData = plots.accel.dataBuffers[ch];
        channelData.copyWithin(0, 1);
        channelData[channelData.length - 1] = accelValues[ch];
      }

      // Update Gyroscope data buffers
      const gyroValues = [gyroX, gyroY, gyroZ];
      for (let ch = 0; ch < numGyroChannels; ch++) {
        const channelData = plots.gyro.dataBuffers[ch];
        channelData.copyWithin(0, 1);
        channelData[channelData.length - 1] = gyroValues[ch];
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

  // Helper function to convert 2 bytes into a signed 16-bit integer
  function typecastInt16(bytes) {
    // bytes[0]: LSB, bytes[1]: MSB
    let value = (bytes[1] << 8) | bytes[0];
    // Sign correction
    if (value & 0x8000) {
      value |= 0xFFFF0000;
    }
    return value;
  }

  // Helper function to convert 4 bytes into an unsigned 32-bit integer (big endian)
  function typecastUint32BigEndian(bytes) {
    // bytes[0]: MSB, bytes[3]: LSB (big endian)
    return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  }

  // Helper function to convert 4 bytes into an unsigned 32-bit integer (little endian)
  function typecastUint32(bytes) {
    // bytes[0]: LSB, bytes[3]: MSB (little endian)
    return (bytes[3] << 24) | (bytes[2] << 16) | (bytes[1] << 8) | bytes[0];
  }

  // Function to convert recorded data to CSV
  function convertDataToCSV(data) {
    // Create CSV header
    let csvContent = 'Timestamp';

    // Add EEG channel headers
    for (let i = 0; i < numEEGChannels; i++) {
      csvContent += `,EEG_Ch${i + 1}`;
    }

    // Add IMU headers
    csvContent += ',Accel_X,Accel_Y,Accel_Z,Accel_Magnitude';
    csvContent += ',Gyro_X,Gyro_Y,Gyro_Z';
    csvContent += ',Temperature,DeviceStatus,DeviceTimestamp,PacketIndex,CommandTimestamp,IncomingCommand';
    csvContent += '\n';

    // Add data rows
    data.forEach(entry => {
      let row = `${entry.timestamp}`;
      
      // Add EEG samples
      entry.eegSamples.forEach(value => {
        row += `,${value}`;
      });
      
      // Add IMU data
      row += `,${entry.imuData.accel.x},${entry.imuData.accel.y},${entry.imuData.accel.z},${entry.imuData.accel.magnitude}`;
      row += `,${entry.imuData.gyro.x},${entry.imuData.gyro.y},${entry.imuData.gyro.z}`;
      row += `,${entry.imuData.temperature},${entry.imuData.deviceStatus},${entry.imuData.deviceTimestamp}`;
      row += `,${entry.imuData.packetIndex},${entry.imuData.commandTimestamp},${entry.imuData.incomingCommand}`;
      
      csvContent += row + '\n';
    });

    return csvContent;
  }

  // Function to draw grid lines and labels
  function drawGrid(plot) {
    if (!plot) return;
    
    // Clear the canvas
    plot.labelCtx.clearRect(0, 0, plot.labelCanvas.width, plot.labelCanvas.height);

    // Set styles
    plot.labelCtx.strokeStyle = '#444'; // Grid line color
    plot.labelCtx.lineWidth = 1;
    plot.labelCtx.font = '12px Arial';
    plot.labelCtx.fillStyle = '#fff'; // Text color

    // Draw vertical lines every 1 second
    const totalTime = numPoints / sps; // Total time in seconds
    const pixelsPerSecond = plot.labelCanvas.width / totalTime;

    for (let t = 0; t <= totalTime; t += 1) {
      const x = ((totalTime - t) / totalTime) * plot.labelCanvas.width;
      plot.labelCtx.beginPath();
      plot.labelCtx.moveTo(x, 0);
      plot.labelCtx.lineTo(x, plot.labelCanvas.height);
      plot.labelCtx.stroke();

      // Time labels every 2 seconds to avoid overlap
      if (t % 2 === 0) {
        plot.labelCtx.fillText(`${t}s`, x + 2, plot.labelCanvas.height - 2);
      }
    }

    // Draw y-axis labels for each channel with FIXED baseline positions
    const verticalMargin = 0.1;
    const verticalRange = 2 - 2 * verticalMargin;
    
    for (let i = 0; i < plot.numChannels; i++) {
      // Fixed baseline positions - same as in display functions
      const offsetY = ((plot.numChannels - i - 0.5) / plot.numChannels) * verticalRange - (verticalRange / 2);
      const y = ((-offsetY + verticalRange / 2) / verticalRange) * plot.labelCanvas.height;

      // Draw horizontal line at center of each channel (baseline)
      plot.labelCtx.strokeStyle = '#666';
      plot.labelCtx.beginPath();
      plot.labelCtx.moveTo(0, y);
      plot.labelCtx.lineTo(plot.labelCanvas.width, y);
      plot.labelCtx.stroke();

      // Draw y-axis labels showing the FULL scale range
      plot.labelCtx.fillStyle = '#fff';
      let yLabel;
      
      if (plot.type === 'EEG') {
        // Show the full range that can be displayed around the baseline
        const fullRangeµV = plot.yRange * 1e6; // Convert to µV
        yLabel = `Ch${i + 1} ±${(fullRangeµV).toFixed(0)}µV`;
      } else if (plot.type === 'Accel') {
        const labels = ['X', 'Y', 'Z', 'Mag'];
        const fullRange = plot.yRange;
        yLabel = `${labels[i]} ±${(fullRange).toFixed(0)}`;
      } else if (plot.type === 'Gyro') {
        const labels = ['X', 'Y', 'Z'];
        const fullRange = plot.yRange;
        yLabel = `${labels[i]} ±${(fullRange).toFixed(0)}`;
      }
      
      plot.labelCtx.fillText(yLabel, 2, y - 5);
    }
  }

  // Event listeners
  connectButton.addEventListener('click', () => {
    console.log('Connect button clicked');
    connectBLE();
  });

  disconnectButton.addEventListener('click', () => {
    console.log('Disconnect button clicked');
    disconnectBLE();
  });

  downloadButton.addEventListener('click', () => {
    console.log('Download button clicked');
    if (recordedData.length > 0) {
      const csvContent = convertDataToCSV(recordedData);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.setAttribute('download', `eeg_imu_data_${new Date().toISOString()}.csv`);
      downloadLink.click();
      URL.revokeObjectURL(url);
      recordedData = [];
      downloadButton.disabled = true;
    } else {
      alert('No data available to download.');
    }
  });

  loadDataButton.addEventListener('click', () => {
    console.log('Load data button clicked');
    fileInput.click();
  });

  fileInput.addEventListener('change', (event) => {
    console.log('File input changed');
    const file = event.target.files[0];
    if (file) {
      console.log('Loading file:', file.name);
      loadCSVData(file);
    }
  });

  // Navigation event listeners
  if (prevPageButton) prevPageButton.addEventListener('click', () => navigateData(-15));
  if (prevSecButton) prevSecButton.addEventListener('click', () => navigateData(-1));
  if (nextSecButton) nextSecButton.addEventListener('click', () => navigateData(1));
  if (nextPageButton) nextPageButton.addEventListener('click', () => navigateData(15));
  if (backToLiveButton) backToLiveButton.addEventListener('click', () => switchToLiveMode());

  // Event listeners for filter controls
  notchFilterCheckbox.addEventListener('change', updateFilterSettings);
  notchBandwidthInput.addEventListener('change', updateFilterSettings);
  bandpassFilterCheckbox.addEventListener('change', updateFilterSettings);
  bandpassLowerInput.addEventListener('change', updateFilterSettings);
  bandpassUpperInput.addEventListener('change', updateFilterSettings);

  // Keyboard navigation
  document.addEventListener('keydown', (event) => {
    if (!isPlaybackMode) return;
    
    switch(event.key) {
      case 'ArrowLeft':
        navigateData(-15);
        event.preventDefault();
        break;
      case 'ArrowRight':
        navigateData(15);
        event.preventDefault();
        break;
      case 'ArrowUp':
        navigateData(-1);
        event.preventDefault();
        break;
      case 'ArrowDown':
        navigateData(1);
        event.preventDefault();
        break;
    }
  });

});
