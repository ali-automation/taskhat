// Atlaskit's new core icons ship as deep CJS files; the production bundler's
// interop sometimes hands us the module object instead of the default export.
// Normalize once here and import icons from this module everywhere.
import SidebarCollapse from '@atlaskit/icon/core/sidebar-collapse'
import SidebarExpand from '@atlaskit/icon/core/sidebar-expand'
import AppSwitcher from '@atlaskit/icon/core/app-switcher'
import Notification from '@atlaskit/icon/core/notification'
import QuestionCircle from '@atlaskit/icon/core/question-circle'
import Settings from '@atlaskit/icon/core/settings'
import PersonAvatar from '@atlaskit/icon/core/person-avatar'
import Clock from '@atlaskit/icon/core/clock'
import StarUnstarred from '@atlaskit/icon/core/star-unstarred'
import Library from '@atlaskit/icon/core/library'
import Filter from '@atlaskit/icon/core/filter'
import Search from '@atlaskit/icon/core/search'
import Board from '@atlaskit/icon/core/board'
import Backlog from '@atlaskit/icon/core/backlog'
import ListBulleted from '@atlaskit/icon/core/list-bulleted'
import Home from '@atlaskit/icon/core/home'
import ChevronLeft from '@atlaskit/icon/core/chevron-left'
import ChevronRight from '@atlaskit/icon/core/chevron-right'
import ChevronDown from '@atlaskit/icon/core/chevron-down'
import ArrowRight from '@atlaskit/icon/core/arrow-right'
import Add from '@atlaskit/icon/core/add'
import Attachment from '@atlaskit/icon/core/attachment'
import EyeOpen from '@atlaskit/icon/core/eye-open'
import ShowMoreHorizontal from '@atlaskit/icon/core/show-more-horizontal'
import Epic16 from '@atlaskit/icon-object/glyph/epic/16'
import Story16 from '@atlaskit/icon-object/glyph/story/16'
import Task16 from '@atlaskit/icon-object/glyph/task/16'
import Bug16 from '@atlaskit/icon-object/glyph/bug/16'
import Subtask16 from '@atlaskit/icon-object/glyph/subtask/16'
import Screen from '@atlaskit/icon/core/screen'
import Copy from '@atlaskit/icon/core/copy'
import ArrowLeft from '@atlaskit/icon/core/arrow-left'
import Feedback from '@atlaskit/icon/core/feedback'
import Task from '@atlaskit/icon/core/task'
import PeopleGroup from '@atlaskit/icon/core/people-group'
import LinkIconRaw from '@atlaskit/icon/core/link'
import Dashboard from '@atlaskit/icon/core/dashboard'
import Page from '@atlaskit/icon/core/page'
import Pages from '@atlaskit/icon/core/pages'
import Edit from '@atlaskit/icon/core/edit'
import Shortcut from '@atlaskit/icon/core/shortcut'
import QuotationMark from '@atlaskit/icon/core/quotation-mark'
import Calendar from '@atlaskit/icon/core/calendar'
import BookWithBookmark from '@atlaskit/icon/core/book-with-bookmark'
import LockLocked from '@atlaskit/icon/core/lock-locked'
import Tag from '@atlaskit/icon/core/tag'
import LinkExternal from '@atlaskit/icon/core/link-external'
import TextBold from '@atlaskit/icon/core/text-bold'
import TextItalic from '@atlaskit/icon/core/text-italic'
import TextUnderline from '@atlaskit/icon/core/text-underline'
import TextStyle from '@atlaskit/icon/core/text-style'
import AlignTextLeft from '@atlaskit/icon/core/align-text-left'
import ListNumbered from '@atlaskit/icon/core/list-numbered'
import ListChecklist from '@atlaskit/icon/core/list-checklist'
import ImageIconRaw from '@atlaskit/icon/core/image'
import Mention from '@atlaskit/icon/core/mention'
import Emoji from '@atlaskit/icon/core/emoji'
import TableIconRaw from '@atlaskit/icon/core/table'
import Undo from '@atlaskit/icon/core/undo'
import Whiteboard from '@atlaskit/icon/core/whiteboard'
import Timeline from '@atlaskit/icon/core/timeline'
import Release from '@atlaskit/icon/core/release'
import CommentRaw from '@atlaskit/icon/core/comment'
import FolderClosed from '@atlaskit/icon/core/folder-closed'
import Redo from '@atlaskit/icon/core/redo'
import ChartTrend from '@atlaskit/icon/core/chart-trend'
import PriorityHighest from '@atlaskit/icon/core/priority-highest'
import PriorityHigh from '@atlaskit/icon/core/priority-high'
import PriorityMedium from '@atlaskit/icon/core/priority-medium'
import PriorityLow from '@atlaskit/icon/core/priority-low'
import PriorityLowest from '@atlaskit/icon/core/priority-lowest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fix<T>(c: T): T {
  return ((c as any)?.default ?? c) as T
}

export const SidebarCollapseIcon = fix(SidebarCollapse)
export const SidebarExpandIcon = fix(SidebarExpand)
export const AppSwitcherIcon = fix(AppSwitcher)
export const NotificationIcon = fix(Notification)
export const QuestionCircleIcon = fix(QuestionCircle)
export const SettingsIcon = fix(Settings)
export const PersonAvatarIcon = fix(PersonAvatar)
export const ClockIcon = fix(Clock)
export const StarUnstarredIcon = fix(StarUnstarred)
export const LibraryIcon = fix(Library)
export const FilterIcon = fix(Filter)
export const SearchIcon = fix(Search)
export const BoardIcon = fix(Board)
export const BacklogIcon = fix(Backlog)
export const ListBulletedIcon = fix(ListBulleted)
export const HomeIcon = fix(Home)
export const ChevronLeftIcon = fix(ChevronLeft)
export const ChevronRightIcon = fix(ChevronRight)
export const ChevronDownIcon = fix(ChevronDown)
export const ArrowRightIcon = fix(ArrowRight)
export const AddIcon = fix(Add)
export const AttachmentIcon = fix(Attachment)
export const EyeOpenIcon = fix(EyeOpen)
export const ShowMoreHorizontalIcon = fix(ShowMoreHorizontal)
export const Epic16Icon = fix(Epic16)
export const Story16Icon = fix(Story16)
export const Task16Icon = fix(Task16)
export const Bug16Icon = fix(Bug16)
export const Subtask16Icon = fix(Subtask16)
export const ScreenIcon = fix(Screen)
export const CopyIcon = fix(Copy)
export const ArrowLeftIcon = fix(ArrowLeft)
export const FeedbackIcon = fix(Feedback)
export const TaskIcon = fix(Task)
export const PeopleGroupIcon = fix(PeopleGroup)
export const LinkIcon = fix(LinkIconRaw)
export const DashboardIcon = fix(Dashboard)
export const PageIcon = fix(Page)
export const PagesIcon = fix(Pages)
export const EditIcon = fix(Edit)
export const ShortcutIcon = fix(Shortcut)
export const QuotationMarkIcon = fix(QuotationMark)
export const CalendarIcon = fix(Calendar)
export const BookIcon = fix(BookWithBookmark)
export const LockLockedIcon = fix(LockLocked)
export const TagIcon = fix(Tag)
export const LinkExternalIcon = fix(LinkExternal)
export const TextBoldIcon = fix(TextBold)
export const TextItalicIcon = fix(TextItalic)
export const TextUnderlineIcon = fix(TextUnderline)
export const TextStyleIcon = fix(TextStyle)
export const AlignTextLeftIcon = fix(AlignTextLeft)
export const ListNumberedIcon = fix(ListNumbered)
export const ListChecklistIcon = fix(ListChecklist)
export const ImageIcon = fix(ImageIconRaw)
export const MentionIcon = fix(Mention)
export const EmojiIcon = fix(Emoji)
export const TableIcon = fix(TableIconRaw)
export const UndoIcon = fix(Undo)
export const WhiteboardIcon = fix(Whiteboard)
export const TimelineIcon = fix(Timeline)
export const ChartTrendIcon = fix(ChartTrend)
export const ReleaseIcon = fix(Release)
export const CommentIcon = fix(CommentRaw)
export const FolderClosedIcon = fix(FolderClosed)
export const RedoIcon = fix(Redo)
export const PriorityHighestIcon = fix(PriorityHighest)
export const PriorityHighIcon = fix(PriorityHigh)
export const PriorityMediumIcon = fix(PriorityMedium)
export const PriorityLowIcon = fix(PriorityLow)
export const PriorityLowestIcon = fix(PriorityLowest)

// Brand mark: a small top hat that renders identically everywhere
// (the 🎩 emoji is font-dependent and missing in some environments).
export { default as HatLogo } from './HatLogo'
export { default as DocHatLogo } from './DocHatLogo'
