// Package rank implements LexoRank-style string ordering (the scheme Jira
// uses): issues carry an opaque string; lexicographic order is display order;
// inserting between two issues writes a single row.
package rank

import (
	"fmt"
	"strings"
)

const digits = "0123456789abcdefghijklmnopqrstuvwxyz"

const (
	minDigit = '0'
	maxDigit = 'z'
	midDigit = 'i' // roughly the midpoint of the alphabet
)

// Initial is the rank given to the first issue in a project.
var Initial = strings.Repeat(string(midDigit), 6)

func indexOf(c byte) int { return strings.IndexByte(digits, c) }

func digitAt(s string, i int) int {
	if i >= len(s) {
		return 0 // treat missing digits as minimum
	}
	return indexOf(s[i])
}

// Between returns a rank r with a < r < b (lexicographically, C collation).
// Pass a == "" for "before everything", b == "" for "after everything".
func Between(a, b string) (string, error) {
	if b != "" && a >= b {
		return "", fmt.Errorf("rank: %q must sort before %q", a, b)
	}
	var sb strings.Builder
	for i := 0; ; i++ {
		da := digitAt(a, i)
		db := len(digits) - 1
		if b != "" {
			db = digitAt(b, i)
		}
		if da == db {
			sb.WriteByte(digits[da])
			continue
		}
		mid := (da + db) / 2
		if mid > da {
			sb.WriteByte(digits[mid])
			return sb.String(), nil
		}
		// Adjacent digits: keep a's digit and continue into deeper positions,
		// where b no longer constrains us (any extension of a's prefix sorts
		// before b at this digit).
		sb.WriteByte(digits[da])
		prefix := sb.String()
		rest := a[min(i+1, len(a)):]
		suffix, err := afterPrefix(rest)
		if err != nil {
			return "", err
		}
		return prefix + suffix, nil
	}
}

// afterPrefix returns a string strictly greater than rest but with no upper
// constraint (caller guaranteed headroom at a previous digit).
func afterPrefix(rest string) (string, error) {
	for i := 0; i < len(rest); i++ {
		d := indexOf(rest[i])
		if d < len(digits)-1 {
			mid := (d + len(digits)) / 2
			return rest[:i] + string(digits[mid]), nil
		}
	}
	return rest + string(midDigit), nil
}

const (
	baseLen = 6
	step    = 36 * 36 // spacing between appended ranks, leaves room for mid-inserts
)

var maxBase = pow36(baseLen)

func pow36(n int) int64 {
	v := int64(1)
	for i := 0; i < n; i++ {
		v *= 36
	}
	return v
}

func parseBase(s string) int64 {
	v := int64(0)
	for i := 0; i < baseLen; i++ {
		d := 0
		if i < len(s) {
			d = indexOf(s[i])
		}
		v = v*36 + int64(d)
	}
	return v
}

func formatBase(v int64) string {
	buf := make([]byte, baseLen)
	for i := baseLen - 1; i >= 0; i-- {
		buf[i] = digits[v%36]
		v /= 36
	}
	return string(buf)
}

// After returns a rank sorting after a, spaced out so appends (the common
// "create issue" path) stay short and leave room for later mid-inserts.
func After(a string) (string, error) {
	if a == "" {
		return Initial, nil
	}
	if v := parseBase(a) + step; v < maxBase {
		return formatBase(v), nil
	}
	// Top of the keyspace: fall back to extending; a rebalance job resets this.
	return Between(a, "")
}

// Before returns a rank sorting before b, using the same spacing as After.
func Before(b string) (string, error) {
	if b == "" {
		return Initial, nil
	}
	if v := parseBase(b) - step; v > 0 && formatBase(v) < b {
		return formatBase(v), nil
	}
	return Between("", b)
}
