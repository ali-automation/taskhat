package httpapi

import (
	"fmt"
	"strconv"
	"strings"
)

// Jira duration strings: "1w 2d 3h 30m" with 1w = 5d, 1d = 8h.
const (
	minuteSec = int64(60)
	hourSec   = 60 * minuteSec
	daySec    = 8 * hourSec
	weekSec   = 5 * daySec
)

// parseJiraDuration parses "2w 1d 4h 30m" (any subset, any order) to seconds.
func parseJiraDuration(s string) (int64, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return 0, fmt.Errorf("empty duration")
	}
	var total int64
	for _, part := range strings.Fields(s) {
		unit := part[len(part)-1]
		numStr := part[:len(part)-1]
		n, err := strconv.ParseFloat(numStr, 64)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("use Jira's format, e.g. 2w 1d 4h 30m")
		}
		switch unit {
		case 'w':
			total += int64(n * float64(weekSec))
		case 'd':
			total += int64(n * float64(daySec))
		case 'h':
			total += int64(n * float64(hourSec))
		case 'm':
			total += int64(n * float64(minuteSec))
		default:
			return 0, fmt.Errorf("use Jira's format, e.g. 2w 1d 4h 30m")
		}
	}
	if total <= 0 {
		return 0, fmt.Errorf("duration must be positive")
	}
	return total, nil
}

// formatJiraDuration renders seconds as "1w 2d 3h 30m".
func formatJiraDuration(sec int64) string {
	if sec <= 0 {
		return "0m"
	}
	parts := []string{}
	for _, u := range []struct {
		size int64
		name string
	}{{weekSec, "w"}, {daySec, "d"}, {hourSec, "h"}, {minuteSec, "m"}} {
		if n := sec / u.size; n > 0 {
			parts = append(parts, fmt.Sprintf("%d%s", n, u.name))
			sec -= n * u.size
		}
	}
	if len(parts) == 0 {
		return "0m"
	}
	return strings.Join(parts, " ")
}
