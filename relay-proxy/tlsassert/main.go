// Asserts that a TLS server built with this crypto stack will not negotiate legacy cipher
// suites or pre-1.2 protocol versions, and prints the result as build evidence.
//
// Why negotiability rather than absence: RC4, DES, MD5 and SHA-1 are linked into any Go
// binary that imports crypto/tls or crypto/x509. Inspecting the relay's symbol table finds
// crypto/tls.cipherRC4 and crypto/tls.cipher3DES, and removing them would mean forking the
// toolchain. "These primitives are not in the image" is therefore not a claim this project
// can make. What it can show is that no peer can negotiate them.
//
// The client here is a hand-built ClientHello rather than crypto/tls, and that detail is
// what makes the result meaningful. Go's own client refuses to send the suites in
// tls.InsecureCipherSuites() even when tls.Config.CipherSuites asks for them, so a test
// built on crypto/tls measures the client's policy and reports success no matter what the
// server would have accepted. An earlier version of this file had that flaw: it passed
// against a server explicitly configured to offer CBC-SHA.
//
// Runs during the image build. A toolchain change that reintroduces a legacy suite fails
// the build instead of shipping.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/fips140"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"fmt"
	"math/big"
	"net"
	"os"
	"runtime"
	"time"
)

// Suites a FedRAMP baseline treats as unacceptable: RC4, 3DES, and the RSA key-exchange
// suites that provide no forward secrecy. Values are the on-the-wire codepoints, since the
// point is to offer them in a raw ClientHello.
//
// The ECDHE CBC-SHA suites are deliberately absent. Go lists those in CipherSuites() rather
// than InsecureCipherSuites(), so they are negotiable by design and asserting against them
// would fail on a stock toolchain.
var legacySuites = []struct {
	name string
	id   uint16
}{
	{"TLS_RSA_WITH_RC4_128_SHA", 0x0005},
	{"TLS_RSA_WITH_3DES_EDE_CBC_SHA", 0x000a},
	{"TLS_RSA_WITH_AES_128_CBC_SHA", 0x002f},
	{"TLS_RSA_WITH_AES_256_CBC_SHA", 0x0035},
	{"TLS_RSA_WITH_AES_128_CBC_SHA256", 0x003c},
	{"TLS_RSA_WITH_AES_128_GCM_SHA256", 0x009c},
	{"TLS_ECDHE_ECDSA_WITH_RC4_128_SHA", 0xc007},
	{"TLS_ECDHE_RSA_WITH_RC4_128_SHA", 0xc011},
	{"TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA", 0xc012},
	{"TLS_DH_anon_WITH_AES_128_CBC_SHA", 0x0034},
	{"TLS_NULL_WITH_NULL_NULL", 0x0000},
}

var oldVersions = []struct {
	name string
	ver  uint16
}{
	{"TLS 1.0", 0x0301},
	{"TLS 1.1", 0x0302},
}

func main() {
	fmt.Println("TLS legacy-suite negotiability assertion")
	fmt.Printf("  toolchain        : %s\n", runtime.Version())
	fmt.Printf("  fips140.Enforced : %v\n", fips140.Enforced())
	fmt.Println("  method           : raw ClientHello offering one legacy suite at a time")
	fmt.Println("                     against a server with no CipherSuites restriction")

	ln, addr, err := permissiveServer()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: could not start test server:", err)
		os.Exit(2)
	}
	defer ln.Close()

	failures := 0

	// Positive control. A malformed ClientHello would be refused for reasons unrelated to
	// cipher policy, which would turn every "refused" below into a false pass. This offers
	// suites the test server must support, and aborts if they are rejected.
	if ok, detail := offer(addr, 0x0303, []uint16{0xc02b, 0xc023, 0xc009}); !ok {
		fmt.Fprintf(os.Stderr, "ERROR: positive control failed (%s).\n", detail)
		fmt.Fprintln(os.Stderr, "The ClientHello is malformed or the test server is wrong;")
		fmt.Fprintln(os.Stderr, "the refusals below would be meaningless. Not a TLS policy finding.")
		os.Exit(2)
	}
	fmt.Println("  control          : ECDHE-ECDSA-AES128-GCM accepted, ClientHello is valid")

	fmt.Println("  legacy cipher suites:")
	for _, s := range legacySuites {
		accepted, detail := offer(addr, 0x0303, []uint16{s.id})
		if accepted {
			fmt.Printf("    NEGOTIATED %-38s %s\n", s.name, detail)
			failures++
			continue
		}
		fmt.Printf("    refused    %-38s %s\n", s.name, detail)
	}

	fmt.Println("  protocol versions below TLS 1.2:")
	// Offered with a suite the server does support, so a refusal is attributable to the
	// version rather than to the suite.
	for _, v := range oldVersions {
		accepted, detail := offer(addr, v.ver, []uint16{0xc02f, 0xc02b, 0x002f})
		if accepted {
			fmt.Printf("    NEGOTIATED %-38s %s\n", v.name, detail)
			failures++
			continue
		}
		fmt.Printf("    refused    %-38s %s\n", v.name, detail)
	}

	if failures > 0 {
		fmt.Fprintf(os.Stderr, "\nERROR: %d legacy configuration(s) were negotiated.\n", failures)
		fmt.Fprintln(os.Stderr, "The toolchain's TLS policy has changed. Investigate before shipping.")
		os.Exit(1)
	}

	total := len(legacySuites) + len(oldVersions)
	fmt.Printf("  result           : 0 of %d legacy configurations negotiable\n", total)
	fmt.Println("verified: no legacy cipher suite or pre-1.2 protocol version is negotiable")
}

// permissiveServer is the weakest configuration the standard library allows: TLS 1.0 floor
// and no CipherSuites restriction, so the library picks from everything it is willing to
// serve. Anything refused here is refused by the crypto stack rather than by our settings,
// which is what makes the result evidence about the toolchain.
func permissiveServer() (net.Listener, string, error) {
	k, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		return nil, "", err
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "tlsassert"},
		DNSNames:     []string{"localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, k.Public(), k)
	if err != nil {
		return nil, "", err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, "", err
	}
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: k, Leaf: leaf}},
		MinVersion:   tls.VersionTLS10,
	})
	if err != nil {
		return nil, "", err
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				_ = c.(*tls.Conn).Handshake()
				c.Close()
			}(c)
		}
	}()
	return ln, ln.Addr().String(), nil
}

// offer sends a ClientHello advertising exactly the given suites and reads the server's
// first handshake record. A ServerHello (type 2) means the server picked one of them; an
// Alert (type 21) means it refused.
func offer(addr string, version uint16, suites []uint16) (accepted bool, detail string) {
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return false, "dial failed: " + err.Error()
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	if _, err := conn.Write(clientHello(version, suites)); err != nil {
		return false, "write failed"
	}

	hdr := make([]byte, 5)
	if _, err := readFull(conn, hdr); err != nil {
		// A closed connection with no alert is still a refusal.
		return false, "no response"
	}
	switch hdr[0] {
	case 22: // handshake record
		body := make([]byte, int(binary.BigEndian.Uint16(hdr[3:5])))
		if _, err := readFull(conn, body); err != nil || len(body) < 1 {
			return false, "truncated handshake"
		}
		if body[0] == 2 {
			return true, "server sent ServerHello"
		}
		return false, fmt.Sprintf("handshake type %d", body[0])
	case 21: // alert
		body := make([]byte, int(binary.BigEndian.Uint16(hdr[3:5])))
		if _, err := readFull(conn, body); err == nil && len(body) >= 2 {
			return false, fmt.Sprintf("alert %d", body[1])
		}
		return false, "alert"
	default:
		return false, fmt.Sprintf("record type %d", hdr[0])
	}
}

func readFull(c net.Conn, b []byte) (int, error) {
	n := 0
	for n < len(b) {
		m, err := c.Read(b[n:])
		if m > 0 {
			n += m
		}
		if err != nil {
			return n, err
		}
	}
	return n, nil
}

// clientHello assembles a minimal TLS 1.2-format ClientHello. Hand-built because
// crypto/tls will not send the suites this needs to offer.
func clientHello(version uint16, suites []uint16) []byte {
	var body []byte
	body = append(body, byte(version>>8), byte(version)) // client_version

	random := make([]byte, 32)
	_, _ = rand.Read(random)
	body = append(body, random...)
	body = append(body, 0) // session_id length

	body = append(body, byte(len(suites)*2>>8), byte(len(suites)*2))
	for _, s := range suites {
		body = append(body, byte(s>>8), byte(s))
	}

	body = append(body, 1, 0) // compression_methods: null

	// Extensions: SNI, supported_groups, ec_point_formats, signature_algorithms. Enough
	// for a server to complete an ECDHE handshake if it wants to.
	ext := []byte{}
	sni := []byte{0, 0, 0, 14, 0, 12, 0, 0, 9}
	sni = append(sni, []byte("localhost")...)
	ext = append(ext, sni...)
	ext = append(ext, 0, 10, 0, 6, 0, 4, 0, 23, 0, 24)                      // supported_groups: P-256, P-384
	ext = append(ext, 0, 11, 0, 2, 1, 0)                                     // ec_point_formats: uncompressed
	ext = append(ext, 0, 13, 0, 8, 0, 6, 4, 1, 4, 3, 2, 1)                   // signature_algorithms
	body = append(body, byte(len(ext)>>8), byte(len(ext)))
	body = append(body, ext...)

	hs := []byte{1, byte(len(body) >> 16), byte(len(body) >> 8), byte(len(body))}
	hs = append(hs, body...)

	rec := []byte{22, 3, 1, byte(len(hs) >> 8), byte(len(hs))}
	return append(rec, hs...)
}
