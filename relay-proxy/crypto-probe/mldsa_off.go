//go:build !go1.27

// Go 1.26 and earlier have crypto/mlkem but no crypto/mldsa, so importing it does not
// compile. This stub keeps the probe buildable on the toolchain the lab used before, which
// is what lets the panel show the older posture honestly rather than failing to build.
package main

import "crypto/tls"

func mldsaAvailable() bool { return false }

func selfSignedCert() (tls.Certificate, error) { return ecdsaCert() }
