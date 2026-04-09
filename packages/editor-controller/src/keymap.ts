import {
  appendInsertMode,
  changeSelection,
  deleteBackwardIndentAware,
  deleteForward,
  deleteSelection,
  enterInsertMode,
  enterNormalMode,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  gotoFileStart,
  gotoFirstNonWhitespace,
  gotoLastLine,
  gotoLineEnd,
  gotoLineStart,
  gotoNextParagraph,
  gotoPrevParagraph,
  gotoWindowBottom,
  gotoWindowCenter,
  gotoWindowTop,
  insertNewline,
  insertText,
  moveDown,
  moveLeft,
  moveNextLongWordEnd,
  moveNextLongWordStart,
  moveNextWordStart,
  movePrevLongWordStart,
  moveRight,
  moveUp,
  moveWordBackward,
  moveWordForward,
  openAbove,
  openBelow,
  pageDown,
  pageUp,
  pasteAfter,
  redo,
  selectAll,
  selectLineBelow,
  toggleVisualMode,
  undo,
  yankSelection,
  type Command
} from "@wx/editor-core";

export function commandForNormalMode(key: string): Command | null {
  switch (key) {
    case "%":
      return selectAll;
    case "B":
      return movePrevLongWordStart;
    case "E":
      return moveNextLongWordEnd;
    case "End":
      return gotoLineEnd;
    case "Home":
      return gotoLineStart;
    case "PageDown":
      return pageDown;
    case "PageUp":
      return pageUp;
    case "W":
      return moveNextLongWordStart;
    case "a":
      return appendInsertMode;
    case "ArrowLeft":
    case "h":
      return moveLeft;
    case "ArrowRight":
    case "l":
      return moveRight;
    case "ArrowUp":
    case "k":
      return moveUp;
    case "ArrowDown":
    case "j":
      return moveDown;
    case "b":
      return moveWordBackward;
    case "c":
      return changeSelection;
    case "d":
      return deleteSelection;
    case "e":
      return moveWordForward;
    case "i":
      return enterInsertMode;
    case "o":
      return openBelow;
    case "O":
      return openAbove;
    case "p":
      return pasteAfter;
    case "u":
      return undo;
    case "U":
      return redo;
    case "v":
      return toggleVisualMode;
    case "w":
      return moveNextWordStart;
    case "x":
      return selectLineBelow;
    case "y":
      return yankSelection;
    default:
      return null;
  }
}

export function commandForVisualMode(key: string): Command | null {
  switch (key) {
    case "%":
      return selectAll;
    case "B":
      return movePrevLongWordStart;
    case "E":
      return moveNextLongWordEnd;
    case "Escape":
      return enterNormalMode;
    case "End":
      return gotoLineEnd;
    case "Home":
      return gotoLineStart;
    case "PageDown":
      return pageDown;
    case "PageUp":
      return pageUp;
    case "W":
      return moveNextLongWordStart;
    case "ArrowLeft":
    case "h":
      return moveLeft;
    case "ArrowRight":
    case "l":
      return moveRight;
    case "ArrowUp":
    case "k":
      return moveUp;
    case "ArrowDown":
    case "j":
      return moveDown;
    case "b":
      return moveWordBackward;
    case "c":
      return changeSelection;
    case "d":
      return deleteSelection;
    case "e":
      return moveWordForward;
    case "o":
      return openBelow;
    case "O":
      return openAbove;
    case "p":
      return pasteAfter;
    case "u":
      return undo;
    case "U":
      return redo;
    case "v":
      return toggleVisualMode;
    case "w":
      return moveNextWordStart;
    case "x":
      return selectLineBelow;
    case "y":
      return yankSelection;
    default:
      return null;
  }
}

export function commandForInsertMode(key: string): Command | null {
  switch (key) {
    case "Escape":
      return enterNormalMode;
    case "Tab":
      return insertText("  ");
    case "ArrowLeft":
      return moveLeft;
    case "ArrowRight":
      return moveRight;
    case "ArrowUp":
      return moveUp;
    case "ArrowDown":
      return moveDown;
    case "Backspace":
      return deleteBackwardIndentAware("  ");
    case "Delete":
      return deleteForward;
    case "Enter":
      return insertNewline;
    default:
      return key.length === 1 ? insertText(key) : null;
  }
}

export function commandForGotoPrefix(key: string): Command | null {
  switch (key) {
    case "g":
      return gotoFileStart;
    case "b":
      return gotoWindowBottom;
    case "c":
      return gotoWindowCenter;
    case "e":
      return gotoLastLine;
    case "h":
      return gotoLineStart;
    case "j":
      return moveDown;
    case "k":
      return moveUp;
    case "l":
      return gotoLineEnd;
    case "s":
      return gotoFirstNonWhitespace;
    case "t":
      return gotoWindowTop;
    default:
      return null;
  }
}

export function commandForBracketPrefix(direction: "[" | "]", key: string): Command | null {
  if (key !== "p") {
    return null;
  }

  return direction === "[" ? gotoPrevParagraph : gotoNextParagraph;
}

export {
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar
};
