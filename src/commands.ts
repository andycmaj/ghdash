// Command constants
export const Commands = {
  // App-level
  APP_QUIT: "app.quit",
  SIDEBAR_TOGGLE: "sidebar.toggle",
  FOCUS_NEXT: "focus.next",
  FOCUS_PREV: "focus.prev",
  PR_REFRESH: "pr.refresh",
  OPEN_IN_BROWSER: "pr.open.browser",
  OPEN_LOKI_LOGS: "pr.open.loki",
  OPEN_PR_LIST: "pr.open.list",
  COPY_PR_LINK: "pr.copy.link",
  MERGE_PR: "pr.merge",

  // Navigation (shared between sections list and content pane)
  NAV_DOWN: "nav.down",
  NAV_UP: "nav.up",
  NAV_TOP: "nav.top",
  NAV_BOTTOM: "nav.bottom",

  // Content scrolling
  SCROLL_PAGEUP: "scroll.pageup",
  SCROLL_PAGEDOWN: "scroll.pagedown",

  // Sections list
  SECTION_SELECT: "section.select",
  SECTION_PICKER_OPEN: "section.picker.open",

  // Content tree (e.g. Actions workflow → job)
  TOGGLE_EXPAND: "content.toggle.expand",
  TOGGLE_ANNOTATIONS: "content.toggle.annotations",

  // Edit the active card (PR Info: title / description / labels)
  CARD_EDIT: "content.card.edit",

  // Reply to the selected review-thread comment in the Feed
  FEED_REPLY: "content.feed.reply",

  // Command palette
  PALETTE_OPEN: "palette.open",

  // Help
  HELP_OPEN: "help.open",
} as const;
