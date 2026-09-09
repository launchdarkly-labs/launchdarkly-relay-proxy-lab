# Port Configuration Guide

This document provides comprehensive information about port configuration in the LaunchDarkly Relay Proxy Enterprise Demo application.

## Table of Contents

- [Overview](#overview)
- [Configurable Ports](#configurable-ports)
- [Fixed Infrastructure Ports](#fixed-infrastructure-ports)
- [Port Configuration Architecture](#port-configuration-architecture)
- [Configuration Examples](#configuration-examples)
- [CORS Configuration](#cors-configuration)
- [Troubleshooting](#troubleshooting)
- [Advanced Topics](#advanced-topics)

## Overview

The LaunchDarkly demo application uses a microservices architecture with nine containerized services. Seven of these services have configurable external ports, while Relay Proxy and Redis use fixed ports required by the LaunchDarkly architecture.

### Why Configurable Ports?

Configurable ports provide several benefits:

- **Avoid Port Conflicts**: Run the application alongside other services without port collisions
- **Multiple Instances**: Deploy multiple instances of the application on the same machine
- **Custom Deployments**: Adapt port assignments to match your infrastructure requirements
- **Development Flexibility**: Use different ports for development, testing, and production environments

### Design Philosophy

The port configuration system follows these principles:

1. **Environment-Driven**: All port configuration is managed through the `.env` file
2. **Backward Compatible**: Default ports match the original hardcoded values
3. **Automatic Propagation**: Port changes automatically update all dependent configurations (CORS, service URLs, frontend code)
4. **Fixed Infrastructure**: Critical infrastructure ports (Relay Proxy, Redis) remain fixed per LaunchDarkly requirements

## Configurable Ports

The following services support custom port configuration via environment variables:

### Dashboard Service

**Environment Variable**: `DASHBOARD_PORT`  
**Default Value**: `8000`  
**Purpose**: Web UI dashboard for monitoring and demonstration  
**Access**: `http://localhost:${DASHBOARD_PORT}`

The dashboard is the main entry point for the application. It serves static HTML/CSS/JavaScript and provides:
- Feature flag display and evaluation
- Real-time updates via Server-Sent Events (SSE)
- Container logs and monitoring
- Relay Proxy status dashboard
- Load testing interface

**Port Mapping**: `${DASHBOARD_PORT}:8000` (external:internal)

### API Service

**Environment Variable**: `API_SERVICE_PORT`  
**Default Value**: `4000`  
**Purpose**: Centralized API gateway for status checks and operations  
**Access**: `http://localhost:${API_SERVICE_PORT}`

The API service coordinates communication between services and provides:
- Status endpoints for all services
- Container log retrieval
- Relay Proxy metrics
- Connection control (disconnect/reconnect)

**Port Mapping**: `${API_SERVICE_PORT}:4000` (external:internal)

### Node.js Service

**Environment Variable**: `NODE_SERVICE_PORT`  
**Default Value**: `3000`  
**Purpose**: Node.js SDK demonstration using Relay Proxy mode  
**Access**: `http://localhost:${NODE_SERVICE_PORT}`

The Node.js service demonstrates:
- LaunchDarkly Node.js SDK integration
- Proxy mode (all traffic through Relay Proxy)
- Real-time streaming updates
- Server-Sent Events for flag changes

**Port Mapping**: `${NODE_SERVICE_PORT}:3000` (external:internal)

### PHP Service

**Environment Variable**: `PHP_SERVICE_PORT`  
**Default Value**: `8080`  
**Purpose**: PHP SDK demonstration using Daemon Mode (Redis + Events)  
**Access**: `http://localhost:${PHP_SERVICE_PORT}`

The PHP service demonstrates:
- LaunchDarkly PHP SDK integration
- Daemon mode (direct Redis reads)
- High-performance flag evaluation (<1ms latency)
- Event forwarding through Relay Proxy

**Port Mapping**: `${PHP_SERVICE_PORT}:80` (external:internal)  
**Note**: Internal port is 80 (Nginx), external port is configurable

### Python Service

**Environment Variable**: `PYTHON_SERVICE_PORT`  
**Default Value**: `5000`  
**Purpose**: Python SDK demonstration using Default Mode  
**Access**: `http://localhost:${PYTHON_SERVICE_PORT}`

The Python service demonstrates:
- LaunchDarkly Python SDK integration
- Default mode (direct connection to LaunchDarkly)
- Real-time streaming updates
- Direct event sending to LaunchDarkly

**Port Mapping**: `${PYTHON_SERVICE_PORT}:5000` (external:internal)

### Data System Service

**Environment Variable**: `DATA_SYSTEM_PORT`  
**Default Value**: `5001`  
**Purpose**: Python SDK data system builder with Relay-first LaunchDarkly fallback  
**Access**: `http://localhost:${DATA_SYSTEM_PORT}`

The data-system service demonstrates:
- `datasystem.custom()` fallback path: Relay streaming → LaunchDarkly streaming → LaunchDarkly polling
- Streaming through Relay Proxy as the primary source
- Automatic fallback to LaunchDarkly streaming, then polling
- Kill/restore Relay Proxy so other Relay clients fail while this SDK falls back to LaunchDarkly

**Port Mapping**: `${DATA_SYSTEM_PORT}:5001` (external:internal)

### Squid Proxy Service

**Environment Variable**: `SQUID_PROXY_PORT`  
**Default Value**: `3128`  
**Purpose**: HTTP proxy for network traffic inspection  
**Access**: `http://localhost:${SQUID_PROXY_PORT}`

The Squid proxy service provides:
- HTTP/HTTPS proxy functionality
- Network traffic inspection
- Request/response logging

**Port Mapping**: `${SQUID_PROXY_PORT}:3128` (external:internal)

## Fixed Infrastructure Ports

Two services use fixed ports that cannot be changed via environment variables:

### Relay Proxy Service

**Port**: `8030` (FIXED)  
**Access**: `http://relay-proxy:8030` (internal Docker network only)  
**Purpose**: LaunchDarkly Relay Proxy for flag caching and event forwarding

**Why Fixed?**

The Relay Proxy port is hardcoded at 8030 because:

1. **LaunchDarkly Architecture Requirement**: The LaunchDarkly Relay Proxy is designed to run on port 8030 as part of its standard configuration
2. **SDK Integration**: LaunchDarkly SDKs expect the Relay Proxy to be available on port 8030 for proper integration
3. **Event Forwarding**: The Relay Proxy's event forwarding mechanism is configured for port 8030
4. **Internal Network**: The Relay Proxy is only accessible within the Docker network, minimizing conflict risk

**Configuration in docker-compose.yml**:
```yaml
relay-proxy:
  ports:
    - "8030:8030"  # FIXED - DO NOT USE VARIABLES
  environment:
    - PORT=8030
```

### Redis Service

**Port**: `6379` (FIXED)  
**Access**: `redis://redis:6379` (internal Docker network only)  
**Purpose**: Persistent data store for feature flags

**Why Fixed?**

The Redis port is hardcoded at 6379 because:

1. **Standard Redis Port**: 6379 is the default and universally recognized Redis port
2. **Relay Proxy Configuration**: The LaunchDarkly Relay Proxy is configured to connect to Redis on port 6379
3. **PHP SDK Daemon Mode**: The PHP SDK in daemon mode expects Redis on port 6379
4. **Internal Network**: Redis is only accessible within the Docker network, minimizing conflict risk

**Configuration in docker-compose.yml**:
```yaml
redis:
  ports:
    - "6379:6379"  # FIXED - DO NOT USE VARIABLES
```

**Note**: While Redis is exposed on port 6379, it's only accessible within the Docker network by default. To expose Redis to the host machine, you would need to modify the port mapping in docker-compose.yml.

## Port Configuration Architecture

### Configuration Flow

The port configuration system follows a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Definition (.env file)                            │
│ - Defines all configurable port variables with defaults    │
│ - Documents fixed ports (relay-proxy, redis)               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Distribution (docker-compose.yml)                 │
│ - Maps external ports using ${VAR:-default} syntax         │
│ - Passes environment variables to service containers       │
│ - Constructs service URLs for inter-service communication  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Application (Service code)                        │
│ - Reads PORT environment variable for server binding       │
│ - Uses service URLs from environment for API calls         │
│ - Configures CORS with dashboard port from environment     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Frontend (HTML files)                             │
│ - Template files with ${VAR} placeholders                  │
│ - Substituted at container startup via envsubst            │
│ - JavaScript code uses injected port values                │
└─────────────────────────────────────────────────────────────┘
```

### Docker Compose Variable Substitution

Docker Compose uses the `${VAR:-default}` syntax for variable substitution with fallback defaults:

```yaml
services:
  dashboard:
    ports:
      - "${DASHBOARD_PORT:-8000}:8000"
    environment:
      - DASHBOARD_PORT=${DASHBOARD_PORT:-8000}
```

**How it works**:
- If `DASHBOARD_PORT` is defined in `.env`, use that value
- If `DASHBOARD_PORT` is not defined, use the default value `8000`
- This ensures backward compatibility with existing deployments

### Frontend Template Substitution

The dashboard service uses `envsubst` to inject port variables into HTML files at container startup:

**docker-entrypoint.sh**:
```bash
#!/bin/sh
set -e

# Define all variables for substitution
ENVSUBST_VARS='${LAUNCHDARKLY_CLIENT_SIDE_ID} ${DASHBOARD_PORT} ${API_SERVICE_PORT} ${NODE_SERVICE_PORT} ${PHP_SERVICE_PORT} ${PYTHON_SERVICE_PORT} ${DATA_SYSTEM_PORT} ${SQUID_PROXY_PORT}'

# Substitute environment variables in dashboard.html
envsubst "$ENVSUBST_VARS" < /usr/share/nginx/html/dashboard.template.html > /usr/share/nginx/html/dashboard.html

# Substitute environment variables in terminal-panels.html
envsubst "$ENVSUBST_VARS" < /usr/share/nginx/html/terminal-panels.template.html > /usr/share/nginx/html/terminal-panels.html

exec "$@"
```

**HTML Template Pattern**:
```html
<script>
  const API_URL = 'http://localhost:${API_SERVICE_PORT}';
  const NODE_URL = 'http://localhost:${NODE_SERVICE_PORT}';
</script>
```

**Result after substitution** (with default ports):
```html
<script>
  const API_URL = 'http://localhost:4000';
  const NODE_URL = 'http://localhost:3000';
</script>
```

### Service-to-Service Communication

Services communicate using internal Docker network hostnames and environment variables:

```yaml
api-service:
  environment:
    - NODE_APP_URL=http://node-app-dev:${NODE_SERVICE_PORT:-3000}
    - PHP_APP_URL=http://php-app-dev:80
    - PYTHON_APP_URL=http://python-app-dev:${PYTHON_SERVICE_PORT:-5000}
```

**Key Points**:
- Internal hostnames use Docker service names (e.g., `node-app-dev`)
- Internal ports match the container's listening port
- External ports are only used for host machine access
- PHP uses internal port 80 (Nginx), not the external `PHP_SERVICE_PORT`

## Configuration Examples

### Example 1: Default Configuration

Use the default ports as defined in `.env.example`:

```bash
DASHBOARD_PORT=8000
API_SERVICE_PORT=4000
NODE_SERVICE_PORT=3000
PHP_SERVICE_PORT=8080
PYTHON_SERVICE_PORT=5000
SQUID_PROXY_PORT=3128
```

**Access URLs**:
- Dashboard: http://localhost:8000
- API Service: http://localhost:4000
- Node.js: http://localhost:3000
- PHP: http://localhost:8080
- Python: http://localhost:5000

### Example 2: Avoiding Common Port Conflicts

If default ports conflict with other services:

```bash
# Port 8000 conflicts with another web server
DASHBOARD_PORT=8888

# Port 3000 conflicts with another Node.js app
NODE_SERVICE_PORT=3001

# Port 8080 conflicts with another application
PHP_SERVICE_PORT=8081

# Keep other ports at defaults
API_SERVICE_PORT=4000
PYTHON_SERVICE_PORT=5000
SQUID_PROXY_PORT=3128
```

**Access URLs**:
- Dashboard: http://localhost:8888
- Node.js: http://localhost:3001
- PHP: http://localhost:8081

### Example 3: Running Multiple Instances

Run two instances of the application on the same machine:

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

**Start both instances**:
```bash
# Instance 1 (default)
docker-compose up -d

# Instance 2 (custom env file and project name)
docker-compose --env-file .env.instance2 -p demo-instance2 up -d
```

**Access URLs**:
- Instance 1 Dashboard: http://localhost:8000
- Instance 2 Dashboard: http://localhost:9000

Remapping the ports handles host-side conflicts only. Each service also takes a static
`ipv4_address` on `launchdarkly-network`, whose name `docker-compose.yml` pins so the
documented `docker run --network launchdarkly-network ...` probe commands resolve. The
second project joins that same network and its containers collide on the same nine
addresses, so a second stack needs its own network name and subnet in an overlay file.

### Example 4: Development vs Production Ports

Use different ports for development and production:

**Development** (`.env.dev`):
```bash
DASHBOARD_PORT=8000
API_SERVICE_PORT=4000
NODE_SERVICE_PORT=3000
PHP_SERVICE_PORT=8080
PYTHON_SERVICE_PORT=5000
SQUID_PROXY_PORT=3128
```

**Production** (`.env.prod`):
```bash
DASHBOARD_PORT=80
API_SERVICE_PORT=443
NODE_SERVICE_PORT=8001
PHP_SERVICE_PORT=8002
PYTHON_SERVICE_PORT=8003
SQUID_PROXY_PORT=8004
```

**Note**: Using ports below 1024 (like 80 and 443) requires root/administrator privileges.

### Example 5: Sequential Port Assignment

Use sequential ports for easier management:

```bash
DASHBOARD_PORT=8000
API_SERVICE_PORT=8001
NODE_SERVICE_PORT=8002
PHP_SERVICE_PORT=8003
PYTHON_SERVICE_PORT=8004
SQUID_PROXY_PORT=8005
```

This makes it easy to remember and manage port assignments.

## CORS Configuration

Cross-Origin Resource Sharing (CORS) is automatically configured based on the `DASHBOARD_PORT` environment variable.

### How CORS Works

When the dashboard (running on `DASHBOARD_PORT`) makes API calls to backend services (Node.js, PHP, Python), the browser enforces CORS policies. The backend services must explicitly allow requests from the dashboard's origin.

### Automatic CORS Configuration

All backend services automatically read the `DASHBOARD_PORT` environment variable and configure CORS to allow requests from `http://localhost:${DASHBOARD_PORT}`:

#### Node.js Service (src/app.js)

```javascript
app.use((req, res, next) => {
  const dashboardPort = process.env.DASHBOARD_PORT || '8000';
  const origin = req.headers.origin;
  
  if (origin && (
    origin.includes(`localhost:${dashboardPort}`) || 
    origin.includes(`127.0.0.1:${dashboardPort}`)
  )) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  // ... rest of CORS headers
});
```

#### Python Service (python/app.py)

```python
from flask_cors import CORS

dashboard_port = os.environ.get('DASHBOARD_PORT', '8000')
node_port = os.environ.get('NODE_SERVICE_PORT', '3000')

CORS(app, resources={
    r"/api/*": {
        "origins": [
            f"http://localhost:{dashboard_port}",
            f"http://localhost:{node_port}"
        ],
        "supports_credentials": True
    }
})
```

#### PHP Service (php/index.php)

```php
<?php
$dashboardPort = getenv('DASHBOARD_PORT') ?: '8000';
$allowedOrigins = [
    "http://localhost:$dashboardPort",
    "http://localhost:3000"
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins)) {
    header("Access-Control-Allow-Origin: $origin");
    header("Access-Control-Allow-Credentials: true");
}
```

### CORS and Port Changes

When you change the `DASHBOARD_PORT`:

1. **Update `.env` file** with new dashboard port
2. **Restart services**: `docker-compose down && docker-compose up -d`
3. **CORS automatically updates**: Backend services read the new `DASHBOARD_PORT` and update their CORS configuration
4. **No manual configuration needed**: The system handles CORS updates automatically

### Testing CORS Configuration

Verify CORS is working correctly:

```bash
# Test CORS from dashboard to API service
curl -H "Origin: http://localhost:8000" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     http://localhost:4000/api/relay-status

# Expected response includes:
# Access-Control-Allow-Origin: http://localhost:8000
# Access-Control-Allow-Credentials: true
```

### CORS Troubleshooting

If you see CORS errors in the browser console:

1. **Verify environment variables are set**:
   ```bash
   docker exec node-app-dev env | grep DASHBOARD_PORT
   docker exec php-app-dev env | grep DASHBOARD_PORT
   docker exec python-app-dev env | grep DASHBOARD_PORT
   ```

2. **Check service logs for CORS configuration**:
   ```bash
   docker logs node-app-dev | grep CORS
   docker logs php-app-dev | grep CORS
   docker logs python-app-dev | grep CORS
   ```

3. **Verify port matches in browser**:
   - Open browser developer tools (F12)
   - Check the Network tab for the failing request
   - Verify the Origin header matches `http://localhost:${DASHBOARD_PORT}`

4. **Restart services after changing ports**:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

## Troubleshooting

### Port Already in Use

**Symptom**: Docker Compose fails to start with "port already in use" error

**Error Message**:
```
Error starting userland proxy: listen tcp4 0.0.0.0:8000: bind: address already in use
```

**Solution**:

1. **Identify the conflicting process**:

   On macOS/Linux:
   ```bash
   lsof -i :8000
   ```

   On Windows:
   ```bash
   netstat -ano | findstr :8000
   ```

2. **Stop the conflicting process**:

   On macOS/Linux:
   ```bash
   kill <PID>
   ```

   On Windows:
   ```bash
   taskkill /PID <PID> /F
   ```

3. **Or change the port in `.env`**:
   ```bash
   DASHBOARD_PORT=8888
   ```

4. **Restart services**:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

### Services Not Accessible on Custom Ports

**Symptom**: After changing ports in `.env`, services are not accessible on new ports

**Possible Causes**:
- Services not restarted after changing `.env`
- Typo in environment variable name
- Docker Compose not reading `.env` file

**Solution**:

1. **Verify `.env` file is in the project root**:
   ```bash
   ls -la .env
   ```

2. **Check environment variables are loaded**:
   ```bash
   docker-compose config | grep PORT
   ```

3. **Restart services completely**:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

4. **Verify containers are running**:
   ```bash
   docker-compose ps
   ```

5. **Check container logs for errors**:
   ```bash
   docker-compose logs dashboard
   docker-compose logs api-service
   ```

### Frontend Shows Wrong Ports

**Symptom**: Dashboard HTML contains old port numbers or `${VAR}` placeholders

**Possible Causes**:
- Template substitution failed
- Environment variables not passed to dashboard container
- Browser cache showing old version

**Solution**:

1. **Check environment variables in dashboard container**:
   ```bash
   docker exec dashboard env | grep PORT
   ```

2. **Verify template substitution occurred**:
   ```bash
   docker exec dashboard cat /usr/share/nginx/html/dashboard.html | grep localhost
   ```

3. **Check docker-entrypoint.sh logs**:
   ```bash
   docker logs dashboard | grep -i substitut
   ```

4. **Rebuild and restart dashboard**:
   ```bash
   docker-compose build --no-cache dashboard
   docker-compose up -d dashboard
   ```

5. **Clear browser cache**:
   - Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
   - Or open in incognito/private window

### CORS Errors After Port Change

**Symptom**: Browser console shows CORS errors after changing dashboard port

**Error Message**:
```
Access to fetch at 'http://localhost:4000/api/status' from origin 'http://localhost:9000' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

**Solution**:

1. **Verify DASHBOARD_PORT is set in backend services**:
   ```bash
   docker exec node-app-dev env | grep DASHBOARD_PORT
   docker exec php-app-dev env | grep DASHBOARD_PORT
   docker exec python-app-dev env | grep DASHBOARD_PORT
   ```

2. **Restart backend services**:
   ```bash
   docker-compose restart node-app-dev php-app-dev python-app-dev
   ```

3. **Check service logs for CORS configuration**:
   ```bash
   docker logs node-app-dev | grep -i cors
   ```

4. **Test CORS manually**:
   ```bash
   curl -H "Origin: http://localhost:9000" \
        -H "Access-Control-Request-Method: GET" \
        -X OPTIONS \
        http://localhost:4000/api/relay-status
   ```

### Cannot Change Relay Proxy or Redis Port

**Symptom**: Attempting to change Relay Proxy or Redis port via environment variables has no effect

**Explanation**: This is expected behavior. The Relay Proxy (8030) and Redis (6379) ports are intentionally fixed and cannot be changed via environment variables.

**Why?**:
- **LaunchDarkly Architecture**: The Relay Proxy must run on port 8030 per LaunchDarkly's design
- **Redis Standard**: Redis uses the standard port 6379 expected by the Relay Proxy and PHP SDK
- **Internal Network**: Both services are only accessible within the Docker network, minimizing conflict risk

**Solution**:

If you absolutely must change these ports (not recommended):

1. **Edit docker-compose.yml directly**:
   ```yaml
   relay-proxy:
     ports:
       - "8031:8030"  # Map external 8031 to internal 8030
   ```

2. **Update all service configurations** that reference the Relay Proxy:
   - Node.js: `RELAY_PROXY_URL`
   - PHP: Event forwarding URL
   - API Service: Relay Proxy connection URLs

3. **Rebuild and restart all services**:
   ```bash
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

**Warning**: Changing these ports may break LaunchDarkly SDK integration and is not supported.

## Advanced Topics

### Port Range Allocation

When running multiple instances, consider allocating port ranges:

- **Instance 1**: 8000-8099
- **Instance 2**: 8100-8199
- **Instance 3**: 8200-8299

Example for Instance 2:
```bash
DASHBOARD_PORT=8100
API_SERVICE_PORT=8101
NODE_SERVICE_PORT=8102
PHP_SERVICE_PORT=8103
PYTHON_SERVICE_PORT=8104
SQUID_PROXY_PORT=8105
```

### Firewall Configuration

If services are not accessible, check firewall rules:

**macOS**:
```bash
# Check if firewall is enabled
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Allow Docker
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/Docker.app
```

**Linux (ufw)**:
```bash
# Allow specific port
sudo ufw allow 8000/tcp

# Allow port range
sudo ufw allow 8000:8099/tcp
```

**Windows**:
```powershell
# Allow port through Windows Firewall
New-NetFirewallRule -DisplayName "LaunchDarkly Demo" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

### Load Balancer Configuration

When deploying behind a load balancer, configure port forwarding:

**Nginx Load Balancer**:
```nginx
upstream dashboard {
    server localhost:8000;
}

server {
    listen 80;
    server_name demo.example.com;
    
    location / {
        proxy_pass http://dashboard;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**HAProxy**:
```
frontend dashboard_frontend
    bind *:80
    default_backend dashboard_backend

backend dashboard_backend
    server dashboard1 localhost:8000 check
```

### Docker Network Inspection

Inspect the Docker network to verify service connectivity:

```bash
# List all networks
docker network ls

# Inspect the LaunchDarkly network
docker network inspect launchdarkly-network

# Check which containers are connected
docker network inspect launchdarkly-network --format='{{range .Containers}}{{.Name}} {{end}}'

# Test connectivity between containers
docker exec node-app-dev ping dashboard
docker exec node-app-dev ping relay-proxy
docker exec node-app-dev ping redis
```

### Performance Considerations

Port configuration has minimal performance impact, but consider:

1. **Internal vs External Ports**: Services communicate using internal Docker network hostnames, so external port changes don't affect inter-service performance

2. **Port Scanning**: Using non-standard ports can reduce automated port scanning attacks

3. **Load Balancing**: When using a load balancer, the external port is the load balancer's port, not the container's port

### Security Best Practices

1. **Use Non-Standard Ports**: Avoid common ports (80, 443, 8080) to reduce automated attacks

2. **Firewall Rules**: Configure firewall to only allow necessary ports

3. **Internal Network**: Keep Relay Proxy and Redis on internal Docker network only

4. **HTTPS**: For production, use HTTPS with proper SSL/TLS certificates

5. **Port Range Restrictions**: Limit port ranges to specific values (e.g., 8000-8999)

### Monitoring Port Usage

Monitor which ports are in use:

**macOS/Linux**:
```bash
# List all listening ports
netstat -tuln

# Check specific port
lsof -i :8000

# Monitor port usage over time
watch -n 1 'netstat -tuln | grep LISTEN'
```

**Windows**:
```powershell
# List all listening ports
netstat -ano | findstr LISTENING

# Check specific port
netstat -ano | findstr :8000
```

### Automated Port Assignment

For CI/CD pipelines, automatically assign available ports:

```bash
#!/bin/bash

# Find available port starting from 8000
find_available_port() {
    local port=$1
    while lsof -i :$port > /dev/null 2>&1; do
        port=$((port + 1))
    done
    echo $port
}

# Assign ports
DASHBOARD_PORT=$(find_available_port 8000)
API_SERVICE_PORT=$(find_available_port 4000)
NODE_SERVICE_PORT=$(find_available_port 3000)

# Write to .env file
cat > .env << EOF
DASHBOARD_PORT=$DASHBOARD_PORT
API_SERVICE_PORT=$API_SERVICE_PORT
NODE_SERVICE_PORT=$NODE_SERVICE_PORT
EOF

# Start services
docker-compose up -d
```

## Summary

The LaunchDarkly demo application provides flexible port configuration for all user-facing services while maintaining fixed ports for critical infrastructure components. This design balances flexibility with architectural requirements, enabling multiple deployment scenarios while ensuring LaunchDarkly SDK integration works correctly.

**Key Takeaways**:

- Six services have configurable ports via `.env` file
- Relay Proxy (8030) and Redis (6379) use fixed ports
- CORS configuration updates automatically when ports change
- Frontend templates use `envsubst` for dynamic port injection
- Docker Compose uses `${VAR:-default}` syntax for backward compatibility
- Multiple instances can run on the same machine with different port configurations

For additional help, see the main [README.md](README.md) or consult the [LaunchDarkly documentation](https://docs.launchdarkly.com).
