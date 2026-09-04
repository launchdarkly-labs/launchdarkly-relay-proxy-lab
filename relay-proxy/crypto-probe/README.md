# crypto-probe

Measures the crypto a Relay Proxy actually negotiates and prints it as JSON.

A relay can have all three ML-KEM hybrid groups compiled in and still hand a client
classical ECDH. The handshake succeeds and nothing is logged, so configuration and labels
do not tell you what a relay does. This performs real TLS handshakes and reports what came
back.

## Why this is a Go program

It measures post-quantum key exchange by handshaking with specific curve preferences
(`tls.Config.CurvePreferences` set to one ML-KEM hybrid group at a time). Node's TLS stack
does not expose ML-KEM group selection and neither does the browser, so a UI cannot measure
this itself. Anything that wants these numbers has to call out to a TLS stack that supports
ML-KEM.

## Running it

```bash
# Build posture only. All that is available when the relay serves plaintext.
docker run --rm ld-relay-lab:crypto-probe

# Probe a TLS relay on the lab network.
docker run --rm --network launchdarkly-network ld-relay-lab:crypto-probe \
  -target relay-proxy:8030
```

Build the image with:

```bash
docker build -t ld-relay-lab:crypto-probe relay-proxy/crypto-probe
```

Or run it from source, which is faster while iterating:

```bash
cd relay-proxy/crypto-probe
GOFIPS140=inprocess GODEBUG=fips140=only go run . -target relay-proxy:8030
```

Flags: `-target host:port`, `-timeout` (default 5s per handshake), `-insecure` (default
true, because the lab uses self-signed certificates).

Exit code is 0 whenever the probe ran, including when every handshake failed. A failed
handshake is a measurement, so read `cnsa2[].status` rather than the exit code.

## Output

```json
{
  "measured_at": "2026-09-04T18:09:44Z",
  "target": "relay-proxy:8030",
  "build": {
    "go_version": "go1.27.0",
    "fips_enforced": true,
    "fips_module": "v1.26.0",
    "mldsa_available": true,
    "mlkem_groups_enabled": 3
  },
  "cnsa2": [
    {
      "requirement": "Key establishment",
      "algorithm": "ML-KEM-768 / ML-KEM-1024 (FIPS 203)",
      "status": "met",
      "detail": "3 of 3 post-quantum client profiles negotiated a hybrid ML-KEM group"
    }
  ],
  "handshakes": [
    {
      "profile": "pqc-nist-p384",
      "connected": true,
      "group": "SecP384r1MLKEM1024",
      "suite": "TLS_AES_128_GCM_SHA256",
      "signature_algorithm": "ML-DSA-87",
      "tls_version": "TLS 1.3",
      "post_quantum_kex": true
    }
  ]
}
```

`cnsa2` always carries four entries, one per CNSA 2.0 algorithm family, in this order: key
establishment, authentication, symmetric encryption, hashing.

`handshakes` is present only when `-target` was given, with one entry per client profile.

### Status values

| Status | Meaning |
| --- | --- |
| `met` | Measured and satisfies the requirement |
| `unmet` | Measured and does not satisfy it. Fixable by configuration or a certificate |
| `unavailable` | No configuration of this component reaches it. A Go standard library limit |

The `unmet` / `unavailable` split matters for a UI. `unmet` is worth surfacing as
actionable; `unavailable` is a property of the toolchain, and showing it as a fixable
failure would be misleading. Symmetric encryption and hashing are always `unavailable`
because Go fixes TLS 1.3 cipher suite preference in the standard library and ignores
`tls.Config.CipherSuites` for 1.3.

### Client profiles

| Profile | Offers | Purpose |
| --- | --- | --- |
| `pqc-nist-p384` | `SecP384r1MLKEM1024` | Exposes the silent downgrade |
| `pqc-nist-p256` | `SecP256r1MLKEM768` | Exposes the silent downgrade |
| `pqc-x25519` | `X25519MLKEM768` | What browsers offer; enabled by default |
| `classical-p384` | `CurveP384` | Control. Getting classical back is correct |

The two NIST profiles are the interesting ones. They are disabled unless the relay's
`go.mod` sets `godebug tlssecpmlkem=1`, and `X25519MLKEM768` stays enabled either way, so a
relay can pass a casual test while downgrading exactly the clients a FIPS-constrained
customer would use.

Scoring counts a refused handshake against the requirement rather than skipping it.
Skipping produced a `met` result on a relay that refused two of three post-quantum clients.

## Read `build` before trusting a result

The probe can only observe what its own TLS stack supports, so its build posture bounds its
measurements:

| Probe built with | Reports |
| --- | --- |
| Go 1.27 + `GOFIPS140=inprocess` | Everything this tool can measure |
| Go 1.27 + `GOFIPS140=certified` | `mldsa_available: false`, marks authentication unavailable |
| Go 1.26 or older | `mldsa_available: false`, ML-DSA absent from the toolchain |

A probe built against the validated FIPS module marks authentication unmet even against a
relay serving an ML-DSA-87 certificate. That is the probe's limit rather than the relay's,
which is why `build` is in the output. A UI showing `cnsa2` without showing `fips_module`
and `mldsa_available` can display a false negative with no way for the reader to tell.

The shipped `Dockerfile` builds with Go 1.27 and `inprocess` so the probe can see everything
`Dockerfile.cnsa` produces.

## Consuming it from a service

The probe writes JSON to stdout and diagnostics to stderr, so stdout parses directly. It is
a one-shot container: it exits after printing.

`api-service` already runs sibling containers this way (see
`api-service/src/docker/squidProxyControl.js`), so the same `child_process` pattern applies:
run `docker run --rm --network launchdarkly-network ld-relay-lab:crypto-probe -target
<host:port>`, parse stdout, return it.

Two things worth handling in whatever consumes this:

A missing image is the common first-run failure, since the probe is not built by the base
compose file. Worth distinguishing from a probe that ran and failed.

`-target` reaches a container argument. Constrain it to `host:port` rather than escaping it.

Handshakes are performed serially with a per-handshake timeout, so a probe against an
unreachable target takes up to four times `-timeout`. Budget ~30s for a call.
