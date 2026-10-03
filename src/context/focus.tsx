// Focus context comes from the framework. The app's pane and modal id unions
// stay here as types so component signatures keep their names.
export { FocusProvider, useFocus } from "@andycmaj/opentui-app";

export type Pane = "sections" | "content";

export type ModalState =
  | "none"
  | "palette"
  | "help"
  | "sectionPicker"
  | "mergeConfirm"
  | "editTitle"
  | "editBody"
  | "editLabels"
  | "openPr"
  | "reply";
