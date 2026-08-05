package httpapi

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ali-automation/taskhat/backend/internal/confimport"
	"github.com/ali-automation/taskhat/backend/internal/jiraimport"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

type startImportRequest struct {
	Source     string `json:"source"` // "api" (Jira) or "confluence"
	Site       string `json:"site"`
	Email      string `json:"email"`
	APIToken   string `json:"apiToken"`
	ProjectKey string `json:"projectKey"`
	SpaceKey   string `json:"spaceKey"`  // Confluence space to import
	TargetKey  string `json:"targetKey"` // DocHat space key (optional)
}

// handleStartImport creates an import job and kicks off the dry-run scan.
// JSON body = Jira API source; multipart body = CSV upload.
func (s *Server) handleStartImport(w http.ResponseWriter, r *http.Request) {
	ownerID := userIDFrom(r.Context())

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
		file, _, err := r.FormFile("file")
		if err != nil {
			writeError(w, http.StatusBadRequest, "multipart field 'file' (Jira CSV export) required")
			return
		}
		defer file.Close()
		csvKey := "imports/upload-" + uuid.NewString() + ".csv"
		if err := s.blobs.Put(r.Context(), csvKey, file, -1, "text/csv"); err != nil {
			s.internalError(w, "store csv", err)
			return
		}
		projectKey := strings.ToUpper(strings.TrimSpace(r.FormValue("projectKey")))
		job, err := s.store.CreateImportJob(r.Context(), ownerID, "jira_csv",
			orDefault(projectKey, "CSV"), jiraimport.JobConfig{ProjectKey: projectKey, CSVKey: csvKey})
		if err != nil {
			s.internalError(w, "create job", err)
			return
		}
		s.publish(r, "import.scan", map[string]string{"jobId": job.ID})
		writeJSON(w, http.StatusCreated, job)
		return
	}

	var req startImportRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	fields := map[string]string{}
	req.Site = strings.TrimRight(strings.TrimSpace(req.Site), "/")
	req.ProjectKey = strings.ToUpper(strings.TrimSpace(req.ProjectKey))
	req.SpaceKey = strings.ToUpper(strings.TrimSpace(req.SpaceKey))
	if u, err := url.Parse(req.Site); err != nil || u.Scheme == "" || u.Host == "" {
		fields["site"] = "full site URL required, e.g. https://your-team.atlassian.net"
	}
	if req.Email == "" {
		fields["email"] = "Atlassian account email required"
	}
	if req.APIToken == "" {
		fields["apiToken"] = "API token required (create one at id.atlassian.com)"
	}

	// Confluence space import (Stage W6) rides the same job pipeline.
	if req.Source == "confluence" {
		if req.SpaceKey == "" {
			fields["spaceKey"] = "space key required, e.g. ENG"
		}
		if len(fields) > 0 {
			writeFieldErrors(w, http.StatusBadRequest, fields)
			return
		}
		job, err := s.store.CreateImportJob(r.Context(), ownerID, "confluence_api", req.SpaceKey, confimport.JobConfig{
			Site:      req.Site,
			Email:     req.Email,
			Token:     req.APIToken,
			SpaceKey:  req.SpaceKey,
			TargetKey: strings.ToUpper(strings.TrimSpace(req.TargetKey)),
		})
		if err != nil {
			s.internalError(w, "create job", err)
			return
		}
		s.publish(r, "import.scan", map[string]string{"jobId": job.ID})
		writeJSON(w, http.StatusCreated, job)
		return
	}

	if req.ProjectKey == "" {
		fields["projectKey"] = "project key required, e.g. PROJ"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	job, err := s.store.CreateImportJob(r.Context(), ownerID, "jira_api", req.ProjectKey, jiraimport.JobConfig{
		Site:       req.Site,
		Email:      req.Email,
		Token:      req.APIToken,
		ProjectKey: req.ProjectKey,
	})
	if err != nil {
		s.internalError(w, "create job", err)
		return
	}
	s.publish(r, "import.scan", map[string]string{"jobId": job.ID})
	writeJSON(w, http.StatusCreated, job)
}

func orDefault(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// requireImportJob loads a job owned by the caller.
func (s *Server) requireImportJob(w http.ResponseWriter, r *http.Request) (store.ImportJob, bool) {
	job, err := s.store.GetImportJob(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && job.OwnerID != userIDFrom(r.Context())) {
		writeError(w, http.StatusNotFound, "import job not found")
		return store.ImportJob{}, false
	}
	if err != nil {
		s.internalError(w, "get job", err)
		return store.ImportJob{}, false
	}
	return job, true
}

func (s *Server) handleGetImportJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.requireImportJob(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, job)
}

// handleDeleteImportJob removes a job plus its stored snapshot (and uploaded
// CSV) from blob storage. Active jobs must finish first — the worker is
// reading those blobs.
func (s *Server) handleDeleteImportJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.requireImportJob(w, r)
	if !ok {
		return
	}
	if job.Status == "scanning" || job.Status == "running" {
		writeError(w, http.StatusConflict, "the import is still running — wait for it to finish")
		return
	}
	blobKeys, err := s.store.DeleteImportJob(r.Context(), job.ID)
	if err != nil {
		s.internalError(w, "delete import job", err)
		return
	}
	for _, key := range blobKeys {
		if err := s.blobs.Delete(r.Context(), key); err != nil {
			s.log.Error("delete import blob", "key", key, "error", err)
		}
	}
	s.audit(r, "import.deleted", job.ProjectKey, map[string]any{"jobId": job.ID, "blobs": len(blobKeys)})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListImportJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.store.ListImportJobs(r.Context(), userIDFrom(r.Context()), 20)
	if err != nil {
		s.internalError(w, "list jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

// handleRunImport confirms a scanned job and starts the actual load.
func (s *Server) handleRunImport(w http.ResponseWriter, r *http.Request) {
	job, ok := s.requireImportJob(w, r)
	if !ok {
		return
	}
	if job.Status != "scanned" && job.Status != "done" && job.Status != "failed" {
		writeError(w, http.StatusConflict, "job is not ready to run (current status: "+job.Status+")")
		return
	}
	if err := s.store.SetImportJobStatus(r.Context(), job.ID, "running", ""); err != nil {
		s.internalError(w, "set status", err)
		return
	}
	s.publish(r, "import.run", map[string]string{"jobId": job.ID})
	job.Status = "running"
	writeJSON(w, http.StatusOK, job)
}

// handleExportCSV streams the project as a Jira-import-compatible CSV.
func (s *Server) handleExportCSV(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	issues, comments, err := s.store.ExportIssues(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "export", err)
		return
	}

	maxComments := 0
	for _, i := range issues {
		if n := len(comments[i.ID]); n > maxComments {
			maxComments = n
		}
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", project.Key+"-export.csv"))
	cw := csv.NewWriter(w)

	header := []string{
		"Issue key", "Issue id", "Summary", "Issue Type", "Status", "Priority",
		"Assignee", "Reporter", "Labels", "Story Points", "Sprint", "Parent",
		"Due Date", "Original Estimate", "Time Spent", "Created", "Updated", "Resolved", "Description",
	}
	for i := 0; i < maxComments; i++ {
		header = append(header, "Comment")
	}
	cw.Write(header)

	fmtTime := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.Format("2006-01-02 15:04")
	}
	for _, i := range issues {
		assignee := ""
		if i.Assignee != nil {
			assignee = i.Assignee.Email
		}
		sprint := ""
		if i.Sprint != nil {
			sprint = i.Sprint.Name
		}
		parent := ""
		if i.Parent != nil {
			parent = i.Parent.Key
		}
		created := i.CreatedAt
		updated := i.UpdatedAt
		row := []string{
			i.Key, i.ID, i.Summary, strings.Title(i.Type), i.Status.Name, strings.Title(i.Priority),
			assignee, i.Reporter.Email, strings.Join(i.Labels, " "), pointsStr(i.StoryPoints), sprint, parent,
			fmtTime(i.DueDate), fmtEstimate(i.OriginalEstimateSeconds), fmtSpent(i.TimeSpentSeconds),
			created.Format("2006-01-02 15:04"), updated.Format("2006-01-02 15:04"),
			fmtTime(i.ResolvedAt), i.Description,
		}
		for _, c := range comments[i.ID] {
			row = append(row, fmt.Sprintf("%s; %s; %s", c.CreatedAt.Format("2006-01-02 15:04"), c.Author.Email, c.Body))
		}
		for len(row) < len(header) {
			row = append(row, "")
		}
		cw.Write(row)
	}
	cw.Flush()
}

func pointsStr(p *float64) string {
	if p == nil {
		return ""
	}
	return strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.2f", *p), "0"), ".0")
}

func fmtEstimate(p *int64) string {
	if p == nil {
		return ""
	}
	return formatJiraDuration(*p)
}

func fmtSpent(sec int64) string {
	if sec == 0 {
		return ""
	}
	return formatJiraDuration(sec)
}
