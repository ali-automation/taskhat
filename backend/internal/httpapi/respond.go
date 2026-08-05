package httpapi

import (
	"encoding/json"
	"net/http"
)

// errorBody matches Jira's REST error shape.
type errorBody struct {
	ErrorMessages []string          `json:"errorMessages"`
	Errors        map[string]string `json:"errors"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, messages ...string) {
	writeJSON(w, status, errorBody{ErrorMessages: messages, Errors: map[string]string{}})
}

func writeFieldErrors(w http.ResponseWriter, status int, fields map[string]string) {
	writeJSON(w, status, errorBody{ErrorMessages: []string{}, Errors: fields})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}
