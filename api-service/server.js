// Connection timing tracking
let disconnectTimestamp = null;
let reconnectTimestamp = null;
let monitoringInterval = null;

// Health status tracking for squid proxy and relay proxy
let squidProxyHealthy = false;
let relayProxyHealthy = false;

// Helper function to monitor Relay Proxy connection state changes
async function monitorRelayProxyConnectionState(action, startTime) {
  const relayProxyUrl = process.env.RELAY_PROXY_URL || 'http://relay-proxy:8030';
  let lastState = null;
  let checkCount = 0;
  const maxChecks = action === 'disconnect' ? 180 : 120; // 6 minutes for disconnect, 4 minutes for reconnect

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      checkCount++;

      try {
        const response = await fetchWithTimeout(`${relayProxyUrl}/status`, {}, 3000);
        const data = await response.json();

        // Check environment connection state
        let currentState = 'unknown';
        if (data.environments) {
          const envKeys = Object.keys(data.environments);
          if (envKeys.length > 0) {
            const env = data.environments[envKeys[0]];
            if (env.connectionStatus) {
              currentState = env.connectionStatus.state;
            }
          }
        }

        // Detect state change
        if (lastState && lastState !== currentState) {
          const elapsed = Date.now() - startTime;

          if (action === 'disconnect' && currentState === 'INTERRUPTED') {
            console.log(`[TIMING] Relay Proxy detected disconnection after ${(elapsed / 1000).toFixed(2)} seconds`);
            console.log(`[TIMING] State changed from ${lastState} to ${currentState}`);
            console.log(`[CONNECTION STATE] Relay Proxy is now DISCONNECTED - ready to test disconnected behavior`);
            clearInterval(interval);
            resolve({ detected: true, elapsed, state: currentState });
            return;
          } else if (action === 'reconnect' && currentState === 'VALID') {
            console.log(`[TIMING] Relay Proxy successfully reconnected after ${(elapsed / 1000).toFixed(2)} seconds`);
            console.log(`[TIMING] State changed from ${lastState} to ${currentState}`);
            console.log(`[CONNECTION STATE] Relay Proxy is now CONNECTED - ready to test connected behavior`);
            clearInterval(interval);
            resolve({ detected: true, elapsed, state: currentState });
            return;
          }
        }

        lastState = currentState;

        // Timeout after max checks
        if (checkCount >= maxChecks) {
          const elapsed = Date.now() - startTime;
          console.log(`[TIMING] Monitoring timeout after ${(elapsed / 1000).toFixed(2)} seconds. Last state: ${currentState}`);
          console.log(`[TIMING] Note: LaunchDarkly streaming connections can take 3-5 minutes to detect disconnection`);
          clearInterval(interval);
          resolve({ detected: false, elapsed, state: currentState, timeout: true });
        }
      } catch (error) {
        // Connection errors are expected during disconnect
        if (action === 'disconnect' && checkCount > 5) {
          // If we can't reach the status endpoint after a few checks, connection is likely down
          const elapsed = Date.now() - startTime;
          console.log(`[TIMING] Relay Proxy status endpoint unreachable after ${(elapsed / 1000).toFixed(2)} seconds (connection likely down)`);
          clearInterval(interval);
          resolve({ detected: true, elapsed, state: 'unreachable' });
        }
      }
    }, 2000); // Check every 2 seconds
  });
}

// Simple timer-based state transition function
// Instead of polling the status endpoint, we simply wait 60 seconds for the connection
// to truly change state, then update the state managers
async function startStateTransitionTimer(action, startTime, operationElapsed) {
  const targetConnectionState = action === 'disconnect' ? 'disconnected' : 'connected';
  const transitionTime = 60000; // 60 seconds - the actual time it takes for traffic to stop/start flowing
  
  console.log(`[STATE_TRANSITION] Starting ${transitionTime / 1000}s timer for ${action} action`);
  console.log(`[STATE_TRANSITION] Dashboard will show transitioning state ("${action === 'disconnect' ? 'Disconnecting' : 'Reconnecting'}...") for ${transitionTime / 1000}s`);
  
  setTimeout(() => {
    const totalElapsed = Date.now() - startTime;
    
    console.log(`[STATE_TRANSITION] === ${action.toUpperCase()} COMPLETE ===`);
    console.log(`[STATE_TRANSITION] ${transitionTime / 1000}s transition time elapsed`);
    console.log(`[STATE_TRANSITION] Total time since action initiated: ${(totalElapsed / 1000).toFixed(2)}s`);
    
    // Update ConnectionStateManager
    stateManager.updateState(targetConnectionState, {
      detectedFrom: `timer_based_${action}`,
      transitionTime: transitionTime,
      totalLatency: totalElapsed,
      operationElapsed: operationElapsed
    });
    
    console.log(`[STATE_TRANSITION] Updated ConnectionStateManager to '${targetConnectionState}'`);
    
    // Complete the control action (re-enables toggle) - only if not already completed
    // For reconnect, this is completed earlier when relay proxy becomes healthy
    if (controlManager.getPendingAction() !== null) {
      controlManager.completeAction();
      console.log(`[STATE_TRANSITION] Called ControlStateManager.completeAction() - toggle re-enabled`);
    }
    
    console.log(`[STATE_TRANSITION] Dashboard will now display "${targetConnectionState}" status`);
  }, transitionTime);
}

const express = require('express');
const cors = require('cors');
const dns = require('dns').promises;
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);
const app = express();

// Import monitoring components
const LogMonitor = require('./src/monitoring/LogMonitor');
const LogPatternParser = require('./src/monitoring/LogPatternParser');
const ConnectionStateManager = require('./src/monitoring/ConnectionStateManager');
const ControlStateManager = require('./src/monitoring/ControlStateManager');

// Import Docker control functions
const { stopSquidProxy, startSquidProxy, getSquidProxyStatus } = require('./src/docker/squidProxyControl');
const { stopRelayPortProxy, startRelayPortProxy, getRelayPortProxyStatus } = require('./src/docker/relayPortProxyControl');

// Instantiate monitoring components
const logMonitor = new LogMonitor('relay-proxy');
const logParser = new LogPatternParser();
const stateManager = new ConnectionStateManager();
const controlManager = new ControlStateManager();

// Initialize connection state detection
// This queries the relay proxy status endpoint to detect initial state
// when the relay proxy is already in a stable state at startup
stateManager.initialize()
  .then(() => {
    console.log('[ConnectionStateManager] Initialization complete');
  })
  .catch((error) => {
    console.warn(`[ConnectionStateManager] Initialization failed: ${error.message}`);
    // Don't block server startup - log pattern detection will serve as fallback
  });

// Wire up event handlers between components
// LogMonitor -> LogPatternParser
logMonitor.on('log_line', (event) => {
  logParser.parseLine(event.line);
});

// LogPatternParser -> ConnectionStateManager
logParser.on('connection_detected', (event) => {
  // Log connection detection with structured logging
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    component: 'LogPatternParser',
    event: 'connection_detected',
    pattern: event.pattern,
    logLine: event.line,
    message: 'Connection pattern detected in relay proxy logs'
  }));
  
  stateManager.updateState('connected', {
    detectedFrom: 'log_pattern',
    logLine: event.line,
    detectionLatency: controlManager.actionStartTime 
      ? Date.now() - controlManager.actionStartTime 
      : null
  });
});

logParser.on('disconnection_detected', (event) => {
  // Log disconnection detection with structured logging
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    component: 'LogPatternParser',
    event: 'disconnection_detected',
    pattern: event.pattern,
    logLine: event.line,
    message: 'Disconnection pattern detected in relay proxy logs'
  }));
  
  stateManager.updateState('disconnected', {
    detectedFrom: 'log_pattern',
    logLine: event.line,
    detectionLatency: controlManager.actionStartTime 
      ? Date.now() - controlManager.actionStartTime 
      : null
  });
});

// ConnectionStateManager -> ControlStateManager
stateManager.on('state_changed', (event) => {
  // Log state change with structured logging
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    component: 'ConnectionStateManager',
    event: 'state_changed',
    previousState: event.previousState,
    newState: event.newState,
    message: `Connection state changed: ${event.previousState} -> ${event.newState}`
  }));
  
  // Complete the pending action when state changes
  controlManager.completeAction();
});

// Error handling for monitoring components with structured logging

// LogMonitor error handler - handles Docker socket, container not found, and process errors
logMonitor.on('error', (errorEvent) => {
  const { error, context, containerName, exitCode } = errorEvent;
  
  // Structured error logging
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    component: 'LogMonitor',
    context: context,
    containerName: containerName,
    exitCode: exitCode,
    error: error.message,
    stack: error.stack
  }));
  
  // Provide user-friendly context-specific messages
  if (context === 'container_not_found') {
    console.error(`[LogMonitor] Container '${containerName}' not found. Monitoring stopped.`);
  } else if (context === 'docker_daemon_error') {
    console.error(`[LogMonitor] Docker daemon error. Check Docker socket access.`);
  } else if (context === 'process_spawn') {
    console.error(`[LogMonitor] Failed to spawn Docker logs process. Docker may not be available.`);
  } else if (context === 'restart_failed') {
    console.error(`[LogMonitor] Max restart attempts reached. Manual intervention required.`);
  }
});

// LogMonitor stopped event handler
logMonitor.on('stopped', (event) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    component: 'LogMonitor',
    event: 'stopped',
    reason: event.reason
  }));
});

// LogPatternParser warning handler - handles unrecognized patterns
logParser.on('unknown_pattern', (event) => {
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'WARN',
    component: 'LogPatternParser',
    event: 'unknown_pattern',
    signature: event.signature,
    count: event.count,
    message: event.message,
    fullLine: event.fullLine
  }));
  
  console.warn(`[LogPatternParser] Frequent unrecognized pattern detected (${event.count} occurrences): "${event.signature}..."`);
  console.warn(`[LogPatternParser] Consider adding this pattern to known connection/disconnection patterns.`);
});

// ControlStateManager timeout handler - handles action timeouts
controlManager.on('action_timeout', (event) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    component: 'ControlStateManager',
    event: 'action_timeout',
    action: event.action,
    timeout: event.timeout,
    message: `Action '${event.action}' timed out after ${event.timeout}ms without state confirmation`
  }));
  
  console.error(`[ControlStateManager] Action '${event.action}' timed out after ${event.timeout / 1000} seconds.`);
  console.error(`[ControlStateManager] No state change confirmation received from log monitoring.`);
  console.error(`[ControlStateManager] Toggle control has been re-enabled. User can retry the action.`);
});

// ControlStateManager control state change handlers
controlManager.on('control_disabled', (event) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    component: 'ControlStateManager',
    event: 'control_disabled',
    action: event.action,
    message: `Toggle control disabled for action: ${event.action}`
  }));
});

controlManager.on('control_enabled', (event) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    component: 'ControlStateManager',
    event: 'control_enabled',
    completedAction: event.completedAction,
    latency: event.latency,
    reason: event.reason,
    message: event.completedAction 
      ? `Toggle control enabled after completing action: ${event.completedAction} (latency: ${event.latency}ms)`
      : `Toggle control enabled (reason: ${event.reason})`
  }));
});

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  // Check if it's a fetch termination error (common when connections are closed)
  if (reason && reason.message && (reason.message.includes('terminated') || reason.message.includes('Body Timeout'))) {
    // Silently handle fetch termination errors - these are expected when connections close
    console.warn('Fetch connection terminated (expected behavior):', reason.message);
    return;
  }
  
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  // Check if it's a fetch termination error
  if (error.message && (error.message.includes('terminated') || error.message.includes('Body Timeout'))) {
    // Silently handle fetch termination errors
    console.warn('Fetch connection terminated (expected behavior):', error.message);
    return;
  }
  
  console.error('Uncaught Exception:', error);
  
  // Only exit for truly fatal errors (port binding, etc.)
  // Don't exit for network issues or fetch errors
  if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
    console.error('Fatal error, exiting...');
    process.exit(1);
  } else {
    console.warn('Non-fatal error caught, continuing operation...');
  }
});

// Helper function for structured error logging
function logError(endpoint, error, context = {}) {
  const timestamp = new Date().toISOString();
  console.error(JSON.stringify({
    timestamp,
    level: 'ERROR',
    endpoint,
    error: error.message,
    stack: error.stack,
    ...context
  }));
}


// Helper function to check if container is running
async function checkContainerRunning(containerName) {
  try {
    const { stdout } = await execPromise(
      `docker inspect -f '{{.State.Running}}' ${containerName}`
    );
    return stdout.trim() === 'true';
  } catch (error) {
    // If container doesn't exist or any other error occurs, return false
    return false;
  }
}







// Helper function to fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  // Add custom User-Agent header to identify API service
  const headers = {
    'User-Agent': 'api-service/1.0',
    ...options.headers
  };
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

// Middleware
app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests from dashboard (port 8000) or no origin (same-origin)
    const allowedOrigins = ['http://localhost:8000', 'http://127.0.0.1:8000'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Real-time Relay Proxy connection state endpoint
// This endpoint checks the ACTUAL connection state by examining the squid proxy status
app.get('/api/relay-proxy/actual-connection-state', async (req, res) => {
  try {
    const status = await getSquidProxyStatus();
    
    return res.status(200).json({
      success: true,
      manuallyDisconnected: !status.running,
      state: status.state,
      method: 'squid-proxy',
      relayProxyRunning: relayProxyHealthy  // Add relay proxy running status
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      state: 'unknown',
      relayProxyRunning: false
    });
  }
});

// Relay Proxy status endpoint
app.get('/api/relay-status', async (req, res) => {
  const relayProxyUrl = process.env.RELAY_PROXY_URL || 'http://relay-proxy:8030';
  
  try {
    const response = await fetchWithTimeout(
      `${relayProxyUrl}/status`,
      {},
      5000
    );
    
    if (!response.ok) {
      return res.status(response.status).json({
        error: `Relay proxy returned ${response.status}`,
        connected: false
      });
    }
    
    const data = await response.json();
    
    // Additionally check if Redis is actually available
    // The relay proxy status shows cached state, not real-time Redis connectivity
    let redisAvailable = false;
    try {
      const { stdout } = await execPromise('docker exec redis redis-cli ping');
      redisAvailable = stdout.trim() === 'PONG';
    } catch (error) {
      // Redis is not responding
      redisAvailable = false;
    }
    
    // If Redis is down, update the status to reflect this
    if (!redisAvailable && data.environments) {
      // Mark all data stores as degraded
      Object.keys(data.environments).forEach(envKey => {
        const env = data.environments[envKey];
        if (env.dataStoreStatus) {
          env.dataStoreStatus.state = 'INTERRUPTED';
          env.dataStoreStatus.error = 'Redis connection unavailable';
        }
      });
      
      // Update overall status to degraded
      data.status = 'degraded';
      data.redisAvailable = false;
    } else {
      data.redisAvailable = true;
    }
    
    res.json({ ...data, connected: true });
  } catch (error) {
    logError('/api/relay-status', error, {
      upstreamUrl: `${relayProxyUrl}/status`
    });
    res.status(500).json({
      error: error.message,
      connected: false
    });
  }
});

// Redis status endpoint
app.get('/api/redis/status', async (req, res) => {
  try {
    // First check if container is running
    const { stdout: inspectOutput } = await execPromise('docker inspect -f "{{.State.Running}}" redis 2>&1');
    const isRunning = inspectOutput.trim() === 'true';
    
    if (!isRunning) {
      return res.json({
        connected: false,
        running: false,
        status: 'stopped'
      });
    }
    
    // If running, check if Redis is responding
    const { stdout, stderr } = await execPromise('docker exec redis redis-cli ping');
    const output = stdout.trim();
    
    if (output === 'PONG') {
      res.json({
        connected: true,
        running: true,
        status: 'healthy'
      });
    } else {
      res.json({
        connected: false,
        running: true,
        status: 'unhealthy',
        error: `Unexpected response: ${output}`
      });
    }
  } catch (error) {
    logError('/api/redis/status', error, {
      command: 'docker inspect/exec redis'
    });
    res.status(500).json({
      connected: false,
      running: false,
      error: error.message
    });
  }
});

// Redis start endpoint
app.post('/api/redis/start', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker start redis');
    res.json({
      success: true,
      message: 'Redis container started successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/redis/start', error, {
      command: 'docker start redis'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Redis stop endpoint
app.post('/api/redis/stop', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker stop redis');
    res.json({
      success: true,
      message: 'Redis container stopped successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/redis/stop', error, {
      command: 'docker stop redis'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Redis restart endpoint
app.post('/api/redis/restart', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker restart redis');
    res.json({
      success: true,
      message: 'Redis container restarted successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/redis/restart', error, {
      command: 'docker restart redis'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Redis data store endpoint - fetch LaunchDarkly flags from Redis
app.post('/api/redis/data-store', async (req, res) => {
  try {
    // First check if Redis is running
    const { stdout: pingOutput } = await execPromise('docker exec redis redis-cli ping 2>&1');
    if (pingOutput.trim() !== 'PONG') {
      return res.status(500).json({
        success: false,
        error: 'Redis is not responding'
      });
    }
    
    // Prefer configured prefix (PHP/REDIS_PREFIX) or client-side ID env, else all prefixes
    const configuredPrefix = process.env.REDIS_PREFIX || '';
    const clientSideId = process.env.LAUNCHDARKLY_CLIENT_SIDE_ID || '';
    const preferredKey = configuredPrefix
      ? `${configuredPrefix}:features`
      : (clientSideId ? `ld-flags-${clientSideId}:features` : null);

    const { stdout: keysOutput } = await execPromise('docker exec redis redis-cli --scan --pattern "ld-flags-*:features"');
    let keys = keysOutput.trim().split('\n').filter(k => k.trim());

    if (preferredKey && keys.includes(preferredKey)) {
      keys = [preferredKey];
    } else if (preferredKey) {
      // Preferred key may exist even if scan raced empty — try it explicitly
      keys = [preferredKey];
    }
    
    if (keys.length === 0) {
      return res.json({
        success: true,
        flags: {},
        message: 'No flags found in Redis'
      });
    }
    
    // For each key, get the hash values (LaunchDarkly stores flags as Redis hashes)
    const flags = {};
    
    for (const key of keys) {
      try {
        // Use HGETALL to get all fields from the hash
        const { stdout: hashOutput } = await execPromise(`docker exec redis redis-cli HGETALL "${key}"`);
        const lines = hashOutput.trim().split('\n').filter(Boolean);
        
        // Parse hash output (alternating field/value pairs)
        for (let i = 0; i < lines.length; i += 2) {
          const flagKey = lines[i];
          const flagValue = lines[i + 1];
          
          if (flagKey && flagValue) {
            try {
              flags[flagKey] = JSON.parse(flagValue);
            } catch (error) {
              console.error(`Error parsing flag ${flagKey}:`, error.message);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching hash from key ${key}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      flags: flags,
      keyCount: keys.length,
      keys
    });
  } catch (error) {
    logError('/api/redis/data-store', error, {
      command: 'docker exec redis redis-cli'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Relay Proxy cache endpoint - fetch flags from Relay Proxy's internal cache
// This creates a temporary SDK client that connects to the Relay Proxy and retrieves
// the flag data it's serving, demonstrating consistency across all layers
let relayProxyCacheClient = null;
let relayProxyCacheData = null;
let relayProxyCacheClients = []; // SSE clients listening for cache updates

// Initialize a dedicated SDK client for inspecting Relay Proxy cache
async function initRelayProxyCacheClient() {
  if (relayProxyCacheClient) {
    return relayProxyCacheClient;
  }

  const LD = require('@launchdarkly/node-server-sdk');
  const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;
  
  if (!sdkKey) {
    throw new Error('LAUNCHDARKLY_SDK_KEY not configured');
  }

  // Create a custom feature store that captures the data
  class CaptureStore {
    constructor() {
      this.data = { flags: {}, segments: {} };
      // Mark as initialized immediately so SDK doesn't block waiting for init data
      // This allows the SDK to connect and receive streaming updates even if
      // the Relay Proxy can't serve initial data (e.g., when Redis is down)
      this.isInitialized = true;
    }

    init(allData, cb) {
      console.log('[Relay Proxy Cache] Received initial data from Relay Proxy');
      console.log('[Relay Proxy Cache] Data structure:', JSON.stringify(Object.keys(allData || {})));
      
      if (allData) {
        // The SDK passes data with 'features' and 'segments' keys
        if (allData.features) {
          this.data.flags = { ...allData.features };
          console.log('[Relay Proxy Cache] Captured', Object.keys(allData.features).length, 'flags');
        }
        if (allData.segments) {
          this.data.segments = { ...allData.segments };
          console.log('[Relay Proxy Cache] Captured', Object.keys(allData.segments).length, 'segments');
        }
      } else {
        console.log('[Relay Proxy Cache] No initial data received (Redis may be unavailable)');
      }
      
      this.isInitialized = true;
      relayProxyCacheData = { ...this.data };
      
      // Broadcast initial data to all connected SSE clients
      broadcastCacheUpdate();
      
      if (cb) cb();
      return Promise.resolve();
    }

    get(kind, key, cb) {
      const kindStr = typeof kind === 'object' ? kind.namespace : kind;
      const collection = kindStr === 'features' ? this.data.flags : this.data.segments;
      const result = collection[key] || null;
      if (cb) cb(result);
      return Promise.resolve(result);
    }

    all(kind, cb) {
      const kindStr = typeof kind === 'object' ? kind.namespace : kind;
      const collection = kindStr === 'features' ? this.data.flags : this.data.segments;
      if (cb) cb(collection);
      return Promise.resolve(collection);
    }

    upsert(kind, item, cb) {
      const kindStr = typeof kind === 'object' ? kind.namespace : kind;
      console.log(`[Relay Proxy Cache] Update received: ${kindStr}/${item.key} (kind type: ${typeof kind}, kind:`, JSON.stringify(kind), ')');
      const collection = kindStr === 'features' ? this.data.flags : this.data.segments;
      collection[item.key] = item;
      relayProxyCacheData = { ...this.data };
      
      // Broadcast update to all connected SSE clients
      broadcastCacheUpdate();
      
      if (cb) cb();
      return Promise.resolve();
    }

    initialized(cb) {
      if (cb) cb(this.isInitialized);
      return Promise.resolve(this.isInitialized);
    }

    close() {
      return Promise.resolve();
    }

    getDescription() {
      return 'Relay Proxy Cache Capture Store';
    }
  }

  const captureStore = new CaptureStore();

  relayProxyCacheClient = LD.init(sdkKey, {
    baseUri: 'http://relay-proxy:8030',
    streamUri: 'http://relay-proxy:8030',
    eventsUri: 'http://relay-proxy:8030',
    featureStore: captureStore,
    stream: true,
    sendEvents: false,
    diagnosticOptOut: true,
    // Use streaming only mode - don't require initial data from store
    // This allows the client to work even when Redis is down
    useLdd: false
  });

  try {
    await relayProxyCacheClient.waitForInitialization({ timeout: 10 });
    console.log('[Relay Proxy Cache] SDK client initialized and connected to Relay Proxy');
  } catch (error) {
    console.warn('[Relay Proxy Cache] SDK client initialization timed out (Redis may be down):', error.message);
    console.log('[Relay Proxy Cache] Will continue with streaming updates only');
    // Don't throw - allow the client to continue receiving streaming updates
    // The client will still receive updates via streaming even if initialization failed
  }
  
  return relayProxyCacheClient;
}

// Broadcast cache updates to all connected SSE clients
function broadcastCacheUpdate() {
  if (!relayProxyCacheData || relayProxyCacheClients.length === 0) {
    return;
  }
  
  const data = JSON.stringify({
    flags: relayProxyCacheData.flags,
    timestamp: Date.now()
  });
  
  console.log(`[Relay Proxy Cache] Broadcasting update to ${relayProxyCacheClients.length} clients`);
  
  // Send to all connected clients
  relayProxyCacheClients = relayProxyCacheClients.filter(client => {
    try {
      client.write(`data: ${data}\n\n`);
      return true;
    } catch (error) {
      console.log('[Relay Proxy Cache] Client disconnected');
      return false;
    }
  });
}

app.post('/api/relay-proxy/cache', async (req, res) => {
  try {
    // Initialize the client if not already done
    if (!relayProxyCacheClient) {
      await initRelayProxyCacheClient();
    }

    // Check if we have cached data
    if (!relayProxyCacheData || !relayProxyCacheData.flags) {
      return res.json({
        success: true,
        flags: {},
        message: 'Waiting for Relay Proxy to send data'
      });
    }

    // Return the captured flag data
    res.json({
      success: true,
      flags: relayProxyCacheData.flags
    });
  } catch (error) {
    logError('/api/relay-proxy/cache', error, {
      message: 'Failed to fetch Relay Proxy cache'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Relay Proxy cache SSE stream endpoint
app.get('/api/relay-proxy/cache/stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Initialize the client if not already done
    if (!relayProxyCacheClient) {
      await initRelayProxyCacheClient();
    }
    
    // Add this client to the broadcast list
    relayProxyCacheClients.push(res);
    console.log(`[Relay Proxy Cache] SSE client connected (${relayProxyCacheClients.length} total)`);
    
    // Send initial data immediately
    if (relayProxyCacheData && relayProxyCacheData.flags) {
      const data = JSON.stringify({
        flags: relayProxyCacheData.flags,
        timestamp: Date.now()
      });
      console.log(`[Relay Proxy Cache] Sending initial data to new client: ${Object.keys(relayProxyCacheData.flags).length} flags`);
      res.write(`data: ${data}\n\n`);
    } else {
      console.log('[Relay Proxy Cache] No initial data available yet');
    }
    
    // Handle client disconnect
    req.on('close', () => {
      relayProxyCacheClients = relayProxyCacheClients.filter(client => client !== res);
      console.log(`[Relay Proxy Cache] SSE client disconnected (${relayProxyCacheClients.length} remaining)`);
    });
    
  } catch (error) {
    logError('/api/relay-proxy/cache/stream', error, {
      message: 'Failed to initialize Relay Proxy cache stream'
    });
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Connection state SSE stream endpoint
app.get('/api/relay-proxy/connection-state/stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Add this client to the broadcast list
  connectionStateClients.push(res);
  console.log(`[Connection State SSE] Client connected (${connectionStateClients.length} total)`);
  
  // Send initial connection state immediately
  const initialState = {
    state: currentConnectionState,
    timestamp: new Date().toISOString(),
    method: 'squid-proxy',
    relayProxyRunning: relayProxyHealthy  // Include relay proxy running status
  };
  
  res.write(`event: connection-state-change\n`);
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  
  // Handle client disconnect
  req.on('close', () => {
    const index = connectionStateClients.indexOf(res);
    if (index > -1) {
      connectionStateClients.splice(index, 1);
    }
    console.log(`[Connection State SSE] Client disconnected (${connectionStateClients.length} remaining)`);
  });
});

// Relay Proxy start endpoint
app.post('/api/relay-proxy/start', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker start relay-proxy');
    res.json({
      success: true,
      message: 'Relay Proxy container started successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/relay-proxy/start', error, {
      command: 'docker start relay-proxy'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Relay Proxy stop endpoint
app.post('/api/relay-proxy/stop', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker stop relay-proxy');
    res.json({
      success: true,
      message: 'Relay Proxy container stopped successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/relay-proxy/stop', error, {
      command: 'docker stop relay-proxy'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Relay Proxy restart endpoint
app.post('/api/relay-proxy/restart', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker restart relay-proxy');
    res.json({
      success: true,
      message: 'Relay Proxy container restarted successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/relay-proxy/restart', error, {
      command: 'docker restart relay-proxy'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Node.js container status endpoint (Docker level)
app.get('/api/node/container-status', async (req, res) => {
  try {
    // Check if container is running
    const { stdout: inspectOutput } = await execPromise('docker inspect -f "{{.State.Running}}" node-app-dev 2>&1');
    const isRunning = inspectOutput.trim() === 'true';
    
    if (!isRunning) {
      return res.json({
        connected: false,
        running: false,
        status: 'stopped'
      });
    }
    
    // If running, container is healthy
    res.json({
      connected: true,
      running: true,
      status: 'healthy'
    });
  } catch (error) {
    logError('/api/node/container-status', error, {
      command: 'docker inspect node-app-dev'
    });
    res.status(500).json({
      connected: false,
      running: false,
      error: error.message
    });
  }
});

// Node.js Service start endpoint
app.post('/api/node/start', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker start node-app-dev');
    res.json({
      success: true,
      message: 'Node.js Service container started successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/node/start', error, {
      command: 'docker start node-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Node.js Service stop endpoint
app.post('/api/node/stop', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker stop node-app-dev');
    res.json({
      success: true,
      message: 'Node.js Service container stopped successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/node/stop', error, {
      command: 'docker stop node-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Node.js Service restart endpoint
app.post('/api/node/restart', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker restart node-app-dev');
    res.json({
      success: true,
      message: 'Node.js Service container restarted successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/node/restart', error, {
      command: 'docker restart node-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Node.js application status endpoint
app.get('/api/node/status', async (req, res) => {
  const nodeAppUrl = process.env.NODE_APP_URL || 'http://node-app-dev:3000';
  
  try {
    const response = await fetchWithTimeout(
      `${nodeAppUrl}/api/node/status`,
      {},
      5000
    );
    
    const data = await response.json();
    
    // Preserve original status code from Node app
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/node/status', error, {
      upstreamUrl: `${nodeAppUrl}/api/node/status`
    });
    res.status(500).json({
      connected: false,
      error: error.message
    });
  }
});

// PHP Service container status endpoint (Docker level)
app.get('/api/php/container-status', async (req, res) => {
  try {
    // Check if container is running
    const { stdout: inspectOutput } = await execPromise('docker inspect -f "{{.State.Running}}" php-app-dev 2>&1');
    const isRunning = inspectOutput.trim() === 'true';
    
    if (!isRunning) {
      return res.json({
        connected: false,
        running: false,
        status: 'stopped'
      });
    }
    
    // If running, check Redis availability (PHP uses Redis for daemon mode cache)
    let redisAvailable = false;
    try {
      const { stdout: redisCheck } = await execPromise('docker exec redis redis-cli ping 2>&1');
      redisAvailable = redisCheck.trim() === 'PONG';
    } catch (error) {
      // Redis is not responding
      redisAvailable = false;
    }
    
    // If Redis is down, PHP is degraded (using fallback variations)
    if (!redisAvailable) {
      return res.json({
        connected: true,
        running: true,
        status: 'degraded',
        redisAvailable: false,
        message: 'PHP running with fallback variations (Redis unavailable)'
      });
    }
    
    // If running and Redis is available, container is healthy
    res.json({
      connected: true,
      running: true,
      status: 'healthy',
      redisAvailable: true
    });
  } catch (error) {
    logError('/api/php/container-status', error, {
      command: 'docker inspect php-app-dev'
    });
    res.status(500).json({
      connected: false,
      running: false,
      error: error.message
    });
  }
});

// Python Service container status endpoint (Docker level)
app.get('/api/python/container-status', async (req, res) => {
  try {
    // Check if container is running
    const { stdout: inspectOutput } = await execPromise('docker inspect -f "{{.State.Running}}" python-app-dev 2>&1');
    const isRunning = inspectOutput.trim() === 'true';
    
    if (!isRunning) {
      return res.json({
        connected: false,
        running: false,
        status: 'stopped'
      });
    }
    
    // If running, container is healthy
    res.json({
      connected: true,
      running: true,
      status: 'healthy'
    });
  } catch (error) {
    logError('/api/python/container-status', error, {
      command: 'docker inspect python-app-dev'
    });
    res.status(500).json({
      connected: false,
      running: false,
      error: error.message
    });
  }
});

// PHP Service start endpoint
app.post('/api/php/start', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker start php-app-dev');
    res.json({
      success: true,
      message: 'PHP Service container started successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/php/start', error, {
      command: 'docker start php-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PHP Service stop endpoint
app.post('/api/php/stop', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker stop php-app-dev');
    res.json({
      success: true,
      message: 'PHP Service container stopped successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/php/stop', error, {
      command: 'docker stop php-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PHP Service restart endpoint
app.post('/api/php/restart', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker restart php-app-dev');
    res.json({
      success: true,
      message: 'PHP Service container restarted successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/php/restart', error, {
      command: 'docker restart php-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Python Service start endpoint
app.post('/api/python/start', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker start python-app-dev');
    res.json({
      success: true,
      message: 'Python Service container started successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/python/start', error, {
      command: 'docker start python-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Python Service stop endpoint
app.post('/api/python/stop', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker stop python-app-dev');
    res.json({
      success: true,
      message: 'Python Service container stopped successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/python/stop', error, {
      command: 'docker stop python-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Python Service restart endpoint
app.post('/api/python/restart', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker restart python-app-dev');
    res.json({
      success: true,
      message: 'Python Service container restarted successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/python/restart', error, {
      command: 'docker restart python-app-dev'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// React Service start endpoint
// React container endpoints removed - JavaScript Client panel now uses SDK directly in dashboard

// PHP application status endpoint
app.get('/api/php/status', async (req, res) => {
  const phpAppUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
  
  try {
    const response = await fetchWithTimeout(
      `${phpAppUrl}/api/status`,
      {},
      5000
    );
    
    const data = await response.json();
    
    // Preserve original status code from PHP app
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/php/status', error, {
      upstreamUrl: `${phpAppUrl}/api/status`
    });
    res.status(500).json({
      connected: false,
      error: error.message
    });
  }
});

// Python application status endpoint
app.get('/api/python/status', async (req, res) => {
  const pythonAppUrl = process.env.PYTHON_APP_URL || 'http://python-app-dev:5000';
  
  try {
    const response = await fetchWithTimeout(
      `${pythonAppUrl}/api/status`,
      {},
      5000
    );
    
    const data = await response.json();
    
    // Preserve original status code from Python app
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/python/status', error, {
      upstreamUrl: `${pythonAppUrl}/api/status`
    });
    res.status(500).json({
      connected: false,
      error: 'Unable to connect to Python application'
    });
  }
});

// Python flag evaluation endpoint (proxy to Python app)
app.get('/api/python/flag', async (req, res) => {
  const pythonAppUrl = process.env.PYTHON_APP_URL || 'http://python-app-dev:5000';
  
  try {
    // Forward all query parameters to Python service
    const queryParams = new URLSearchParams();
    if (req.query.contextKey) queryParams.append('contextKey', req.query.contextKey);
    if (req.query.email) queryParams.append('email', req.query.email);
    if (req.query.name) queryParams.append('name', req.query.name);
    if (req.query.location) queryParams.append('location', req.query.location);
    
    const flagUrl = queryParams.toString()
      ? `${pythonAppUrl}/api/flag?${queryParams.toString()}`
      : `${pythonAppUrl}/api/flag`;
    
    const response = await fetchWithTimeout(
      flagUrl,
      {},
      5000
    );
    
    const data = await response.json();
    
    // Preserve original status code from Python app
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/python/flag', error, {
      upstreamUrl: `${pythonAppUrl}/api/flag`
    });
    res.status(500).json({
      error: 'Unable to connect to Python application'
    });
  }
});

// Python context endpoint (proxy to Python app)
// GET: Fetch current context
app.get('/api/python/context', async (req, res) => {
  const pythonAppUrl = process.env.PYTHON_APP_URL || 'http://python-app-dev:5000';
  
  try {
    const response = await fetchWithTimeout(
      `${pythonAppUrl}/api/context`,
      {},
      5000
    );
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/python/context (GET)', error, {
      upstreamUrl: `${pythonAppUrl}/api/context`
    });
    res.status(500).json({
      kind: 'user',
      key: 'error',
      anonymous: true,
      error: 'Unable to connect to Python application'
    });
  }
});

// POST: Update context
app.post('/api/python/context', express.json(), async (req, res) => {
  const pythonAppUrl = process.env.PYTHON_APP_URL || 'http://python-app-dev:5000';
  
  try {
    const response = await fetchWithTimeout(
      `${pythonAppUrl}/api/context`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      },
      5000
    );
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/python/context', error, {
      upstreamUrl: `${pythonAppUrl}/api/context`
    });
    res.status(500).json({
      success: false,
      error: 'Unable to connect to Python application'
    });
  }
});

// Python SDK data store endpoint (proxy to Python app)
app.post('/api/python/sdk-data-store', express.json(), async (req, res) => {
  const pythonAppUrl = process.env.PYTHON_APP_URL || 'http://python-app-dev:5000';
  
  try {
    const response = await fetchWithTimeout(
      `${pythonAppUrl}/api/sdk-data-store`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      },
      5000
    );
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/python/sdk-data-store', error, {
      upstreamUrl: `${pythonAppUrl}/api/sdk-data-store`
    });
    res.status(500).json({
      success: false,
      error: 'Unable to connect to Python application',
      flags: {}
    });
  }
});

// React container endpoints removed - JavaScript Client panel now uses SDK directly in dashboard

// Python SSE stream proxy endpoint
app.get('/api/python/message/stream', async (req, res) => {
  const pythonUrl = process.env.PYTHON_APP_URL || 'http://python-app-dev:5000';
  
  // Forward all query parameters to Python service
  const queryParams = new URLSearchParams();
  if (req.query.contextKey) queryParams.append('contextKey', req.query.contextKey);
  if (req.query.email) queryParams.append('email', req.query.email);
  if (req.query.name) queryParams.append('name', req.query.name);
  if (req.query.location) queryParams.append('location', req.query.location);
  
  const pythonStreamUrl = queryParams.toString()
    ? `${pythonUrl}/api/message/stream?${queryParams.toString()}`
    : `${pythonUrl}/api/message/stream`;
  
  console.log(`[Python SSE Proxy] Forwarding to: ${pythonStreamUrl}`);
  console.log(`[Python SSE Proxy] Query params:`, req.query);
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  try {
    // Connect to Python SSE stream with custom User-Agent
    const response = await fetch(pythonStreamUrl, {
      headers: {
        'User-Agent': 'api-service/1.0'
      }
    });
    
    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ error: 'Python service unavailable' })}\n\n`);
      return res.end();
    }
    
    // Stream the response body to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            res.end();
            break;
          }
          
          // Write chunk to response
          res.write(value);
        }
      } catch (error) {
        logError('/api/python/message/stream', error, {
          pythonUrl: `${pythonUrl}/api/message/stream`
        });
        res.end();
      }
    };
    
    pump();
    
    // Handle client disconnect
    req.on('close', () => {
      reader.cancel();
    });
    
  } catch (error) {
    logError('/api/python/message/stream', error, {
      pythonUrl: `${pythonUrl}/api/message/stream`
    });
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

const dataSystemAppUrl = () => process.env.DATA_SYSTEM_APP_URL || 'http://data-system-app:5001';

app.get('/api/data-system/status', async (req, res) => {
  try {
    const portStatus = await getRelayPortProxyStatus();
    const response = await fetchWithTimeout(
      `${dataSystemAppUrl()}/api/data-system`,
      {},
      5000
    );
    const data = await response.json();
    data.relayPortOpen = portStatus.open;
    data.relayPortState = portStatus.state;
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/data-system/status', error, {
      upstreamUrl: `${dataSystemAppUrl()}/api/data-system`
    });
    const portStatus = await getRelayPortProxyStatus();
    res.status(500).json({
      connected: false,
      mode: 'data-system-custom',
      sdkInitialized: false,
      error: 'Unable to connect to data-system application',
      relayPortOpen: portStatus.open,
      relayPortState: portStatus.state,
      path: [],
      events: []
    });
  }
});

app.get('/api/data-system/flag', async (req, res) => {
  try {
    const response = await fetchWithTimeout(`${dataSystemAppUrl()}/api/flag`, {}, 5000);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/data-system/flag', error);
    res.status(500).json({
      error: 'Unable to connect to data-system application',
      value: 'Hello from Data System!'
    });
  }
});

app.get('/api/data-system/relay-port', async (req, res) => {
  const portStatus = await getRelayPortProxyStatus();
  res.status(portStatus.success ? 200 : 500).json({
    open: portStatus.open,
    running: portStatus.running,
    state: portStatus.state,
    error: portStatus.error
  });
});

app.post('/api/data-system/relay-port/kill', async (req, res) => {
  const result = await stopRelayPortProxy();
  if (result.success) {
    res.json({
      success: true,
      open: false,
      state: 'killed',
      message: 'Relay Proxy stopped. Node.js and JavaScript Client lose Relay; the data-system SDK falls back to LaunchDarkly.'
    });
  } else {
    logError('/api/data-system/relay-port/kill', new Error(result.error));
    res.status(500).json({
      success: false,
      error: result.error
    });
  }
});

app.post('/api/data-system/relay-port/restore', async (req, res) => {
  const result = await startRelayPortProxy();
  if (result.success) {
    res.json({
      success: true,
      open: true,
      state: 'open',
      message: 'Relay Proxy restored. Port 8030 is available again for every SDK.'
    });
  } else {
    logError('/api/data-system/relay-port/restore', new Error(result.error));
    res.status(500).json({
      success: false,
      error: result.error
    });
  }
});

app.post('/api/data-system/restart', async (req, res) => {
  try {
    const { stdout } = await execPromise('docker restart data-system-app');
    res.json({
      success: true,
      message: 'Data System Builder container restarted successfully',
      container: stdout.trim()
    });
  } catch (error) {
    logError('/api/data-system/restart', error, {
      command: 'docker restart data-system-app'
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Feature flag evaluation endpoint for dashboard panel selection
// Initialize LaunchDarkly SDK client for flag evaluation
let dashboardFlagClient = null;

async function initDashboardFlagClient() {
  if (dashboardFlagClient) {
    return dashboardFlagClient;
  }

  const LD = require('@launchdarkly/node-server-sdk');
  const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;
  
  if (!sdkKey) {
    throw new Error('LAUNCHDARKLY_SDK_KEY not configured');
  }

  // Initialize SDK with default configuration (direct connection to LaunchDarkly)
  dashboardFlagClient = LD.init(sdkKey, {
    stream: true,
    sendEvents: false,
    diagnosticOptOut: true
  });

  await dashboardFlagClient.waitForInitialization({ timeout: 10 });
  console.log('[Dashboard Flag Client] SDK initialized successfully');
  
  return dashboardFlagClient;
}

app.get('/api/flag/dashboard-service-panel-1', async (req, res) => {
  try {
    // Initialize the SDK client if not already done
    if (!dashboardFlagClient) {
      await initDashboardFlagClient();
    }
    
    // Check if SDK is initialized
    if (!dashboardFlagClient.initialized()) {
      return res.status(503).json({
        error: 'SDK not initialized',
        value: 'python'  // Default fallback
      });
    }
    
    // Create anonymous context for flag evaluation
    const context = {
      kind: 'user',
      key: 'dashboard-user',
      anonymous: true
    };
    
    // Evaluate the flag
    const value = await dashboardFlagClient.variation(
      'dashboard-service-panel-1',
      context,
      'python'  // Default value
    );
    
    res.json({ value });
  } catch (error) {
    logError('/api/flag/dashboard-service-panel-1', error, {
      message: 'Flag evaluation failed'
    });
    res.status(500).json({
      error: 'Flag evaluation failed',
      value: 'python'  // Default fallback
    });
  }
});

// Container logs endpoint
app.get('/api/logs/:container', async (req, res) => {
  const { container } = req.params;
  const allowedContainers = ['node-app-dev', 'php-app-dev', 'python-app-dev', 'relay-proxy', 'redis', 'data-system-app'];
  
  // Validate container name against allowlist
  if (!allowedContainers.includes(container)) {
    return res.status(400).json({
      error: 'Invalid container name',
      lines: []
    });
  }
  
  try {
    // Execute docker logs command
    const { stdout, stderr } = await execPromise(`docker logs --tail 50 ${container} 2>&1`);
    
    // Parse output and return as JSON array of log lines
    const logs = (stdout + stderr).split('\n').filter(line => line.trim());
    res.json({ lines: logs });
  } catch (error) {
    logError(`/api/logs/${container}`, error, {
      container,
      command: `docker logs --tail 50 ${container}`
    });
    // Handle Docker command failures with empty array and error message
    res.json({
      error: `Unable to fetch logs for ${container}. Container may not be running.`,
      lines: []
    });
  }
});

// Clear container logs endpoint
app.post('/api/logs/:container/clear', async (req, res) => {
  const { container } = req.params;
  const allowedContainers = ['node-app-dev', 'php-app-dev', 'python-app-dev', 'relay-proxy', 'redis', 'data-system-app'];
  
  // Validate container name against allowlist
  if (!allowedContainers.includes(container)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid container name'
    });
  }
  
  try {
    // Docker doesn't have a native "clear logs" command, but we can truncate the log file
    // This requires access to the Docker log file location
    // For now, we'll return success but note that logs will still exist
    // A proper implementation would require direct file system access to Docker's log directory
    res.json({
      success: true,
      message: `Log clear requested for ${container}. Note: Docker logs persist until container restart.`
    });
  } catch (error) {
    logError(`/api/logs/${container}/clear`, error, {
      container
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Relay Proxy metrics endpoint
app.get('/api/relay-metrics', async (req, res) => {
  try {
    // Execute docker stats command
    const { stdout } = await execPromise('docker stats relay-proxy --no-stream --format "{{json .}}"');
    
    // Parse JSON output
    const stats = JSON.parse(stdout.trim());
    
    // Extract CPU percentage, memory usage, and memory percentage
    const cpuStr = stats.CPUPerc || '0%';
    const memoryStr = stats.MemUsage || '0B / 0B';
    const memoryPercStr = stats.MemPerc || '0%';
    
    // Parse CPU percentage (remove % sign) and handle NaN
    const cpu = parseFloat(cpuStr.replace('%', '')) || 0;
    
    // Extract memory usage (first part before /)
    const memory = memoryStr.split('/')[0].trim();
    
    // Parse memory percentage (remove % sign) and handle NaN
    const memoryPercent = parseFloat(memoryPercStr.replace('%', '')) || 0;
    
    // Return JSON with required fields
    res.json({
      cpu,
      memory,
      memoryPercent,
      timestamp: Date.now()
    });
  } catch (error) {
    logError('/api/relay-metrics', error, {
      command: 'docker stats relay-proxy --no-stream --format "{{json .}}"'
    });
    // Handle Docker command failures with 500 status and error message
    res.status(500).json({
      error: error.message
    });
  }
});

// PHP SSE stream proxy endpoint
app.get('/api/php/message/stream', async (req, res) => {
  const phpUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
  
  // Get context key from query parameter and forward it
  const contextKey = req.query.contextKey;
  const phpStreamUrl = contextKey 
    ? `${phpUrl}/api/message/stream?contextKey=${encodeURIComponent(contextKey)}`
    : `${phpUrl}/api/message/stream`;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  try {
    // Connect to PHP SSE stream with custom User-Agent
    const response = await fetch(phpStreamUrl, {
      headers: {
        'User-Agent': 'api-service/1.0'
      }
    });
    
    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ error: 'PHP service unavailable' })}\n\n`);
      return res.end();
    }
    
    // Stream the response body to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            res.end();
            break;
          }
          
          // Write chunk to response
          res.write(value);
        }
      } catch (error) {
        logError('/api/php/message/stream', error, {
          phpUrl: `${phpUrl}/api/message/stream`
        });
        res.end();
      }
    };
    
    pump();
    
    // Handle client disconnect
    req.on('close', () => {
      reader.cancel();
    });
    
  } catch (error) {
    logError('/api/php/message/stream', error, {
      phpUrl: `${phpUrl}/api/message/stream`
    });
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Redis monitor SSE stream proxy endpoint
app.get('/api/redis/monitor', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  let monitorProcess = null;
  
  try {
    const { spawn } = require('child_process');
    
    // Spawn redis-cli monitor command
    monitorProcess = spawn('docker', ['exec', 'redis', 'redis-cli', 'MONITOR']);
    
    // Send data to client
    monitorProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => {
        res.write(`data: ${JSON.stringify({ command: line })}\n\n`);
      });
    });
    
    monitorProcess.stderr.on('data', (data) => {
      logError('/api/redis/monitor', new Error(data.toString()), {
        command: 'docker exec redis redis-cli MONITOR'
      });
    });
    
    monitorProcess.on('error', (error) => {
      logError('/api/redis/monitor', error, {
        command: 'docker exec redis redis-cli MONITOR'
      });
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });
    
    // Handle client disconnect
    req.on('close', () => {
      if (monitorProcess) {
        monitorProcess.kill();
      }
    });
    
  } catch (error) {
    logError('/api/redis/monitor', error, {
      command: 'docker exec redis redis-cli MONITOR'
    });
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// PHP context GET proxy endpoint
app.get('/api/php/context', async (req, res) => {
  const phpUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
  
  try {
    const response = await fetchWithTimeout(`${phpUrl}/api/context`, {}, 5000);
    
    if (!response.ok) {
      return res.status(response.status).json({
        error: `PHP service returned ${response.status}`
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logError('/api/php/context', error, {
      phpUrl: `${phpUrl}/api/context`
    });
    res.status(500).json({
      error: error.message
    });
  }
});

// PHP context update proxy endpoint
app.post('/api/php/context', async (req, res) => {
  const phpUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
  
  try {
    const response = await fetchWithTimeout(`${phpUrl}/api/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/php/context', error, {
      phpUrl: `${phpUrl}/api/context`
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PHP test evaluation proxy endpoint
app.post('/api/php/test-evaluation', async (req, res) => {
  const phpUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
  
  try {
    const response = await fetchWithTimeout(`${phpUrl}/api/test-evaluation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/php/test-evaluation', error, {
      phpUrl: `${phpUrl}/api/test-evaluation`
    });
    res.status(500).json({
      success: false,
      error: `Unable to connect to PHP service: ${error.message}`
    });
  }
});

// PHP redis-cache proxy endpoint
app.post('/api/php/redis-cache', async (req, res) => {
  const phpUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
  
  try {
    // Forward cookies to PHP service for session persistence
    const headers = {
      'Content-Type': 'application/json'
    };
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }
    
    // Forward the context from request body
    const response = await fetchWithTimeout(`${phpUrl}/api/redis-cache`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    
    // Forward Set-Cookie headers back to client
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      res.setHeader('Set-Cookie', setCookie);
    }
    
    res.status(response.status).json(data);
  } catch (error) {
    logError('/api/php/redis-cache', error, {
      phpUrl: `${phpUrl}/api/redis-cache`
    });
    res.status(500).json({
      success: false,
      error: `Unable to connect to PHP service: ${error.message}`
    });
  }
});

// Load test proxy endpoint
app.post('/api/load-test', async (req, res) => {
  const { requests, concurrency, service } = req.body;
  
  // Route to appropriate service
  if (service === 'node') {
    const nodeAppUrl = process.env.NODE_APP_URL || 'http://node-app-dev:3000';
    
    try {
      const response = await fetchWithTimeout(`${nodeAppUrl}/api/load-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests, concurrency, service })
      }, 30000); // 30 second timeout for load test
      
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      logError('/api/load-test', error, {
        service: 'node',
        upstreamUrl: `${nodeAppUrl}/api/load-test`
      });
      res.status(500).json({
        success: false,
        error: `Unable to connect to Node.js service: ${error.message}`
      });
    }
  } else if (service === 'php') {
    const phpUrl = process.env.PHP_APP_URL || 'http://php-app-dev:80';
    
    try {
      const response = await fetchWithTimeout(`${phpUrl}/api/load-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests, concurrency, service })
      }, 30000); // 30 second timeout for load test
      
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      logError('/api/load-test', error, {
        service: 'php',
        upstreamUrl: `${phpUrl}/api/load-test`
      });
      res.status(500).json({
        success: false,
        error: `Unable to connect to PHP service: ${error.message}`
      });
    }
  } else {
    res.status(400).json({
      success: false,
      error: 'Invalid service specified. Must be "node" or "php".'
    });
  }
});



// Relay Proxy disconnect endpoint
app.post('/api/relay-proxy/disconnect', async (req, res) => {
  try {
    const disconnectStartTime = Date.now();
    
    // Initiate action in control manager (disables toggle control)
    const controlResult = controlManager.initiateAction('disconnect');
    if (!controlResult.success) {
      return res.status(409).json({
        success: false,
        error: controlResult.error,
        message: controlResult.message
      });
    }
    
    // Stop squid proxy container
    const result = await stopSquidProxy();
    
    if (!result.success) {
      controlManager.completeAction();
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Start background monitoring
    monitorRelayProxyConnectionState('disconnect', disconnectStartTime);
    
    return res.status(200).json({
      success: true,
      action: 'disconnect_initiated',
      message: 'Squid proxy stopped. Relay proxy disconnected.',
      controlEnabled: false
    });
    
  } catch (error) {
    controlManager.completeAction();
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Relay Proxy reconnect endpoint
app.post('/api/relay-proxy/reconnect', async (req, res) => {
  try {
    const reconnectStartTime = Date.now();
    
    // Initiate action in control manager (disables toggle control)
    const controlResult = controlManager.initiateAction('reconnect');
    if (!controlResult.success) {
      return res.status(409).json({
        success: false,
        error: controlResult.error,
        message: controlResult.message
      });
    }
    
    // Start squid proxy container
    const result = await startSquidProxy();
    
    if (!result.success) {
      controlManager.completeAction();
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Start background monitoring
    monitorRelayProxyConnectionState('reconnect', reconnectStartTime);
    
    return res.status(200).json({
      success: true,
      action: 'reconnect_initiated',
      message: 'Squid proxy started. Relay proxy reconnected.',
      controlEnabled: false
    });
    
  } catch (error) {
    controlManager.completeAction();
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/relay-proxy/connection-state endpoint
// Returns current connection state detected from log monitoring
app.get('/api/relay-proxy/connection-state', async (req, res) => {
  try {
    // Get current state from StateManager
    const currentState = stateManager.getCurrentState();
    
    // Get control state from ControlManager
    const controlEnabled = controlManager.isControlEnabled();
    const pendingAction = controlManager.getPendingAction();
    
    // Get the last history entry for metadata
    const history = stateManager.getStateHistory(1);
    const metadata = history.length > 0 ? history[0].metadata : {};
    
    return res.json({
      state: currentState.state,
      timestamp: currentState.timestamp,
      controlEnabled: controlEnabled,
      pendingAction: pendingAction,
      metadata: metadata,
      relayProxyRunning: relayProxyHealthy  // Include relay proxy running status
    });
  } catch (error) {
    logError('/api/relay-proxy/connection-state', error);
    return res.status(500).json({
      error: error.message
    });
  }
});

// GET /api/relay-proxy/connection-state/history endpoint
// Returns connection state change history
app.get('/api/relay-proxy/connection-state/history', async (req, res) => {
  try {
    // Parse limit parameter with default of 10
    const limit = parseInt(req.query.limit) || 10;
    
    // Get history from StateManager (automatically clamped to 1-100)
    const history = stateManager.getStateHistory(limit);
    
    // Get total entries count
    const totalEntries = stateManager.getCurrentState().historySize;
    
    return res.json({
      history: history,
      totalEntries: totalEntries
    });
  } catch (error) {
    logError('/api/relay-proxy/connection-state/history', error);
    return res.status(500).json({
      error: error.message
    });
  }
});



// Export app and helper functions for testing
module.exports = { 
  app, 
  logError, 
  fetchWithTimeout, 
  checkContainerRunning, 
  // Export monitoring components
  logMonitor,
  logParser,
  stateManager,
  controlManager,
  // Export cleanup function for tests
  cleanup
};

// Only start server if this file is run directly (not imported)
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  const server = app.listen(PORT, () => {
    console.log(`API Service listening on port ${PORT}`);
    
    // Start log monitoring on server startup
    try {
      logMonitor.start();
      console.log('[LogMonitor] Started monitoring relay-proxy logs');
    } catch (error) {
      console.error('[LogMonitor] Failed to start:', error.message);
    }
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    
    // Stop log monitoring
    logMonitor.stop();
    console.log('[LogMonitor] Stopped monitoring');
    
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
}
// Store SSE clients for connection state changes
const connectionStateClients = [];

// Broadcast connection state changes to all connected SSE clients
function broadcastConnectionStateChange(stateData) {
  const event = {
    type: 'connection-state-change',
    data: {
      state: stateData.state,
      timestamp: stateData.timestamp || new Date().toISOString(),
      method: 'squid-proxy',
      relayProxyRunning: stateData.relayProxyRunning  // Include relay proxy running status
    }
  };

  console.log(`[SSE] Broadcasting connection state change to ${connectionStateClients.length} clients:`, event.data);

  // Send to all connected clients
  connectionStateClients.forEach((client, index) => {
    try {
      client.write(`event: ${event.type}\n`);
      client.write(`data: ${JSON.stringify(event.data)}\n\n`);
    } catch (error) {
      console.error(`[SSE] Failed to send to client ${index}:`, error.message);
    }
  });
}

// Poll squid proxy and relay proxy status at regular intervals
let currentConnectionState = 'unknown';
const POLL_INTERVAL = 5000; // 5 seconds

// Store interval IDs for cleanup
let pollingIntervalId = null;
let pollingTimeoutId = null;
let relayProxyPollingIntervalId = null;
let relayProxyPollingTimeoutId = null;

// Determine overall connection state based on both squid and relay proxy health
function updateOverallConnectionState(source) {
  let newState = 'unknown';
  
  // Connection is only "connected" if BOTH squid proxy AND relay proxy are healthy
  if (squidProxyHealthy && relayProxyHealthy) {
    newState = 'connected';
  } else if (!squidProxyHealthy) {
    // Squid proxy is down - this is a manual disconnect
    newState = 'disconnected';
  } else if (!relayProxyHealthy) {
    // Relay proxy is down but squid is up
    // Check if we're in the middle of a reconnect action
    const pendingAction = controlManager.getPendingAction();
    if (pendingAction === 'reconnect') {
      // Don't change state while reconnect is in progress
      // This prevents flickering from disconnected -> connected -> disconnected -> connected
      console.log(`[${source}] Relay proxy not healthy yet, but reconnect in progress - keeping current state`);
      return;
    }
    newState = 'disconnected';
  }
  
  if (newState !== currentConnectionState) {
    console.log(`[${source}] Overall state changed: ${currentConnectionState} -> ${newState} (squid: ${squidProxyHealthy}, relay: ${relayProxyHealthy})`);
    currentConnectionState = newState;

    // Broadcast state change to SSE clients with relay proxy running status
    broadcastConnectionStateChange({
      state: newState,
      timestamp: new Date().toISOString(),
      relayProxyRunning: relayProxyHealthy  // Add this to indicate if relay proxy container is running
    });

    // Update the ConnectionStateManager
    stateManager.updateState(newState, {
      detectedFrom: source,
      squidProxyHealthy: squidProxyHealthy,
      relayProxyHealthy: relayProxyHealthy
    });
  }
}

async function pollSquidProxyStatus() {
  try {
    const status = await getSquidProxyStatus();
    const isHealthy = status.state === 'connected' && status.running;
    
    if (isHealthy !== squidProxyHealthy) {
      squidProxyHealthy = isHealthy;
      updateOverallConnectionState('SQUID_PROXY_POLL');
    }
  } catch (error) {
    console.error('[SQUID_PROXY_POLL] Error polling squid proxy status:', error.message);
    if (squidProxyHealthy) {
      squidProxyHealthy = false;
      updateOverallConnectionState('SQUID_PROXY_POLL');
    }
  }
}

// Poll relay proxy container status to detect if it stops
async function pollRelayProxyHealth() {
  try {
    const relayProxyUrl = process.env.RELAY_PROXY_URL || 'http://relay-proxy:8030';
    
    // Try to reach the relay proxy status endpoint with a short timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    
    const response = await fetch(`${relayProxyUrl}/status`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    // If we can reach the endpoint, relay proxy is running
    if (response.ok) {
      // Relay proxy is reachable and healthy
      if (!relayProxyHealthy) {
        relayProxyHealthy = true;
        
        // If we're in the middle of a reconnect action, complete it now
        const pendingAction = controlManager.getPendingAction();
        if (pendingAction === 'reconnect') {
          console.log('[RELAY_PROXY_HEALTH] Relay proxy healthy - completing reconnect action');
          controlManager.completeAction();
        }
        
        updateOverallConnectionState('RELAY_PROXY_HEALTH');
      }
    } else {
      // Relay proxy returned an error - treat as unhealthy
      console.warn(`[RELAY_PROXY_HEALTH] Relay proxy returned HTTP ${response.status}`);
      if (relayProxyHealthy) {
        relayProxyHealthy = false;
        updateOverallConnectionState('RELAY_PROXY_HEALTH');
      }
    }
  } catch (error) {
    // Relay proxy is unreachable (container stopped, network issue, etc.)
    if (error.name === 'AbortError') {
      console.warn('[RELAY_PROXY_HEALTH] Relay proxy health check timeout');
    } else {
      console.warn(`[RELAY_PROXY_HEALTH] Relay proxy unreachable: ${error.message}`);
    }
    
    if (relayProxyHealthy) {
      relayProxyHealthy = false;
      updateOverallConnectionState('RELAY_PROXY_HEALTH');
    }
  }
}

function handleRelayProxyUnreachable() {
  // This function is no longer needed - logic moved to pollRelayProxyHealth
}

// Cleanup function to stop all intervals and timeouts
function cleanup() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
  if (pollingTimeoutId) {
    clearTimeout(pollingTimeoutId);
    pollingTimeoutId = null;
  }
  if (relayProxyPollingIntervalId) {
    clearInterval(relayProxyPollingIntervalId);
    relayProxyPollingIntervalId = null;
  }
  if (relayProxyPollingTimeoutId) {
    clearTimeout(relayProxyPollingTimeoutId);
    relayProxyPollingTimeoutId = null;
  }
}

// Start polling after a short delay to allow initialization
pollingTimeoutId = setTimeout(() => {
  console.log('[SQUID_PROXY_POLL] Starting squid proxy status polling (interval: 5s)');
  pollSquidProxyStatus(); // Initial poll
  pollingIntervalId = setInterval(pollSquidProxyStatus, POLL_INTERVAL);
}, 2000);

// Start relay proxy health checking
relayProxyPollingTimeoutId = setTimeout(() => {
  console.log('[RELAY_PROXY_HEALTH] Starting relay proxy health check polling (interval: 5s)');
  pollRelayProxyHealth(); // Initial check
  relayProxyPollingIntervalId = setInterval(pollRelayProxyHealth, POLL_INTERVAL);
}, 2000);
