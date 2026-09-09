package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"time"
)

// certFrom builds a self-signed leaf from any signer. Shared by both build variants so the
// ML-DSA and ECDSA paths produce identical certificates apart from the key.
func certFrom(key crypto.Signer, pub crypto.PublicKey) (tls.Certificate, error) {
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "crypto-probe"},
		DNSNames:     []string{"localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, pub, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return tls.Certificate{}, err
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}, nil
}

// ecdsaCert is the fallback when ML-DSA is unavailable. P-384 because CNSA 2.0 names it as
// the classical curve, so the fallback stays as close to the target as the toolchain allows.
func ecdsaCert() (tls.Certificate, error) {
	k, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	return certFrom(k, k.Public())
}
