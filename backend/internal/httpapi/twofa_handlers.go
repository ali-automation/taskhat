package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"

	"github.com/ali-automation/taskhat/backend/internal/auth"
)

// ---- Stage 23: TOTP two-factor ----

func hashRecovery(code string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.ReplaceAll(code, "-", ""))))
	return hex.EncodeToString(sum[:])
}

func newRecoveryCodes(n int) []string {
	codes := make([]string, n)
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	for i := range codes {
		buf := make([]byte, 8)
		_, _ = rand.Read(buf)
		out := make([]byte, 8)
		for j, b := range buf {
			out[j] = alphabet[int(b)%len(alphabet)]
		}
		codes[i] = string(out[:4]) + "-" + string(out[4:])
	}
	return codes
}

func (s *Server) otpauthURL(email, secret string) string {
	label := url.PathEscape("TaskHat:" + email)
	return fmt.Sprintf("otpauth://totp/%s?secret=%s&issuer=TaskHat&digits=6&period=30", label, secret)
}

func (s *Server) handleTwoFAStatus(w http.ResponseWriter, r *http.Request) {
	_, enabled, err := s.store.TwoFAState(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "2fa state", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":  enabled,
		"required": s.store.SettingStr(r.Context(), "require_2fa", "false") == "true",
	})
}

// handleTwoFASetup mints a pending secret; enabling requires a valid code.
func (s *Server) handleTwoFASetup(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.GetUserByID(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "get user", err)
		return
	}
	secret := auth.NewTOTPSecret()
	if err := s.store.SetPendingTOTP(r.Context(), user.ID, secret); err != nil {
		s.internalError(w, "set pending totp", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"secret":     secret,
		"otpauthUrl": s.otpauthURL(user.Email, secret),
	})
}

// handleTwoFAQR renders the enrollment QR for the pending/enabled secret.
func (s *Server) handleTwoFAQR(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.GetUserByID(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "get user", err)
		return
	}
	secret, _, err := s.store.TwoFAState(r.Context(), user.ID)
	if err != nil || secret == "" {
		writeError(w, http.StatusNotFound, "run setup first")
		return
	}
	png, err := qrcode.Encode(s.otpauthURL(user.Email, secret), qrcode.Medium, 220)
	if err != nil {
		s.internalError(w, "qr", err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(png)
}

func (s *Server) handleTwoFAEnable(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	var req struct {
		Code string `json:"code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	secret, enabled, err := s.store.TwoFAState(r.Context(), userID)
	if err != nil {
		s.internalError(w, "2fa state", err)
		return
	}
	if secret == "" || enabled {
		writeError(w, http.StatusBadRequest, "run setup first")
		return
	}
	if !auth.VerifyTOTP(secret, strings.TrimSpace(req.Code), time.Now()) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"code": "that code didn't match — try the next one"})
		return
	}
	codes := newRecoveryCodes(8)
	hashes := make([]string, len(codes))
	for i, c := range codes {
		hashes[i] = hashRecovery(c)
	}
	if err := s.store.EnableTOTP(r.Context(), userID, hashes); err != nil {
		s.internalError(w, "enable totp", err)
		return
	}
	s.audit(r, "2fa.enabled", "", nil)
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true, "recoveryCodes": codes})
}

func (s *Server) handleTwoFADisable(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	var req struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		s.internalError(w, "get user", err)
		return
	}
	_, hash, err := s.store.GetUserForLogin(r.Context(), user.Email)
	if err != nil {
		s.internalError(w, "login lookup", err)
		return
	}
	if ok, _ := auth.VerifyPassword(req.Password, hash); !ok {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"password": "incorrect password"})
		return
	}
	if !s.verifySecondFactor(r, userID, strings.TrimSpace(req.Code)) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"code": "invalid code"})
		return
	}
	if err := s.store.DisableTOTP(r.Context(), userID); err != nil {
		s.internalError(w, "disable totp", err)
		return
	}
	s.audit(r, "2fa.disabled", "", nil)
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}

// verifySecondFactor accepts a TOTP code or an unused recovery code.
func (s *Server) verifySecondFactor(r *http.Request, userID, code string) bool {
	secret, enabled, err := s.store.TwoFAState(r.Context(), userID)
	if err != nil || !enabled {
		return false
	}
	if auth.VerifyTOTP(secret, code, time.Now()) {
		return true
	}
	ok, _ := s.store.ConsumeRecoveryCode(r.Context(), userID, hashRecovery(code))
	return ok
}

// handleLogin2FA finishes a login that required a second factor.
func (s *Server) handleLogin2FA(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MFAToken string `json:"mfaToken"`
		Code     string `json:"code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	userID, err := auth.ParseMFAToken(s.cfg.JWTSecret, req.MFAToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "sign-in expired — enter your password again")
		return
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user no longer active")
		return
	}
	if s.loginLocked(r, user.Email) {
		writeError(w, http.StatusTooManyRequests, "too many failed attempts — try again later")
		return
	}
	if !s.verifySecondFactor(r, userID, strings.TrimSpace(req.Code)) {
		s.recordLoginFailure(r, user.Email)
		s.store.Audit(r.Context(), &user.ID, "login.2fa_failed", user.Email, r.RemoteAddr, nil)
		writeFieldErrors(w, http.StatusUnauthorized, map[string]string{"code": "that code didn't match"})
		return
	}
	s.rdb.Del(r.Context(), "loginfail:"+user.Email)
	s.store.Audit(r.Context(), &user.ID, "login.success", user.Email, r.RemoteAddr, nil)
	s.issueTokens(w, r, user, http.StatusOK)
}
