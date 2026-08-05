package jiraimport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// JobConfig lives in import_jobs.config (jsonb). API credentials stay
// server-side and are never returned by the API.
type JobConfig struct {
	Site       string `json:"site,omitempty"`
	Email      string `json:"email,omitempty"`
	Token      string `json:"token,omitempty"`
	ProjectKey string `json:"projectKey"`
	CSVKey     string `json:"csvKey,omitempty"` // blob key of the uploaded CSV
}

func snapshotKey(jobID string) string { return "imports/" + jobID + ".json" }

// JobRunner executes import jobs inside the worker.
type JobRunner struct {
	St    *store.Store
	Blobs storage.Blob
	Hub   *realtime.Hub
	Log   *slog.Logger
}

// Execute runs one phase of a job: "scan" (fetch + dry-run report) or
// "run" (load the scanned snapshot into TaskHat).
func (j *JobRunner) Execute(ctx context.Context, jobID, mode string) error {
	job, err := j.St.GetImportJob(ctx, jobID)
	if err != nil {
		return fmt.Errorf("job %s: %w", jobID, err)
	}
	var cfg JobConfig
	if err := json.Unmarshal(job.Config, &cfg); err != nil {
		return j.failJob(ctx, job, fmt.Errorf("bad job config: %w", err))
	}

	switch mode {
	case "scan":
		return j.scan(ctx, job, cfg)
	case "run":
		return j.run(ctx, job, cfg)
	default:
		return fmt.Errorf("unknown import mode %q", mode)
	}
}

func (j *JobRunner) fetch(ctx context.Context, job store.ImportJob, cfg JobConfig) (*Data, *Client, error) {
	switch job.Source {
	case "jira_api":
		client := NewClient(cfg.Site, cfg.Email, cfg.Token)
		data, err := client.FetchAll(ctx, cfg.ProjectKey, func(p string) {
			j.publish(job, "scanning", Stats{Phase: "fetching", Progress: p})
		})
		return data, client, err
	case "jira_csv":
		body, err := j.Blobs.Get(ctx, cfg.CSVKey)
		if err != nil {
			return nil, nil, fmt.Errorf("csv blob: %w", err)
		}
		defer body.Close()
		data, err := ParseCSV(body)
		if err != nil {
			return nil, nil, err
		}
		if cfg.ProjectKey != "" {
			data.Project.Key = cfg.ProjectKey
			if data.Project.Name == "" {
				data.Project.Name = cfg.ProjectKey
			}
		}
		return data, nil, err
	default:
		return nil, nil, fmt.Errorf("unknown source %q", job.Source)
	}
}

func (j *JobRunner) scan(ctx context.Context, job store.ImportJob, cfg JobConfig) error {
	j.setStatus(ctx, job, "scanning", "")
	data, _, err := j.fetch(ctx, job, cfg)
	if err != nil {
		return j.failJob(ctx, job, err)
	}

	// Snapshot so "run" doesn't refetch (and a failed run can resume).
	raw, err := json.Marshal(data)
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	if err := j.Blobs.Put(ctx, snapshotKey(job.ID), bytes.NewReader(raw), int64(len(raw)), "application/json"); err != nil {
		return j.failJob(ctx, job, err)
	}

	emails, err := j.St.AllActiveEmails(ctx)
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	sc := ScanContext{
		KnownEmails:     emails,
		KnownAccountIDs: map[string]bool{},
		WorkTypes:       map[string]string{},
		StatusNames:     map[string]bool{"to do": true, "in progress": true, "done": true},
	}
	if ids, err := j.St.AllJiraAccountIDs(ctx); err == nil {
		sc.KnownAccountIDs = ids
	}
	if types, err := j.St.ListWorkTypes(ctx, true); err == nil {
		for _, wt := range types {
			sc.WorkTypes[normalize(wt.Name)] = wt.Key
			sc.WorkTypes[normalize(wt.Key)] = wt.Key
		}
	}
	// Importing into an existing space? Its real workflow statuses count too.
	if project, err := j.St.GetProjectByKey(ctx, data.Project.Key); err == nil {
		if statuses, err := j.St.ListStatuses(ctx, project.WorkflowID); err == nil {
			for _, st := range statuses {
				sc.StatusNames[normalize(st.Name)] = true
			}
		}
	}
	stats := Scan(data, sc)
	if err := j.St.SetImportJobStats(ctx, job.ID, stats); err != nil {
		return j.failJob(ctx, job, err)
	}
	j.setStatus(ctx, job, "scanned", "")
	j.publish(job, "scanned", stats)
	return nil
}

func (j *JobRunner) run(ctx context.Context, job store.ImportJob, cfg JobConfig) error {
	j.setStatus(ctx, job, "running", "")
	body, err := j.Blobs.Get(ctx, snapshotKey(job.ID))
	if err != nil {
		return j.failJob(ctx, job, fmt.Errorf("scan snapshot missing — run a scan first: %w", err))
	}
	var data Data
	err = json.NewDecoder(body).Decode(&data)
	body.Close()
	if err != nil {
		return j.failJob(ctx, job, err)
	}

	var client *Client
	if job.Source == "jira_api" {
		client = NewClient(cfg.Site, cfg.Email, cfg.Token)
	}
	lastSave := time.Now()
	runner := &Runner{
		St:     j.St,
		Blobs:  j.Blobs,
		Client: client,
		Log:    j.Log,
		Progress: func(s Stats) {
			if time.Since(lastSave) > time.Second || s.Phase == "done" {
				lastSave = time.Now()
				_ = j.St.SetImportJobStats(ctx, job.ID, s)
				j.publish(job, "running", s)
			}
		},
	}
	stats, err := runner.Load(ctx, &data, job.OwnerID)
	if saveErr := j.St.SetImportJobStats(ctx, job.ID, stats); saveErr != nil {
		j.Log.Error("save import stats", "error", saveErr)
	}
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	j.setStatus(ctx, job, "done", "")
	j.publish(job, "done", stats)
	return nil
}

func (j *JobRunner) setStatus(ctx context.Context, job store.ImportJob, status, errMsg string) {
	if err := j.St.SetImportJobStatus(ctx, job.ID, status, errMsg); err != nil {
		j.Log.Error("set import status", "job", job.ID, "error", err)
	}
}

func (j *JobRunner) failJob(ctx context.Context, job store.ImportJob, err error) error {
	j.Log.Error("import job failed", "job", job.ID, "error", err)
	j.setStatus(ctx, job, "failed", err.Error())
	j.publish(job, "failed", map[string]string{"error": err.Error()})
	return nil // consumed; don't requeue forever
}

func (j *JobRunner) publish(job store.ImportJob, status string, payload any) {
	if j.Hub == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = j.Hub.Publish(ctx, "user:"+job.OwnerID, "import.progress",
		map[string]any{"jobId": job.ID, "status": status, "stats": payload})
}
