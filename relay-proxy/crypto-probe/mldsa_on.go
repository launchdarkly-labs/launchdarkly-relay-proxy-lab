//go:build go1.27

// ML-DSA lives in crypto/mldsa as of Go 1.27. Split across two build-tagged files so the
// probe compiles on 1.26, where importing the package is a hard error rather than a
// runtime absence. Both postures the panel compares have to build from one source tree.
package main

import (
	"crypto/mldsa"
	"crypto/tls"
)

// mldsaAvailable reports whether ML-DSA keygen works, which depends on the linked FIPS
// module and not only the Go version. The validated module (v1.0.0) refuses with
// "mldsa: unavailable in FIPS 140-3 Go Cryptographic Module v1.0.0", so this attempts a
// key rather than assuming the import implies support.
func mldsaAvailable() bool {
	_, err := mldsa.GenerateKey(mldsa.MLDSA87())
	return err == nil
}

// selfSignedCert prefers ML-DSA-87 so the loopback group probe exercises the same
// certificate type the relay would serve, and falls back to ECDSA when the linked module
// has no ML-DSA.
func selfSignedCert() (tls.Certificate, error) {
	if k, err := mldsa.GenerateKey(mldsa.MLDSA87()); err == nil {
		return certFrom(k, k.Public())
	}
	return ecdsaCert()
}
