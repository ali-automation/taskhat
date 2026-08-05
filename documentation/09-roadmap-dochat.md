# 09 — DocHat Roadmap (the wiki half)

> **This file covers DocHat only.** TaskHat's staged roadmap lives in
> [06-roadmap.md](06-roadmap.md).
>
> **Status (2026-07-16): stages W1–W7 — the full Confluence-style wiki including
> the design-quality pass, the Cloud importer (pages, folders, whiteboards,
> emojis), and Excalidraw whiteboards with document embeds — are complete
> and smoke-tested.** The next feature stages below are specced and waiting
> to be scheduled.

TaskHat's companion wiki, served from the same platform at `/wiki` (the way
Atlassian pairs Jira and Confluence on one site). Same repo, same backend binary
(isolated `internal/wiki` packages, own tables), same React shell — single
sign-on and cross-product links for free. Parity target: the user's real
Confluence (2025 design), matched from screenshots like TaskHat was.

## Stage W1 — Wiki skeleton ✅ (shipped 2026-07-14)
`wiki_spaces` + hierarchical `wiki_pages` (each space auto-creates its Overview
home page), the `/wiki` area with Confluence's chrome: page-tree sidebar with
expand/collapse and hover-create, breadcrumbs, page view (byline + rich text),
full-page TipTap editor with Publish/Close, and the **app switcher** in the top
bar hopping between TaskHat ⇄ DocHat in both apps.

## Stage W2 — Editor parity ✅ (shipped 2026-07-14)
Full-width editor: tables, inline images (the Stage 16 deferral), slash-command
`/` insert menu, autosave drafts, publish vs draft, drag-reorder in the page tree.

**Shipped:** the shared TipTap editor (wiki *and* work items/comments — Jira has
these too) gained **tables** (Confluence styling, header rows, add/remove
row/column controls when the caret is in a table), **inline images** (toolbar
button, paste, or drag-drop → blob storage, served like avatars via unguessable
public keys at `/api/v1/wiki-images/{key}`), and a **slash `/` insert menu**
(headings, lists, table, image, quote, code block, divider). **Confluence's
draft model** (migration 0020 `wiki_drafts`, per-user): autosave after 1.5s idle
("Draft saved …"), Close keeps the draft, reopening restores it, the page view
shows an **Unpublished changes** lozenge, Publish applies + clears. The page
tree supports **drag-reorder** (drop above/below as sibling, onto a page as
child; cycle-safe move API with sibling shifting).

## Stage W2.5 — Confluence-2025 UI parity pass ✅ (shipped 2026-07-14, from the user's live screenshot)
Matched against a screenshot of real Confluence (dark mode, unified nav):
**unified sidebar** (For you / Recent — live recently-updated pages via
`/wiki/recent` / Starred / Spaces expanders, then the current space rail:
avatar header, Shortcuts, **Content** section with hover-create and a
**Search by title** tree filter, Blogs/Calendars backlog entries, TaskHat
cross-link, **Invite people** footer button for admins), **editor chrome**
(page icon + title at left; "Draft saved …" · **Update** · Close · copy-link
· ⋯ with Discard draft at right), and a **Confluence-style toolbar**: Normal
text ▾ style dropdown, B/U/I with a more-formats menu (**Underline** added),
lists, **action items** (checkbox task lists — new node type, searchable),
image, @, table, a **+ insert menu**, and undo/redo. Toolbar menus close on
Escape. Deferred to later stages: column layouts, emoji page icons, text
color/alignment, Share dialog (arrives with W4 permissions).

## Stage W2.6 — Editor completion pass ✅ (shipped 2026-07-14)
Closed the gaps the user's Confluence screenshots exposed, grounded against
Atlassian's own docs (panel presets, ":" emoji browser, /panel): **resizable
images** (custom node view — select an image, drag the side handles; width
persists into the published page), **panels** (info/note/success/warning/error
with preset emoji + tinted backgrounds, via /slash and the insert menu, nesting
supported), a full **emoji picker** (category groups + search, in the toolbar
and as the **`:shortcut:`** inline suggestion), **text color** (Confluence's
palette) and **alignment**, and **page emoji icons** (migration 0021): pick an
icon above the title in the editor — it shows large above the **centered
title**, in the page tree, breadcrumb children, and the "Owned by · read-time"
byline matches Confluence's. Deferred: reactions, block drag handles ⠿,
column layouts, expand element, Share dialog, views counter.

## Stage W3 — Versions & collaboration ✅ (shipped 2026-07-14)
Page version history with diff + restore, footer comments then inline comments,
attachments, watchers + notifications through the existing pipeline.

**Shipped (migration 0022):** every publish appends a `wiki_page_versions`
snapshot (existing pages seeded as v1). **Version history** (page ⋯ menu) lists
revisions with editor + timestamp; open one to view it as it was, toggle
**Show changes** for a word-level green/red diff against the previous version,
or **Restore this version** — which republishes it as a new version, Confluence
style. **Footer comments** with the full rich-text editor (mentions included),
edit/delete own (admins may delete any). **Attachments** (20 MiB, auth-checked
download) with an Attach file menu item and a strip above comments.
**Watchers**: authors and editors auto-watch, Watch/Stop watching in the ⋯
menu; page edits and comments flow through the worker to watchers as in-app
notifications (the bell now links to wiki pages) and email — honoring each
user's notification matrix, with mentions taking priority. Deferred: inline
comments on text selections, reactions.

## Stage W4 — Organization & search ✅ (shipped 2026-07-14)
Labels, space home customization, templates, wiki results in quick search and
⌘K, TQL-style page search, permissions (space view/edit + page restrictions).

**Shipped (migration 0023):** DocHat pages appear in the top-bar **quick
search** ("Pages" section, restriction-aware). **Labels** — chips at the bottom
of every page (normalized kebab-case, click → pages-by-label listing).
**Templates** — a gallery on every new page (Meeting notes, How-to guide,
Project plan, Retrospective, Decision) that pre-fills structure incl. panels,
tables, and action items. **Page restrictions** — the ⋯ → Restrictions dialog
limits viewing to listed people (+ site admins); restrictions **inherit down
the page tree** and are enforced across page/comments/attachments/versions,
the sidebar tree, search, and the Recent list; the caller is auto-kept on the
list. **Share** — Confluence's dialog: pick people + a note → in-app
notification (bell links to the page) + email, and on restricted pages sharing
also grants access; the Share button wears a 🔒 when the page is restricted.
Deferred: space-wide view/edit roles (needs member management UI), custom
user templates, TQL-style page search.

## Stage W5 — TaskHat ⇄ DocHat integration ✅ (shipped 2026-07-15)
Smart links (work-item chips on pages, page chips on work items), TQL-embed
macro, "mentioned on" section on the work item view, automation "create page".

**Shipped (migration 0024):** **Work-item chips** — inline smart links that
render the issue key + summary + live status lozenge; inserted by typing
`#` (quick-search popup), via the slash menu ("Work item"), or by pasting a
`/browse/KEY` URL (Confluence's paste-a-Jira-link behavior). **Page chips** —
pasting a DocHat page URL into any editor (wiki, issue description, comments)
becomes an icon + title chip. **TQL embed** — a "Work items from TQL" block
(slash menu) that stores the query and renders a live result list (key,
summary, status) on every view, like Confluence's Jira-issues macro. Static
page views hydrate chips/embeds client-side after render. **Mentioned on** —
saving a page extracts its chip keys into `wiki_issue_mentions`; the work-item
view grows a "Mentioned on" section listing referencing pages, filtered by
page restrictions per viewer. **Automation** — new "Create page" action
(space key + title + body, smart values like `{{issue.key}}` supported), so
rules can e.g. scaffold release notes when an issue is created. The slash
menu now keeps matching through spaces ("/work items…"), as in Confluence.
Deferred: page chips surfacing as a section on the wiki side, TQL page search.

## Stage W6 — Parity polish + Arabic ✅ (shipped 2026-07-15)
i18n sweep (mechanism exists), RTL check, Confluence importer (Cloud API/export).

**Shipped (migration 0025):** **Confluence importer** — "Import from
Confluence" on the DocHat spaces directory connects to a Confluence Cloud
site (email + API token), scans a space over the v2 REST API, shows a
dry-run report (page count, images/macros that will be skipped), then
imports: the page tree is recreated (space homepage becomes the Overview),
and storage-format bodies are converted to the editor's document model —
headings, marks (bold/italic/underline/strike/code/links), lists, tables,
info/note/tip/warning/error panels, code blocks with language, action
items (with checked state), emoticons, page links (as text), status
lozenges. Re-running the same import **updates** pages (new versions) via
`wiki_pages.confluence_id` provenance instead of duplicating. Rides the
Stage-6 import-job pipeline (scan snapshot in blob storage, worker queue,
live progress). **Arabic sweep** — importer strings translated (catalog
~1030 keys); RTL verified across the wiki page view, sidebar, and editor.
Deferred: image/attachment import, Confluence space exports (XML zip),
user mapping for page authorship (pages land owned by the importer).

## Design-quality pass ✅ (shipped 2026-07-15)
Matched Confluence's 2025 visuals from the user's reference screenshots:
full-bleed chromeless editor (sticky full-width toolbar, centered 760px
writing column), real Atlaskit SVG toolbar icons, unified sidebar/canvas
surfaces, Confluence-style "Content" nav row with always-visible chevrons,
760px reading column with 16px/1.7 body text, icon swaps (book/tag/lock),
avatar on the comment composer.

## Stage W7 — Whiteboards ✅ (shipped 2026-07-16)
**Shipped (migration 0026, `wiki_pages.kind` page|whiteboard|folder):**
Confluence-style whiteboards as first-class wiki content. The sidebar's
Create menu offers **Page / Whiteboard**; a whiteboard is an always-editable
infinite canvas (Excalidraw engine: shapes, arrows, freehand, text, sticky
colors, images, laser pointer) that **autosaves** ~2s after each change —
no versions spam, title renames inline in the header, Share/Restrictions
work as on pages. Canvas text is mirrored into `body_text`, so whiteboard
content is searchable. Dark mode and Arabic canvas UI supported; the
canvas bundle is lazy-loaded. The tree shows kind icons (whiteboard /
folder / page). **Importer:** unknown parents now also resolve as
Confluence whiteboards — they import as empty whiteboards (the API doesn't
expose whiteboard contents) so the tree keeps its shape, and imported
folders/whiteboards get their proper kind on re-runs. **Embeds:** pasting a whiteboard's
URL into any editor (pages, work items, comments) becomes a board preview
card — a rendered snapshot with an Open link, hydrated on published pages
too. Deferred: real-time multi-user canvas editing, whiteboard version
history, importing whiteboard contents (no API).


# Planned feature stages (specced, apply on request)

## Stage W8 — Images & attachments in the importer ✅ (shipped 2026-07-17)
**Shipped (migration 0028, `wiki_attachments.confluence_id` + `image_key`):**
the scan lists every page's attachments (v2 API, cursor-paged) and the run
downloads them (20 MiB cap, signed-CDN redirects handled): every file
becomes a **page attachment** in DocHat, and image attachments referenced
by `ac:image` are additionally stored as served wiki images so they render
**inline in the page body** (width preserved from `ac:width`; external
`ri:url` images keep their URL; images buried inside text marks can't be
hoisted and are reported). Attachment links (`ac:link` → `ri:attachment`)
degrade to the filename. Idempotent: re-runs skip already-imported
attachments by Confluence id. The scan report now shows attachment and
inline-image counts; oversize files are called out by name. Converter
change along the way: paragraphs now route through the block builder so
images inside `<p>` hoist to proper block images (pinned by unit tests).
Deferred: attachment version updates (a changed file in Confluence keeps
the originally imported binary), video/media players.

## Stage W9 — Inline comments ✅ (shipped 2026-07-17)
**Shipped (migration 0030: `wiki_comments` + parent_id / inline_text /
inline_occurrence / resolved_at,by):** Confluence's highlight-to-comment on
the published page view — select text → a floating **Comment** bubble →
popup composer; the quoted text becomes a **yellow highlight** (anchored by
exact text + occurrence index, no document mutation). Clicking a highlight
opens the **thread popover**: quoted context, root + replies, a reply box,
and **Resolve** (root-only; resolving removes the highlight). The footer
comments section now shows page comments only, plus an **Inline comments**
summary listing every thread — resolved ones carry a Resolved lozenge with
**Reopen**, and anchors whose text was edited away degrade gracefully there
with a "Text changed" lozenge instead of breaking. Replies cascade-delete
with their root; restricted pages block commenting as everywhere else;
notifications ride the existing comment pipeline. Deferred: rich-text and
@mentions in the inline composer (footer composer has them), comment counts
in the byline, per-highlight deep links.

## Stage W10 — Editor layout blocks ✅ (shipped 2026-07-17)
**Shipped:** **column layouts** — `/2 columns` / `/3 columns` insert a
layout section; while the cursor is inside, a controls row (like the table
controls) offers width presets (equal, ⅔ ⅓, ⅓ ⅔), add/remove column
(content merges back), and remove-layout (unwraps content); columns render
as flex with per-column widths and dashed guides in the editor only.
**Expand** — `/expand` inserts a collapsible section with an editable
title; published pages render a native `<details>/<summary>` so collapsing
works with zero JS. **Block drag handles** — hovering a top-level block
shows the ⠿ handle beside it; dragging moves the whole block (ProseMirror
node-selection drag, drop-cursor included). Cursor lands in the first
column / the expand body on insert, like Confluence. **Importer:**
`ac:layout` sections map to real column layouts (1 or >3 cells flatten)
and the `expand` macro becomes an expand element with its title
(unit-tested). Deferred: drag-resize column dividers (presets instead),
per-column background colors.

## Stage W11 — Reactions & views ✅ (shipped 2026-07-18)
**Shipped (migration 0033: `wiki_reactions` + `wiki_page_views`):**
**Reactions** — a Confluence-style row under every page (and a compact one
under each footer comment): quick emoji (👍 ❤️ 🎉 😄 😮), the full emoji
picker behind a + button, chips showing per-emoji counts with your own
reactions highlighted and reactor names on hover; clicking toggles.
**Views** — opening a page records the viewer (idempotent per person);
the byline shows "👁 N" and clicking it lists who viewed and when.
Restricted pages enforce access on all of it. Deferred: reaction
notifications, reactions on inline-comment threads, anonymous view counts.

## Stage W12 — Space roles & custom templates ✅ (shipped 2026-07-18)
**Shipped (migration 0035: `wiki_space_members` + `wiki_spaces.default_role`
+ `wiki_templates`):**
**Space roles** — Confluence's role model: each space has members with a
role (Admin / Collaborator / Viewer) plus a default access level for
everyone else (anyone can view and edit — the pre-W12 behavior every
existing space keeps; anyone can view; or members only, which hides the
space from lists, search, recents and mentions entirely). Space creators
are seeded as admins; site admins are always space admins. Every wiki
mutation (create/edit/move/delete pages, canvas saves, comments, inline
threads, attachments, labels, restrictions, drafts, version restores) is
gated at collaborator level; member management, space details and access
level need admin. The space payload carries `myRole`, and the UI follows:
viewers see no Create/Edit buttons, no comment composers, and whiteboards
open in Excalidraw view-mode. Space settings (sidebar gear for admins):
Details, Access (default level + member list with add/change/remove), and
Templates.
**Custom templates** — "Save as template" in the page ••• menu snapshots
the page body into the space's template gallery; the editor's new-page
gallery shows space templates ahead of the built-ins; authors or space
admins delete them from Space settings. Deferred: custom roles, groups,
per-role granular permissions, template editing in place.

## Stage W13 — Blogs ✅ (shipped 2026-07-18)
**Shipped (migration 0036: `kind` check gains `'blog'`):** blog posts are
wiki pages with `kind='blog'` — they get the full editor, drafts,
comments (footer + inline), reactions, views, labels, attachments,
restrictions, versions and search for free, but live on a chronological
feed instead of the content tree (the tree query excludes them; blogs are
always parentless). `GET /wiki/spaces/{key}/blog` returns the
restriction-filtered feed with author + excerpt. The sidebar's Blogs item
is live: a Confluence-style feed grouped by month with author, date,
title and a 3-line excerpt; Create blog post (and the + menu's Blog post
entry) opens the editor in blog mode. Space roles apply: collaborators
post, viewers read. Deferred: importing Confluence blog posts, per-post
cover images, cross-space blog feed on the DocHat home.

## Stage W14 — Calendars ✅ (shipped 2026-07-18)
**Shipped (migration 0037: `wiki_calendar_events`):** a team calendar per
space, Confluence Team-Calendars style. All-day events with date ranges
and a 7-color palette; month view with a Monday-aligned grid, month
navigation + Today, today highlighted; click a day to add an event, click
an event to edit or delete (collaborator+; viewers read). Multi-day
events render across their range with squared continuation edges. The
TaskHat feed rides along with per-viewer scoping to their project
memberships: work items due that day (type icon + key, struck through
when resolved, linking to the item) and sprint start/end markers — each
of the three layers toggleable. `GET /wiki/spaces/{key}/calendar?from&to`
(≤10 weeks) returns events + dueItems + sprints. Deferred: week/list
views, drag-to-move events, event categories/subscriptions, ICS export.

## Stage W15 — Whiteboard extras ✅ (shipped 2026-07-18)
**Shipped (no migration):**
**Live multi-user drawing** — the realtime hub accepts client-originated
`publish` frames on `canvas:{pageId}` channels (auth'd, relayed through
Redis across replicas). Whiteboards broadcast throttled scene updates
(250ms) and pointer positions (100ms); peers merge elements with
Excalidraw's version/versionNonce reconciliation, remote cursors render
natively with per-peer colors, and presence avatars sit in the board
header (pruned after 30s idle). Viewers receive live updates read-only.
**Version history** — canvas autosaves now snapshot into
`wiki_page_versions`, coalesced to at most one version per 10 minutes;
the board's ••• menu gains Version history, and the history page renders
whiteboard revisions as static Excalidraw previews (diff toggle hidden)
with the existing restore flow.
**Interactive embeds** — whiteboard embeds on pages keep the fast SVG
snapshot but gain an "Interactive" action that swaps in a live read-only
Excalidraw canvas (pan/zoom, always the board's current content) — in
the editor, on published pages, and in static views. Deferred: file
(image) sync in live sessions, conflict-free text co-editing on shapes,
embed auto-refresh.

# Polish stages (planned 2026-07-19 from the user's live Confluence
# screenshots + Atlassian's current docs — apply on request)

## Stage W16 — Content tree & page operations ✅ (shipped 2026-07-19)
**Shipped (migration 0039: `wiki_page_stars` + `wiki_pages.archived_at`):**
**Tree item ••• menu** on every row — Edit, Rename (inline input right in
the tree, Enter/Escape), Star/unstar, Copy link, Make a copy, Move…,
Archive, Delete; viewers see only Star and Copy link. Folder rows toggle
open on click instead of navigating.
**Folders** — the sidebar + menu creates them natively ("New folder"
lands in inline-rename immediately); renameable like everything else.
**Page stars** — from the tree menu or the page ••• menu; the sidebar's
Starred section is live, listing starred pages/whiteboards across spaces
(restriction- and space-access-filtered).
**Make a copy** — duplicates body, icon, and labels as a "Copy of X"
sibling with a fresh version history (children not copied).
**Move dialog** — target space + parent pickers; the whole subtree moves,
including across spaces (collaborator required on both ends; cycle-safe).
**Archive** — archives the page and its subtree out of the tree, search,
recents, mentions, and the blog feed; the page itself stays viewable with
an Archived lozenge + Restore, and Space settings gains an Archived
content list with restore. Deferred: copy-with-children, archived-page
banner on children, bulk tree actions.

## Stage W17 — Space management ✅ (shipped 2026-07-19)
**Shipped (migration 0040: space icon/archived/owner + `wiki_space_stars`
/ `wiki_space_watchers` / `wiki_space_categories` + `wiki_pages.deleted_at`):**
**Space ••• menu** on the sidebar header — Star/Unstar space, Watch/Stop
watching, and for admins Space tools (Users, Space settings), Archive/
Restore space, Delete space (type the key to confirm).
**Space identity** — emoji space icons across the directory, sidebar and
settings; starred spaces join the sidebar's Starred section; watching a
space delivers every page edit and comment in it through the normal
notification pipeline (page + space watchers are unioned).
**Space settings takeover** — Confluence-style sub-nav (deep-linkable
`/settings/{section}`): Space details (icon, name, description, key,
owner with change-owner, admin avatars, category chips, home-content
picker), Access (default level + members, owner badged), Templates,
Archived content, Trash.
**Space categories** — kebab-case chips, shown in the directory with a
click-to-filter row.
**Trash** — page deletes are now soft: children move up, the page lands
in the space Trash (hidden everywhere, direct view 404s) with Restore
(back at top level) and Delete forever; archived spaces go read-only for
non-admins and sink to an Archived section in the directory; Delete
space removes everything after a type-the-key confirmation. Deferred:
trash auto-expiry, anonymous access/public links, image space avatars.

## Stage W18 — Editor completion: macros & modes ✅ (shipped 2026-07-19)
**Shipped (no migration):**
**Status macro** — a real inline node now: colored lozenges (6 Atlassian
colors) insertable from /status, the + menu, or Browse; click one in the
editor to retitle it or recolor via swatches. The Confluence importer now
maps status macros to the node with their colour preserved (was bold
text).
**Date macro** — 📅 inline chips with a native date picker on click,
locale-formatted on published pages.
**Decision macro** — green-diamond decision rows (list of decision
items), /decision.
**Browse-all insert modal** — the + menu keeps a quick list and gains
"View more", opening the searchable catalog grouped All / Formatting /
Content / Media / Navigation, matching Confluence's Browse dialog.
**Present mode** — a full-screen clean reading view (big centered title,
18px/1.8 body, Esc to exit) from the page ••• menu.
**Export to PDF** — a print-optimized window carrying the page's real
styles; the browser's dialog saves the PDF.
**Convert** — page ↔ blog post from the ••• menu (children move up when
a page becomes a post; Overview protected). Deferred: decision importer
mapping, per-page PDF headers/footers, present-mode slide splitting.

## Stage W19 — Search & navigation ✅ (shipped 2026-07-19)
**Shipped (migration 0041: `wiki_space_shortcuts` + `wiki_spaces.is_personal`):**
**Search parity** — inside DocHat the top-bar search opens with your
recently viewed pages ("You viewed X ago", from the real view records),
DRAFT lozenges wherever you have an unpublished draft (recents and
results), and Space / Contributor filter dropdowns that scope wiki
results server-side.
**Space Shortcuts** — the sidebar section is live: pinned links per space
(external URLs open in a new tab, /app paths navigate), added inline with
a title+URL form (collaborators; 12 max) and removed on hover.
**Watch settings** — the page ••• menu now offers both Watch page and
Watch space together.
**Personal space** — the account menu's Personal space entry creates a
private members-only space on first use (key derived from your email,
"Name's space", owner-admin) and jumps to it; personal spaces stay out
of other people's directory. Deferred: content-type search filter,
shortcut reordering, personal-space avatar.

## Excluded (Atlassian-cloud-only or out of scope for now)
Rovo/AI features (Ask/Create with Rovo, Improve formatting, Listen),
Live Docs, Slides, Databases, Sync blocks, anonymous access & public
links, Slack/RSS integrations, Report abuse.

## W20 — Import page owners ✅ (shipped 2026-07-27)
The Confluence importer now carries the people behind every page. Scan
resolves each page's `ownerId` (the "Owned by" byline person), `authorId`
(creator) and the current version's author to real names via the v1 user
API (one request per unique account; the report shows a People count).
Run maps each account to a TaskHat user — by Atlassian account id first
(so people already imported from Jira match automatically), then by email
(back-filling the account id), else a claimable deactivated placeholder —
and stamps `created_by`/`updated_by` (plus the v1 version snapshot), so
bylines, the contributors search filter and the For-you feeds show the
real owners. Deleted Confluence accounts fall back to the importing user;
inactive placeholders are removed as watchers so no notifications queue
for accounts that can't log in. Re-imports re-stamp idempotently.
Deferred: per-version author history, space-owner mapping, group members.

## Blob cleanup on permanent deletes ✅ (2026-07-27)
Purging a page from the Trash and deleting a space now also remove the
attachment binaries (and their public inline-image copies) from object
storage — previously the database rows went away but the S3 objects
stayed orphaned (and inline-image URLs kept serving). Deletion is
best-effort after the transaction commits, with failures logged; the
space-delete audit row records the blob count. Editor-uploaded inline
images that were never attachments remain unlinked to pages and are not
collected. `backend/cmd/blobcheck` is a tiny ops tool to check a key.

## Later / backlog
TQL-style page search, custom emoji, page cover images, space export
(PDF/zip), verified-page status, bulk tree actions, smart links in the
content tree.
