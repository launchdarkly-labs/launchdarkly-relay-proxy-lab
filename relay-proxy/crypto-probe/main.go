// Measures the crypto a Relay Proxy actually negotiates, and reports it as JSON for the
// dashboard's CNSA 2.0 panel.
//
// The panel needs measurements rather than configuration, because the two differ in a way
// that matters: a relay can be built with all three ML-KEM hybrid groups compiled in and
// still hand a client classical ECDH. Only a handshake shows which happened.
//
// Two things are reported. The build posture of this probe binary, which tells you which
// FIPS module it links and whether ML-DSA is available; and one handshake per client
// profile against a target relay, which tells you what that relay negotiates.
//
// The probe is built the same way the hardened relay is, so its own posture is a proxy for
// what a relay built the same way supports.
package main

import (
	"crypto/fips140"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"runtime"
	"runtime/debug"
	"time"
)

// Client profiles worth probing. The NIST-only entries are the ones that expose a silent
// downgrade: a relay whose tlssecpmlkem default is off will answer them with classical
// ECDH instead of refusing, so the handshake succeeds and nothing is logged.
var profiles = []struct {
	Name   string
	Groups []tls.CurveID
}{
	{"pqc-nist-p384", []tls.CurveID{tls.SecP384r1MLKEM1024}},
	{"pqc-nist-p256", []tls.CurveID{tls.SecP256r1MLKEM768}},
	{"pqc-x25519", []tls.CurveID{tls.X25519MLKEM768}},
	{"classical-p384", []tls.CurveID{tls.CurveP384}},
}

type handshake struct {
	Profile   string `json:"profile"`
	Connected bool   `json:"connected"`
	Group     string `json:"group,omitempty"`
	Suite     string `json:"suite,omitempty"`
	SigAlg    string `json:"signature_algorithm,omitempty"`
	TLSVer    string `json:"tls_version,omitempty"`
	// PostQuantumKEX is the measurement the panel keys on: whether this handshake used a
	// hybrid ML-KEM group or fell back to classical key exchange.
	PostQuantumKEX bool   `json:"post_quantum_kex"`
	Error          string `json:"error,omitempty"`
}

type report struct {
	MeasuredAt string      `json:"measured_at"`
	Target     string      `json:"target,omitempty"`
	Build      buildInfo   `json:"build"`
	CNSA       []cnsaItem  `json:"cnsa2"`
	Handshakes []handshake `json:"handshakes,omitempty"`
}

type buildInfo struct {
	GoVersion string `json:"go_version"`
	// FIPSEnforced reports crypto/fips140.Enforced(). GODEBUG=fips140=on links the module
	// but leaves it permissive, where this is false and non-approved algorithms stay usable.
	FIPSEnforced bool   `json:"fips_enforced"`
	FIPSModule   string `json:"fips_module"`
	MLDSA        bool   `json:"mldsa_available"`
	MLKEMGroups  int    `json:"mlkem_groups_enabled"`
}

// cnsaItem is one CNSA 2.0 algorithm family. Status is deliberately one of met / unmet /
// unavailable rather than a score: "unavailable" means the toolchain has no path to it, so
// it is not something this deployment can configure its way out of.
type cnsaItem struct {
	Requirement string `json:"requirement"`
	Algorithm   string `json:"algorithm"`
	Status      string `json:"status"`
	Detail      string `json:"detail"`
}

func main() {
	target := flag.String("target", "", "host:port of a TLS relay to probe (omit to report build posture only)")
	timeout := flag.Duration("timeout", 5*time.Second, "per-handshake timeout")
	insecure := flag.Bool("insecure", true, "skip certificate verification (lab uses self-signed certs)")
	flag.Parse()

	r := report{
		MeasuredAt: time.Now().UTC().Format(time.RFC3339),
		Target:     *target,
		Build:      probeBuild(),
	}
	if *target != "" {
		for _, p := range profiles {
			r.Handshakes = append(r.Handshakes, probeHandshake(*target, p.Name, p.Groups, *timeout, *insecure))
		}
	}
	r.CNSA = assessCNSA(r.Build, r.Handshakes)

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(r); err != nil {
		fmt.Fprintln(os.Stderr, "encode:", err)
		os.Exit(1)
	}
}

func probeBuild() buildInfo {
	b := buildInfo{
		GoVersion:    runtime.Version(),
		FIPSEnforced: fips140.Enforced(),
		FIPSModule:   "not linked",
		MLDSA:        mldsaAvailable(),
		MLKEMGroups:  countMLKEMGroups(),
	}
	// The linked module version is recorded in the binary's build settings by the toolchain,
	// which is the same place `go version -m` reads it from.
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			if s.Key == "GOFIPS140" && s.Value != "" {
				b.FIPSModule = s.Value
			}
		}
	}
	return b
}

// countMLKEMGroups counts hybrid groups this binary will actually offer. A group can be
// compiled in and still disabled by the tlssecpmlkem GODEBUG default that the module's `go`
// directive bakes in, so this asks the TLS stack rather than assuming three.
func countMLKEMGroups() int {
	n := 0
	for _, g := range []tls.CurveID{tls.X25519MLKEM768, tls.SecP256r1MLKEM768, tls.SecP384r1MLKEM1024} {
		if groupUsable(g) {
			n++
		}
	}
	return n
}

// groupUsable performs a real loopback handshake restricted to one group. A group disabled
// by GODEBUG fails here even though the constant exists, which is the whole point.
func groupUsable(g tls.CurveID) bool {
	cert, err := selfSignedCert()
	if err != nil {
		return false
	}
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		return false
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		_ = c.(*tls.Conn).Handshake()
		c.Close()
	}()
	conn, err := tls.Dial("tcp", ln.Addr().String(), &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec // loopback capability probe, not a trust decision
		MinVersion:         tls.VersionTLS13,
		CurvePreferences:   []tls.CurveID{g},
	})
	if err != nil {
		return false
	}
	used := conn.ConnectionState().CurveID
	conn.Close()
	return used == g
}

func probeHandshake(target, name string, groups []tls.CurveID, timeout time.Duration, insecure bool) handshake {
	h := handshake{Profile: name}
	d := &net.Dialer{Timeout: timeout}
	conn, err := tls.DialWithDialer(d, "tcp", target, &tls.Config{
		InsecureSkipVerify: insecure, //nolint:gosec // lab relay uses a self-signed cert
		MinVersion:         tls.VersionTLS13,
		CurvePreferences:   groups,
	})
	if err != nil {
		h.Error = err.Error()
		return h
	}
	defer conn.Close()

	st := conn.ConnectionState()
	h.Connected = true
	h.Group = st.CurveID.String()
	h.Suite = tls.CipherSuiteName(st.CipherSuite)
	h.TLSVer = tls.VersionName(st.Version)
	h.PostQuantumKEX = isHybrid(st.CurveID)
	if len(st.PeerCertificates) > 0 {
		h.SigAlg = st.PeerCertificates[0].SignatureAlgorithm.String()
	}
	return h
}

// isPQCProfile marks the profiles that request a hybrid group. The classical profile is
// excluded from scoring and kept as a control, so the panel can show that a relay answers
// a classical client normally rather than refusing it.
func isPQCProfile(name string) bool {
	for _, p := range profiles {
		if p.Name != name {
			continue
		}
		for _, g := range p.Groups {
			if isHybrid(g) {
				return true
			}
		}
	}
	return false
}

func isHybrid(g tls.CurveID) bool {
	switch g {
	case tls.X25519MLKEM768, tls.SecP256r1MLKEM768, tls.SecP384r1MLKEM1024:
		return true
	}
	return false
}

// assessCNSA maps what was measured onto the four CNSA 2.0 algorithm families that apply to
// a TLS server. Two of them cannot currently be met by any configuration of this component,
// and the panel shows that rather than omitting the rows: an accurate two-of-four is more
// use in a compliance conversation than a partial list that looks complete.
func assessCNSA(b buildInfo, hs []handshake) []cnsaItem {
	items := []cnsaItem{}

	// Key establishment. Measured from handshakes when a target was probed, since a group
	// being available is not the same as a relay selecting it.
	kex := cnsaItem{
		Requirement: "Key establishment",
		Algorithm:   "ML-KEM-768 / ML-KEM-1024 (FIPS 203)",
	}
	switch {
	case len(hs) > 0:
		// Score only the profiles that asked for a hybrid group. classical-p384 is a
		// control: it requests classical key exchange and getting it back is correct, so
		// counting it as a failure would mark a compliant relay unmet.
		// A profile that failed to connect counts against the requirement. Skipping it
		// would report "met" for a relay that refused every PQC client except one, which
		// is the opposite of what the panel is for.
		var pq, asked int
		var downgraded, refused []string
		for _, h := range hs {
			if !isPQCProfile(h.Profile) {
				continue
			}
			asked++
			switch {
			case !h.Connected:
				refused = append(refused, h.Profile)
			case h.PostQuantumKEX:
				pq++
			default:
				downgraded = append(downgraded, h.Profile)
			}
		}
		switch {
		case asked == 0:
			kex.Status = "unmet"
			kex.Detail = "no post-quantum client profile was probed"
		case pq == asked:
			kex.Status = "met"
			kex.Detail = fmt.Sprintf("%d of %d post-quantum client profiles negotiated a hybrid ML-KEM group", pq, asked)
		default:
			kex.Status = "unmet"
			kex.Detail = fmt.Sprintf("%d of %d post-quantum profiles negotiated ML-KEM.", pq, asked)
			if len(downgraded) > 0 {
				kex.Detail += fmt.Sprintf(" Silently downgraded to classical key exchange: %v.", downgraded)
			}
			if len(refused) > 0 {
				kex.Detail += fmt.Sprintf(" Handshake refused: %v.", refused)
			}
			kex.Detail += " The NIST P-curve hybrid groups are disabled unless go.mod sets" +
				" godebug tlssecpmlkem=1."
		}
	case b.MLKEMGroups == 3:
		kex.Status = "met"
		kex.Detail = "all three hybrid groups enabled in this build (no relay probed)"
	default:
		kex.Status = "unmet"
		kex.Detail = fmt.Sprintf("%d of 3 hybrid groups enabled; the NIST P-curve groups are "+
			"disabled unless go.mod sets godebug tlssecpmlkem=1", b.MLKEMGroups)
	}
	items = append(items, kex)

	// Authentication. ML-DSA and a CMVP-validated module are mutually exclusive today: the
	// validated module reports "mldsa: unavailable in FIPS 140-3 Go Cryptographic Module
	// v1.0.0", so reaching this requires the in-process module.
	sig := cnsaItem{
		Requirement: "Authentication",
		Algorithm:   "ML-DSA-87 (FIPS 204)",
	}
	var observed string
	for _, h := range hs {
		if h.SigAlg != "" {
			observed = h.SigAlg
			break
		}
	}
	switch {
	case observed != "" && observed == "ML-DSA-87":
		sig.Status = "met"
		sig.Detail = "relay certificate is signed with ML-DSA-87"
	case observed != "":
		sig.Status = "unmet"
		sig.Detail = "relay certificate uses " + observed +
			"; ML-DSA is available in this build but the certificate is classical"
	case b.MLDSA:
		sig.Status = "unmet"
		sig.Detail = "ML-DSA available in this build; needs a certificate issued with it"
	default:
		sig.Status = "unavailable"
		sig.Detail = "ML-DSA absent from " + b.GoVersion +
			", and from the validated module in any Go version. Needs Go 1.27+ with GOFIPS140=inprocess"
	}
	items = append(items, sig)

	// Symmetric encryption. Go's TLS 1.3 suite preference is fixed in the standard library
	// and tls.Config.CipherSuites is ignored for 1.3, so AES-256 is not selectable from
	// configuration. Reported as unavailable rather than unmet for that reason.
	sym := cnsaItem{
		Requirement: "Symmetric encryption",
		Algorithm:   "AES-256",
		Status:      "unavailable",
	}
	if observedSuite := firstSuite(hs); observedSuite != "" {
		sym.Detail = "negotiated " + observedSuite +
			". Go fixes TLS 1.3 suite preference in the standard library and ignores " +
			"tls.Config.CipherSuites for 1.3, so AES-256 cannot be selected by configuration"
	} else {
		sym.Detail = "Go fixes TLS 1.3 suite preference in the standard library and ignores " +
			"tls.Config.CipherSuites for 1.3, so AES-256 cannot be selected by configuration"
	}
	items = append(items, sym)

	// Hashing follows suite selection, so it moves only when the suite does.
	hash := cnsaItem{
		Requirement: "Hashing",
		Algorithm:   "SHA-384",
		Status:      "unavailable",
		Detail:      "tied to TLS 1.3 suite selection, which is fixed in the standard library",
	}
	if s := firstSuite(hs); s != "" {
		hash.Detail = "negotiated " + s + "; " + hash.Detail
	}
	items = append(items, hash)

	return items
}

func firstSuite(hs []handshake) string {
	for _, h := range hs {
		if h.Suite != "" {
			return h.Suite
		}
	}
	return ""
}
