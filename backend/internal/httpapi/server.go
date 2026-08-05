package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"

	"github.com/ali-automation/taskhat/backend/internal/auth"
	"github.com/ali-automation/taskhat/backend/internal/config"
	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

type Server struct {
	cfg       config.Config
	store     *store.Store
	sessions  *auth.Sessions
	rdb       *redis.Client
	publisher *events.Publisher
	hub       *realtime.Hub
	blobs     storage.Blob
	log       *slog.Logger
}

func NewServer(cfg config.Config, st *store.Store, rdb *redis.Client, publisher *events.Publisher, hub *realtime.Hub, blobs storage.Blob, log *slog.Logger) *Server {
	return &Server{
		cfg:       cfg,
		store:     st,
		sessions:  auth.NewSessions(rdb),
		rdb:       rdb,
		publisher: publisher,
		hub:       hub,
		blobs:     blobs,
		log:       log,
	}
}

// publish emits a domain event to RabbitMQ (async workers) and, for issue
// events, to the project's realtime channel (live boards). Failures are
// logged, never surfaced to the caller.
func (s *Server) publish(r *http.Request, eventType string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		s.log.Error("marshal event", "type", eventType, "error", err)
		return
	}
	if s.publisher != nil {
		e := events.Event{
			Type:       eventType,
			ActorID:    userIDFrom(r.Context()),
			OccurredAt: time.Now().UTC(),
			Payload:    body,
		}
		if err := s.publisher.Publish(r.Context(), e); err != nil {
			s.log.Error("publish event", "type", eventType, "error", err)
		}
	}
	if s.hub != nil {
		channel := ""
		switch p := payload.(type) {
		case store.Issue:
			channel = "project:" + p.ProjectKey
		case CommentEvent:
			channel = "project:" + p.Issue.ProjectKey
		}
		if channel != "" {
			if err := s.hub.Publish(r.Context(), channel, eventType, payload); err != nil {
				s.log.Error("publish realtime", "type", eventType, "error", err)
			}
		}
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(requestLogger(s.log))

	if s.hub != nil {
		r.Get("/ws", s.hub.HandleWS(s.cfg.JWTSecret))
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", s.handleHealth)
		r.Get("/avatars/{key}", s.handleServeUserImage)
		r.Get("/wiki-images/{key}", s.handleServeWikiImage)
		r.Get("/site", s.handleSiteInfo)
		r.Post("/automation/incoming/{token}", s.handleIncomingAutomation)
		r.Post("/mail/incoming/{token}", s.handleIncomingMail)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", s.handleRegister)
			r.Post("/login", s.handleLogin)
			r.Post("/login/2fa", s.handleLogin2FA)
			r.Post("/demo", s.handleDemoLogin)
			r.Get("/oidc/start", s.handleOIDCStart)
			r.Get("/oidc/callback", s.handleOIDCCallback)
			r.Post("/refresh", s.handleRefresh)
			r.Post("/logout", s.handleLogout)
			r.Get("/invite/{token}", s.handleGetInvite)
			r.Post("/accept-invite", s.handleAcceptInvite)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)
			r.Get("/me", s.handleMe)
			r.Get("/users", s.handleSearchUsers)
			r.Get("/users/{id}/profile", s.handleUserProfile)
			r.Get("/work-types", s.handleListWorkTypes)

			r.Route("/admin", func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/users", s.handleAdminListUsers)
				r.Post("/users/{id}/activate", s.handleAdminSetActive(true))
				r.Post("/users/{id}/deactivate", s.handleAdminSetActive(false))
				r.Post("/users/{id}/admin", s.handleAdminSetAdmin)
				r.Get("/invites", s.handleAdminListInvites)
				r.Route("/workflows", func(r chi.Router) {
					r.Get("/", s.handleAdminListWorkflows)
					r.Post("/", s.handleAdminCreateWorkflow)
					r.Get("/{id}", s.handleAdminGetWorkflow)
					r.Put("/{id}", s.handleAdminUpdateWorkflow)
					r.Delete("/{id}", s.handleAdminDeleteWorkflow)
					r.Post("/{id}/copy", s.handleAdminCopyWorkflow)
					r.Post("/{id}/assign", s.handleAdminAssignWorkflow)
				})
				r.Post("/invites", s.handleAdminCreateInvite)
				r.Delete("/invites/{id}", s.handleAdminDeleteInvite)
				r.Get("/projects", s.handleAdminListProjects)
				r.Put("/projects/{key}/lead", s.handleAdminSetLead)
				r.Delete("/projects/{key}", s.handleAdminDeleteProject)
				r.Get("/demo-data", s.handleDemoDataStatus)
				r.Post("/demo-data", s.handleDemoDataCreate)
				r.Delete("/demo-data", s.handleDemoDataDelete)
				r.Get("/settings", s.handleAdminGetSettings)
				r.Put("/settings", s.handleAdminUpdateSettings)
				r.Post("/settings/test-email", s.handleAdminTestEmail)
				r.Get("/system", s.handleAdminSystem)
				r.Get("/audit", s.handleAdminAudit)
				r.Get("/categories", s.handleAdminListCategories)
				r.Post("/categories", s.handleAdminCreateCategory)
				r.Delete("/categories/{id}", s.handleAdminDeleteCategory)
				r.Put("/projects/{key}/category", s.handleAdminSetProjectCategory)
				r.Post("/projects/{key}/unarchive", s.handleAdminUnarchive)
				r.Get("/work-types", s.handleAdminListWorkTypes)
				r.Post("/work-types", s.handleAdminCreateWorkType)
				r.Put("/work-types/{id}", s.handleAdminUpdateWorkType)
				r.Delete("/work-types/{id}", s.handleAdminDeleteWorkType)
				r.Get("/automation", s.handleAdminListAutomation)
				r.Post("/automation", s.handleAdminCreateAutomation)
				r.Get("/automation/{id}", s.handleAdminGetAutomation)
				r.Put("/automation/{id}", s.handleAdminUpdateAutomation)
				r.Delete("/automation/{id}", s.handleAdminDeleteAutomation)
				r.Get("/automation/{id}/runs", s.handleAdminAutomationRuns)
				r.Get("/webhooks", s.handleAdminListWebhooks)
				r.Post("/webhooks", s.handleAdminCreateWebhook)
				r.Put("/webhooks/{id}", s.handleAdminUpdateWebhook)
				r.Delete("/webhooks/{id}", s.handleAdminDeleteWebhook)
				r.Get("/webhooks/{id}/deliveries", s.handleAdminWebhookDeliveries)
				r.Get("/fields", s.handleAdminListFields)
				r.Post("/fields", s.handleAdminCreateField)
				r.Put("/fields/{id}", s.handleAdminUpdateField)
				r.Delete("/fields/{id}", s.handleAdminDeleteField)
				r.Get("/schemes", s.handleAdminListSchemes)
				r.Post("/schemes", s.handleAdminCreateScheme)
				r.Get("/schemes/{id}", s.handleAdminGetScheme)
				r.Put("/schemes/{id}", s.handleAdminUpdateScheme)
				r.Delete("/schemes/{id}", s.handleAdminDeleteScheme)
				r.Post("/schemes/{id}/grants", s.handleAdminAddGrant)
				r.Delete("/schemes/{id}/grants/{grantId}", s.handleAdminRemoveGrant)
				r.Put("/projects/{key}/scheme", s.handleAdminSetProjectScheme)
				r.Get("/mail-handlers", s.handleAdminListMailHandlers)
				r.Post("/mail-handlers", s.handleAdminCreateMailHandler)
				r.Put("/mail-handlers/{id}", s.handleAdminUpdateMailHandler)
				r.Delete("/mail-handlers/{id}", s.handleAdminDeleteMailHandler)
			})

			r.Route("/account", func(r chi.Router) {
				r.Get("/2fa", s.handleTwoFAStatus)
				r.Post("/2fa/setup", s.handleTwoFASetup)
				r.Get("/2fa/qr", s.handleTwoFAQR)
				r.Post("/2fa/enable", s.handleTwoFAEnable)
				r.Post("/2fa/disable", s.handleTwoFADisable)
				r.Get("/", s.handleGetAccount)
				r.Put("/profile", s.handleUpdateProfile)
				r.Put("/email", s.handleUpdateEmail)
				r.Put("/password", s.handleUpdatePassword)
				r.Put("/preferences", s.handleUpdatePreferences)
				r.Get("/notifications", s.handleGetUserNotifyPrefs)
				r.Put("/notifications", s.handleUpdateUserNotifyPrefs)
				r.Post("/avatar", s.handleUploadUserImage("avatar"))
				r.Delete("/avatar", s.handleDeleteUserImage("avatar"))
				r.Post("/header", s.handleUploadUserImage("header"))
				r.Delete("/header", s.handleDeleteUserImage("header"))
				r.Get("/api-tokens", s.handleListAPITokens)
				r.Post("/api-tokens", s.handleCreateAPIToken)
				r.Delete("/api-tokens/{id}", s.handleRevokeAPIToken)
				r.Get("/sessions", s.handleListSessions)
				r.Delete("/sessions", s.handleRevokeOtherSessions)
				r.Delete("/sessions/{id}", s.handleRevokeSession)
			})

			r.Route("/projects", func(r chi.Router) {
				r.Get("/", s.handleListProjects)
				r.Post("/", s.handleCreateProject)
				r.Route("/{key}", func(r chi.Router) {
					r.Get("/", s.handleGetProject)
					r.Get("/mypermissions", s.handleMyPermissions)
					r.Put("/", s.handleUpdateProject)
					r.Delete("/", s.handleDeleteProject)
					r.Put("/details", s.handleUpdateProjectDetails)
					r.Post("/avatar", s.handleUploadProjectAvatar)
					r.Delete("/avatar", s.handleDeleteProjectAvatar)
					r.Get("/members", s.handleListMembers)
					r.Post("/members", s.handleAddMember)
					r.Put("/members/{userId}", s.handleUpdateMemberRole)
					r.Delete("/members/{userId}", s.handleRemoveMember)
					r.Get("/statuses", s.handleListStatuses)
					r.Post("/statuses", s.handleCreateStatus)
					r.Put("/statuses/{id}", s.handleRenameStatus)
					r.Delete("/statuses/{id}", s.handleDeleteStatus)
					r.Get("/labels", s.handleListLabels)
					r.Get("/labelinfo", s.handleLabelInfo)
					r.Put("/labels/{name}", s.handleRenameLabel)
					r.Delete("/labels/{name}", s.handleDeleteLabel)
					r.Post("/archive", s.handleSetArchived(true))
					r.Post("/unarchive", s.handleSetArchived(false))
					r.Put("/notifications", s.handleUpdateNotifyPrefs)
					r.Get("/fields", s.handleListProjectFields)
					r.Get("/automation", s.handleSpaceListAutomation)
					r.Post("/automation", s.handleSpaceCreateAutomation)
					r.Get("/automation/{id}", s.handleSpaceGetAutomation)
					r.Put("/automation/{id}", s.handleSpaceUpdateAutomation)
					r.Delete("/automation/{id}", s.handleSpaceDeleteAutomation)
					r.Get("/automation/{id}/runs", s.handleSpaceAutomationRuns)
					r.Get("/transitions", s.handleListProjectTransitions)
					r.Post("/transitions", s.handleCreateProjectTransition)
					r.Delete("/transitions/{id}", s.handleDeleteProjectTransition)
					r.Get("/workflow", s.handleGetWorkflow)
					r.Put("/workflow", s.handleUpdateWorkflow)
					r.Get("/issues", s.handleProjectIssues)
					r.Get("/timeline", s.handleTimeline)
					r.Get("/versions", s.handleListVersions)
					r.Post("/versions", s.handleCreateVersion)
					r.Get("/versions/{versionId}", s.handleGetVersion)
					r.Put("/versions/{versionId}", s.handleUpdateVersion)
					r.Post("/versions/{versionId}/status", s.handleVersionStatus)
					r.Delete("/versions/{versionId}", s.handleDeleteVersion)
					r.Get("/boards", s.handleListBoards)
					r.Post("/boards", s.handleCreateBoard)
					r.Get("/epics", s.handleListEpics)
					r.Get("/summary", s.handleProjectSummary)
					r.Put("/features", s.handleSetProjectFeatures)
					r.Get("/components", s.handleListComponents)
					r.Post("/components", s.handleCreateComponent)
					r.Put("/components/{componentId}", s.handleUpdateComponent)
					r.Delete("/components/{componentId}", s.handleDeleteComponent)
					r.Get("/permissionscheme", s.handleProjectPermissionScheme)
					r.Get("/fields", s.handleSpaceListFields)
					r.Post("/fields", s.handleSpaceCreateField)
					r.Delete("/fields/{fieldId}", s.handleSpaceDeleteField)
					r.Get("/email-audit", s.handleSpaceEmailAudit)
					r.Route("/reports", func(r chi.Router) {
						r.Get("/overview", s.handleReportOverview)
						r.Get("/cfd", s.handleReportCFD)
						r.Get("/cycle-time", s.handleReportCycleTime)
						r.Get("/pie", s.handleReportPie)
						r.Get("/groupby", s.handleReportGroupBy)
						r.Get("/workload", s.handleReportWorkload)
						r.Get("/trend/{trend}", s.handleReportTrend)
					})
					r.Get("/export.csv", s.handleExportCSV)
				})
			})

			r.Route("/boards/{id}", func(r chi.Router) {
				r.Get("/", s.handleGetBoard)
				r.Put("/", s.handleRenameBoard)
				r.Delete("/", s.handleDeleteBoard)
				r.Get("/issues", s.handleBoardIssues)
				r.Put("/columns", s.handleUpdateColumns)
				r.Put("/columns/order", s.handleReorderColumns)
				r.Get("/backlog", s.handleBoardBacklog)
				r.Get("/sprints", s.handleListSprints)
				r.Post("/sprints", s.handleCreateSprint)
			})

			r.Route("/attachments/{id}", func(r chi.Router) {
				r.Get("/", s.handleDownloadAttachment)
				r.Delete("/", s.handleDeleteAttachment)
			})

			r.Get("/categories", s.handleListCategoriesPublic)
			r.Get("/stars", s.handleListStars)
			r.Post("/stars", s.handleSetStar)
			r.Get("/notifications", s.handleListNotifications)
			r.Post("/notifications/read", s.handleMarkNotificationsRead)

			r.Route("/import/jira", func(r chi.Router) {
				r.Get("/", s.handleListImportJobs)
				r.Post("/", s.handleStartImport)
				r.Get("/{id}", s.handleGetImportJob)
				r.Post("/{id}/run", s.handleRunImport)
				r.Delete("/{id}", s.handleDeleteImportJob)
			})

			r.Get("/search", s.handleSearch)
			r.Get("/quicksearch", s.handleQuickSearch)
			r.Get("/foryou", s.handleForYou)
			r.Route("/filters", func(r chi.Router) {
				r.Get("/", s.handleListFilters)
				r.Post("/", s.handleCreateFilter)
				r.Put("/{id}", s.handleUpdateFilter)
				r.Delete("/{id}", s.handleDeleteFilter)
			})

			r.Route("/dashboards", func(r chi.Router) {
				r.Get("/", s.handleListDashboards)
				r.Post("/", s.handleCreateDashboard)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", s.handleGetDashboard)
					r.Put("/", s.handleUpdateDashboard)
					r.Delete("/", s.handleDeleteDashboard)
					r.Put("/layout", s.handleSaveLayout)
					r.Post("/gadgets", s.handleAddGadget)
					r.Put("/gadgets/{gadgetId}", s.handleUpdateGadget)
					r.Delete("/gadgets/{gadgetId}", s.handleDeleteGadget)
				})
			})
			r.Route("/wiki", func(r chi.Router) {
				r.Post("/images", s.handleUploadWikiImage)
				r.Put("/drafts", s.handleSaveWikiDraft)
				r.Delete("/drafts/{id}", s.handleDeleteWikiDraft)
				r.Get("/pages/{id}/draft", s.handleGetWikiPageDraft)
				r.Get("/recent", s.handleRecentWikiPages)
				r.Get("/spaces", s.handleListWikiSpaces)
				r.Post("/spaces", s.handleCreateWikiSpace)
				r.Get("/spaces/{key}", s.handleGetWikiSpace)
				r.Post("/spaces/{key}/pages", s.handleCreateWikiPage)
				r.Get("/pages/{id}", s.handleGetWikiPage)
				r.Get("/pages/{id}/restrictions", s.handleWikiListRestrictions)
				r.Put("/pages/{id}/restrictions", s.handleWikiSetRestrictions)
				r.Put("/pages/{id}/canvas", s.handleSaveWikiCanvas)
				r.Get("/pages/{id}/reactions", s.handleWikiPageReactions)
				r.Post("/pages/{id}/reactions", s.handleToggleWikiPageReaction)
				r.Post("/comments/{commentId}/reactions", s.handleToggleWikiCommentReaction)
				r.Post("/pages/{id}/viewed", s.handleWikiPageViewed)
				r.Get("/pages/{id}/viewers", s.handleWikiPageViewers)
				r.Post("/pages/{id}/share", s.handleWikiShare)
				r.Get("/pages/{id}/labels", s.handleWikiPageLabels)
				r.Put("/pages/{id}/labels", s.handleWikiSetLabels)
				r.Get("/spaces/{key}/labels/{label}", s.handleWikiPagesByLabel)
				r.Get("/pages/{id}/versions", s.handleWikiVersions)
				r.Get("/pages/{id}/versions/{n}", s.handleWikiVersion)
				r.Post("/pages/{id}/versions/{n}/restore", s.handleWikiRestore)
				r.Get("/pages/{id}/comments", s.handleWikiListComments)
				r.Post("/pages/{id}/comments", s.handleWikiAddComment)
				r.Put("/comments/{commentId}", s.handleWikiUpdateComment)
				r.Post("/comments/{commentId}/resolve", s.handleWikiResolveComment)
				r.Delete("/comments/{commentId}", s.handleWikiDeleteComment)
				r.Get("/pages/{id}/watch", s.handleWikiWatchState)
				r.Post("/pages/{id}/watch", s.handleWikiWatch(true))
				r.Delete("/pages/{id}/watch", s.handleWikiWatch(false))
				r.Get("/pages/{id}/attachments", s.handleWikiListAttachments)
				r.Post("/pages/{id}/attachments", s.handleWikiUploadAttachment)
				r.Get("/attachments/{attId}", s.handleWikiDownloadAttachment)
				r.Delete("/attachments/{attId}", s.handleWikiDeleteAttachment)
				r.Get("/spaces/{key}/members", s.handleListWikiSpaceMembers)
				r.Put("/spaces/{key}/members", s.handleSetWikiSpaceMember)
				r.Delete("/spaces/{key}/members/{userId}", s.handleRemoveWikiSpaceMember)
				r.Put("/spaces/{key}/access", s.handleSetWikiSpaceAccess)
				r.Put("/spaces/{key}", s.handleUpdateWikiSpace)
				r.Get("/spaces/{key}/templates", s.handleListWikiTemplates)
				r.Get("/spaces/{key}/blog", s.handleWikiBlogFeed)
				r.Get("/starred", s.handleWikiStarred)
				r.Get("/spaces/{key}/flags", s.handleWikiSpaceFlags)
				r.Get("/spaces/{key}/shortcuts", s.handleWikiListShortcuts)
				r.Post("/spaces/{key}/shortcuts", s.handleWikiCreateShortcut)
				r.Delete("/shortcuts/{id}", s.handleWikiDeleteShortcut)
				r.Post("/personal-space", s.handleWikiPersonalSpace)
				r.Get("/contributors", s.handleWikiContributors)
				r.Get("/foryou", s.handleWikiForYou)
				r.Post("/spaces/{key}/star", s.handleWikiSpaceStar)
				r.Post("/spaces/{key}/watch", s.handleWikiSpaceWatch)
				r.Put("/spaces/{key}/icon", s.handleWikiSpaceIcon)
				r.Put("/spaces/{key}/owner", s.handleWikiSpaceOwner)
				r.Put("/spaces/{key}/home", s.handleWikiSpaceHome)
				r.Put("/spaces/{key}/categories", s.handleWikiSpaceCategories)
				r.Post("/spaces/{key}/archive", s.handleWikiSpaceArchive)
				r.Delete("/spaces/{key}", s.handleWikiSpaceDelete)
				r.Get("/spaces/{key}/trash", s.handleWikiTrash)
				r.Post("/pages/{id}/restore", s.handleWikiRestoreTrashed)
				r.Delete("/pages/{id}/purge", s.handleWikiPurgeTrashed)
				r.Get("/pages/{id}/star", s.handleWikiStarState)
				r.Post("/pages/{id}/star", s.handleWikiToggleStar)
				r.Put("/pages/{id}/rename", s.handleWikiRenamePage)
				r.Post("/pages/{id}/copy", s.handleWikiCopyPage)
				r.Post("/pages/{id}/moveto", s.handleWikiMovePage)
				r.Post("/pages/{id}/archive", s.handleWikiArchivePage)
				r.Post("/pages/{id}/convert", s.handleWikiConvertPage)
				r.Get("/spaces/{key}/archived", s.handleWikiArchivedPages)
				r.Get("/spaces/{key}/calendar", s.handleWikiCalendar)
				r.Post("/spaces/{key}/calendar", s.handleCreateWikiCalendarEvent)
				r.Put("/calendar/events/{id}", s.handleUpdateWikiCalendarEvent)
				r.Delete("/calendar/events/{id}", s.handleDeleteWikiCalendarEvent)
				r.Post("/spaces/{key}/templates", s.handleCreateWikiTemplate)
				r.Delete("/templates/{id}", s.handleDeleteWikiTemplate)
				r.Put("/pages/{id}", s.handleUpdateWikiPage)
				r.Put("/pages/{id}/move", s.handleMoveWikiPage)
				r.Delete("/pages/{id}", s.handleDeleteWikiPage)
			})

			r.Get("/gadgets/pie", s.handleGadgetPie)
			r.Get("/gadgets/activity", s.handleGadgetActivity)
			r.Get("/gadgets/burndown", s.handleGadgetBurndown)

			r.Route("/sprints/{id}", func(r chi.Router) {
				r.Get("/issues", s.handleSprintIssues)
				r.Put("/", s.handleUpdateSprint)
				r.Delete("/", s.handleDeleteSprint)
				r.Post("/start", s.handleStartSprint)
				r.Post("/complete", s.handleCompleteSprint)
				r.Get("/burndown", s.handleBurndown)
			})

			r.Route("/issues", func(r chi.Router) {
				r.Post("/", s.handleCreateIssue)
				r.Route("/{key}", func(r chi.Router) {
					r.Get("/", s.handleGetIssue)
					r.Put("/", s.handleUpdateIssue)
					r.Delete("/", s.handleDeleteIssue)
					r.Get("/transitions", s.handleListTransitions)
					r.Post("/transitions", s.handleDoTransition)
					r.Get("/changelog", s.handleIssueChangelog)
					r.Get("/children", s.handleIssueChildren)
					r.Put("/rank", s.handleRankIssue)
					r.Get("/comments", s.handleListComments)
					r.Post("/comments", s.handleAddComment)
					r.Put("/comments/{commentId}", s.handleUpdateComment)
					r.Delete("/comments/{commentId}", s.handleDeleteComment)
					r.Get("/attachments", s.handleListAttachments)
					r.Post("/attachments", s.handleUploadAttachment)
					r.Get("/mentioned-on", s.handleMentionedOn)
					r.Get("/worklogs", s.handleListWorklogs)
					r.Post("/worklogs", s.handleAddWorklog)
					r.Post("/viewed", s.handleIssueViewed)
					r.Put("/worklogs/{worklogId}", s.handleUpdateWorklog)
					r.Delete("/worklogs/{worklogId}", s.handleDeleteWorklog)
					r.Get("/links", s.handleListLinks)
					r.Post("/links", s.handleCreateLink)
					r.Delete("/links/{linkId}", s.handleDeleteLink)
					r.Get("/manual-flows", s.handleListManualFlows)
					r.Post("/manual-flows/{ruleId}", s.handleRunManualFlow)
					r.Get("/watchers", s.handleListWatchers)
					r.Post("/watchers", s.handleWatch)
					r.Delete("/watchers", s.handleUnwatch)
				})
			})
		})
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	checks := map[string]string{"postgres": "ok", "redis": "ok"}
	status := http.StatusOK
	if err := s.store.Ping(ctx); err != nil {
		checks["postgres"] = err.Error()
		status = http.StatusServiceUnavailable
	}
	if err := s.rdb.Ping(ctx).Err(); err != nil {
		checks["redis"] = err.Error()
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"status": http.StatusText(status), "checks": checks})
}

func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			log.Info("http",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}
