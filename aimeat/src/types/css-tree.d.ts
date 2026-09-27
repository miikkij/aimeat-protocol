/**
 * @file src/types/css-tree.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Types for the part of css-tree the Design Book's component bench calls
 *   (services/design-book/component-scan.ts). css-tree ships no types of its own, so this states the
 *   calls and the nodes as the bench uses them: parse(), whose `children` are css-tree Lists the bench
 *   reads through toArray(); walk() with enter and leave; tokenize(); the token type numbers;
 *   ident.decode() and string.decode(). A node type the bench does not read is named in OtherNode,
 *   so a switch on `type` still narrows. The shapes follow css-tree 3.2.1's node definitions
 *   (lib/syntax/node/*.js). Its `list: false` option is not stated: in 3.2.1 the parser does not
 *   read a rule with it and keeps the text raw.
 * @usage import { parse, walk, tokenize, tokenTypes, ident, string } from 'css-tree';
 * @version-history
 *   v1.2.0 — 2026-09-26 — string.decode(), and the token types of a string and a ";", which the bench
 *     reads in the prelude of an at-rule that defines a name.
 *   v1.1.0 — 2026-09-26 — The token types of a number, a dimension, a percentage and a comma, which
 *     the bench reads in a pseudo's argument of words and numbers.
 *   v1.0.0 — 2026-09-26 — Initial, for the component bench's stylesheet reader.
 */
declare module 'css-tree' {
  export interface CssPosition { offset: number; line: number; column: number }
  export interface CssLocation { source: string; start: CssPosition; end: CssPosition }

  /** css-tree's linked list of child nodes. */
  export interface CssList<T> { toArray(): T[] }

  interface NodeBase { loc?: CssLocation | null }

  export interface StyleSheet extends NodeBase { type: 'StyleSheet'; children: CssList<CssNode> }
  export interface Atrule extends NodeBase { type: 'Atrule'; name: string; prelude: CssNode | null; block: Block | null }
  export interface Rule extends NodeBase { type: 'Rule'; prelude: SelectorList | Raw; block: Block }
  export interface Block extends NodeBase { type: 'Block'; children: CssList<CssNode> }
  /** `important` is true for `!important`, and the word as written for any other `!word`. */
  export interface Declaration extends NodeBase { type: 'Declaration'; property: string; important: boolean | string; value: Value | Raw }
  export interface Value extends NodeBase { type: 'Value'; children: CssList<CssNode> }
  /** Text the parser kept as written: what it could not parse, or what it does not parse by design. */
  export interface Raw extends NodeBase { type: 'Raw'; value: string }
  export interface Identifier extends NodeBase { type: 'Identifier'; name: string }
  export interface FunctionNode extends NodeBase { type: 'Function'; name: string; children: CssList<CssNode> }
  export interface Hash extends NodeBase { type: 'Hash'; value: string }
  export interface SelectorList extends NodeBase { type: 'SelectorList'; children: CssList<Selector | Raw> }
  export interface Selector extends NodeBase { type: 'Selector'; children: CssList<CssNode> }
  export interface TypeSelector extends NodeBase { type: 'TypeSelector'; name: string }
  export interface ClassSelector extends NodeBase { type: 'ClassSelector'; name: string }
  export interface PseudoClassSelector extends NodeBase { type: 'PseudoClassSelector'; name: string; children: CssList<CssNode> | null }
  export interface PseudoElementSelector extends NodeBase { type: 'PseudoElementSelector'; name: string; children: CssList<CssNode> | null }
  /** `name` is " " for a descendant, ">", "+", "~", or "/deep/". */
  export interface Combinator extends NodeBase { type: 'Combinator'; name: string }
  export interface Nth extends NodeBase { type: 'Nth'; nth: CssNode; selector: SelectorList | null }

  export interface OtherNode extends NodeBase {
    type: 'AnPlusB' | 'AtrulePrelude' | 'AttributeSelector' | 'Brackets' | 'CDC' | 'CDO' | 'Comment' | 'Condition'
      | 'DeclarationList' | 'Dimension' | 'Feature' | 'FeatureFunction' | 'FeatureRange' | 'GeneralEnclosed' | 'IdSelector'
      | 'Layer' | 'LayerList' | 'MediaQuery' | 'MediaQueryList' | 'NestingSelector' | 'Number' | 'Operator' | 'Parentheses'
      | 'Percentage' | 'Ratio' | 'Scope' | 'String' | 'SupportsDeclaration' | 'UnicodeRange' | 'Url' | 'WhiteSpace';
  }

  export type CssNode = StyleSheet | Atrule | Rule | Block | Declaration | Value | Raw | Identifier | FunctionNode | Hash
    | SelectorList | Selector | TypeSelector | ClassSelector | PseudoClassSelector | PseudoElementSelector | Combinator | Nth
    | OtherNode;

  /** What css-tree hands onParseError: the message, and where in the text the parser gave up. */
  export interface CssSyntaxError extends Error { offset: number }

  export interface ParseOptions {
    positions?: boolean;
    parseCustomProperty?: boolean;
    onParseError?: (error: CssSyntaxError, fallbackNode: CssNode) => void;
  }
  export function parse(text: string, options: ParseOptions): CssNode;

  /** `this` inside enter and leave: the nearest enclosing node of each kind, or null. */
  export interface WalkContext { readonly skip: symbol; readonly break: symbol; readonly atrulePrelude: CssNode | null }
  export interface WalkOptions {
    enter?: (this: WalkContext, node: CssNode) => void | symbol;
    leave?: (this: WalkContext, node: CssNode) => void | symbol;
  }
  export function walk(ast: CssNode, options: WalkOptions): void;

  /** Calls onToken for every token of the text, in order, with its type number and where it stands. */
  export function tokenize(text: string, onToken: (type: number, start: number, end: number) => void): void;
  export const tokenTypes: {
    readonly Ident: number; readonly Function: number; readonly AtKeyword: number; readonly Url: number; readonly BadUrl: number;
    readonly WhiteSpace: number; readonly Comment: number; readonly LeftParenthesis: number; readonly RightParenthesis: number;
    readonly LeftSquareBracket: number; readonly RightSquareBracket: number; readonly LeftCurlyBracket: number;
    readonly RightCurlyBracket: number; readonly Number: number; readonly Dimension: number; readonly Percentage: number;
    readonly Comma: number; readonly String: number; readonly Semicolon: number;
  };
  /** A name with its escapes resolved: `u\72 l` is `url`. */
  export const ident: { decode(text: string): string };
  /** A string token's value, its quotes taken off and its escapes resolved. */
  export const string: { decode(text: string): string };
}
