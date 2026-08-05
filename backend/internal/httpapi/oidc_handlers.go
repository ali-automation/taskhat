package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/auth"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage 23: OIDC single sign-on ----
//
// Authorization-code flow; identity comes from the provider's userinfo
// endpoint over TLS (no local JWT verification needed).

type oidcDiscovery struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

var (
	oidcCacheMu sync.Mutex
	oidcCache   = map[string]struct {
		doc oidcDiscovery
		at  time.Time
	}{}
)

func (s *Server) oidcConfig(ctx context.Context) (issuer, clientID, clientSecret string, enabled bool) {
	issuer = strings.TrimRight(s.store.SettingStr(ctx, "oidc_issuer", ""), "/")
	clientID = s.store.SettingStr(ctx, "oidc_client_id", "")
	clientSecret = s.store.SettingStr(ctx, "oidc_client_secret", "")
	enabled = s.store.SettingStr(ctx, "oidc_enabled", "false") == "true" && issuer != "" && clientID != ""
	return
}

func (s *Server) oidcDiscover(issuer string) (oidcDiscovery, error) {
	oidcCacheMu.Lock()
	if c, ok := oidcCache[issuer]; ok && time.Since(c.at) < 10*time.Minute {
		oidcCacheMu.Unlock()
		return c.doc, nil
	}
	oidcCacheMu.Unlock()
	resp, err := http.Get(issuer + "/.well-known/openid-configuration")
	if err != nil {
		return oidcDiscovery{}, fmt.Errorf("discovery: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return oidcDiscovery{}, fmt.Errorf("discovery returned %d", resp.StatusCode)
	}
	var doc oidcDiscovery
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return oidcDiscovery{}, err
	}
	oidcCacheMu.Lock()
	oidcCache[issuer] = struct {
		doc oidcDiscovery
		at  time.Time
	}{doc, time.Now()}
	oidcCacheMu.Unlock()
	return doc, nil
}

func (s *Server) oidcRedirectURI() string {
	return strings.TrimRight(s.cfg.BaseURL, "/") + "/api/v1/auth/oidc/callback"
}

func (s *Server) handleOIDCStart(w http.ResponseWriter, r *http.Request) {
	issuer, clientID, _, enabled := s.oidcConfig(r.Context())
	if !enabled {
		http.Redirect(w, r, "/login?error=sso-disabled", http.StatusFound)
		return
	}
	doc, err := s.oidcDiscover(issuer)
	if err != nil {
		s.log.Error("oidc discovery", "error", err)
		http.Redirect(w, r, "/login?error=sso-unavailable", http.StatusFound)
		return
	}
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	state := hex.EncodeToString(buf)
	s.rdb.Set(r.Context(), "oidcstate:"+state, "1", 10*time.Minute)
	q := url.Values{
		"response_type": {"code"},
		"client_id":     {clientID},
		"redirect_uri":  {s.oidcRedirectURI()},
		"scope":         {"openid email profile"},
		"state":         {state},
	}
	http.Redirect(w, r, doc.AuthorizationEndpoint+"?"+q.Encode(), http.StatusFound)
}

func (s *Server) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	fail := func(reason string) {
		http.Redirect(w, r, "/login?error="+url.QueryEscape(reason), http.StatusFound)
	}
	issuer, clientID, clientSecret, enabled := s.oidcConfig(r.Context())
	if !enabled {
		fail("sso-disabled")
		return
	}
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" {
		fail("sso-cancelled")
		return
	}
	if n, _ := s.rdb.Del(r.Context(), "oidcstate:"+state).Result(); n == 0 {
		fail("sso-expired")
		return
	}
	doc, err := s.oidcDiscover(issuer)
	if err != nil {
		fail("sso-unavailable")
		return
	}

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {s.oidcRedirectURI()},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
	}
	resp, err := http.PostForm(doc.TokenEndpoint, form)
	if err != nil {
		fail("sso-unavailable")
		return
	}
	defer resp.Body.Close()
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil || tok.AccessToken == "" {
		s.log.Error("oidc token exchange failed", "status", resp.StatusCode)
		fail("sso-rejected")
		return
	}

	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, doc.UserinfoEndpoint, nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	uresp, err := http.DefaultClient.Do(req)
	if err != nil {
		fail("sso-unavailable")
		return
	}
	defer uresp.Body.Close()
	var info struct {
		Email             string `json:"email"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
	}
	if err := json.NewDecoder(uresp.Body).Decode(&info); err != nil || info.Email == "" {
		fail("sso-no-email")
		return
	}
	email := strings.ToLower(strings.TrimSpace(info.Email))
	name := strings.TrimSpace(info.Name)
	if name == "" {
		name = orDefault(info.PreferredUsername, strings.Split(email, "@")[0])
	}

	// JIT provisioning: SSO users bypass invite-only (the admin turned SSO on).
	user, _, err := s.store.GetUserForLogin(r.Context(), email)
	if err == store.ErrNotFound {
		buf := make([]byte, 24)
		_, _ = rand.Read(buf)
		hash, herr := auth.HashPassword(hex.EncodeToString(buf))
		if herr != nil {
			fail("sso-error")
			return
		}
		user, err = s.store.CreateUser(r.Context(), email, hash, name)
		if err != nil {
			s.log.Error("oidc provision", "error", err)
			fail("sso-error")
			return
		}
		s.applyNewUserDefaults(r, user.ID)
		s.store.Audit(r.Context(), &user.ID, "user.registered", email+" (sso)", r.RemoteAddr, nil)
	} else if err != nil {
		fail("sso-error")
		return
	}
	if !user.IsActive {
		fail("sso-deactivated")
		return
	}

	// Start the session cookie-side, then land in the app; the frontend
	// bootstraps the access token via the normal refresh call.
	sessionID, err := s.store.CreateSession(r.Context(), user.ID, r.RemoteAddr, r.UserAgent())
	if err != nil {
		fail("sso-error")
		return
	}
	refresh, err := s.sessions.Create(r.Context(), user.ID, sessionID, s.sessionTTL(r))
	if err != nil {
		fail("sso-error")
		return
	}
	s.setRefreshCookie(w, refresh)
	s.store.Audit(r.Context(), &user.ID, "login.success", user.Email+" (sso)", r.RemoteAddr, nil)
	http.Redirect(w, r, "/", http.StatusFound)
}
