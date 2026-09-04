//go:build go1.27

package main

import (
	"crypto"
	"crypto/mldsa"
	"fmt"
)

// generateMLDSA returns an ML-DSA key at the requested parameter set. The error from
// GenerateKey is worth passing through verbatim: the validated FIPS module reports
// "mldsa: unavailable in FIPS 140-3 Go Cryptographic Module v1.0.0", which tells the caller
// exactly which knob to change.
func generateMLDSA(alg string) (crypto.Signer, error) {
	switch alg {
	case "mldsa87":
		return mldsa.GenerateKey(mldsa.MLDSA87())
	case "mldsa65":
		return mldsa.GenerateKey(mldsa.MLDSA65())
	case "mldsa44":
		return mldsa.GenerateKey(mldsa.MLDSA44())
	}
	return nil, fmt.Errorf("unknown ML-DSA parameter set %q", alg)
}
