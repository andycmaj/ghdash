// The keymap engine lives in the framework. This module binds its types to
// ghdash's help context, so bindings' `relevant` predicates are typed.

import type { HelpContext } from "@/context/help-context";
import type {
  BindingSpec as CoreBindingSpec,
  HelpBinding as CoreHelpBinding,
  KeymapTable as CoreKeymapTable,
} from "@andycmaj/opentui-app";

export type BindingSpec = CoreBindingSpec<HelpContext>;
export type KeymapTable = CoreKeymapTable<HelpContext>;
export type HelpBinding = CoreHelpBinding<HelpContext>;

export {
  filterRelevant,
  getHelpItems,
  getScopeBindings,
  useHelpItems,
  useReachableBindings,
  useScope,
  type Command,
  type HelpItem,
} from "@andycmaj/opentui-app";
