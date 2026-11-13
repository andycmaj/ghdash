import { Commands } from "./commands";
import type { KeymapTable } from "./keyboard/keymap-utils";
import { SectionKey } from "./github/types";
import { canReply, canResolve } from "./github/feed-utils";

// Declarative keymap configuration, by scope: "app" applies anywhere in the
// pane layout; "sections" and "content" while focus is within that pane.
export const keymap: KeymapTable = {
  // Common global interactions (enter, space, :) omit `help` to keep the
  // footer strip short; they still appear in the `?` modal.
  app: [
    { key: "ctrl+p", cmd: Commands.PALETTE_OPEN, desc: "palette" },
    {
      key: ":",
      cmd: Commands.PALETTE_OPEN,
      desc: "command palette",
    },
    {
      key: "space",
      cmd: Commands.SECTION_PICKER_OPEN,
      desc: "section picker",
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
      // The TiVo player takes `l` for stepping forward.
      relevant: (ctx) => ctx.selectedItem?.kind !== "tivoPlayer",
    },
    {
      key: "p",
      cmd: Commands.OPEN_PR_LIST,
      desc: "open one of my PRs",
      help: "my PRs",
      // Footer room for the TiVo player's own keys.
      relevant: (ctx) => ctx.selectedItem?.kind !== "tivoPlayer",
    },
    {
      key: "y",
      cmd: Commands.COPY_LINK,
      desc: "copy PR link",
      help: "copy link",
      // Footer room for the TiVo player's own keys.
      relevant: (ctx) => ctx.selectedItem?.kind !== "tivoPlayer",
    },
    {
      key: "d",
      cmd: Commands.TOGGLE_DRAFT,
      desc: "toggle draft/ready",
      help: "draft/ready",
      // Footer room for the TiVo player's own keys.
      relevant: (ctx) => ctx.selectedItem?.kind !== "tivoPlayer",
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
      relevant: (ctx) => ctx.selectedItem?.kind !== "tivoPlayer",
    },
    {
      key: "return",
      cmd: Commands.TOGGLE_EXPAND,
      desc: "expand/collapse",
      // Enter toggles workflow rows and long/threaded feed cards; on PR Info
      // cards it edits (shown as `e`).
      relevant: (ctx) =>
        ctx.selectedItem?.kind === "workflow" ||
        (ctx.selectedItem?.kind === "feedItem" && ctx.selectedItem.collapsible),
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
      relevant: (ctx) =>
        ctx.selectedItem?.kind === "infoCard" &&
        ctx.selectedItem.card !== "branch",
    },
    {
      key: "c",
      cmd: Commands.FEED_REPLY,
      desc: "reply",
      help: "reply",
      relevant: (ctx) =>
        ctx.selectedItem?.kind === "feedItem" &&
        canReply(ctx.selectedItem.item),
    },
    {
      key: "x",
      cmd: Commands.FEED_RESOLVE,
      desc: "resolve/unresolve thread",
      help: "resolve",
      relevant: (ctx) =>
        ctx.selectedItem?.kind === "feedItem" &&
        canResolve(ctx.selectedItem.item),
    },
    {
      key: "f",
      cmd: Commands.FEED_FILTER,
      desc: "cycle feed filter",
      help: "filter",
      relevant: (ctx) => ctx.activeSection === SectionKey.Feed,
    },
    {
      key: "y",
      cmd: Commands.COPY_LINK,
      desc: "copy link to selected item",
      help: "copy link",
      relevant: (ctx) => ctx.selectedItem?.kind !== "tivoPlayer",
    },
    {
      key: "shift+l",
      cmd: Commands.OPEN_JOB_LOGS,
      desc: "open job logs in $EDITOR",
      help: "job logs",
      relevant: (ctx) => ctx.selectedItem?.kind === "job",
    },
    { key: "pageup", cmd: Commands.SCROLL_PAGEUP, desc: "pgup" },
    { key: "pagedown", cmd: Commands.SCROLL_PAGEDOWN, desc: "pgdn" },
  ],

  // TiVo view, layered over "content" while the TiVo section is shown: the
  // file list, then the player once a file is open.
  tivo: [
    { key: "j", cmd: Commands.NAV_DOWN, desc: "down" },
    { key: "down", cmd: Commands.NAV_DOWN, desc: "down" },
    { key: "k", cmd: Commands.NAV_UP, desc: "up" },
    { key: "up", cmd: Commands.NAV_UP, desc: "up" },
    { key: "g", cmd: Commands.NAV_TOP, desc: "top" },
    { key: "shift+g", cmd: Commands.NAV_BOTTOM, desc: "bottom" },
    {
      key: "return",
      cmd: Commands.TIVO_OPEN,
      desc: "open file in the player",
      help: "play",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoFile",
    },
    {
      key: "h",
      cmd: Commands.TIVO_PREV,
      desc: "previous commit",
      help: "commit",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    { key: "left", cmd: Commands.TIVO_PREV, desc: "previous commit" },
    {
      key: "l",
      cmd: Commands.TIVO_NEXT,
      desc: "next commit",
      help: "next",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    { key: "right", cmd: Commands.TIVO_NEXT, desc: "next commit" },
    {
      key: "[",
      cmd: Commands.TIVO_HUNK_PREV,
      desc: "previous change in this commit",
      help: "hunk",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    {
      key: "]",
      cmd: Commands.TIVO_HUNK_NEXT,
      desc: "next change in this commit",
      help: "next hunk",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    {
      key: "<",
      cmd: Commands.TIVO_FILE_PREV,
      desc: "previous changed file",
      help: "file",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    {
      key: ">",
      cmd: Commands.TIVO_FILE_NEXT,
      desc: "next changed file",
      help: "next file",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    {
      key: "0",
      cmd: Commands.TIVO_FIRST,
      desc: "jump to merge-base",
    },
    {
      key: "$",
      cmd: Commands.TIVO_LAST,
      desc: "jump to HEAD",
    },
    {
      key: "b",
      cmd: Commands.TIVO_BLAME,
      desc: "toggle blame gutter",
      help: "blame",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    {
      key: "escape",
      cmd: Commands.TIVO_BACK,
      desc: "back to file list",
      help: "files",
      relevant: (ctx) => ctx.selectedItem?.kind === "tivoPlayer",
    },
    { key: "ctrl+d", cmd: Commands.SCROLL_HALF_DOWN, desc: "half page down" },
    { key: "ctrl+u", cmd: Commands.SCROLL_HALF_UP, desc: "half page up" },
    { key: "pageup", cmd: Commands.SCROLL_PAGEUP, desc: "pgup" },
    { key: "pagedown", cmd: Commands.SCROLL_PAGEDOWN, desc: "pgdn" },
  ],

  // While the embedded terminal has focus every other key goes to it.
  terminal: [
    {
      key: "ctrl+]",
      cmd: Commands.TERMINAL_DETACH,
      desc: "detach terminal",
      help: "detach",
    },
  ],
};
