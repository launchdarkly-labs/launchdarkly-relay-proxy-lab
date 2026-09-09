//go:build !go1.27

package main

import (
	"crypto"
	"errors"
	"runtime"
)

// crypto/mldsa arrived in Go 1.27. Building with an older toolchain keeps this tool usable
// for the classical algorithms and reports the reason for the rest.
func generateMLDSA(string) (crypto.Signer, error) {
	return nil, errors.New("ML-DSA needs Go 1.27 or newer; this binary was built with " +
		runtime.Version() + ". Rebuild on Go 1.27+ with GOFIPS140=inprocess, or use -alg ecdsa-p384")
}
