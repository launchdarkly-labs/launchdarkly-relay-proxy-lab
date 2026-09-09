# syntax=docker/dockerfile:1

# Builds the crypto probe as a one-shot container. api-service runs it with `docker run
# --rm` and parses its JSON, so it exits after printing rather than staying up.
#
# Built with the same toolchain and FIPS module as Dockerfile.cnsa on purpose. The probe
# measures a relay by performing TLS handshakes, so it can only observe what its own TLS
# stack supports: built against the validated module it reports ML-DSA unavailable even
# when the relay serves an ML-DSA certificate. Its `build` block in the JSON records which
# posture it was built with, so a consumer can tell the difference between "the relay does
# not do this" and "this probe cannot see it".

ARG GOFIPS140=inprocess

# Go 1.27 for crypto/mldsa. On an older toolchain the probe still builds and runs, and
# reports ML-DSA as unavailable because of the Go version.
FROM golang:1.27.0-alpine3.24 AS builder

ARG GOFIPS140

WORKDIR /src
COPY . .

ENV CGO_ENABLED=0
ENV GOOS=linux
ENV GOFIPS140=${GOFIPS140}

RUN go build -trimpath -o /crypto-probe . && \
    go version -m /crypto-probe | grep -q 'GOFIPS140=' && \
    echo "verified: FIPS module linked into probe"

FROM alpine:3.24.1

ARG GOFIPS140

RUN addgroup -g 1000 -S probe && adduser -u 1000 -S probe -G probe

COPY --from=builder /crypto-probe /usr/bin/crypto-probe

LABEL org.opencontainers.image.title="ld-relay crypto probe" \
      com.launchdarkly.relay.probe.fips140.module="${GOFIPS140}"

# Matches the relay images, which use `on` because the LaunchDarkly evaluation engine hashes
# context keys with SHA-1 and crypto/sha1 panics under `only`. fips140.Enforced() is
# reported in the JSON so a consumer can see which mode produced a measurement.
ENV GODEBUG=fips140=on

USER 1000

ENTRYPOINT ["/usr/bin/crypto-probe"]
