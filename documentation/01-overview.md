# 01 — Overview

## Vision

TaskHat is a self-hosted issue and project tracker that looks and behaves as close to Jira (Jira Software / Jira Cloud) as practical. A team that knows Jira should be able to sit down in front of TaskHat and use it without training — same concepts, same layout, same workflows.

## Goals

1. **UI parity** — navigation, board, backlog, and issue view laid out like Jira. We use Atlassian's own open-source design system (Atlaskit) so components literally look like Jira's.
2. **Functional parity (core)** — projects, issue types, workflows/statuses, boards (Kanban + Scrum), sprints, backlog, comments, attachments, labels, priorities, assignees, watchers, activity history, notifications, search/filters.
3. **Jira migration** — export issues from a real Jira instance and import them into TaskHat with fidelity (keys, types, statuses, comments, attachments, links where possible).
4. **Self-hosted & simple ops** — one `docker compose up` brings up the whole system.

## Non-goals (for now)

- Jira ecosystem: Marketplace apps/plugins, Automation rules engine, Advanced Roadmaps, Confluence/Bitbucket integrations.
- Full JQL — we implement a practical subset ("TQL") that covers common queries.
- Multi-region / enterprise-scale HA. Single-node Compose deployment first.
- Jira Service Management (helpdesk) features.

## Core concepts (mirroring Jira)

| Jira concept | TaskHat | Notes |
|---|---|---|
| Project (key e.g. `TH`) | Project | Company-managed style; key prefixes issue keys |
| Issue (`TH-123`) | Issue | Types: Epic, Story, Task, Bug, Sub-task |
| Workflow / Status | Workflow / Status | Status categories: To Do / In Progress / Done |
| Board (Kanban/Scrum) | Board | Columns map to statuses; swimlanes later |
| Sprint | Sprint | Future / Active / Closed; scrum boards only |
| Backlog | Backlog | Ordered (rank) list of unresolved issues |
| Priority | Priority | Highest…Lowest, same icon language |
| Components / Labels | Components / Labels | |
| Comments, Attachments | Same | |
| Watchers, Activity log | Same | |
| JQL | TQL (subset) | `project = TH AND status = "In Progress" ORDER BY priority` |

## What "parity" means per stage

Each roadmap stage (see [06-roadmap.md](06-roadmap.md)) ends with a **parity review**: we open Jira and TaskHat side by side and walk a scripted scenario in both, noting gaps in layout, interaction (drag & drop, inline edit, keyboard shortcuts), and behavior (workflow rules, ordering, permissions). Gaps become issues for the next stage.
