<!-- footer: Draft for discussion -->
<!-- author: md-editor -->

# Markdown Editor Sample

## A tour of what the live preview renders

This paragraph has **bold text**, *italic text*, `inline code`, ~~struck text~~ and a [link to Helix](https://helix-editor.com). Move the cursor onto a line to see its raw markdown; move away and it renders again.

**Label paragraphs** open with bold, which the docx export colors as a mini-heading.

### Lists

- First bullet, with **emphasis** mid-sentence
- Second bullet
  continued on an indented line
- [ ] An open task
- [x] A finished task

1. Numbered item one
2. Numbered item two
3. Numbered item three

### A table

| Phase | Weeks | Owner | Cost |
|---|---|---|---:|
| Discovery | 1–2 | Design | $4,000 |
| **Build** | 3–8 | Engineering | $18,500 |
| Rollout | 9 | Operations | $2,500 |
| **Total** | | | **$25,000** |

> A blockquote, for the occasional quotation.

---

### Code

```ts
function greet(name: string): string {
  return `hello, ${name}`;
}
```

That's the tour. Try `w`, `b`, `e`, `x`, `mi(`, `ms*`, Enter for jump labels, and `:export-docx`.
