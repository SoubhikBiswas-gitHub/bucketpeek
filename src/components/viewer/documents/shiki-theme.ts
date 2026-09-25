import type { ThemeRegistration } from "shiki";

// Colors are CSS variables from `syntax.css`, so highlighted code follows the brand without re-tokenizing.
// Anything that renders these tokens must sit inside `.lens-syntax`.
export const LENS_THEME_NAME = "deccan-lens";

const v = (name: string) => `var(--syntax-${name})`;

export const lensTheme: ThemeRegistration = {
  name: LENS_THEME_NAME,
  type: "dark",
  colors: {
    "editor.foreground": v("fg"),
    "editor.background": "var(--surface-1)",
  },
  tokenColors: [
    { settings: { foreground: v("fg") } },
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: v("comment"), fontStyle: "italic" },
    },
    {
      scope: [
        "punctuation",
        "meta.brace",
        "punctuation.separator",
        "punctuation.terminator",
        "punctuation.accessor",
        "meta.delimiter",
      ],
      settings: { foreground: v("punctuation") },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.logical.python",
        "variable.language",
        "support.type.primitive",
      ],
      settings: { foreground: v("keyword") },
    },
    { scope: ["keyword.operator"], settings: { foreground: v("punctuation") } },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string", "markup.inline.raw"],
      settings: { foreground: v("string") },
    },
    {
      scope: ["constant.character.escape", "string.regexp", "constant.other.placeholder"],
      settings: { foreground: v("regex") },
    },
    {
      scope: ["constant.numeric", "constant.other", "support.constant", "constant"],
      settings: { foreground: v("number") },
    },
    { scope: ["constant.language"], settings: { foreground: v("constant") } },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "variable.function",
        "meta.function-call.generic",
      ],
      settings: { foreground: v("function") },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.other.inherited-class",
        "support.class",
        "support.type",
        "entity.name.namespace",
        "entity.name.module",
      ],
      settings: { foreground: v("type") },
    },
    {
      scope: [
        "support.type.property-name",
        "meta.object-literal.key",
        "variable.other.property",
        "variable.other.object.property",
        "entity.name.tag.yaml",
        "keyword.other.definition.ini",
        "entity.name.tag.toml",
        "support.type.property-name.json",
      ],
      settings: { foreground: v("property") },
    },
    {
      scope: ["punctuation.definition.dictionary", "punctuation.definition.array", "punctuation.separator.dictionary"],
      settings: { foreground: v("punctuation") },
    },
    { scope: ["variable.parameter", "meta.parameter"], settings: { foreground: v("fg"), fontStyle: "italic" } },
    {
      scope: ["entity.name.tag", "punctuation.definition.tag", "meta.tag.sgml"],
      settings: { foreground: v("tag") },
    },
    { scope: ["entity.other.attribute-name"], settings: { foreground: v("attribute") } },
    { scope: ["entity.name.function.decorator", "meta.decorator", "punctuation.definition.decorator"], settings: { foreground: v("attribute") } },
    { scope: ["markup.heading", "entity.name.section"], settings: { foreground: v("heading"), fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.underline.link", "string.other.link", "markup.link"], settings: { foreground: v("link") } },
    { scope: ["punctuation.definition.list.begin.markdown", "punctuation.definition.list"], settings: { foreground: v("keyword") } },
    { scope: ["markup.quote"], settings: { foreground: v("comment") } },
    { scope: ["markup.inserted", "punctuation.definition.inserted"], settings: { foreground: v("inserted") } },
    { scope: ["markup.deleted", "punctuation.definition.deleted"], settings: { foreground: v("deleted") } },
    { scope: ["markup.changed"], settings: { foreground: v("warning") } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: v("error") } },
    // Log files (Shiki's "log" grammar).
    { scope: ["log.error"], settings: { foreground: v("error"), fontStyle: "bold" } },
    { scope: ["log.warning"], settings: { foreground: v("warning") } },
    { scope: ["log.info"], settings: { foreground: v("info") } },
    { scope: ["log.debug", "log.verbose"], settings: { foreground: v("muted") } },
    { scope: ["log.date", "log.time"], settings: { foreground: v("muted"), fontStyle: "" } },
    { scope: ["log.constant", "log.exceptiontype"], settings: { foreground: v("type") } },
    { scope: ["log.string"], settings: { foreground: v("string") } },
  ],
};
