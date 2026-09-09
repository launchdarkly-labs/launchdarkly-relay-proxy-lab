# LaunchDarkly Relay Proxy Enterprise Demo

A comprehensive demonstration application showcasing the LaunchDarkly Node.js server-side SDK integration with the LaunchDarkly Relay Proxy Enterprise. This application provides a full-featured demo environment with real-time flag updates, load testing, and performance monitoring.

## Features

### Core Functionality
- **Multi-Variate Feature Flags**: Demonstrates flag evaluation with multiple variations
- **Real-Time Updates**: Server-Sent Events (SSE) for instant flag changes without page refresh
- **Multi-Context Evaluation**: Supports both anonymous and custom user contexts with container context
- **Geolocation**: Automatic browser-based location detection for targeting
- **Singleton SDK Pattern**: Efficient SDK client management with automatic recovery

### Demo Capabilities
- **Interactive UI**: Modern web interface with LaunchDarkly branding
- **Context Management**: Switch between anonymous and custom user contexts
- **Live Container Logs**: Real-time viewing of app and relay proxy logs
- **Redis Monitor**: Live stream of all Redis commands showing feature flag operations
- **Relay Proxy Status**: Comprehensive status dashboard with health checks
- **Data System Builder**: Python SDK `datasystem.custom()` with Relay-first streaming and LaunchDarkly fallback
- **Performance Metrics**: Real-time CPU and memory monitoring
- **Load Testing**: Built-in load testing tool with live results

### Technical Features
- **Graceful Degradation**: Continues operation when relay proxy is unavailable
- **Error Handling**: Clear error messages with fallback value display
- **Flag Change Detection**: Detailed logging of flag configuration changes
- **Docker Integration**: Full containerized environment with Docker Compose
- **ARM64 Compatible**: Runs on Apple Silicon and ARM64 architectures

## Prerequisites

- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **LaunchDarkly Account**: With SDK key and Relay Proxy configuration key
- **Required Feature Flags**: Three flags must be created in your LaunchDarkly project:
  - `user-message` (string, multi-variate)
  - `terminal-panels` (boolean)
  - `dashboard-service-panel-1` (string)
  
  See the [Required Feature Flags](#required-feature-flags) section below for detailed setup instructions.

## Quick Start

### 1. Clone and Configure

```bash
# Navigate to the project directory
cd launchdarkly-relay-proxy-enterprise-demo

# Copy the example environment file
cp .env.example .env

# Edit .env and add your LaunchDarkly credentials
```

Required environment variables:
```env
LAUNCHDARKLY_SDK_KEY=sdk-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
LAUNCHDARKLY_CLIENT_SIDE_ID=6980ccadb17af909dd9c4abb
RELAY_PROXY_CONFIG_KEY=rel-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Optional configuration:
```env
# Redis prefix (must match your environment ID from LaunchDarkly)
# Note: The environment ID is the same as your Client-side ID
# Find it in LaunchDarkly: Account Settings > Projects > [Your Project] > [Environment] > Client-side ID
REDIS_PREFIX=ld-flags-'your-environment-id'
```

### 2. Create Required Feature Flags

This demo requires **three feature flags** to be created in your LaunchDarkly project:

#### Flag 1: user-message (Required)
1. Create a new flag with key: `user-message`
2. Set it as a **multi-variate string flag**
3. Add three variations:
   - "Hello from LaunchDarkly!"
   - "Welcome to the demo!"
   - "Greetings from the Relay Proxy!"
4. Configure the flag:
   - Turn targeting ON or OFF to control which variation is served
   - When targeting is ON, configure rules to serve specific variations to different contexts
   - When targeting is OFF, all contexts receive the off variation

**Purpose**: Primary demo flag that displays different messages to users. Used to demonstrate flag evaluation, targeting rules, and real-time updates across both Node.js and PHP applications.

#### Flag 2: terminal-panels (Required)
1. Create a new flag with key: `terminal-panels`
2. Set it as a **boolean flag**
3. Two variations:
   - `true` (open terminal panels in separate window)
   - `false` (close terminal panels window)
4. Configure the flag:
   - Turn targeting ON or OFF to control terminal window behavior
   - When targeting is ON, configure rules to serve `true` or `false` to different contexts
   - When targeting is OFF, all contexts receive the off variation (`false`)

**Purpose**: Controls whether terminal log panels open in a separate browser window. When set to `true`, a popup window displays real-time container logs for all services. When set to `false`, the terminal window closes automatically. Demonstrates real-time UI control and window management via feature flags.

#### Flag 3: dashboard-service-panel-1 (Required)
1. Create a new flag with key: `dashboard-service-panel-1`
2. Set it as a **string flag**
3. Three variations:
   - `nodejs` (show Node.js panel)
   - `python` (show Python panel)
   - `javascript` (show JavaScript Client panel)
4. Configure the flag:
   - Turn targeting ON or OFF to control which service panel is displayed
   - When targeting is ON, configure rules to serve `nodejs`, `python`, or `javascript` to different contexts
   - When targeting is OFF, all contexts receive the off variation (defaults to `python`)

**Purpose**: Controls which service is displayed in Panel 1 of the dashboard. Demonstrates dynamic UI panel switching via feature flags. Changes apply instantly without page refresh, and the terminal panels window automatically synchronizes to match the selected service.

**Important**: All three flags must exist in your LaunchDarkly project for the demo to function correctly. The application will show fallback values if these flags are missing.

### 3. Run with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Access the application
# Dashboard UI: http://localhost:8000 (main interface - includes all services)
# Node.js API: http://localhost:3000 (backend only)
# API service: http://localhost:4000 (backend only)
# PHP API: http://localhost:8080 (backend only)
# Python API: http://localhost:5000 (backend only)
# Data System API: http://localhost:5001 (backend only)
```

**Relay proxy options** (pick one):

```bash
# Default — official LaunchDarkly image
docker compose up -d

# Native Go FIPS 140-3 + post-quantum (relay-proxy/Dockerfile.fips)
# No license needed. Start here.
docker compose -f docker-compose.yml -f docker-compose-fips.yml up -d --build

# Chainguard go-fips — OpenSSL-backed FIPS (relay-proxy/Dockerfile.chainguard)
# Needs a commercial Chainguard license; see "Chainguard build" below.
docker compose -f docker-compose.yml -f docker-compose-chainguard.yml up -d --build

# CNSA 2.0 posture: adds ML-DSA-87 signatures, trades the CMVP certificate
# Needs Go 1.27 and the in-process FIPS module; see "CNSA 2.0 posture" below.
docker compose -f docker-compose.yml -f docker-compose-cnsa.yml up -d --build
```

All three hardened builds compile the relay from the upstream `LD_RELAY_VERSION` release
tarball rather than pulling a published image, so the crypto configuration is a build-time
choice.

#### What the hardened builds change

Four things, on top of what the official image does.

**Post-quantum key exchange is enabled.** The relay's `go.mod` declares `go 1.24.0`, and
that directive bakes `tlssecpmlkem=0` into the binary, which disables the two ML-KEM hybrid
groups on the NIST P curves. A newer Go toolchain does not override a module's
compatibility defaults. Both Dockerfiles append `godebug tlssecpmlkem=1` before building,
guarded so the patch no-ops once upstream ships the line.

The failure this prevents is silent. `X25519MLKEM768` stays enabled, so browsers negotiate
post-quantum normally and a smoke test passes. A FIPS-constrained client offering only
NIST-curve PQC gets classical ECDH, the handshake succeeds, and the relay logs nothing.

**The validated FIPS module is linked, in permissive mode.** `Dockerfile.fips` sets
`GODEBUG=fips140=on`, so `fips140.Enforced()` reports false.

`fips140=only` is the enforcing mode and cannot be used here. The LaunchDarkly evaluation
engine hashes context keys with SHA-1 to compute percentage rollout buckets
(`go-server-sdk-evaluation v3.0.1`, `evaluator_bucketing.go:99`), and `crypto/sha1` panics
unconditionally under `only`. The relay then panics on every client-side flag evaluation
with `crypto/sha1: use of SHA-1 is not allowed in FIPS 140-only mode`. LaunchDarkly's
published FIPS guidance specifies `on` for this reason.

Measured cost of `on` versus `only`: direct calls to MD5, 3DES and RC4 stop panicking and
become reachable. TLS behavior is unchanged. TLS 1.0 and 1.1 are refused under both modes,
negotiated suites are identical, and all three ML-KEM hybrid groups work under both.

**No legacy cipher suite is negotiable, and the build proves it.** RC4, DES, MD5 and SHA-1
stay linked in any Go binary that imports `crypto/tls` or `crypto/x509`, so "absent from
the image" is not a claim this project can make. `relay-proxy/tlsassert` runs during the
build and offers each legacy suite in a raw ClientHello against a server with no suite
restriction:

```
result : 0 of 13 legacy configurations negotiable
```

That covers RC4, 3DES, RSA-CBC-SHA, NULL, anonymous DH, and TLS 1.0/1.1. The tool carries a
positive control and exits 2 if its own ClientHello stops working, so a broken test is
distinguishable from a real finding.

**The build identifies its own crypto boundary.** Each build prints the module it linked and
where to look the certificate up. `Dockerfile.fips` also writes this into the image at
`/etc/launchdarkly/`, so it is readable from a running container:

```bash
docker run --rm --entrypoint /bin/sh ld-relay-lab:fips-hardened \
  -c 'cat /etc/launchdarkly/fips-readme'
```

No CMVP certificate number is hardcoded anywhere. A pinned number asserts a validation
status that can go stale without the build changing, and it is the field an assessor copies
down. The build emits the module identity and the CMVP search URLs instead.

Each build asserts its own hardening. Dropping `GOFIPS140`, failing to apply the `go.mod`
patch, or a toolchain change that reintroduces a legacy suite fails the build. If an
assertion trips, diagnose it — deleting the check ships an image that looks hardened and is
not.

#### FIPS module selection

`Dockerfile.fips` defaults to `GOFIPS140=v1.0.0`, which resolves to the module Go
classifies as `certified`. To build against the in-process module instead — it adds ML-DSA,
the post-quantum *signature* algorithm, but is Pending Review rather than validated:

```bash
docker compose -f docker-compose.yml -f docker-compose-fips.yml build \
  --build-arg GOFIPS140=inprocess
```

The build log reports which module resolved and how it was classified. Validation status is
derived from the toolchain's own `/usr/local/go/lib/fips140/{certified,inprocess}.txt`
rather than passed in as a build arg, so a label cannot claim a status the linked module
lacks. When resolving `GOFIPS140`, note that `certified.txt` holds a patch-suffixed version
(`v1.0.0-c2097c7c`) while a bare `v1.0.0.txt` alias also exists; match through the alias
file, because a string comparison against `certified.txt` will miss.

#### CNSA 2.0 posture

CNSA 2.0 names four algorithm families. Two are reachable in this component, and the build
reports which:

| Requirement | Algorithm | Status |
| --- | --- | --- |
| Key establishment | ML-KEM-768 / ML-KEM-1024 (FIPS 203) | Met, all three hybrid groups |
| Authentication | ML-DSA-87 (FIPS 204) | Met with `Dockerfile.cnsa` |
| Symmetric encryption | AES-256 | Not reachable |
| Hashing | SHA-384 | Not reachable |

AES-256 is not selectable: Go fixes TLS 1.3 cipher suite preference in the standard library
and ignores `tls.Config.CipherSuites` for 1.3. A handshake negotiating ML-KEM-1024 with an
ML-DSA-87 certificate still lands on `TLS_AES_128_GCM_SHA256`. Hashing follows suite
selection. Neither has a GODEBUG override, so no configuration reaches them.

`Dockerfile.cnsa` adds ML-DSA-87 authentication on top of `Dockerfile.fips`, which needs
Go 1.27 (`crypto/mldsa` does not exist before it) and the in-process FIPS module:

```bash
docker compose -f docker-compose.yml -f docker-compose-cnsa.yml up -d --build
```

ML-DSA costs the CMVP certificate, because Go ships two FIPS modules and only one is
validated.

| | `GOFIPS140=certified` | `GOFIPS140=inprocess` |
| --- | --- | --- |
| Module | `v1.0.0-c2097c7c` | `v1.26.0` |
| CMVP | Validated, holds a certificate | Modules In Process, Pending Review |
| ML-DSA | Absent | Available |
| CNSA families met | 1 of 4 | 2 of 4 |
| Dockerfile | `Dockerfile.fips` | `Dockerfile.cnsa` |

Go states the constraint directly. Building `Dockerfile.cnsa` with the validated module
fails with `mldsa: unavailable in FIPS 140-3 Go Cryptographic Module v1.0.0`.

Which posture a customer wants depends on a question only their assessor answers: whether
an in-process module is acceptable as interim evidence. `Dockerfile.fips` stays the default
because naming a certificate number is usually the harder requirement.

To keep the validated module and give up post-quantum authentication, build the CNSA image
with a classical certificate. ML-KEM key exchange is unaffected:

```bash
CERT_ALG=ecdsa-p384 docker compose -f docker-compose.yml -f docker-compose-cnsa.yml up -d --build
```

#### Certificate generation

No public CA issues ML-DSA certificates yet, so `relay-proxy/certgen` issues the one the
relay serves. `Dockerfile.cnsa` runs it during the build and the relay picks it up through
`TLS_CERT` / `TLS_KEY`.

```bash
cd relay-proxy/certgen
GOFIPS140=inprocess go run . -alg mldsa87 -out /tmp/certs -hosts relay-proxy,localhost
```

Certificates are self-signed and sized for a lab: an ML-DSA-87 certificate is around 7.5 KB
DER against roughly 500 bytes for ECDSA P-384. Clients skip verification or trust the
generated certificate. This shows the relay can serve an ML-DSA certificate. Issuing one
from a customer's own CA is theirs to arrange.

`-alg` accepts `mldsa87`, `mldsa65`, `mldsa44`, `ecdsa-p384`, and `ecdsa-p256`. The tool
writes `tls.alg` next to the certificate so the build can assert on the algorithm without a
certificate parser.

#### Measuring what a relay negotiates

A relay can have all three hybrid groups compiled in and still hand a client classical
ECDH, with a successful handshake and nothing in the logs. `relay-proxy/crypto-probe`
performs real handshakes and prints what came back as JSON:

```bash
docker compose -f docker-compose.yml -f docker-compose-cnsa.yml build crypto-probe
docker run --rm --network launchdarkly-network ld-relay-lab:crypto-probe \
  -target relay-proxy:8030
```

Against a relay built without `godebug tlssecpmlkem=1`, the NIST-curve profiles fail while
`x25519` succeeds, and key establishment reports `unmet` naming the profiles that failed.

Measuring this needs a TLS stack that supports ML-KEM group selection, which Node and the
browser do not expose, so anything building a UI on these numbers has to call the probe.
Output shape, status semantics, and the build-posture caveat are in
[relay-proxy/crypto-probe/README.md](relay-proxy/crypto-probe/README.md).

#### Chainguard build

`Dockerfile.chainguard` uses Chainguard's `go-fips` toolchain, where crypto is performed by
FIPS-validated OpenSSL through CGO rather than inside the Go binary. That makes it a
different mechanism from `Dockerfile.fips`, not a variant of it: `GOFIPS140` and the fips140
GODEBUG belong to the Go module and are absent here deliberately, and the two hold different
vendors' CMVP certificates. Never carry a certificate number or validation status from one
image to the other; the `fips140.mechanism` labels tell them apart once running.

Those images are commercial-tier:

```bash
# 1. Install chainctl — https://edu.chainguard.dev/chainguard/chainctl/
# 2. chainctl auth login
# 3. Add your org to .env
echo 'CHAINGUARD_ORG=your-org' >> .env
# 4. Build
docker compose -f docker-compose.yml -f docker-compose-chainguard.yml up -d --build
```

Without an entitled org the build stops at the first `FROM` with a registry auth error. Use
`Dockerfile.fips` instead, which needs no license and demonstrates the same post-quantum
behavior.

Its build-time checks have not been run against the real toolchain, since the images are
gated. If one trips on your first build, the check is more likely wrong than your build.

### 4. Changing Configuration

After modifying `.env` file:

```bash
# Stop and remove all containers
docker-compose down

# Start fresh containers with new environment variables
docker-compose up -d
```

Or to recreate specific containers:

```bash
docker-compose up -d --force-recreate app php
```

### 5. Updating to Latest Version

When pulling updates from the repository, rebuild containers to ensure you have the latest code:

```bash
# Pull latest changes from repository
git pull

# Stop all containers
docker-compose down

# Rebuild all containers with latest code (no cache)
docker-compose build --no-cache

# Start containers with fresh builds
docker-compose up -d
```

**Why `--no-cache` is important**: Docker aggressively caches build layers. Without `--no-cache`, you might get old code even after pulling updates. This is especially important for:
- Dashboard UI changes (`public/dashboard.html`)
- Application code changes (`src/`, `php/`)
- Configuration file updates

**Quick rebuild for specific services**:

```bash
# Rebuild only dashboard after UI changes
docker-compose build --no-cache dashboard && docker-compose up -d dashboard

# Rebuild only Node.js app
docker-compose build --no-cache app && docker-compose up -d app

# Rebuild only PHP app
docker-compose build --no-cache php && docker-compose up -d php
```

**Browser cache**: After rebuilding the dashboard, do a hard refresh in your browser:
- **Mac**: Cmd + Shift + R
- **Windows/Linux**: Ctrl + Shift + R
- **Or**: Close the tab completely and open a fresh one

### 6. Stop the Application

```bash
docker-compose down
```

## Configurable Service Ports

This application supports configurable service ports via environment variables, allowing you to customize port assignments to avoid conflicts or run multiple instances simultaneously.

### Overview

All user-facing services can be configured to use custom ports through the `.env` file:

- **Dashboard** (default: 8000) - Web UI
- **API Service** (default: 4000) - API gateway
- **Node.js Service** (default: 3000) - Node.js SDK demo
- **PHP Service** (default: 8080) - PHP SDK demo
- **Python Service** (default: 5000) - Python SDK demo
- **Data System Service** (default: 5001) - Python SDK data system builder (Relay with LaunchDarkly fallback)
- **Squid Proxy** (default: 3128) - HTTP proxy for relay-proxy connection management

**Fixed Infrastructure Ports** (cannot be changed):
- **Relay Proxy** (8030) - Required by LaunchDarkly architecture
- **Redis** (6379) - Required by LaunchDarkly Relay Proxy and PHP SDK

**Note**: The squid-proxy service is essential for the Relay Proxy Connection Toggle feature. It enables **fast, near-instant network disconnection testing** by routing relay-proxy traffic through a controllable proxy. Connection state changes happen in seconds, not minutes. See the [Architecture](#squid-proxy-enabling-fast-connection-management) section for details.

### Customizing Ports

To customize service ports:

1. **Edit the `.env` file** and modify the port variables:

```bash
# Example: Custom port configuration
DASHBOARD_PORT=9000
API_SERVICE_PORT=9001
NODE_SERVICE_PORT=9002
PHP_SERVICE_PORT=9003
PYTHON_SERVICE_PORT=9004
SQUID_PROXY_PORT=9005
```

2. **Restart the services** to apply changes:

```bash
docker-compose down
docker-compose up -d
```

3. **Access services on new ports**:

```bash
# Dashboard UI
http://localhost:9000

# API Service
http://localhost:9001

# Node.js Service
http://localhost:9002
```

### Why Some Ports Are Fixed

The Relay Proxy (8030) and Redis (6379) ports are hardcoded and cannot be changed because:

- **Relay Proxy (8030)**: LaunchDarkly's architecture requires the Relay Proxy to run on port 8030 for proper SDK integration and event forwarding
- **Redis (6379)**: The standard Redis port is required by the LaunchDarkly Relay Proxy configuration and PHP SDK daemon mode

These ports are fixed and cannot be changed, but they are exposed to the host machine (localhost:8030 and localhost:6379) for direct access and debugging.

### Troubleshooting Port Conflicts

If you encounter "port already in use" errors:

**1. Identify the conflicting port:**

The error message will indicate which port is in conflict:
```
Error: bind: address already in use
```

**2. Find the process using the port:**

On macOS/Linux:
```bash
lsof -i :8000
```

On Windows:
```bash
netstat -ano | findstr :8000
```

**3. Resolve the conflict:**

Option A: Stop the conflicting process
```bash
# macOS/Linux
kill <PID>

# Windows
taskkill /PID <PID> /F
```

Option B: Change the port in `.env` file
```bash
# Edit .env and change the conflicting port
DASHBOARD_PORT=8888
```

**4. Restart services:**
```bash
docker-compose down
docker-compose up -d
```

### Running Multiple Instances

You can run multiple instances of the application on the same machine by using different port configurations:

**Instance 1** (`.env`):
```bash
DASHBOARD_PORT=8000
API_SERVICE_PORT=4000
NODE_SERVICE_PORT=3000
PHP_SERVICE_PORT=8080
PYTHON_SERVICE_PORT=5000
SQUID_PROXY_PORT=3128
```

**Instance 2** (`.env.instance2`):
```bash
DASHBOARD_PORT=9000
API_SERVICE_PORT=9001
NODE_SERVICE_PORT=9002
PHP_SERVICE_PORT=9003
PYTHON_SERVICE_PORT=9004
SQUID_PROXY_PORT=9005
```

Start the second instance:
```bash
docker-compose --env-file .env.instance2 -p demo-instance2 up -d
```

### CORS Implications

When you change the dashboard port, the backend services automatically update their CORS (Cross-Origin Resource Sharing) configurations to allow requests from the new port. This is handled automatically through environment variables:

- **Node.js Service**: Reads `DASHBOARD_PORT` and allows `http://localhost:${DASHBOARD_PORT}`
- **Python Service**: Reads `DASHBOARD_PORT` and allows `http://localhost:${DASHBOARD_PORT}`
- **PHP Service**: Reads `DASHBOARD_PORT` and allows `http://localhost:${DASHBOARD_PORT}`

No manual CORS configuration is needed when changing ports.

### Port Configuration Reference

For complete details on port configuration, including architecture diagrams and advanced scenarios, see [PORTS.md](PORTS.md).

## Application Features

### User Interface

The demo application provides:

1. **Feature Flag Display**: Shows the current value of the `user-message` flag
2. **SDK Data Store Display**: View raw flag configurations cached by the SDK (context-independent)
3. **User Context Selector**: Switch between anonymous and custom user contexts
4. **Container Logs**: Real-time logs from both app-dev and relay-proxy containers
5. **Relay Proxy Status**: Detailed status information and performance metrics
6. **Relay Proxy Connection Toggle**: Simulate network disconnection scenarios
7. **Load Testing**: Built-in load testing tool

### Relay Proxy Connection Toggle

The dashboard includes a connection toggle that allows you to simulate network disconnection scenarios between the Relay Proxy and LaunchDarkly without stopping the container. This feature provides **fast, near-instant connection state changes** for efficient testing.

**What It Does:**
- **Disconnect**: Stops the squid-proxy container to block outbound network traffic from the Relay Proxy to LaunchDarkly
- **Reconnect**: Starts the squid-proxy container to restore connectivity
- **Status Display**: Shows current connection state (Connected/Disconnected/Container Stopped)
- **Fast State Changes**: Connection state changes happen in seconds, not minutes

**How to Use:**
1. Open the dashboard at http://localhost:8000
2. Locate the "Relay Proxy" panel
3. Find the "Connection to LaunchDarkly" toggle switch
4. Click the toggle to disconnect or reconnect
5. Observe the status text change quickly (Connected → Disconnected)

**What Happens During Disconnection:**
- Relay Proxy container remains running
- SDK clients (Node.js and PHP) continue to evaluate flags using cached data from Redis
- No new flag updates are received from LaunchDarkly
- Internal Docker network connectivity (Redis access) is preserved
- Dashboard continues to display cached flag data
- **Status updates appear within seconds** - no long waiting periods

**Fast Connection Management:**
Unlike traditional approaches that require waiting 30-120 seconds for TCP timeouts, this implementation uses squid-proxy container control for rapid state changes:
- **Disconnect**: Squid-proxy stops immediately, blocking new connections
- **Reconnect**: Squid-proxy starts immediately, allowing connections to resume
- **Status Detection**: Dashboard polls every 5 seconds and detects state changes quickly
- **No Long Delays**: Test connected/disconnected scenarios efficiently without waiting minutes

**Testing Scenarios:**
1. **Resilience Testing**: Verify your application continues to function with cached flags
2. **Daemon Mode vs Proxy Mode**: Compare PHP (daemon mode) and Node.js (proxy mode) behavior during disconnection
3. **Flag Update Lag**: Disconnect, change flags in LaunchDarkly, reconnect, and observe synchronization
4. **Cache Validation**: Confirm that Redis cache provides continuity during network issues

**Status Messages:**

The Relay Proxy status display shows specific messages to clearly explain what's degraded:

- **"Connected"**: Relay Proxy is healthy, connected to both LaunchDarkly and Redis
- **"Degraded - LaunchDarkly Connection Issue"**: Streaming connection to LaunchDarkly is interrupted, but Redis is available (serving cached data)
- **"Degraded - Redis Unavailable"**: Redis is down, but LaunchDarkly connection is active (limited caching)
- **"Degraded - Redis & LaunchDarkly Unavailable"**: Both Redis and LaunchDarkly connections are down (critical state)
- **"Degraded - Serving Cached Data"**: Generic degraded state (other issues detected)

The dashboard automatically detects the specific cause of degradation by examining:
- Redis connectivity (via ping check)
- Environment connection status (INTERRUPTED, OFF, or disconnected states)

This helps you quickly identify whether the issue is with LaunchDarkly connectivity, Redis availability, or both.

**Technical Details:**
- Uses Docker container stop/start commands to control squid-proxy
- Blocks all outbound traffic from relay-proxy when squid-proxy is stopped
- Connection state persists across dashboard refreshes
- Automatic status polling every 5 seconds

**Limitations:**
- **Container State**: Stopping squid-proxy blocks all relay-proxy outbound traffic
- **Container Restart**: Restarting the Relay Proxy container maintains the current squid-proxy state
- **Requires Docker Access**: API service container must have Docker socket access (already configured in docker-compose.yml)

**Auto-Configuration - Relay Proxy Enterprise Feature:**

This demo uses the Relay Proxy's **auto-configuration mode** (`AUTO_CONFIG_KEY`), a key feature of **LaunchDarkly Relay Proxy Enterprise**. This feature is used specifically to demonstrate the full capabilities of the Enterprise version.

**Why We Use Auto-Configuration:**
- **Enterprise Feature Showcase**: Auto-configuration is exclusive to Relay Proxy Enterprise and demonstrates its advanced capabilities
- **Simplified Setup**: Single `RELAY_PROXY_CONFIG_KEY` environment variable automatically configures all environments
- **Dynamic Environment Discovery**: Automatically detects and configures all environments associated with your account
- **Zero Manual Configuration**: No need to manually specify environment IDs, SDK keys, or Redis settings
- **Production-Ready Pattern**: Demonstrates how Enterprise customers deploy the Relay Proxy in real-world scenarios

**How Auto-Config Works:**
1. On startup, the Relay Proxy connects to LaunchDarkly using the `AUTO_CONFIG_KEY`
2. Downloads configuration for all environments (SDK keys, Redis settings, etc.)
3. Initializes each environment's SDK client automatically
4. Each SDK client reads from Redis (if available) and streams updates from LaunchDarkly
5. The Relay Proxy serves flag data to downstream SDK clients

**Connection Management Behavior:**

The disconnect feature stops the squid-proxy container to block network traffic **without restarting the relay-proxy container**. This is intentional because:

**Auto-Config Mode Dependency:**
- In auto-config mode, the Relay Proxy **must connect to LaunchDarkly on startup** to download its configuration
- The configuration tells the Relay Proxy which environments to serve and that it should use Redis as a data store
- This is the standard behavior for Enterprise deployments using auto-configuration

**What Happens If We Restart While Disconnected:**
1. ❌ Relay Proxy starts but **cannot reach LaunchDarkly** (network is blocked)
2. ❌ Cannot download auto-config (which includes Redis configuration)
3. ❌ **Doesn't know to read from Redis** - ends up with an empty cache
4. ❌ Cannot serve any flag data to downstream clients
5. ❌ Remains in degraded state until network is restored

**Why This Happens:**
- Auto-config mode requires LaunchDarkly connectivity on startup to discover which environments to initialize
- The Relay Proxy doesn't persist auto-config data to disk for offline restarts
- Without environment configuration, the Relay Proxy doesn't know which Redis keys to read

**Alternative Configuration Approach:**
While manual configuration is possible, this demo intentionally uses auto-configuration to showcase the Enterprise feature. Manual configuration would:
- ✅ Read configuration from environment variables on startup
- ✅ **Immediately connect to Redis** and load cached flags
- ✅ Serve cached data even while disconnected from LaunchDarkly
- ✅ Support instant reconnection via container restart
- ❌ Require manual specification of all environment IDs and settings
- ❌ Not demonstrate the Enterprise auto-configuration capability

**Demo Design Choice:**
- **Auto-config mode** (this demo): Showcases Relay Proxy Enterprise features with simplified setup
- **Manual config mode**: Available but not used, as it doesn't demonstrate Enterprise capabilities

**Recommended Usage:**
- ✅ **Disconnect without restart**: Relay Proxy continues serving from cache and Redis (works perfectly)
- ❌ **Disconnect + restart**: Relay Proxy cannot initialize (avoid this scenario in auto-config mode)
- ✅ **Production scenario**: Network outages rarely coincide with container restarts

**SDK Mode Comparison During Disconnection:**

| Scenario | Proxy Mode (Node.js) | Daemon Mode (PHP) |
|----------|---------------------|-------------------|
| **Disconnected (no restart)** | ✅ Works - serves from Relay Proxy cache | ✅ Works - reads from Redis |
| **Disconnected + Relay Proxy restart** | ❌ Fails - Relay Proxy can't initialize | ✅ Works - reads from Redis |
| **Real-time updates** | ✅ Streaming (instant) | ⚠️ Polling (5-30 second delay) |
| **Latency** | ~10-50ms (network call) | <1ms (local Redis) |
| **Throughput** | Moderate | Very high (4000+ req/sec) |
| **Complexity** | Simple (single connection) | Complex (Redis + events) |

**Trade-offs:**

**Proxy Mode (Node.js in this demo):**
- ✅ Real-time streaming updates (instant flag changes)
- ✅ Simpler configuration (single endpoint)
- ✅ No polling overhead
- ❌ Requires Relay Proxy to be running and initialized
- ❌ Cannot survive Relay Proxy restart during disconnection

**Daemon Mode (PHP in this demo):**
- ✅ Maximum resilience (survives Relay Proxy restart)
- ✅ Highest performance (direct Redis reads)
- ✅ Works even if Relay Proxy is down
- ❌ Polling-based updates (5-30 second delay)
- ❌ More complex configuration (Redis + events)
- ❌ Requires Redis to be available

**Alternative: Manual Environment Configuration**

While manual environment configuration is possible, this demo intentionally uses auto-configuration to showcase the **Relay Proxy Enterprise** feature:
- Manual config: Requires explicit environment IDs, SDK keys, and Redis settings
- Auto-config: Automatically discovers and configures all environments
- Trade-off: Manual config provides offline resilience, but doesn't demonstrate Enterprise capabilities

**For This Demo:**
- We use **auto-config to showcase Relay Proxy Enterprise features**
- The disconnect toggle is designed to simulate network issues **without restarting containers**
- This reflects real-world scenarios where network outages don't typically coincide with service restarts
- Both SDK modes demonstrate their respective strengths: Node.js shows streaming updates, PHP shows maximum resilience

**Example Workflow:**
```bash
# 1. Start all services
docker-compose up -d

# 2. Open dashboard and verify "Connected" status
# http://localhost:8000

# 3. Click disconnect toggle
# Status changes to "Disconnected"

# 4. Verify SDK clients still work (cached flags)
curl http://localhost:3000/api/flag
curl http://localhost:8080/api/status

# 5. Change flag value in LaunchDarkly dashboard
# SDK clients won't see the change (disconnected)

# 6. Click reconnect toggle
# Status changes to "Connected"

# 7. Wait 30 seconds for Relay Proxy to sync
sleep 30

# 8. Verify SDK clients now show updated flag value
curl http://localhost:3000/api/flag
curl http://localhost:8080/api/status
```

**API Endpoints:**

The connection toggle uses these API endpoints (also available for programmatic testing):

```bash
# Disconnect Relay Proxy from LaunchDarkly
curl -X POST http://localhost:4000/api/relay-proxy/disconnect

# Reconnect Relay Proxy to LaunchDarkly
curl -X POST http://localhost:4000/api/relay-proxy/reconnect

# Check current connection status
curl http://localhost:4000/api/relay-proxy/connection-status
```

For detailed API documentation, see [api-service/README.md](api-service/README.md#relay-proxy-connection-control).

### SDK Data Store Display

Each service panel includes an "SDK Data Store" section that displays the raw flag configurations cached locally by the SDK:

**What You Can See:**
- **Raw Flag Configurations**: Complete flag structure as stored in the SDK's internal data store
- **Variations**: All possible flag values with their indices
- **Targeting Rules**: Detailed rules with clauses, operators, and conditions
- **Percentage Rollouts**: Rollout configurations with variation weights
- **Individual Targets**: User keys explicitly targeted to specific variations
- **Prerequisites**: Flag dependencies if configured
- **Version Information**: Flag version numbers and enabled/disabled state

**Key Features:**
- **Context-Independent**: Shows raw flag data, not evaluated values for specific users
- **Always Visible**: Automatically displays when the SDK initializes
- **Auto-Refresh**: Automatically updates when flags change in LaunchDarkly
- **Real-Time Updates**: SSE keeps the display current without manual interaction

**Data Sources by Service:**
- **Node.js**: Shows data from the SDK's in-memory feature store (Proxy Mode)
- **PHP**: Shows data from the Redis data store (Daemon Mode)
- **Redis**: Shows raw flag data stored in Redis by the Relay Proxy

**Redis Panel:**
The Redis panel includes a dedicated "Redis Data Store" display that shows the raw flag configurations stored in Redis by the Relay Proxy. This provides visibility into:
- The shared data store used by the PHP SDK in daemon mode
- The cache used by the Relay Proxy for all environments
- The same flag data that multiple applications can read from
- Real-time updates as the Relay Proxy refreshes flag data from LaunchDarkly

**Relay Proxy Panel:**
The Relay Proxy panel includes a "Relay Proxy Cache" display that shows the internal Go SDK cache maintained by the Relay Proxy. This demonstrates data consistency across all layers:
- **Layer 1**: LaunchDarkly Cloud (source of truth)
- **Layer 2**: Relay Proxy's Internal Cache (Go SDK in-memory)
- **Layer 3**: Redis Persistent Store (shared cache)
- **Layer 4**: Node.js SDK Cache (receives from Relay Proxy)
- **Layer 5**: PHP SDK Cache (reads from Redis)

The Relay Proxy cache display shows:
- Raw flag configurations as served to downstream SDK clients
- The same data structure that Node.js receives via streaming
- Real-time updates when flags change in LaunchDarkly
- Complete flag details including variations, rules, targets, and prerequisites

This feature is useful for:
- Understanding how flags are structured internally
- Debugging targeting rules and rollouts
- Verifying flag configurations are cached correctly
- Learning how LaunchDarkly stores flag data
- Monitoring the shared Redis data store used by multiple services
- Demonstrating data consistency across the entire architecture

### User Context Management

**Anonymous Context:**
- Automatically generated unique key per session
- Optional geolocation (browser-based)
- Multi-context with container kind

**Custom Context:**
- Email address (required, used as context key)
- Name (optional)
- Automatic geolocation detection
- Multi-context with container kind

**Context Persistence Across SSE Connections:**

The application uses specialized context stores to ensure user context (including location attributes) persists across Server-Sent Events (SSE) connections:

**Node.js Context Store:**
- In-memory Map stores context by contextKey
- SSE connections pass contextKey in URL query parameter
- Context updates via POST endpoint stored in both session and in-memory store
- Ensures location attribute is available for flag evaluation in SSE endpoint

**PHP Context Store:**
- File-based store at `/tmp/php-context-store.json`
- Required because PHP doesn't maintain memory between requests
- SSE connections read from file store using contextKey
- Context updates stored in both session and file store
- Enables location-based targeting in daemon mode

**Why This Matters:**
- EventSource (SSE) creates separate HTTP connections that don't share session state
- Without context stores, location attributes wouldn't reach flag evaluation
- Enables targeting rules based on `user.location` attribute
- Works seamlessly for both Node.js (Proxy Mode) and PHP (Daemon Mode)

### Bucketing Hash Values

Each service panel includes a collapsible "Bucketing Hash Values" section that displays the hash calculation used by LaunchDarkly to determine which variation a user receives in percentage rollouts.

**What You Can See:**
- **Context Key**: The user identifier used in the hash calculation
- **Salt**: The unique salt value from the flag configuration
- **Hash Value**: The raw SHA-1 hash result (first 60 bits as decimal)
- **Bucket Value**: The normalized value between 0 and 1 used for rollout decisions

**How LaunchDarkly's Bucketing Algorithm Works:**

LaunchDarkly uses a deterministic hashing algorithm to assign users to variations in percentage rollouts:

1. **Hash Input Format**: `{flagKey}.{salt}.{contextKey}`
   - Example: `user-message.94b881a3be5c449d99dbbe1a92ca3fa0.node-anon-42163483`

2. **Hash Algorithm**: SHA-1 (not MurmurHash3)
   - Calculates SHA-1 hash of the input string
   - Extracts first 15 hexadecimal characters (60 bits)
   - Converts to decimal integer

3. **Bucket Calculation**: Divide by `0xFFFFFFFFFFFFFFF` (2^60 - 1)
   - Result is a float between 0 and 1
   - Example: `0.85104` means user is in the 85.104th percentile

4. **Variation Assignment**: Compare bucket value to rollout percentages
   - Variation 0: 0% - 50% (bucket < 0.5)
   - Variation 1: 50% - 100% (bucket >= 0.5)
   - User with bucket `0.85104` receives Variation 1

**Technical Implementation:**

Both Node.js and PHP implementations use identical algorithms to ensure consistency:

**Node.js** (`src/nodejs/src/calculateHashValue.js`):
```javascript
import crypto from 'crypto';

// LaunchDarkly's bucketing algorithm
const hashKey = `${flagKey}.${salt}.${contextKey}`;

// Calculate SHA-1 hash
const sha1Hash = crypto.createHash('sha1').update(hashKey).digest('hex');

// Extract first 15 hex characters (60 bits)
const hashPrefix = sha1Hash.substring(0, 15);

// Convert to integer and normalize
const hashValue = parseInt(hashPrefix, 16);
const bucketValue = hashValue / 0xFFFFFFFFFFFFFFF;
```

**PHP** (`src/php/src/CalculateHashValue.php`):
```php
// LaunchDarkly's bucketing algorithm
$hashKey = "{$flagKey}.{$salt}.{$contextKey}";

// Calculate SHA-1 hash
$sha1Hash = sha1($hashKey);

// Extract first 15 hex characters (60 bits)
$hashPrefix = substr($sha1Hash, 0, 15);

// Convert using GMP for precise large integer handling
$hashGmp = gmp_init($hashPrefix, 16);
$divisorGmp = gmp_init('FFFFFFFFFFFFFFF', 16); // 2^60 - 1

// Calculate bucket value
$bucketValue = (float)gmp_strval($hashGmp) / (float)gmp_strval($divisorGmp);
```

**Why This Feature Matters:**

- **Educational**: Understand how LaunchDarkly assigns users to variations
- **Debugging**: Verify why a specific user receives a particular variation
- **Consistency**: Confirm both Node.js and PHP return identical values
- **Transparency**: See the exact calculation behind percentage rollouts
- **Predictability**: Same context key always gets same bucket value for a flag

**Cross-Platform Consistency:**

The demo verifies that both Node.js and PHP implementations return identical hash and bucket values for the same inputs, demonstrating that LaunchDarkly's bucketing algorithm works consistently across different SDK implementations and languages.

**Example Output:**
```
Context Key: node-anon-42163483-4966-4ba0-ac94-6700041f00d3
Salt: 94b881a3be5c449d99dbbe1a92ca3fa0
Hash Value: 1001234567890123
Bucket Value: 0.85104
```

In this example, the user's bucket value of `0.85104` means they fall into the 85.104th percentile. With a 50/50 rollout, they would receive Variation 1 (the second variation) since their bucket value is >= 0.5.

### Real-Time Flag Updates

The application uses Server-Sent Events (SSE) to push flag changes instantly:
- No page refresh required
- Automatic reconnection on connection loss
- Detailed logging of flag changes in console

**SSE Connection Behavior:**

The dashboard maintains persistent SSE connections to both Node.js and PHP services for real-time flag updates:

**Node.js (Proxy Mode):**
- Receives instant push updates via streaming from Relay Proxy
- Updates appear immediately when flags change in LaunchDarkly
- Connection stays open indefinitely

**PHP (Daemon Mode with Polling):**
- Polls Redis every 5 seconds for flag changes
- Updates appear within 5 seconds of flag changes in LaunchDarkly
- Demonstrates how daemon mode can still provide near-real-time updates
- Connection closes after 5 minutes and automatically reconnects

**Connection Management:**
- **Connection Timeout**: PHP SSE connections automatically close after 5 minutes
- **Automatic Reconnection**: The dashboard seamlessly reconnects when a connection closes
- **Heartbeat Monitoring**: Connections send heartbeats to detect disconnects
- **Why This Matters**: Prevents PHP-FPM worker exhaustion and memory leaks from indefinite connections

**What You'll See:**
- Every 5 minutes, the PHP connection will show "Connection timeout - please refresh"
- The dashboard automatically reconnects within seconds
- This is **expected behavior** and ensures long-term stability
- Node.js connections remain open indefinitely (handled differently by Node.js runtime)

**Connection Lifecycle:**
1. Initial connection established
2. Flag value sent immediately
3. Heartbeats sent every 15 seconds
4. After 5 minutes, PHP connection closes gracefully
5. Dashboard reconnects automatically
6. Process repeats

This design ensures the demo can run for extended periods without manual intervention or resource issues.

### Service Panels Overview

The dashboard displays four service panels, each demonstrating a different LaunchDarkly SDK implementation. Panel 1 is dynamic and switches between Node.js, Python, and JavaScript Client based on the `dashboard-service-panel-1` feature flag.

#### Node.js Service Panel (Panel 1 - Dynamic)

**What It Shows:**
- Flag evaluation for `user-message` flag
- Current context (anonymous or custom with attributes)
- Bucketing hash values (context key, salt, hash, bucket value)
- SDK Data Store (raw flag configurations cached by the SDK)
- Context editor for testing different user attributes
- Test flag evaluation button

**SDK Client Behavior:**
- **Mode**: Proxy Mode (Server-Side SDK)
- **Connection**: All traffic through Relay Proxy
- **Updates**: Real-time streaming (instant flag changes)
- **Caching**: SDK caches flag configurations locally
- **Events**: Analytics events sent through Relay Proxy
- **Offline Behavior**: Uses cached flags when Relay Proxy is unavailable

#### Python Service Panel (Panel 1 - Dynamic)

**What It Shows:**
- Flag evaluation for `user-message` flag
- Current context (anonymous or custom with attributes)
- Bucketing hash values (context key, salt, hash, bucket value)
- SDK Data Store (raw flag configurations cached by the SDK)
- Context editor for testing different user attributes
- Test flag evaluation button

**SDK Client Behavior:**
- **Mode**: Default Mode (Server-Side SDK)
- **Connection**: Direct to LaunchDarkly (bypasses Relay Proxy and Squid Proxy)
- **Updates**: Real-time streaming (instant flag changes)
- **Caching**: SDK caches flag configurations locally
- **Events**: Analytics events sent directly to LaunchDarkly
- **Offline Behavior**: Uses cached flags when LaunchDarkly is unavailable
- **Independence**: Continues working even when Relay Proxy is down

#### JavaScript Client Panel (Panel 1 - Dynamic)

**What It Shows:**
- Flag evaluation for `user-message` flag
- Current context (anonymous or custom with attributes)
- Bucketing hash values (context key, salt, hash, bucket value)
- SDK Data Store (evaluated flag values for current context)
- Context editor for testing different user attributes
- Test flag evaluation button

**SDK Client Behavior:**
- **Mode**: Proxy Mode (Client-Side SDK)
- **Connection**: All traffic through Relay Proxy (runs in browser)
- **Updates**: Real-time streaming (instant flag changes)
- **Caching**: SDK caches evaluated flag values for current context only (NOT flag configurations)
- **Events**: Analytics events sent through Relay Proxy
- **Offline Behavior**: 
  - Shows fallback variation when context changes and Relay Proxy is unavailable
  - Automatically retries identify() when connection is restored
  - Displays "⚠️ Offline - Data may be stale" warning in SDK Data Store
  - Reconnection detected within 2 seconds via periodic check

**Key Difference from Server-Side SDKs:**
- Client-side SDKs do NOT cache flag configurations
- They only cache evaluated flag values for the current context
- When context changes offline, SDK cannot evaluate and returns fallback value
- Server-side SDKs cache flag configurations and can evaluate any context offline

#### PHP Service Panel (Panel 2 - Fixed)

**What It Shows:**
- Flag evaluation for `user-message` flag
- Current context (anonymous or custom with attributes)
- Bucketing hash values (context key, salt, hash, bucket value)
- SDK Data Store (raw flag configurations from Redis)
- Context editor for testing different user attributes
- Test flag evaluation button

**SDK Client Behavior:**
- **Mode**: Daemon Mode (Server-Side SDK)
- **Connection**: Reads flags from Redis, sends events through Relay Proxy
- **Updates**: Polling-based (5-second delay for flag changes)
- **Caching**: Reads directly from Redis (no local cache)
- **Events**: Analytics events sent through Relay Proxy
- **Offline Behavior**: 
  - Works even when Relay Proxy is down (reads from Redis)
  - Highest resilience - survives Relay Proxy restarts
  - Highest performance - <1ms latency (local Redis reads)
  - Trade-off: 5-second delay for flag updates vs instant streaming

**Key Difference from Other Modes:**
- Only SDK that reads flags from Redis instead of streaming/polling LaunchDarkly
- Requires Relay Proxy to populate Redis, but doesn't need it for flag reads
- Best for high-throughput applications (4000+ requests/second)

### Terminal Panels Window

The dashboard includes a separate browser window for viewing real-time container logs, controlled by the `terminal-panels` feature flag:

**Window Management:**
- **Automatic Opening**: When the `terminal-panels` flag is `true`, a separate browser window opens automatically
- **Popup Blocker**: If your browser blocks the popup, you'll see a notification with a manual link
- **Window Synchronization**: The terminal window automatically switches services when you change Panel 1 in the dashboard
- **Flag-Controlled**: Toggle the `terminal-panels` flag in LaunchDarkly to show/hide the window

**Terminal Consoles:**
- **Panel 1 Service** (dynamic): Shows logs for the currently selected service (Node.js, Python, or JavaScript Client)
  - Node.js: Application and SDK logs from the Node.js container
  - Python: Application and SDK logs from the Python container
  - JavaScript Client: Browser console logs from the dashboard (filtered for JavaScript Client messages)
- **PHP Service**: Application and SDK logs from the PHP container
- **Relay Proxy**: Relay proxy connection and event logs
- **Redis Monitor**: Live stream of all Redis commands showing feature flag operations in real-time

**Features:**
- **Clear Button**: Truncates container logs or clears monitor display
- **Auto-Refresh**: Updates every 2 seconds (Docker logs) or streams live (Redis monitor, JavaScript console)
- **Service Switching**: Panel 1 automatically switches between Node.js, Python, and JavaScript based on the `dashboard-service-panel-1` flag
- **Console Interception**: JavaScript Client mode captures and displays browser console logs from the dashboard

**Browser Requirements:**
- Allow popups from localhost:8000 for automatic window opening
- Modern browser with EventSource support for real-time updates
- Separate window can be manually opened via the notification link if popup is blocked

### Relay Proxy Status

Comprehensive status dashboard showing:

**Performance Metrics:**
- CPU usage percentage
- Memory usage and percentage
- Real-time updates

**Overall Status:**
- Health status (healthy/degraded)
- Relay proxy version
- SDK client version

**Environment Status:**
- Connection state (VALID/INITIALIZING/INTERRUPTED/OFF)
- Data store status
- Big Segments status
- Last error information

### Load Testing

Built-in load testing tool to measure SDK performance for both Node.js and PHP applications:

**Configuration:**
- Target Service: Node.js (Proxy Mode) or PHP (Daemon Mode)
- Number of Requests: 1-1000 total flag evaluations
- Concurrency: 1-100 simultaneous requests

**Metrics:**
- Total requests completed
- Successful evaluations
- Failed evaluations
- Average response time (milliseconds)
- Requests per second (throughput)

**Performance Comparison:**
- **Node.js (Proxy Mode)**: ~10-50ms average latency, moderate throughput
  - Evaluates flags through Relay Proxy over HTTP
  - Demonstrates real-world network latency
  - Suitable for interactive applications
  
- **PHP (Daemon Mode)**: <1ms average latency, very high throughput (4000+ req/sec)
  - Reads flags directly from Redis
  - Minimal latency, maximum performance
  - Ideal for high-throughput scenarios

**How to Use:**
1. Open the dashboard at http://localhost:8000
2. Scroll to the "Relay Proxy Load Test" panel
3. Select target service (Node.js or PHP)
4. Configure number of requests and concurrency level
5. Click "Start Test" to begin
6. View real-time results in the output panel

**Example Results:**
```
Node.js Load Test:
Total Requests: 100
Successful: 100
Failed: 0
Average Response Time: 15.23ms
Requests/sec: 250.45

PHP Load Test:
Total Requests: 100
Successful: 100
Failed: 0
Average Response Time: 0.23ms
Requests/sec: 4118.44
```

## Architecture

### 9-Container Architecture

This application uses a microservices architecture with nine specialized containers:

**dashboard** (Dashboard UI Container):
- Nginx Alpine
- Serves static web UI (HTML, CSS, JavaScript)
- Port: 8000
- Purpose: User interface for monitoring and demonstration

**api-service** (API Service Container):
- Node.js 18 Alpine
- Express web server
- Centralized API gateway for status checks and operations
- Docker CLI for container management
- Port: 4000
- Purpose: Cross-service communication and monitoring

**app-dev** (Node.js Application Container):
- Node.js 24 Alpine
- Express web server
- LaunchDarkly SDK v9.10.5
- **Fixed Mode**: Proxy Mode only
- Port: 3000
- Purpose: LaunchDarkly Node.js SDK demonstration

**python-app-dev** (Python Application Container):
- Python 3.11 Alpine
- Flask web server
- LaunchDarkly Python SDK v9.7+
- **Fixed Mode**: Default Mode (Direct Connection)
- Port: 5000
- Purpose: LaunchDarkly Python SDK demonstration

**data-system-app** (Data System Configuration Container):
- Python 3.11 Alpine
- Flask web server
- LaunchDarkly Python SDK v9.14.1
- **Mode**: `datasystem.custom()` — Relay-first with LaunchDarkly fallback
- Port: 5001
- Purpose: Demonstrate SDK data system fallback: Relay streaming → LaunchDarkly streaming → polling

**php-app-dev** (PHP Application Container):
- PHP 8.3-FPM Alpine
- Nginx web server
- LaunchDarkly PHP SDK v6.4+
- **Fixed Mode**: Daemon Mode (Redis + Events) only
- Port: 8080
- Purpose: LaunchDarkly PHP SDK demonstration

**dashboard** (Dashboard UI Container - includes JavaScript Client):
- Nginx Alpine
- Serves static web UI (HTML, CSS, JavaScript)
- LaunchDarkly JavaScript Client SDK v3.9.0 (runs in browser)
- **Fixed Mode**: Proxy Mode (Client-Side) only
- Port: 8000
- Purpose: User interface with embedded JavaScript SDK demonstration

**relay-proxy** (Relay Proxy Container):
- LaunchDarkly Relay Proxy v9.0.0-rc.6 (FDv2 `/sdk/stream` for the Data System Builder)
- Default: official `launchdarkly/ld-relay` image (`docker-compose.yml`)
- FIPS: local build via `docker-compose-fips.yml` + `relay-proxy/Dockerfile.fips`: native Go
  Cryptographic Module (`GOFIPS140=v1.0.0`), static binary, `GODEBUG=fips140=on`, ML-KEM
  hybrid key exchange enabled, no legacy cipher suite negotiable. No license required
- Chainguard: local build via `docker-compose-chainguard.yml` + `relay-proxy/Dockerfile.chainguard`:
  FIPS-validated OpenSSL via CGO, dynamically linked. Requires a commercial Chainguard license
- CNSA: local build via `docker-compose-cnsa.yml` + `relay-proxy/Dockerfile.cnsa`: adds
  ML-DSA-87 authentication and sets `TLS_ENABLED=true`, so SDK containers pointed at
  `http://relay-proxy:8030` will not connect under it. Trades the CMVP certificate for the
  in-process module
- AutoConfig mode
- Event forwarding enabled
- Redis integration for persistent storage
- **Network Configuration**: Routes outbound traffic through squid-proxy for connection management
- Port: 8030
- Purpose: Feature flag caching and event forwarding

**redis** (Redis Container):
- Redis 7 Alpine
- Persistent data store for feature flags
- AOF (Append-Only File) persistence enabled
- Health checks every 5 seconds
- Port: 6379 (internal Docker network)
- Volume: redis-data for persistent storage
- Purpose: Shared data store for feature flags

**squid-proxy** (HTTP Proxy Container):
- Squid 6 Alpine
- HTTP/HTTPS proxy server
- Static IP assignment (172.18.0.80) for reliable routing
- Port: 3128
- Purpose: Network traffic control for relay-proxy connection management

### Squid Proxy: Enabling Fast Connection Management

The squid-proxy service is a critical infrastructure component that enables the **Relay Proxy Connection Toggle** feature to work efficiently. Here's how it works:

**Why We Need It:**
- The Relay Proxy maintains a long-lived streaming connection to LaunchDarkly
- Traditional disconnection methods require stopping the entire relay-proxy container (slow, disruptive, loses state)
- With squid-proxy, we can control network traffic by stopping/starting the proxy container (fast, non-disruptive, preserves state)

**How It Works:**
1. **Traffic Routing**: The relay-proxy container is configured to route all outbound HTTP/HTTPS traffic through squid-proxy using the `HTTP_PROXY` and `HTTPS_PROXY` environment variables
2. **Static IP Assignment**: squid-proxy has a fixed IP address (172.18.0.80) on the Docker network for reliable routing
3. **Container Control**: The api-service can stop/start the squid-proxy container to block/allow traffic to LaunchDarkly
4. **Fast Disconnection**: When you click "Disconnect" in the dashboard, squid-proxy is stopped immediately - connection state changes within seconds
5. **Fast Reconnection**: When you click "Connect", squid-proxy is started immediately - relay-proxy detects and reconnects quickly

### Data System Configuration Builder

The dashboard **Data System Builder** panel (to the right of Redis) shows the Python SDK fallback path in order:

1. Stream from Relay Proxy
2. Stream from LaunchDarkly directly
3. Poll LaunchDarkly as last resort

The SDK configuration lives in [`data-system/app.py`](data-system/app.py) in `_build_data_system_config()`.

**Kill Relay Port** stops the `relay-proxy` container, taking port 8030 down for every Relay client. Node.js (proxy mode) and the JavaScript Client lose their data source and fail. This SDK keeps evaluating by walking that fallback path. PHP daemon mode may continue from Redis cache until that data goes stale. **Restore Relay Port** starts Relay again.

This is different from the Relay Proxy **Disconnect** toggle, which uses squid-proxy to cut Relay's outbound connection to LaunchDarkly.

**Benefits:**
- **Speed**: Connection state changes happen in seconds, not minutes - ideal for rapid testing
- **No Waiting**: Test connected/disconnected scenarios efficiently without long TCP timeout delays
- **Reliability**: The relay-proxy container stays running, preserving its internal state and Redis connections
- **Realism**: Simulates real-world network issues (proxy failures, network outages) rather than container failures
- **Observability**: You can watch the relay-proxy logs in real-time as it detects the disconnection and attempts to reconnect

**Network Flow:**
```
relay-proxy → squid-proxy (172.18.0.80:3128) → LaunchDarkly
                    ↑
              Container stop/start controls traffic here
              (Fast state changes - seconds, not minutes)
```

When disconnected, the squid-proxy container is stopped, immediately blocking new connections while preserving internal Docker network connectivity to Redis.

### Port Mappings

All service ports are configurable via environment variables in the `.env` file, except for the fixed infrastructure ports (Relay Proxy and Redis).

| Service | Default Port | Environment Variable | Purpose |
|---------|--------------|---------------------|---------|
| Dashboard | 8000 | `DASHBOARD_PORT` | Web UI access (includes all service panels) |
| API Service | 4000 | `API_SERVICE_PORT` | API endpoints for status and operations |
| Node.js App | 3000 | `NODE_SERVICE_PORT` | Backend API only (no UI) |
| Python App | 5000 | `PYTHON_SERVICE_PORT` | Backend API only (no UI) |
| Data System App | 5001 | `DATA_SYSTEM_PORT` | Python SDK data system builder (Relay fallback demo) |
| PHP App | 8080 | `PHP_SERVICE_PORT` | Backend API only (no UI) |
| Relay Proxy | 8030 | **FIXED** | LaunchDarkly Relay Proxy (cannot be changed, exposed to host) |
| Redis | 6379 | **FIXED** | Redis data store (cannot be changed, exposed to host) |
| Squid Proxy | 3128 | `SQUID_PROXY_PORT` | HTTP proxy service |

**Note**: The Relay Proxy and Redis ports are fixed and cannot be changed via environment variables. See the [Configurable Service Ports](#configurable-service-ports) section for details.

### Network

All containers communicate via a custom Docker bridge network (`launchdarkly-network`).

### Multi-Language SDK Integration

This demo showcases SDK integration across four different languages, each demonstrating a distinct integration pattern:

**Node.js Application** (Proxy Mode only):
- All SDK traffic goes through the Relay Proxy
- Receives real-time flag updates via streaming
- Sends analytics events through the Relay Proxy
- Backend API accessible at http://localhost:3000

**Python Application** (Default Mode - Direct Connection):
- Connects directly to LaunchDarkly for flag updates
- Receives real-time streaming updates from LaunchDarkly
- Sends analytics events directly to LaunchDarkly
- No Relay Proxy or Redis dependency
- Backend API accessible at http://localhost:5000

**PHP Application** (Daemon Mode only):
- Reads flags directly from Redis for high-performance evaluation
- Sends analytics events through the Relay Proxy
- No direct LaunchDarkly API connections for flag evaluation
- Backend API accessible at http://localhost:8080

**JavaScript Client** (Proxy Mode - Client-Side):
- Client-side SDK running directly in the browser within the dashboard
- All SDK traffic goes through the Relay Proxy
- Receives real-time flag updates via streaming
- Sends analytics events through the Relay Proxy
- Runs as part of the dashboard at http://localhost:8000

**Offline Behavior & Automatic Reconnection:**
- When Relay Proxy is unavailable and context changes, displays fallback variation
- Automatically detects reconnection and retries failed identify() calls
- Stores pending context changes and applies them when connection is restored
- SDK Data Store shows "⚠️ Offline - Data may be stale" warning during disconnection
- Reconnection detection uses multiple mechanisms:
  - SDK `change` event (fires when SDK reconnects and syncs flags)
  - Periodic check every 2 seconds (fallback mechanism)
  - Automatically retries identify with pending context within 2 seconds of reconnection

All applications:
- Evaluate the same feature flags
- Send analytics events to LaunchDarkly
- Demonstrate how multiple SDKs in different languages work together
- Display in a unified dashboard with dynamic panel switching

The dashboard includes a JavaScript Client panel that demonstrates the LaunchDarkly JavaScript SDK running directly in the browser, communicating with the Relay Proxy for flag evaluation and event tracking.

### API Service Endpoints

The API service provides centralized endpoints for monitoring and operations:

**Status Endpoints:**
- `GET /api/relay-status` - Relay Proxy connection status
- `GET /api/redis/status` - Redis connectivity check
- `GET /api/node/status` - Node.js application status
- `GET /api/php/status` - PHP application status

**Operations Endpoints:**
- `GET /api/logs/:container` - Retrieve container logs (last 50 lines)
- `GET /api/relay-metrics` - Relay Proxy CPU and memory metrics

**Health Check:**
- `GET /health` - API service health status

All API endpoints are accessible at http://localhost:4000

For detailed API documentation, see [api-service/README.md](api-service/README.md)

### Redis Integration

The relay proxy uses Redis as a persistent data store for caching feature flag configurations. This architecture provides a clear separation of concerns with each application using its optimal integration pattern.

**Architecture Diagram:**

```
┌─────────────────┐
│  Dashboard      │  (Port 8000)
│  Static UI      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Service    │  (Port 4000)
│  Status/Metrics │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Node.js App    │      │  Dashboard      │      │  PHP App        │      │  Python App     │
│  (Relay Proxy   │      │  + JavaScript   │      │  (Daemon Mode)  │      │  (Default Mode) │
│   Mode Only)    │      │  Client SDK     │      │  Redis + Events │      │  Direct Connect │
│  (Port 3000)    │      │  (Port 8000)    │      │  (Port 8080)    │      │  (Port 5000)    │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │                        │
         │ All SDK Traffic        │ Browser SDK            │ Direct Read            │ Direct
         ▼                        │ Traffic                ▼                        │ Connection
┌─────────────────┐               │               ┌─────────────────┐               │
│  Relay Proxy    │◄──────────────┘               │  Redis          │               │
│  (Port 8030)    │─────────────────────────────►│  (Port 6379)    │               │
└────────┬────────┘                               └─────────────────┘               │
         │                                                                           │
         │ Outbound Traffic                                                          │
         ▼                                                                           │
┌─────────────────┐                                                                  │
│  Squid Proxy    │                                                                  │
│  (Port 3128)    │                                                                  │
│  172.18.0.80    │                                                                  │
└────────┬────────┘                                                                  │
         │                                                                           │
         │ Container stop/start controlled                                           │
         ▼                                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                           LaunchDarkly Cloud Service                                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Key Architecture Points:**
- **Dashboard**: Serves static UI with embedded JavaScript Client SDK, fetches data from API service
- **API Service**: Centralized gateway for status checks and operations
- **Node.js**: Single path through Relay Proxy (streaming + events)
- **Python**: Direct connection to LaunchDarkly (streaming + events)
- **PHP**: Direct Redis reads for flags, Relay Proxy for events only
- **JavaScript Client**: Browser-based SDK through Relay Proxy (streaming + events)
- **Squid Proxy**: HTTP proxy for relay-proxy traffic control (enables connection toggle feature)
- **Simplified Configuration**: No mode switching logic in any application
- **Optimized Performance**: Each application uses its ideal integration pattern

**Benefits of This Architecture:**

**Data Persistence**: Feature flag data persists across container restarts, reducing initialization time and API calls to LaunchDarkly.

**Network Control**: The squid-proxy enables fast, non-disruptive connection management for the relay-proxy. By routing relay-proxy's outbound traffic through squid-proxy (static IP 172.18.0.80), we can stop/start the squid-proxy container to simulate network disconnections without restarting the relay-proxy. This allows realistic testing of offline behavior and reconnection logic.

**Persistence Mechanism**: Redis uses AOF (Append-Only File) persistence, which logs every write operation to disk. The data is stored in a Docker volume (`redis-data`) that survives container removal and recreation.

**Relay Proxy Configuration**: The relay proxy is configured with:
- `USE_REDIS=1` - Enables Redis as the persistent store
- `REDIS_URL=redis://redis:6379` - Connection string using internal hostname
- `ENV_DATASTORE_PREFIX=ld-flags-'$CID'` - Prefix for environment-specific keys

**SDK Configuration Options:**

The LaunchDarkly SDK can be configured to use Redis directly as a feature store:

```javascript
// Option 1: Via Relay Proxy (current demo configuration)
const client = LD.init(sdkKey, {
  baseUri: 'http://relay-proxy:8030',
  streamUri: 'http://relay-proxy:8030',
  eventsUri: 'http://relay-proxy:8030'
});

// Note: This demo uses Proxy Mode (shown above) for Node.js
// For daemon mode with direct Redis access (like the PHP app), you would use:
// const RedisFeatureStore = require('launchdarkly-node-server-sdk/integrations').Redis;
// const client = LD.init(sdkKey, {
//   featureStore: RedisFeatureStore({
//     redisOpts: { host: 'redis', port: 6379 },
//     prefix: 'ld-flags',
//     cacheTTL: 30
//   })
// });
```

**Automatic Configuration**: The relay proxy automatically discovers and caches all environments configured via the `AUTO_CONFIG_KEY`, storing each environment's data separately in Redis with environment-specific prefixes.

**Live Monitoring**: The UI includes a Redis monitor console that streams all Redis commands in real-time using `redis-cli MONITOR`. This allows you to watch:
- GET/SET operations for feature flag data
- Key operations when flags are updated
- Connection health checks (PING commands every 5 seconds)
- All other Redis operations in the system

**Data Structure**: Feature flags are stored in Redis with keys like:
- `ld-flags-'<environment-id>':features` - Feature flag configurations
- `ld-flags-'<environment-id>':segments` - User segment definitions
- `ld-flags-'<environment-id>':$inited` - Initialization markers

### Verifying Redis Connectivity

To verify Redis is working correctly:

```bash
# Check Redis container is running and healthy
docker-compose ps redis

# View Redis logs
docker-compose logs redis

# Connect to Redis CLI and check stored data
docker exec redis redis-cli KEYS "*"

# Check specific feature flag data
docker exec redis redis-cli GET "ld-flags-'<environment-id>':features"

# Monitor Redis commands in real-time (also available in UI)
docker exec redis redis-cli MONITOR

# Check relay proxy logs for Redis connection
docker-compose logs relay-proxy | grep -i redis

# Verify data persistence
# 1. Let services run for a minute to cache data
# 2. Check data exists: docker exec redis redis-cli KEYS "*"
# 3. Restart Redis: docker-compose restart redis
# 4. Wait for Redis to be healthy: docker-compose ps redis
# 5. Verify data persists: docker exec redis redis-cli KEYS "*"
```

**Using the UI Redis Monitor:**

The application UI includes a live Redis monitor console that shows all Redis commands in real-time:
1. Open the dashboard at http://localhost:8000
2. Look at the rightmost console panel labeled "redis monitor (live commands)"
3. Watch as commands stream in real-time
4. Trigger activity by refreshing the page or changing user context
5. Click "Clear" to reset the monitor display

### SDK Configuration

The SDK is configured as a singleton with:
- Automatic initialization on startup
- Background retry on connection failure
- Automatic recovery when relay proxy becomes available
- Event flushing on shutdown
- Flag change listeners for real-time updates

## Docker Health Checks

This application uses Docker health checks to monitor container health and manage service dependencies. Health checks run automatically in the background and are a normal part of the application's operation.

### What Are Health Checks?

Health checks are periodic tests that Docker runs to verify a container is functioning correctly. They help ensure:
- Services are ready to accept connections before dependent services start
- Containers are restarted automatically if they become unhealthy
- The overall system remains stable and responsive

### Configured Health Checks

The following containers have health checks configured:

**Redis** (every 5 seconds):
- Command: `redis-cli ping`
- Purpose: Verifies Redis is accepting connections
- Critical: Other services wait for Redis to be healthy before starting
- Timeout: 3 seconds
- Retries: 5 attempts before marking unhealthy

**Dashboard** (every 10 seconds):
- Command: `curl -f http://localhost:8000/`
- Purpose: Verifies Nginx is serving the web UI
- Timeout: 3 seconds
- Retries: 3 attempts before marking unhealthy

**API Service** (every 10 seconds):
- Command: `curl -f http://localhost:4000/health`
- Purpose: Verifies the API gateway is responding
- Timeout: 3 seconds
- Retries: 3 attempts before marking unhealthy

### What You'll See

When monitoring Docker events or logs, you may observe:

**Health Check Activity**:
- Health check commands run every 5-10 seconds (this is normal)
- You'll see periodic container executions in Docker events
- These are lightweight operations that don't impact performance

**Temporary Alpine Containers**:
- Short-lived Alpine containers may appear during Docker operations
- These are created by Docker commands for various management tasks
- They are automatically removed after completing their task
- This is expected behavior for container management operations

### Viewing Health Status

Check the health status of all containers:

```bash
# View health status for all services
docker-compose ps

# View detailed health check logs for a specific container
docker inspect redis --format='{{json .State.Health}}' | jq

# Monitor health check events in real-time
docker events --filter type=container --filter event=health_status

# View health check history
docker inspect redis --format='{{range .State.Health.Log}}{{.Start}} - {{.ExitCode}} - {{.Output}}{{end}}'
```

### Health Check Dependencies

The docker-compose.yml configuration uses health checks to manage startup order:

**Redis → Relay Proxy**:
- Relay Proxy waits for Redis to be healthy before starting
- Ensures Redis is ready to accept connections for flag storage
- Prevents connection errors during initialization

**Redis → PHP Application**:
- PHP application waits for Redis to be healthy before starting
- Ensures Redis is available for daemon mode flag reads
- Prevents PHP SDK initialization failures

**No Dependencies for Dashboard**:
- Dashboard is a static site that doesn't require backend services to start
- Remains available even if backend services restart
- Connects to services via client-side JavaScript

### Troubleshooting Health Checks

If a container is marked as unhealthy:

```bash
# Check why a container is unhealthy
docker inspect <container-name> --format='{{json .State.Health}}' | jq

# View recent health check failures
docker-compose logs <container-name> | grep -i health

# Manually run the health check command
docker exec <container-name> <health-check-command>

# Example: Test Redis health check manually
docker exec redis redis-cli ping

# Example: Test API service health check manually
docker exec api-service curl -f http://localhost:4000/health
```

**Common Issues**:
- **Redis unhealthy**: Check if Redis is running and accepting connections
- **Dashboard unhealthy**: Verify Nginx is running and port 8000 is accessible
- **API service unhealthy**: Check if the Express server started successfully

### Disabling Health Checks

Health checks can be disabled by removing the `healthcheck` sections from docker-compose.yml, but this is not recommended as it may cause:
- Services starting before their dependencies are ready
- Connection errors during initialization
- Reduced system reliability

## SDK Configuration Examples

The Node.js, Python, and PHP applications use distinct, optimized integration patterns with LaunchDarkly.

### Node.js SDK - Proxy Mode

The Node.js application always uses Proxy mode for all SDK operations:

```javascript
const LD = require('@launchdarkly/node-server-sdk');

const client = LD.init(sdkKey, {
  baseUri: 'http://relay-proxy:8030',      // Flag polling endpoint
  streamUri: 'http://relay-proxy:8030',    // Streaming updates endpoint
  eventsUri: 'http://relay-proxy:8030',    // Analytics events endpoint
  stream: true,                             // Enable streaming for real-time updates
  sendEvents: true                          // Send analytics events
});
```

**Key Points**:
- All three URIs point to the Relay Proxy
- Streaming enabled for real-time flag updates
- Events are sent through the Relay Proxy to LaunchDarkly
- Relay Proxy handles caching via Redis internally

### Python SDK - Default Mode (Direct Connection)

The Python application uses the default SDK configuration with direct connection to LaunchDarkly:

```python
import ldclient
from ldclient.config import Config

# Create SDK configuration with default settings
config = Config(sdk_key=sdk_key)

# Initialize the SDK
ldclient.set_config(config)
client = ldclient.get()

# Wait for SDK initialization
if client.is_initialized():
    print("SDK initialized successfully")
```

**Key Points**:
- Connects directly to LaunchDarkly (not through Relay Proxy)
- Streaming enabled by default for real-time flag updates
- Events sent directly to LaunchDarkly
- No Redis or Relay Proxy dependency
- Simplest configuration - ideal for getting started
- Demonstrates standard SDK usage pattern

**Default Endpoints**:
- Streaming: `https://clientstream.launchdarkly.com`
- Events: `https://events.launchdarkly.com`
- Polling: `https://app.launchdarkly.com`

### PHP SDK - Daemon Mode (Redis + Events)

The PHP application always uses daemon mode, reading flags from Redis while sending events:

```php
use LaunchDarkly\LDClient;
use LaunchDarkly\Integrations\Redis;

// Create Redis client
$redisClient = new Predis\Client([
    'scheme' => 'tcp',
    'host' => 'redis',
    'port' => 6379
]);

// Configure Redis feature requester
$featureStore = Redis::featureRequester($redisClient, [
    'prefix' => 'ld-flags-{environment-id}'  // Match Relay Proxy prefix
]);

// Initialize SDK in daemon mode with events
$client = new LDClient($sdkKey, [
    'feature_requester' => $featureStore,    // Read flags from Redis
    'send_events' => true,                    // Enable event sending
    'base_uri' => 'http://relay-proxy:8030', // Send events via Relay Proxy
    'use_ldd' => false                        // Allow event sending
]);
```

**Key Points**:
- `feature_requester` configured with Redis client
- Flags are read directly from Redis (no HTTP calls for flags)
- `send_events => true` enables analytics
- `base_uri` routes events through Relay Proxy
- `use_ldd => false` allows event sending (pure daemon mode would disable this)
- Redis prefix must match Relay Proxy's `ENV_DATASTORE_PREFIX`

### Redis Key Prefix Configuration

The Redis prefix must match between the Relay Proxy and SDK clients:

**Relay Proxy** (docker-compose.yml):
```yaml
environment:
  - ENV_DATASTORE_PREFIX=ld-flags-'$CID'
```

**PHP SDK** (.env):
```bash
REDIS_PREFIX=ld-flags-'6969a4b8e5069109d9807840'
```

**Finding Your Environment ID (Client-side ID)**:

The environment ID is the same value as your **Client-side ID** in LaunchDarkly.

**Option 1: From LaunchDarkly UI**
1. Log in to https://app.launchdarkly.com
2. Navigate to **Account Settings** > **Projects**
3. Select your project and environment
4. Copy the **Client-side ID** value
5. Use it in the format: `REDIS_PREFIX=ld-flags-{client-side-id}`

**Option 2: From Redis**
```bash
# List all Redis keys
docker exec redis redis-cli KEYS "*"

# Look for keys like: ld-flags-507f1f77bcf86cd799439011:features
# The environment ID is: 507f1f77bcf86cd799439011
```

### Configuration Comparison

| Feature | Node.js (Proxy Mode) | Python (Default Mode) | PHP (Daemon Mode) | JavaScript Client (Proxy Mode) |
|---------|---------------------------|----------------------|-------------------|----------------------------------|
| Flag Source | Relay Proxy | LaunchDarkly Direct | Redis Direct | Relay Proxy |
| Real-time Updates | Yes (streaming) | Yes (streaming) | Yes (polling every 5s) | Yes (streaming) |
| Update Mechanism | Push (instant) | Push (instant) | Poll (5-second delay) | Push (instant) |
| Analytics Events | Yes | Yes | Yes | Yes |
| Network Latency | ~10-50ms | ~50-100ms | <1ms (Redis read) | ~10-50ms |
| LaunchDarkly API Calls | Via Relay Proxy | Direct | None (for flags) | Via Relay Proxy |
| Redis Dependency | Optional | None | Required | Optional |
| Relay Proxy Dependency | Required | None | Optional (events only) | Required |
| Best For | Standard setup, caching | Simple setup, getting started | High-throughput, air-gapped | Browser apps, client-side |

## PHP Daemon Mode Integration

### What is Daemon Mode?

Daemon mode is a special LaunchDarkly SDK configuration where the SDK reads feature flags exclusively from a persistent store (Redis) without making any connections to LaunchDarkly's streaming or polling endpoints. This architecture provides several benefits:

**Key Characteristics**:
- **No LaunchDarkly API calls**: SDK reads only from Redis
- **No analytics events**: Event sending is disabled
- **High performance**: Sub-millisecond flag evaluations (no network latency)
- **Offline capable**: Works in air-gapped environments
- **Shared data**: Multiple applications can read from the same Redis store

**How It Differs from Standard SDK Operation**:

| Feature | Standard Mode (Node.js) | Daemon Mode (PHP) |
|---------|------------------------|-------------------|
| LaunchDarkly API Connection | Yes (via Relay Proxy) | No |
| Real-time Updates | Yes (streaming) | No (depends on Redis refresh) |
| Analytics Events | Yes | No |
| Network Latency | ~10-50ms | <1ms (Redis read) |
| Requires Relay Proxy | Yes | No (for flag evaluation) |
| Use Case | Interactive apps, real-time updates | High-throughput, air-gapped, multi-language |

### Architecture

The PHP application demonstrates daemon mode by reading feature flags from the same Redis instance that the Relay Proxy populates:

```
┌─────────────────┐      ┌─────────────────┐
│  Node.js App    │      │  PHP App        │
│  (Standard)     │      │  (Daemon Mode)  │
└────────┬────────┘      └────────┬────────┘
         │                        │
         │ Via Relay Proxy        │ Direct Read
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│  Relay Proxy    │─────►│  Redis          │
│                 │      │  (Shared Store) │
└────────┬────────┘      └─────────────────┘
         │
         │ LaunchDarkly API
         ▼
┌─────────────────┐
│  LaunchDarkly   │
│  Cloud Service  │
└─────────────────┘
```

**Data Flow**:
1. Relay Proxy fetches flags from LaunchDarkly and stores in Redis
2. Node.js app connects to Relay Proxy via HTTP (Proxy Mode)
3. PHP app reads flags directly from Redis (Daemon Mode)

### Accessing the PHP Application

Once the services are running, the PHP backend API is accessible at:

**URL**: http://localhost:8080

**Note**: The PHP service is **API-only** and returns JSON responses. For a visual interface, use the unified dashboard at http://localhost:8000 which displays both Node.js and PHP services.

**Available Endpoints:**
- `GET /` - API information and available endpoints
- `GET /api/status` - SDK and Redis status
- `GET /api/context` - Get current context
- `POST /api/context` - Update context
- `POST /api/test-evaluation` - Test flag evaluation
- `POST /api/redis-cache` - Get Redis data store
- `POST /api/load-test` - Run load test
- `GET /api/message/stream` - SSE stream for flag updates
- `GET /redis-monitor` - SSE stream for Redis monitor

**Example:**
```bash
# Get API information
curl http://localhost:8080

# Check PHP SDK status
curl http://localhost:8080/api/status
```

### Verifying PHP SDK is Reading from Redis

To verify the PHP SDK is correctly reading from Redis in daemon mode:

```bash
# 1. Check that PHP container is running
docker-compose ps php

# 2. View PHP application logs
docker-compose logs php

# 3. Verify Redis contains feature flag data
docker exec redis redis-cli KEYS "*"

# 4. Check specific flag data in Redis
docker exec redis redis-cli HGETALL "ld-flags-<environment-id>:features"

# 5. Access PHP API and verify it returns status
curl http://localhost:8080/api/status

# 6. Test flag evaluation via API
curl -X POST http://localhost:8080/api/test-evaluation \
  -H "Content-Type: application/json" \
  -d '{"context": {"key": "test-user", "anonymous": false}}'

# 7. Stop Relay Proxy to test daemon mode independence
docker-compose stop relay-proxy

# 8. Verify PHP app still works (reads from Redis cache)
curl http://localhost:8080/api/status

# 9. Check PHP logs show no LaunchDarkly API connection attempts
docker-compose logs php | grep -i "launchdarkly"

# 10. Restart Relay Proxy
docker-compose start relay-proxy
```

### Redis Architecture

The Relay Proxy and PHP application share the same Redis instance for feature flag data:

**Redis Key Structure**:
- Keys follow pattern: `ld-flags-{environment-id}:{data-type}`
- Example: `ld-flags-507f1f77bcf86cd799439011:features`
- The Relay Proxy and PHP SDK use the same key prefix for the target environment

**Benefits of This Architecture**:
- **Consistency**: Relay Proxy and PHP app always see the same flag values
- **Efficiency**: Single source of truth reduces API calls
- **Scalability**: Add more daemon-mode applications without increasing LaunchDarkly API load
- **Multi-language**: Demonstrates different SDK modes (Relay Proxy vs Daemon)

**How It Works**:
1. Relay Proxy populates Redis with flag data for all configured environments
2. Node.js SDK connects to Relay Proxy via HTTP (Proxy Mode - no direct Redis access)
3. PHP SDK reads directly from Redis using the same key prefix (Daemon Mode)
4. Relay Proxy uses Redis as its cache, PHP reads from that same cache
5. When flags change in LaunchDarkly, Relay Proxy updates Redis
6. PHP sees the updated values on next evaluation, Node.js gets updates via Relay Proxy

### Testing Multi-Language Consistency

To verify both applications return the same flag values:

```bash
# 1. Start all services
docker-compose up -d

# 2. Wait for services to initialize (30 seconds)
sleep 30

# 3. Test Node.js API endpoint
curl http://localhost:3000/api/flag

# 4. Test PHP API endpoint
curl -X POST http://localhost:8080/api/test-evaluation \
  -H "Content-Type: application/json" \
  -d '{"context": {"key": "test-user", "anonymous": false}}'

# 5. Compare flag values - they should match

# 6. Change flag value in LaunchDarkly dashboard

# 7. Wait for Relay Proxy to update Redis (30 seconds)
sleep 30

# 8. Verify both apps show the updated value
curl http://localhost:3000/api/flag
curl -X POST http://localhost:8080/api/test-evaluation \
  -H "Content-Type: application/json" \
  -d '{"context": {"key": "test-user", "anonymous": false}}'
```

## Environment Variables

### Application (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAUNCHDARKLY_SDK_KEY` | Yes | - | Your LaunchDarkly SDK key |
| `LAUNCHDARKLY_CLIENT_SIDE_ID` | Yes | - | Your LaunchDarkly client-side ID (for dashboard JavaScript SDK) |
| `RELAY_PROXY_CONFIG_KEY` | Yes | - | Relay Proxy configuration key |
| `DASHBOARD_PORT` | No | 8000 | External port for dashboard web UI |
| `API_SERVICE_PORT` | No | 4000 | External port for API service |
| `NODE_SERVICE_PORT` | No | 3000 | External port for Node.js service |
| `PHP_SERVICE_PORT` | No | 8080 | External port for PHP service |
| `PYTHON_SERVICE_PORT` | No | 5000 | External port for Python service |
| `SQUID_PROXY_PORT` | No | 3128 | External port for Squid proxy |
| `PORT` | No | 3000 | Port for the Express server (set via NODE_SERVICE_PORT) |
| `RELAY_PROXY_URL` | No | http://relay-proxy:8030 | URL of the Relay Proxy |
| `REDIS_HOST` | No | redis | Redis hostname (PHP only) |
| `REDIS_PORT` | No | 6379 | Redis port (PHP only, fixed at 6379) |
| `REDIS_PREFIX` | No | - | Redis key prefix (PHP only, must match Relay Proxy environment ID / Client-side ID) |

**Note**: The Relay Proxy (8030) and Redis (6379) ports are fixed and cannot be changed via environment variables. See the [Configurable Service Ports](#configurable-service-ports) section for details.

### Obtaining LaunchDarkly Credentials

**SDK Key:**
1. Log in to https://app.launchdarkly.com
2. Navigate to **Account Settings** > **Projects**
3. Select your project and environment
4. Copy the SDK key from **"Server-side SDK"** section

**Client-Side ID:**
1. Log in to https://app.launchdarkly.com
2. Navigate to **Account Settings** > **Projects**
3. Select your project and environment
4. Copy the client-side ID from **"Client-side ID"** section

**Relay Proxy Configuration Key:**
1. Log in to https://app.launchdarkly.com
2. Navigate to **Account Settings** > **Relay Proxy**
3. Create or copy your Relay Proxy configuration key

## Project Structure

```
launchdarkly-relay-proxy-enterprise-demo/
├── .env                    # Environment variables (gitignored)
├── .env.example           # Example environment configuration
├── .gitignore            # Git ignore rules
├── LICENSE               # MIT License
├── Dockerfile            # Docker image for Node.js app
├── docker-compose.yml    # Multi-container orchestration (7 services)
├── package.json          # Node.js dependencies and scripts
├── server.js             # Express server entry point
├── load-test.js          # Standalone load testing script
├── api-service/          # API Service container
│   ├── Dockerfile       # API service Docker image
│   ├── package.json     # API service dependencies
│   ├── server.js        # API service Express server
│   └── README.md        # API service documentation
├── dashboard/           # Dashboard container
│   ├── Dockerfile       # Dashboard Docker image
│   └── nginx.conf       # Nginx configuration
├── src/
│   ├── app.js           # Express app and SDK routes
│   ├── config.js        # Configuration management
│   └── launchdarkly.js  # LaunchDarkly SDK singleton
├── public/
│   ├── dashboard.html   # Dashboard web UI
│   └── launchdarkly-logo.svg  # LaunchDarkly logo
├── php/                 # PHP application
│   ├── Dockerfile       # PHP Docker image
│   ├── composer.json    # PHP dependencies
│   ├── index.php        # PHP application
│   ├── nginx.conf       # Nginx configuration
│   ├── supervisord.conf # Process manager config
│   └── www.conf         # PHP-FPM pool config
├── python/              # Python application
│   ├── Dockerfile       # Python Docker image
│   ├── app.py           # Flask application
│   └── requirements.txt # Python dependencies
└── squid-proxy/         # Squid proxy for relay-proxy connection control
    ├── Dockerfile       # Squid Docker image
    └── squid.conf       # Squid configuration
```

## Troubleshooting

### SSE Connection Timeouts (Expected Behavior)

**Symptom**: Dashboard shows "Connection timeout - please refresh" for PHP service every 5 minutes, then automatically reconnects

**This is Expected Behavior**: PHP SSE connections are designed to close after 5 minutes to prevent resource exhaustion.

**Why This Happens**:
- PHP-FPM workers have limited capacity (20 max workers)
- Long-running connections can exhaust available workers
- 5-minute timeout prevents memory leaks and worker exhaustion
- Dashboard automatically reconnects seamlessly

**What's Normal**:
- PHP connection closes every 5 minutes with timeout message
- Dashboard reconnects within 1-2 seconds automatically
- Flag values continue to update correctly
- No manual intervention required

**When to Worry**:
- If reconnection fails repeatedly (check PHP container health)
- If timeout happens much faster than 5 minutes (check PHP-FPM logs)
- If connection never establishes (check api-service and PHP container)

**To Verify It's Working Correctly**:
```bash
# Check PHP container is healthy
docker-compose ps php

# View PHP logs (should show SSE connections opening/closing)
docker logs php-app-dev --tail 50

# Check for PHP-FPM worker exhaustion (should see ~5-8 workers, not 20)
docker exec php-app-dev ps aux | grep "php-fpm: pool www" | wc -l
```

### Redis Connection Issues

**Symptom**: Relay proxy logs show "Failed to connect to Redis" or similar errors

**Causes**:
- Redis container not running
- Redis container not healthy
- Network connectivity issues between containers

**Solutions**:
```bash
# Check Redis container status
docker-compose ps redis

# View Redis logs for errors
docker-compose logs redis

# Restart Redis container
docker-compose restart redis

# Verify Redis is on the correct network
docker network inspect launchdarkly-network

# Test connectivity from relay-proxy to redis
docker exec relay-proxy ping redis

# If Redis won't start, check volume permissions
docker volume inspect redis-data
```

### Redis Data Persistence Issues

**Symptom**: Feature flag data is lost after Redis restart

**Causes**:
- AOF persistence not enabled
- Volume not properly mounted
- Disk space issues

**Solutions**:
```bash
# Verify AOF is enabled
docker exec redis redis-cli CONFIG GET appendonly

# Check volume is mounted
docker inspect redis | grep -A 5 Mounts

# Check disk space
df -h

# Verify data directory exists in container
docker exec redis ls -la /data

# If data is corrupted, repair AOF file
docker exec redis redis-check-aof --fix /data/appendonly.aof
```

### SDK Initialization Timeout

**Symptom**: "SDK Error: Failed to initialize LaunchDarkly SDK: timeout waiting for initialization"

**Causes**:
- Relay proxy not running
- Invalid SDK key
- Network connectivity issues

**Solutions**:
```bash
# Check relay proxy status
docker-compose ps relay-proxy

# View relay proxy logs
docker-compose logs relay-proxy

# Restart services
docker-compose restart
```

### Flag Shows Fallback Value

**Symptom**: Message displays "Fallback: Flag not found or SDK offline"

**Causes**:
- Flag doesn't exist in LaunchDarkly
- Wrong flag key
- SDK not connected

**Solutions**:
1. Verify flag exists with key `user-message`
2. Check SDK connection in logs
3. Verify SDK key is correct

### Container Logs Not Showing

**Symptom**: "Unable to fetch logs" in UI

**Causes**:
- App container doesn't have Docker socket access
- Container names don't match

**Solutions**:
```bash
# Verify Docker socket is mounted
docker inspect app-dev | grep docker.sock

# Restart app container
docker-compose restart app
```

### Load Test Fails

**Symptom**: Load test shows connection errors

**Causes**:
- SDK not initialized
- Relay proxy overloaded

**Solutions**:
1. Reduce number of clients
2. Increase evaluation interval
3. Check relay proxy metrics during test

### Performance Issues

**Symptom**: High CPU or memory usage

**Solutions**:
1. Check relay proxy metrics in status dashboard
2. Reduce load test parameters
3. Monitor Docker stats: `docker stats`

## PHP-Specific Troubleshooting

### PHP Container Won't Start

**Symptom**: `docker-compose up` fails to start php-app container

**Causes**:
- Composer dependency installation failure
- PHP-FPM configuration error
- Nginx configuration error
- Redis not healthy

**Solutions**:
```bash
# Check PHP container logs
docker-compose logs php

# Verify Redis is healthy first
docker-compose ps redis

# Rebuild PHP container
docker-compose build php

# Check Dockerfile syntax
cat php/Dockerfile

# Verify composer.json is valid
cat php/composer.json
```

### PHP Application Returns 502 Bad Gateway

**Symptom**: Accessing http://localhost:8080 returns "502 Bad Gateway"

**Causes**:
- PHP-FPM not running
- Nginx can't connect to PHP-FPM socket
- PHP application error

**Solutions**:
```bash
# Check if PHP-FPM is running
docker exec php-app ps aux | grep php-fpm

# Check if Nginx is running
docker exec php-app ps aux | grep nginx

# View PHP-FPM logs
docker-compose logs php | grep php-fpm

# View Nginx error logs
docker exec php-app cat /var/log/nginx/error.log

# Restart PHP container
docker-compose restart php
```

### PHP SDK Initialization Fails

**Symptom**: PHP application shows "SDK initialization failed" error

**Causes**:
- Invalid LaunchDarkly SDK key
- Redis not accessible
- Wrong Redis key prefix
- Composer dependencies not installed

**Solutions**:
```bash
# Verify LAUNCHDARKLY_SDK_KEY is set
docker-compose config | grep LAUNCHDARKLY_SDK_KEY

# Test Redis connectivity from PHP container
docker exec php-app ping redis

# Check Redis is accessible
docker exec php-app nc -zv redis 6379

# Verify Redis has flag data
docker exec redis redis-cli KEYS "*"

# Check PHP logs for detailed error
docker-compose logs php

# Verify composer dependencies installed
docker exec php-app ls -la /var/www/html/vendor
```

### PHP Application Shows Fallback Values

**Symptom**: PHP app displays "Fallback: Flag not found" instead of actual flag value

**Causes**:
- Feature flag doesn't exist in LaunchDarkly
- Wrong Redis key prefix (environment mismatch)
- Redis not populated by Relay Proxy yet
- Flag key mismatch

**Solutions**:
```bash
# Verify flag exists in LaunchDarkly dashboard
# Flag key should be: user-message

# Check Redis keys to find environment ID
docker exec redis redis-cli KEYS "*"

# Verify REDIS_PREFIX matches environment
docker-compose config | grep REDIS_PREFIX

# Check if Relay Proxy has populated Redis
docker-compose logs relay-proxy | grep -i redis

# Wait for Relay Proxy to initialize (30 seconds)
sleep 30

# Check flag data in Redis
docker exec redis redis-cli HGETALL "ld-flags-<environment-id>:features"

# Restart PHP container after Redis is populated
docker-compose restart php
```

### PHP and Node.js Apps Show Different Flag Values

**Symptom**: PHP app and Node.js app display different values for the same flag

**Causes**:
- Different Redis key prefixes (different environments)
- Redis not yet updated after flag change
- Caching issue

**Solutions**:
```bash
# Verify Redis prefix matches environment
docker-compose config | grep REDIS_PREFIX

# Check Redis keys
docker exec redis redis-cli KEYS "*"

# Wait for Relay Proxy to update Redis
sleep 30

# Restart both containers
docker-compose restart app php

# Clear Redis cache and let Relay Proxy repopulate
docker exec redis redis-cli FLUSHALL
docker-compose restart relay-proxy
sleep 30
```

### PHP Application Can't Connect to Redis

**Symptom**: PHP logs show "Failed to connect to Redis" errors

**Causes**:
- Redis container not running
- Network connectivity issue
- Wrong Redis hostname or port

**Solutions**:
```bash
# Check Redis is running and healthy
docker-compose ps redis

# Verify network connectivity
docker exec php-app ping redis

# Check Redis port is accessible
docker exec php-app nc -zv redis 6379

# Verify environment variables
docker-compose config | grep REDIS

# Check both containers are on same network
docker network inspect launchdarkly-network

# Restart Redis and PHP
docker-compose restart redis php
```

## Required Feature Flags

This demo application requires **three feature flags** to be created in your LaunchDarkly project. All flags must exist for the demo to work correctly.

### Flag 1: user-message (Required)

**Flag Key**: `user-message`
**Type**: String (multi-variate)
**Status**: Can be ON (serves default variation) or OFF with targeting rules (serves targeted variations)

**Variations**:
1. "Hello from LaunchDarkly!"
2. "Welcome to the demo!"
3. "Greetings from the Relay Proxy!"

**Purpose**: 
This is the primary demo flag that displays different messages to users. It demonstrates:
- Flag evaluation across both Node.js and PHP applications
- Multi-variate string flags with multiple variations
- Real-time flag updates via Server-Sent Events (SSE)
- Targeting rules and context-based evaluation
- Consistency between Proxy Mode (Node.js) and Daemon Mode (PHP)

**What Happens Without This Flag**:
The application will display "Fallback: Flag not found or SDK offline" instead of the actual message.

**Targeting Examples**:

Target by location:
```
If user.location contains "San Francisco"
  Serve variation 2: "Welcome to the demo!"
```

Target by container:
```
If container.key is "app-dev"
  Serve variation 3: "Greetings from the Relay Proxy!"
```

Target anonymous users:
```
If user.anonymous is true
  Serve variation 1: "Hello from LaunchDarkly!"
```

### Flag 2: terminal-panels (Required)

**Flag Key**: `terminal-panels`
**Type**: Boolean
**Status**: Can be ON (serves default variation) or OFF with targeting rules (serves targeted variations)
**Default Value**: `true` (recommended)

**Variations**:
- `true`: Open terminal panels in separate browser window (default)
- `false`: Close terminal panels window

**Purpose**: 
Controls whether terminal log panels open in a separate browser window. This flag demonstrates:
- Real-time window management via feature flags
- Cross-window communication and synchronization
- Instant updates without browser refresh via SSE
- Boolean flag evaluation with container context

**Behavior**:
- **Automatic Window Opening**: When `true`, a popup window opens automatically displaying real-time container logs
- **Popup Blocker Handling**: If browser blocks the popup, a notification appears with a manual link
- **Window Synchronization**: Terminal window automatically switches services when Panel 1 changes in the dashboard
- **Real-time Updates**: Changes apply instantly without browser refresh via SSE
- **Automatic Closing**: When flag changes to `false`, the terminal window closes automatically
- **Context**: Evaluated with container context (key: 'dashboard-v2')

**Terminal Window Features**:
- **Four Log Consoles**: Panel 1 service (dynamic), PHP, Relay Proxy, and Redis Monitor
- **Service Switching**: Panel 1 automatically switches between Node.js, Python, and JavaScript Client
- **Console Interception**: JavaScript Client mode captures browser console logs from the dashboard
- **Auto-Refresh**: Docker logs update every 2 seconds, Redis monitor streams live
- **Clear Buttons**: Each console has a clear button to truncate logs

**Use Cases**:
- View container logs in a dedicated window without cluttering the main dashboard
- Monitor multiple services simultaneously in a separate screen
- Demonstrate real-time window management via feature flags
- Show cross-window communication and synchronization
- Capture and display JavaScript Client browser console logs

**Technical Details**:
- Uses `window.open()` to create a popup window
- Window name: 'terminal-panels' (reuses existing window if already open)
- Passes LaunchDarkly client-side ID via URL parameter for SDK initialization
- Terminal window initializes its own LaunchDarkly SDK instance
- Listens for `dashboard-service-panel-1` flag changes to synchronize Panel 1 service
- JavaScript Client mode intercepts console.log/warn/error from opener window

**Browser Requirements**:
- Allow popups from localhost:8000 for automatic window opening
- Modern browser with EventSource support for real-time updates
- Cross-origin access between windows (same origin: localhost:8000)

**What Happens Without This Flag**:
The terminal panels window will always attempt to open (fallback to `true`), and you won't be able to demonstrate dynamic window control.

### Flag 3: dashboard-service-panel-1 (Required)

**Flag Key**: `dashboard-service-panel-1`
**Type**: String
**Status**: Can be ON (serves default variation) or OFF with targeting rules (serves targeted variations)
**Default Value**: `nodejs` (recommended)

**Variations**:
- `nodejs`: Display Node.js service panel in Panel 1
- `python`: Display Python service panel in Panel 1
- `javascript`: Display JavaScript Client panel in Panel 1

**Purpose**: 
Controls which service is displayed in Panel 1 of the dashboard. This flag demonstrates:
- Dynamic UI panel switching via feature flags
- Real-time content updates without page refresh
- String flag evaluation with multiple service options
- Cross-window synchronization (terminal panels follow Panel 1 selection)

**Behavior**:
- **Dynamic Panel Switching**: Panel 1 content changes instantly when flag value changes
- **Service Selection**: Choose between Node.js, Python, or JavaScript Client SDK demonstrations
- **Real-time Updates**: Changes apply instantly via SSE without browser refresh
- **Terminal Synchronization**: Terminal panels window automatically switches Panel 1 to match
- **Context**: Evaluated with container context (key: 'dashboard-v2')

**Panel Features by Service**:
- **Node.js**: Server-side SDK via Relay Proxy, streaming updates, load testing
- **Python**: Server-side SDK direct to LaunchDarkly, streaming updates, independent connection
- **JavaScript Client**: Client-side SDK in browser via Relay Proxy, browser console logs

**Use Cases**:
- Demonstrate different SDK integration patterns in a single dashboard
- Switch between server-side and client-side SDK demonstrations
- Show how feature flags can control UI layout and content
- Compare behavior across different SDK implementations

**Technical Details**:
- Uses CSS display properties to show/hide panels
- SSE connections managed per service (Node.js and Python have separate streams)
- JavaScript Client runs directly in browser, no SSE needed
- Terminal panels window listens for flag changes to synchronize Panel 1

**What Happens Without This Flag**:
The dashboard will default to showing the Node.js panel (fallback to `nodejs`), and you won't be able to demonstrate dynamic panel switching.

### Creating the Flags in LaunchDarkly

1. Log in to https://app.launchdarkly.com
2. Navigate to your project and environment
3. Click **"Create flag"**
4. For `user-message`:
   - Enter key: `user-message`
   - Select type: **String**
   - Click **"Create flag"**
   - Add the three variations listed above
   - Configure the flag: Turn it ON with a default variation, OR leave it OFF and set up targeting rules
5. For `terminal-panels`:
   - Enter key: `terminal-panels`
   - Select type: **Boolean**
   - Click **"Create flag"**
   - Configure the flag: Turn it ON with default `true`, OR leave it OFF and set up targeting rules
6. For `dashboard-service-panel-1`:
   - Enter key: `dashboard-service-panel-1`
   - Select type: **String**
   - Click **"Create flag"**
   - Add three variations: `nodejs`, `python`, `javascript`
   - Configure the flag: Turn it ON with default `nodejs`, OR leave it OFF and set up targeting rules

**Important**: All three flags must be created in the same LaunchDarkly project and environment that your SDK key and Relay Proxy configuration key are associated with.

## Best Practices

### For Demos

1. **Pre-create flags** before starting demo
2. **Test flag changes** to verify real-time updates work
3. **Use load testing** to show performance under load
4. **Show container logs** to demonstrate SDK behavior
5. **Switch contexts** to show targeting capabilities

### For Development

1. **Use .env file** for local credentials
2. **Never commit .env** to version control
3. **Use docker-compose** for consistent environment
4. **Monitor logs** during development
5. **Test error scenarios** (relay proxy down, invalid keys)

### Local Development Setup

If you're developing locally and need to modify the dashboard or run tests:

**Install Dependencies:**
```bash
npm install
```

This will:
- Install all Node.js dependencies including the LaunchDarkly JavaScript SDK v3.9.0
- Run the postinstall script to copy SDK files to `public/vendor/`
- Copy both `ldclient.min.js` and `ldclient.min.js.map` for browser debugging

**JavaScript SDK Integration:**
- The dashboard uses the LaunchDarkly JavaScript Client-Side SDK v3.9.0
- SDK files are served locally from `public/vendor/` (not from CDN)
- The SDK is loaded as a UMD bundle compatible with all browsers
- Source maps are included for debugging

**After Making Changes:**
```bash
# Rebuild the dashboard container
docker-compose build --no-cache dashboard

# Restart the dashboard
docker-compose up -d dashboard

# Hard refresh your browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows/Linux)
```

## Security Notes

- `.env` file is gitignored and never committed
- SDK keys and configuration keys are environment variables only
- No sensitive data in code or configuration files
- Docker socket access is read-only where possible

## License

MIT License - See LICENSE file for details

## Resources

- **LaunchDarkly Docs**: https://docs.launchdarkly.com
- **Node.js Server SDK**: https://docs.launchdarkly.com/sdk/server-side/node-js
- **JavaScript Client SDK**: https://docs.launchdarkly.com/sdk/client-side/javascript
- **PHP SDK**: https://docs.launchdarkly.com/sdk/server-side/php
- **Python SDK**: https://docs.launchdarkly.com/sdk/server-side/python
- **Relay Proxy**: https://docs.launchdarkly.com/home/relay-proxy
- **Docker**: https://docs.docker.com

## Support

For issues or questions:
- LaunchDarkly SDK: https://docs.launchdarkly.com/sdk/server-side/node-js
- Relay Proxy: https://docs.launchdarkly.com/home/relay-proxy
- Docker: https://docs.docker.com
