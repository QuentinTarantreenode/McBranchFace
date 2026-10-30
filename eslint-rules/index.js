// Project rules for the Svelte markup: what the v0.7/v0.8 reviews found by eye, now found by the linter.
// Each rule works on the svelte-eslint-parser AST (SvelteText, SvelteAttribute, SvelteDirective, …).

const LETTER = /\p{L}/u;
// Product name and git terms stay as they are in every language (house rule: terms are never translated).
const TERMS = new Set(["McBranchFace", "PR", "Fetch", "Pull", "Push", "gone", "Diff", "Commits", "HEAD", "SHA", "origin"]);
const isTerm = (text) => TERMS.has(text.trim());
// Attributes whose text a person reads: they belong in the dictionary.
const TEXT_ATTRIBUTES = new Set(["aria-label", "placeholder", "title", "label", "alt", "hint", "tip"]);

/** The literal text of an attribute value that has no {expressions}, else null. */
function literalValue(attr) {
  if (!attr.value || attr.value.length === 0) return null;
  if (attr.value.every((v) => v.type === "SvelteLiteral")) return attr.value.map((v) => v.value).join("");
  return null;
}

/** String literals in an expression: a plain literal, or a template without placeholders. */
function literalExpression(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((q) => q.value.cooked).join("");
  return null;
}

const insideCode = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "SvelteElement" && ["code", "kbd", "pre"].includes(p.name?.name)) return true;
  }
  return false;
};

/** Visible text in markup must come from the dictionary (t.…), in every language. */
const noLiteralUiText = {
  meta: { type: "problem", docs: { description: "UI text comes from the dictionary" }, schema: [], messages: { literal: "Text shown to people belongs in the dictionary: {{text}}" } },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: "literal", data: { text: text.trim().slice(0, 40) } });
    return {
      SvelteText(node) {
        if (LETTER.test(node.value) && !insideCode(node) && !isTerm(node.value)) report(node, node.value);
      },
      SvelteAttribute(node) {
        const name = node.key?.name;
        if (!TEXT_ATTRIBUTES.has(name)) return;
        const text = literalValue(node);
        if (text && LETTER.test(text) && !isTerm(text)) report(node, text);
        const expr = node.value?.length === 1 && node.value[0].type === "SvelteMustacheTag" ? literalExpression(node.value[0].expression) : null;
        if (expr && LETTER.test(expr) && !isTerm(expr)) report(node, expr);
      },
      SvelteDirective(node) {
        if (node.kind !== "Action" || node.key?.name?.name !== "tooltip") return;
        const text = literalExpression(node.expression);
        if (text && LETTER.test(text)) report(node, text);
      },
    };
  },
};

const classOrStyle = (node) => ["class", "style"].includes(node.key?.name);
const textOf = (node) => (node.value ?? []).filter((v) => v.type === "SvelteLiteral").map((v) => v.value).join(" ");

/** Paths and names must not break mid-word: `break-all` and `overflow-wrap:anywhere` need a reason. */
const noBreakAll = {
  meta: { type: "problem", docs: { description: "no break-all" }, schema: [], messages: { breakAll: "{{what}} breaks inside words (paths: PathText, names: truncate). Disable with a reason if intended." } },
  create(context) {
    return {
      SvelteAttribute(node) {
        if (!classOrStyle(node)) return;
        const text = textOf(node);
        for (const what of ["break-all", "overflow-wrap:anywhere", "word-break: break-all"]) {
          if (text.includes(what)) context.report({ node, messageId: "breakAll", data: { what } });
        }
      },
    };
  },
};

/** Native title tooltips look and time differently from the app's tooltip. */
const noNativeTitle = {
  meta: { type: "problem", docs: { description: "no native title" }, schema: [], messages: { title: "Use the tooltip action instead of a native title." } },
  create(context) {
    return {
      SvelteAttribute(node) {
        if (node.key?.name === "title" && node.parent?.parent?.kind === "html") context.report({ node, messageId: "title" });
      },
    };
  },
};

/** Colours come from the tokens in app.css; a raw value skips both themes. Shadows may use black. */
const noRawColor = {
  meta: { type: "problem", docs: { description: "colours from tokens" }, schema: [], messages: { color: "Raw colour {{value}}: use a token from app.css." } },
  create(context) {
    return {
      SvelteAttribute(node) {
        if (!classOrStyle(node)) return;
        const text = textOf(node).replace(/shadow-\[[^\]]*\]/g, "");
        const m = text.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/);
        if (m) context.report({ node, messageId: "color", data: { value: m[0] } });
      },
    };
  },
};

// File system paths only; paths inside a repository are shown git-style with "/" on purpose.
const PATHLIKE = /(^|\.)(root|repoPath|worktreePath|appDir|diagnosticsLog|worktree\.path)$/;
const nameOf = (e) => (e.type === "Identifier" ? e.name : e.type === "MemberExpression" && !e.computed ? `${nameOf(e.object)}.${e.property.name}` : null);

/** A path shown as text goes through displayPath() or PathText: one separator style, `~`, wrap after separators. */
const rawPathDisplay = {
  meta: { type: "problem", docs: { description: "paths through displayPath" }, schema: [], messages: { raw: "{{name}} is shown raw: use displayPath() or <PathText>." } },
  create(context) {
    return {
      SvelteMustacheTag(node) {
        if (node.kind !== "text" || node.parent?.type === "SvelteAttribute") return;
        const name = nameOf(node.expression);
        if (name && PATHLIKE.test(name)) context.report({ node, messageId: "raw", data: { name } });
      },
    };
  },
};

/** A tooltip that says what the element already shows is noise; full text only while cut off (fullText). */
const tooltipRepeatsText = {
  meta: { type: "problem", docs: { description: "tooltip repeats text" }, schema: [], messages: { repeat: "The tooltip repeats the visible text; use fullText if it may be cut off." } },
  create(context) {
    const src = context.sourceCode ?? context.getSourceCode();
    return {
      SvelteElement(node) {
        const tip = node.startTag.attributes.find((a) => a.type === "SvelteDirective" && a.kind === "Action" && a.key?.name?.name === "tooltip");
        if (!tip?.expression) return;
        const kids = node.children.filter((c) => !(c.type === "SvelteText" && !c.value.trim()));
        if (kids.length === 1 && kids[0].type === "SvelteMustacheTag" && src.getText(kids[0].expression) === src.getText(tip.expression)) {
          context.report({ node: tip, messageId: "repeat" });
        }
      },
    };
  },
};

export default {
  meta: { name: "mbf" },
  rules: {
    "no-literal-ui-text": noLiteralUiText,
    "no-break-all": noBreakAll,
    "no-native-title": noNativeTitle,
    "no-raw-color": noRawColor,
    "raw-path-display": rawPathDisplay,
    "tooltip-repeats-text": tooltipRepeatsText,
  },
};
