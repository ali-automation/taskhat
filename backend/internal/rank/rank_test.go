package rank

import (
	"sort"
	"testing"
)

func mustBetween(t *testing.T, a, b string) string {
	t.Helper()
	r, err := Between(a, b)
	if err != nil {
		t.Fatalf("Between(%q, %q): %v", a, b, err)
	}
	if a != "" && r <= a {
		t.Fatalf("Between(%q, %q) = %q, not greater than a", a, b, r)
	}
	if b != "" && r >= b {
		t.Fatalf("Between(%q, %q) = %q, not less than b", a, b, r)
	}
	return r
}

func TestBetweenBasics(t *testing.T) {
	mustBetween(t, "", "")
	mustBetween(t, "a", "c")
	mustBetween(t, "a", "b")     // adjacent digits
	mustBetween(t, "az", "b")    // tight squeeze
	mustBetween(t, "a", "a1")    // b extends a
	mustBetween(t, "azzz", "b")  // long run of max digits
	mustBetween(t, "", "000001") // near minimum
	mustBetween(t, "zzzz", "")   // near maximum
}

func TestBetweenRejectsBadOrder(t *testing.T) {
	if _, err := Between("b", "a"); err == nil {
		t.Error("expected error for a >= b")
	}
	if _, err := Between("a", "a"); err == nil {
		t.Error("expected error for a == b")
	}
}

// Repeatedly inserting at the same point must keep producing valid ranks.
func TestRepeatedMidInsert(t *testing.T) {
	lo, hi := "a", "b"
	for i := 0; i < 100; i++ {
		mid := mustBetween(t, lo, hi)
		lo = mid
	}
	lo, hi = "a", "b"
	for i := 0; i < 100; i++ {
		mid := mustBetween(t, lo, hi)
		hi = mid
	}
}

// Appending repeatedly (the common "create issue" path) should stay short.
func TestAppendGrowth(t *testing.T) {
	r, _ := After("")
	ranks := []string{r}
	for i := 0; i < 1000; i++ {
		next, err := After(r)
		if err != nil {
			t.Fatalf("After(%q): %v", r, err)
		}
		if next <= r {
			t.Fatalf("After(%q) = %q, not greater", r, next)
		}
		ranks = append(ranks, next)
		r = next
	}
	if len(r) > 40 {
		t.Errorf("rank grew to %d chars after 1000 appends: %q", len(r), r)
	}
	if !sort.StringsAreSorted(ranks) {
		t.Error("appended ranks are not sorted")
	}
}

func TestBeforeShrinks(t *testing.T) {
	r, _ := Before("")
	for i := 0; i < 1000; i++ {
		prev, err := Before(r)
		if err != nil {
			t.Fatalf("Before(%q): %v", r, err)
		}
		if prev >= r {
			t.Fatalf("Before(%q) = %q, not less", r, prev)
		}
		r = prev
	}
	if len(r) > 40 {
		t.Errorf("rank grew to %d chars after 1000 prepends: %q", len(r), r)
	}
}
