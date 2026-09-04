// Issues the TLS certificate the Relay Proxy serves, with a choice of signature algorithm.
//
// This exists because no public CA issues ML-DSA certificates yet. CNSA 2.0 names ML-DSA-87
// for authentication, so demonstrating that half of the requirement means generating the
// certificate here or not demonstrating it at all.
//
// These are self-signed certificates for a lab. Clients either skip verification or add the
// generated CA to their trust store. Nothing here is a substitute for a PKI, and an ML-DSA
// certificate from this tool proves the relay can serve one, not that a customer's CA can
// issue one.
//
// Usage:
//
//	certgen -alg mldsa87 -out /certs -hosts relay-proxy,localhost
//	certgen -alg ecdsa-p384 -out /certs
//
// ML-DSA requires Go 1.27 or newer and GOFIPS140=inprocess. The validated module has no
// ML-DSA, so -alg mldsa87 fails there with a message naming the module.
package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	alg := flag.String("alg", "ecdsa-p384", "signature algorithm: mldsa87 | mldsa65 | mldsa44 | ecdsa-p384 | ecdsa-p256")
	out := flag.String("out", ".", "directory to write tls.crt and tls.key into")
	hosts := flag.String("hosts", "relay-proxy,localhost,127.0.0.1", "comma-separated SANs")
	days := flag.Int("days", 365, "validity in days")
	flag.Parse()

	key, err := generateKey(*alg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}

	der, err := issue(key, strings.Split(*hosts, ","), *days)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: issuing certificate:", err)
		os.Exit(1)
	}

	if err := write(*out, der, key); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: writing files:", err)
		os.Exit(1)
	}

	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: reparsing certificate:", err)
		os.Exit(1)
	}
	fmt.Printf("issued %s certificate\n", leaf.SignatureAlgorithm)
	fmt.Printf("  subject   : %s\n", leaf.Subject.CommonName)
	fmt.Printf("  hosts     : %s\n", *hosts)
	fmt.Printf("  size      : %d bytes DER\n", len(der))
	fmt.Printf("  expires   : %s\n", leaf.NotAfter.UTC().Format(time.RFC3339))
	fmt.Printf("  written   : %s, %s\n", filepath.Join(*out, "tls.crt"), filepath.Join(*out, "tls.key"))
	fmt.Printf("  self-signed: clients must skip verification or trust this certificate\n")

	// Record the algorithm alongside the certificate so a build step can assert on it
	// without needing a certificate parser. Alpine's builder image has no openssl, and
	// ML-DSA is new enough that an older openssl would not name it anyway.
	if err := os.WriteFile(filepath.Join(*out, "tls.alg"),
		[]byte(leaf.SignatureAlgorithm.String()), 0o644); err != nil { //nolint:gosec // public metadata
		fmt.Fprintln(os.Stderr, "ERROR: writing tls.alg:", err)
		os.Exit(1)
	}
}

// generateKey returns a signer for the requested algorithm. The ML-DSA branches live in a
// build-tagged file so this tool still compiles on Go 1.26, where crypto/mldsa does not
// exist; asking for mldsa there fails with a message rather than a build error.
func generateKey(alg string) (crypto.Signer, error) {
	switch strings.ToLower(alg) {
	case "mldsa87", "mldsa65", "mldsa44":
		return generateMLDSA(strings.ToLower(alg))
	case "ecdsa-p384":
		return ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	case "ecdsa-p256":
		return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	default:
		return nil, fmt.Errorf("unknown -alg %q; want mldsa87, mldsa65, mldsa44, ecdsa-p384 or ecdsa-p256", alg)
	}
}

func issue(key crypto.Signer, hosts []string, days int) ([]byte, error) {
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, err
	}
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "ld-relay-proxy (lab)"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(0, 0, days),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	for _, h := range hosts {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		if ip := parseIP(h); ip != nil {
			tpl.IPAddresses = append(tpl.IPAddresses, ip)
			continue
		}
		tpl.DNSNames = append(tpl.DNSNames, h)
	}
	return x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
}

func write(dir string, der []byte, key crypto.Signer) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	crt := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(filepath.Join(dir, "tls.crt"), crt, 0o644); err != nil { //nolint:gosec // public certificate
		return err
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return err
	}
	// 0600: the relay reads this as the same user that runs it. The relay does not check
	// key file permissions itself, so this is the only place the mode is set.
	return os.WriteFile(filepath.Join(dir, "tls.key"),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8}), 0o600)
}
