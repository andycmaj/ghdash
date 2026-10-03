import { Commands } from "./commands";
import type { KeymapTable } from "./keyboard/keymap-utils";
import { FeedItemKind, SectionKey } from "./github/types";

// Declarative keymap configuration, by scope: "app" applies anywhere in the
// pane layout; "sections" and "content" while focus is within that pane.
export const keymap: KeymapTable = {
  app: [
    { key: "ctrl+p", cmd: Commands.PALETTE_OPEN, desc: "palette" },
    {
      key: ":",
      cmd: Commands.PALETTE_OPEN,
      desc: "command palette",
      help: "commands",
    },
    {
      key: "space",
      cmd: Commands.SECTION_PICKER_OPEN,
      desc: "section picker",
      help: "sections",
    },
    { key: "q", cmd: Commands.APP_QUIT, desc: "quit" },
    { key: "ctrl+c", cmd: Commands.APP_QUIT, desc: "quit" },
    { key: "ctrl+e", cmd: Commands.SIDEBAR_TOGGLE, desc: "sidebar" },
    { key: "tab", cmd: Commands.FOCUS_NEXT, desc: "switch" },
    { key: "r", cmd: Commands.PR_REFRESH, desc: "refresh", help: "refresh" },
    {
      key: "l",
      cmd: Commands.OPEN_LOKI_LOGS,
      desc: "open loki logs",
      help: "logs",
    },
    {
      key: "p",
      cmd: Commands.OPEN_PR_LIST,
      desc: "open one of my PRs",
      help: "my PRs",
    },
    {
      key: "y",
      cmd: Commands.COPY_PR_LINK,
      desc: "copy PR link",
      help: "copy link",
    },
    { key: "?", cmd: Commands.HELP_OPEN, desc: "keyboard help", help: "help" },
  ],

  sections: [
    { key: "j", cmd: Commands.NAV_DOWN, desc: "down" },
    { key: "down", cmd: Commands.NAV_DOWN, desc: "down" },
    { key: "k", cmd: Commands.NAV_UP, desc: "up" },
    { key: "up", cmd: Commands.NAV_UP, desc: "up" },
    { key: "g", cmd: Commands.NAV_TOP, desc: "top" },
    { key: "shift+g", cmd: Commands.NAV_BOTTOM, desc: "bottom" },
    {
      key: "o",
      cmd: Commands.OPEN_IN_BROWSER,
      desc: "open in browser",
      help: "open",
    },
    {
      key: "return",
      cmd: Commands.SECTION_SELECT,
      desc: "select",
      help: "select",
    },
  ],

  content: [
    { key: "j", cmd: Commands.NAV_DOWN, desc: "down" },
    { key: "down", cmd: Commands.NAV_DOWN, desc: "down" },
    { key: "k", cmd: Commands.NAV_UP, desc: "up" },
    { key: "up", cmd: Commands.NAV_UP, desc: "up" },
    { key: "g", cmd: Commands.NAV_TOP, desc: "top" },
    { key: "shift+g", cmd: Commands.NAV_BOTTOM, desc: "bottom" },
    {
      key: "o",
      cmd: Commands.OPEN_IN_BROWSER,
      desc: "open in browser",
      help: "open",
    },
    {
      key: "return",
      cmd: Commands.TOGGLE_EXPAND,
      desc: "expand/collapse",
      help: "expand",
      // Enter toggles workflow rows; on PR Info cards it edits (shown as `e`).
      relevant: (ctx) => ctx.selectedItem?.kind === "workflow",
    },
    {
      key: "a",
      cmd: Commands.TOGGLE_ANNOTATIONS,
      desc: "toggle annotations",
      help: "annotations",
      relevant: (ctx) => ctx.activeSection === SectionKey.Actions,
    },
    {
      key: "e",
      cmd: Commands.CARD_EDIT,
      desc: "edit",
      help: "edit",
      relevant: (ctx) => ctx.selectedItem?.kind === "infoCard",
    },
    {
      key: "c",
      cmd: Commands.FEED_REPLY,
      desc: "reply to thread",
      help: "reply",
      relevant: (ctx) =>
        ctx.selectedItem?.kind === "feedItem" &&
        ctx.selectedItem.item.kind === FeedItemKind.ThreadComment,
    },
    { key: "pageup", cmd: Commands.SCROLL_PAGEUP, desc: "pgup" },
    { key: "pagedown", cmd: Commands.SCROLL_PAGEDOWN, desc: "pgdn" },
  ],
};
