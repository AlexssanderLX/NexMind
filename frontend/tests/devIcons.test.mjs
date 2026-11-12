// Testa os ícones do explorador do Nex Dev (lib/devIcons.ts).
// Rodar: node --experimental-strip-types --test frontend/tests/devIcons.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { fileIcon } from "../src/lib/devIcons.ts";

test("ícones: .cs, .ts, .tsx, .json, .md e .ps1 têm selo próprio", () => {
  assert.equal(fileIcon("Program.cs").label, "C#");
  assert.equal(fileIcon("api.ts").label, "TS");
  assert.equal(fileIcon("App.tsx").label, "TSX");
  assert.equal(fileIcon("appsettings.json").label, "{}");
  assert.equal(fileIcon("README.md").label, "M↓");
  assert.equal(fileIcon("iniciar-nex.ps1").label, ">_");
  const labels = new Set(["Program.cs", "api.ts", "App.tsx", "a.json", "a.md", "a.ps1"].map((n) => fileIcon(n).label));
  assert.equal(labels.size, 6, "todos diferentes");
});

test("ícones: nome conta mais que extensão; maiúsculas não importam", () => {
  assert.equal(fileIcon("package.json").label, "npm");
  assert.equal(fileIcon(".gitignore").label, "git");
  assert.equal(fileIcon("PROGRAM.CS").label, "C#");
});

test("ícones: sem extensão ou desconhecida usa o selo genérico", () => {
  for (const n of ["LICENSE", "arquivo.xyz", ".env", "termina."]) assert.equal(fileIcon(n).label, "·", n);
  assert.ok(fileIcon("x.cs").color.startsWith("text-"));
});
